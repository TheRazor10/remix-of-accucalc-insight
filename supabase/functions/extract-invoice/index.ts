import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

// Input validation constants
const MAX_BASE64_SIZE = 10 * 1024 * 1024; // 10MB limit for base64 string
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

interface ExtractionResult {
  documentType: string | null;
  documentNumber: string | null;
  documentDate: string | null;
  supplierId: string | null;
  taxBaseAmount: number | null;
  vatAmount: number | null;
  confidence: 'high' | 'medium' | 'low' | 'unreadable';
}

serve(async (req) => {
  const origin = req.headers.get('Origin');
  const corsHeaders = getCorsHeaders(origin);

  if (req.method === 'OPTIONS') {
    return handleCorsPreflightRequest(origin);
  }

  try {
    // Verify authentication - require valid JWT token
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'Authentication required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    // Verify the user is authenticated
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid or expired token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // User is authenticated, proceed with extraction
    const { imageBase64, mimeType, useProModel, ownCompanyIds } = await req.json();

    // Validate imageBase64 exists and is a string
    if (!imageBase64 || typeof imageBase64 !== 'string') {
      return new Response(
        JSON.stringify({ error: 'Invalid image data: imageBase64 must be a non-empty string' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate payload size to prevent DoS
    if (imageBase64.length > MAX_BASE64_SIZE) {
      return new Response(
        JSON.stringify({ error: `Image too large. Maximum size is ${MAX_BASE64_SIZE / 1024 / 1024}MB.` }),
        { status: 413, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate and sanitize mimeType - default to image/jpeg if invalid
    const safeMimeType = ALLOWED_MIME_TYPES.includes(mimeType) ? mimeType : 'image/jpeg';

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY is not configured');
    }

    // Build dynamic prompt with optional company ID exclusion
    const ownCompanyIdsList = Array.isArray(ownCompanyIds) 
      ? ownCompanyIds.filter((id: string) => id && id.trim()).map((id: string) => id.trim().toUpperCase())
      : [];
    
    const companyIdExclusionNote = ownCompanyIdsList.length > 0 
      ? `\n\nCRITICAL - EXCLUDE OWN COMPANY IDs:
The following IDs belong to the document OWNER (buyer/receiver), NOT the supplier:
${ownCompanyIdsList.map((id: string) => `- ${id}`).join('\n')}
You MUST extract the COUNTERPARTY's ID (the other company on the invoice), NOT any of the above IDs.
If you see one of these IDs, it is the buyer - look for the OTHER company's ID.`
      : '';

    const systemPrompt = `You are an expert OCR system specialized in extracting data from Bulgarian invoices (фактури). 
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
${companyIdExclusionNote}

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
- "unreadable": Cannot extract meaningful data`;

    const userPrompt = `Please extract the invoice data from this image and return it using the extract_invoice_data function.`;

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: useProModel ? 'google/gemini-2.5-pro' : 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: [
              { type: 'text', text: userPrompt },
              {
                type: 'image_url',
                image_url: {
                  url: `data:${safeMimeType};base64,${imageBase64}`,
                },
              },
            ],
          },
        ],
        tools: [
          {
            type: 'function',
            function: {
              name: 'extract_invoice_data',
              description: 'Extract structured data from a Bulgarian invoice image',
              parameters: {
                type: 'object',
                properties: {
                  documentType: {
                    type: 'string',
                    description: 'Type of document: ФАКТУРА, КРЕДИТНО ИЗВЕСТИЕ, etc.',
                    nullable: true,
                  },
                  documentNumber: {
                    type: 'string',
                    description: 'Invoice/document number',
                    nullable: true,
                  },
                  documentDate: {
                    type: 'string',
                    description: 'Document date in DD.MM.YYYY format',
                    nullable: true,
                  },
                  supplierId: {
                    type: 'string',
                    description: 'Supplier VAT number (BG...) or company ID (9 digits)',
                    nullable: true,
                  },
                  taxBaseAmount: {
                    type: 'number',
                    description: 'Tax base amount (данъчна основа) as a number, can be negative for credit notes',
                    nullable: true,
                  },
                  vatAmount: {
                    type: 'number',
                    description: 'VAT amount (ДДС) as a number, usually 20% of tax base, can be negative for credit notes',
                    nullable: true,
                  },
                  confidence: {
                    type: 'string',
                    enum: ['high', 'medium', 'low', 'unreadable'],
                    description: 'Confidence level of the extraction',
                  },
                },
                required: ['confidence'],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: 'function', function: { name: 'extract_invoice_data' } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: 'Rate limit exceeded. Please try again later.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: 'Payment required. Please add credits to your workspace.' }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      const errorText = await response.text();
      console.error('AI Gateway error:', response.status, errorText);
      throw new Error(`AI Gateway error: ${response.status}`);
    }

    const aiResponse = await response.json();
    
    // Extract the function call result
    const toolCall = aiResponse.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall || toolCall.function.name !== 'extract_invoice_data') {
      console.error('Unexpected response format:', JSON.stringify(aiResponse));
      return new Response(
        JSON.stringify({
          documentType: null,
          documentNumber: null,
          documentDate: null,
          supplierId: null,
          taxBaseAmount: null,
          vatAmount: null,
          confidence: 'unreadable',
        } as ExtractionResult),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const extractedData = JSON.parse(toolCall.function.arguments) as ExtractionResult;
    
    return new Response(
      JSON.stringify(extractedData),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in extract-invoice:', error);
    const origin = req.headers.get('Origin');
    const corsHeaders = getCorsHeaders(origin);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Unknown error',
        documentType: null,
        documentNumber: null,
        documentDate: null,
        supplierId: null,
        taxBaseAmount: null,
        vatAmount: null,
        confidence: 'unreadable',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
