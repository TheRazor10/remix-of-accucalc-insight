/**
 * OCR Fallback for Scanned PDFs
 *
 * Renders PDF pages as images and sends them to the local
 * Express/Gemini server for AI-powered OCR extraction.
 */

import * as pdfjsLib from 'pdfjs-dist';
import { ExtractedSalesPdfData } from './salesComparisonTypes';
import { STANDALONE_CONFIG } from '@/config/constants';

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

/**
 * Detect if extracted text is garbled (from scanned PDF).
 * Scanned PDFs produce OCR-like noise with unusual character patterns.
 */
export function isGarbledText(text: string): boolean {
  if (!text || text.length < 50) return true;

  // Clean whitespace for analysis
  const cleaned = text.replace(/\s+/g, ' ').trim();

  // Check for common Bulgarian/invoice keywords that should be readable
  const expectedKeywords = [
    'фактура', 'invoice', 'дата', 'ддс', 'vat', 'клиент', 'доставчик',
    'данъчна основа', 'получател', 'сума', 'лева', 'bgn', 'eur',
    'еик', 'идент', 'адрес', 'номер'
  ];

  const lowerText = cleaned.toLowerCase();
  const foundKeywords = expectedKeywords.filter(kw => lowerText.includes(kw));

  // If we find at least 3 expected keywords, text is likely readable
  if (foundKeywords.length >= 3) {
    return false;
  }

  // Check for excessive unusual character patterns (garbled OCR output)
  const unusualPatternCount = (cleaned.match(/[A-Z]{2,}[a-z][A-Z]/g) || []).length +
                               (cleaned.match(/[a-z][0-9][a-z]/gi) || []).length +
                               (cleaned.match(/[{}\[\]\\]/g) || []).length;

  const unusualRatio = unusualPatternCount / (cleaned.length / 100);

  if (unusualRatio > 2) {
    return true;
  }

  // Check ratio of Cyrillic vs Latin characters for Bulgarian invoices
  const cyrillicCount = (cleaned.match(/[а-яА-ЯёЁ]/g) || []).length;
  const latinCount = (cleaned.match(/[a-zA-Z]/g) || []).length;
  const totalChars = cyrillicCount + latinCount;

  if (totalChars > 50 && cyrillicCount < totalChars * 0.1) {
    const garbledPatterns = (cleaned.match(/[AEOPC][aeopc]/g) || []).length;
    if (garbledPatterns > 5) {
      return true;
    }
  }

  return false;
}

/**
 * Convert PDF page to base64 image for OCR processing.
 */
async function pdfPageToImage(pdf: pdfjsLib.PDFDocumentProxy, pageNum: number): Promise<{ base64: string; mimeType: string }> {
  const page = await pdf.getPage(pageNum);

  // Use moderate scale for OCR accuracy while keeping payload manageable
  const scale = 1.2;
  const viewport = page.getViewport({ scale });

  // Create canvas - cap dimensions to avoid oversized payloads
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d')!;

  const maxDim = 2000;
  let renderViewport = viewport;
  if (viewport.width > maxDim || viewport.height > maxDim) {
    const ratio = Math.min(maxDim / viewport.width, maxDim / viewport.height);
    const cappedScale = scale * ratio;
    renderViewport = page.getViewport({ scale: cappedScale });
  }

  canvas.width = Math.floor(renderViewport.width);
  canvas.height = Math.floor(renderViewport.height);

  // Render page to canvas using the same viewport as the canvas dimensions
  await page.render({
    canvasContext: context,
    viewport: renderViewport,
  }).promise;

  // Convert to base64 PNG (more reliable than JPEG for OCR)
  const dataUrl = canvas.toDataURL('image/png');

  console.log(`[OCR] Image dimensions: ${canvas.width}x${canvas.height}, base64 length: ${dataUrl.length}`);

  // Extract base64 part
  return { base64: dataUrl.split(',')[1], mimeType: 'image/png' };
}

/**
 * Extract invoice data from a scanned PDF using the local Gemini server.
 * Adapted from the Lovable Cloud version to use the local Express server.
 */
export async function extractScannedPdfWithOcr(
  file: File,
  fileIndex: number,
  firmVatId: string | null = null,
  useProModel: boolean = false
): Promise<ExtractedSalesPdfData> {
  try {
    console.log(`[OCR Fallback] Processing scanned PDF: ${file.name} (Pro: ${useProModel})`);

    // Load PDF
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    // Process the first page (most invoices are single-page)
    const { base64: imageBase64, mimeType } = await pdfPageToImage(pdf, 1);

    console.log(`[OCR Fallback] Sending to local Gemini server for OCR (${imageBase64.length} chars)...`);

    // Build ownCompanyIds to help Gemini distinguish seller from client
    const ownCompanyIds = firmVatId ? [firmVatId] : [];

    // Call the local Express/Gemini server
    const response = await fetch(`${STANDALONE_CONFIG.standaloneServerUrl}/extract-invoice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageBase64,
        mimeType,
        useProModel,
        ownCompanyIds,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Server error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();

    console.log(`[OCR Fallback] OCR result:`, data);

    // Map OCR result to ExtractedSalesPdfData
    return {
      pdfIndex: fileIndex,
      fileName: file.name,
      documentType: data.documentType || null,
      documentNumber: data.documentNumber || null,
      documentDate: data.documentDate || null,
      sellerId: data.supplierId || null,
      clientId: data.clientId || null,
      clientName: null,
      taxBaseAmount: data.taxBaseAmount ?? null,
      vatAmount: data.vatAmount ?? null,
      vatRate: null,
      rawText: '',
      extractionMethod: 'ocr',
      usedProModel: useProModel,
    };
  } catch (error) {
    console.error(`[OCR Fallback] Error processing ${file.name}:`, error);
    return createEmptyExtractedData(fileIndex, file.name, 'ocr');
  }
}

/**
 * Create empty extracted data when extraction fails.
 */
function createEmptyExtractedData(
  index: number,
  fileName: string,
  method: 'native' | 'ocr'
): ExtractedSalesPdfData {
  return {
    pdfIndex: index,
    fileName,
    documentType: null,
    documentNumber: null,
    documentDate: null,
    sellerId: null,
    clientId: null,
    clientName: null,
    taxBaseAmount: null,
    vatAmount: null,
    vatRate: null,
    rawText: '',
    extractionMethod: method,
  };
}
