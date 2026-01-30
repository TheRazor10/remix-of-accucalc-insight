/**
 * Standalone Invoice Extraction Server
 * 
 * This Express server handles Gemini API calls for invoice OCR extraction.
 * Run this locally alongside the Vite frontend.
 * 
 * Setup:
 *   1. cd standalone
 *   2. npm install express cors dotenv @google/generative-ai
 *   3. Create .env file with: GEMINI_API_KEY=your_api_key_here
 *   4. node server.js
 * 
 * The server runs on http://localhost:3001
 */

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { GoogleGenerativeAI } from '@google/generative-ai';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Validate environment
if (!process.env.GEMINI_API_KEY) {
  console.error('ERROR: GEMINI_API_KEY is not set in .env file');
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// System prompt for Bulgarian invoice extraction
const SYSTEM_PROMPT = `You are an expert OCR system specialized in extracting data from Bulgarian invoices (фактури). 
Your task is to extract specific fields from invoice images accurately.

CRITICAL - SLASHED ZERO RECOGNITION:
Many Bulgarian thermal receipts and dot-matrix printed invoices use a SLASHED ZERO (0 with a diagonal line through it, like ø).
This is commonly confused with the digit 8 or 9. When you see a digit that looks like:
- A zero with a diagonal slash through it (ø or 0̷) → This is the digit "0"
- An 8-like shape but with a clear diagonal line → This is likely "0" not "8"
Pay special attention to invoice numbers, company IDs (EIK/ДДС номер), and amounts on thermal receipts.

Extract the following fields:
1. Document Type (Вид на документа) - MUST be one of: "ФАКТУРА", "КРЕДИТНО ИЗВЕСТИЕ", "ДЕБИТНО ИЗВЕСТИЕ"
   - IMPORTANT: "ОРИГИНАЛ", "КОПИЕ", "ДУБЛИКАТ" are document COPY STATUSES, NOT document types - IGNORE these!
   - Look for "ФАКТУРА №" or "ФАКТУРА N:" to identify an invoice
   - The document type is the category of the document, not its copy status
2. Document Number (Номер на документа) - the invoice number, usually after "ФАКТУРА №" or "ФАКТУРА N:" or "№"
3. Document Date (Дата на документа) - the issue date, usually labeled "Дата:" or "Дата на издаване:" or "Дата дан.събитие:"
4. Supplier ID (ДДС номер или ЕИК на доставчика) - the VAT number (starts with BG) or company ID (9 digits) of the SUPPLIER (Доставчик)
5. Tax Base Amount (Данъчна основа) - the TOTAL taxable base for the ENTIRE invoice, NOT page subtotals
6. VAT Amount (ДДС) - the TOTAL VAT amount for the ENTIRE invoice, usually 20% of tax base

CRITICAL - CURRENCY PRIORITY (EUR vs BGN):
Many Bulgarian invoices show amounts in BOTH EUR and BGN (лева). You MUST:
1. FIRST look for amounts in EUR (€, EUR, евро) - these are the PRIMARY values to extract
2. ONLY if EUR amounts are NOT present, use the BGN (лв., лева, BGN) amounts as fallback
3. The EUR amount is typically shown alongside or above the BGN equivalent

CRITICAL for Tax Base Amount - look for these labels IN ORDER OF PRIORITY:
1. "Данъчна основа" = Tax Base (MOST COMMON - use this first)
2. "Общо без ДДС" = Total without VAT (COMMON)
3. "НЕТО СУМА" or "Общо нето" = Net Amount (fallback for some vendors like Metro)
For each label, prefer the EUR value if both EUR and BGN are shown.

CRITICAL for VAT Amount - look for these labels:
- "ДДС" followed by amount
- "НАЧИСЛЕН ДДС" or "ДДС НАЧИСЛ. ДДС"
- "В=20%" section showing VAT calculation
- "ОБЩА СУМА" minus "Данъчна основа" = VAT (for verification)
For each label, prefer the EUR value if both EUR and BGN are shown.

DO NOT extract these (they are page subtotals, not invoice totals):
- "Стр. Общо" = Page subtotal - IGNORE THIS
- "Посл. Стр. Общо" = Previous page subtotal - IGNORE THIS

Important notes:
- For dates, use DD.MM.YYYY format
- For amounts, extract only the numeric value (can be negative for credit notes)
- Preserve negative signs for credit notes (КРЕДИТНО ИЗВЕСТИЕ)
- The Supplier ID is from the seller/issuer (Доставчик), NOT the buyer (Получател)
- Look for ДДС № or ЕИК near the supplier company name at the top of the invoice
- If a field cannot be read clearly, return null for that field

Return a confidence level:
- "high": All fields clearly readable
- "medium": Most fields readable, some uncertainty
- "low": Significant difficulty reading some fields
- "unreadable": Cannot extract meaningful data

IMPORTANT: Return your response as valid JSON with these exact fields:
{
  "documentType": string or null,
  "documentNumber": string or null,
  "documentDate": string or null,
  "supplierId": string or null,
  "taxBaseAmount": number or null,
  "vatAmount": number or null,
  "confidence": "high" | "medium" | "low" | "unreadable"
}`;

// Extract invoice endpoint
app.post('/extract-invoice', async (req, res) => {
  try {
    const { imageBase64, mimeType, useProModel, ownCompanyIds } = req.body;

    if (!imageBase64 || typeof imageBase64 !== 'string') {
      return res.status(400).json({ error: 'Invalid image data: imageBase64 must be a non-empty string' });
    }

    // Build dynamic prompt with optional company ID exclusion
    const ownCompanyIdsList = Array.isArray(ownCompanyIds) 
      ? ownCompanyIds.filter(id => id && id.trim()).map(id => id.trim().toUpperCase())
      : [];
    
    let companyIdExclusionNote = '';
    if (ownCompanyIdsList.length > 0) {
      companyIdExclusionNote = `\n\nCRITICAL - EXCLUDE OWN COMPANY IDs:
The following IDs belong to the document OWNER (buyer/receiver), NOT the supplier:
${ownCompanyIdsList.map(id => `- ${id}`).join('\n')}
You MUST extract the COUNTERPARTY's ID (the other company on the invoice), NOT any of the above IDs.
If you see one of these IDs, it is the buyer - look for the OTHER company's ID.`;
    }

    const fullPrompt = SYSTEM_PROMPT + companyIdExclusionNote + '\n\nPlease extract the invoice data from this image and return it as JSON.';

    // Select model based on useProModel flag
    const modelName = useProModel ? 'gemini-2.5-pro-preview-05-06' : 'gemini-2.5-flash-preview-05-20';
    const model = genAI.getGenerativeModel({ model: modelName });

    // Prepare the image for Gemini
    const imagePart = {
      inlineData: {
        data: imageBase64,
        mimeType: mimeType || 'image/jpeg',
      },
    };

    console.log(`[${new Date().toISOString()}] Processing image with ${modelName}...`);

    const result = await model.generateContent([fullPrompt, imagePart]);
    const response = await result.response;
    const text = response.text();

    // Parse the JSON response
    let extractedData;
    try {
      // Try to extract JSON from the response (it might be wrapped in markdown code blocks)
      const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/```\s*([\s\S]*?)\s*```/);
      const jsonStr = jsonMatch ? jsonMatch[1] : text;
      extractedData = JSON.parse(jsonStr.trim());
    } catch (parseError) {
      console.error('Failed to parse Gemini response:', text);
      extractedData = {
        documentType: null,
        documentNumber: null,
        documentDate: null,
        supplierId: null,
        taxBaseAmount: null,
        vatAmount: null,
        confidence: 'unreadable',
      };
    }

    console.log(`[${new Date().toISOString()}] Extracted:`, extractedData);
    res.json(extractedData);

  } catch (error) {
    console.error('Error in extract-invoice:', error);
    res.status(500).json({
      error: error.message || 'Unknown error',
      documentType: null,
      documentNumber: null,
      documentDate: null,
      supplierId: null,
      taxBaseAmount: null,
      vatAmount: null,
      confidence: 'unreadable',
    });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`\n🚀 Invoice Extraction Server running on http://localhost:${PORT}`);
  console.log(`   POST /extract-invoice - Extract data from invoice image`);
  console.log(`   GET  /health         - Health check\n`);
});
