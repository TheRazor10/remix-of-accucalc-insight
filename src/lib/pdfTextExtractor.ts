import * as pdfjsLib from 'pdfjs-dist';
import { ExtractedSalesPdfData } from './salesComparisonTypes';
import { isGarbledText, extractScannedPdfWithOcr } from './pdfOcrFallback';

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

/**
 * Extract text content from a native PDF file.
 * Returns the raw text for pattern matching.
 */
export async function extractPdfText(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  let fullText = '';

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();

    const pageText = textContent.items
      .map((item: any) => item.str)
      .join(' ');

    fullText += pageText + '\n';
  }

  return fullText;
}

/**
 * Extract structured invoice data from PDF text.
 * Uses regex patterns to find document number, date, amounts, etc.
 */
export function parseInvoiceFromText(
  text: string,
  fileIndex: number,
  fileName: string,
  firmVatId: string | null = null
): ExtractedSalesPdfData {
  // Normalize whitespace for easier pattern matching
  const normalizedText = text.replace(/\s+/g, ' ').trim();

  // Debug: Log the raw and normalized text for troubleshooting
  console.log(`[PDF Extract] File: ${fileName}`);
  console.log(`[PDF Extract] Raw text length: ${text.length}`);
  console.log(`[PDF Extract] First 500 chars:`, text.substring(0, 500));
  console.log(`[PDF Extract] Normalized (first 800 chars):`, normalizedText.substring(0, 800));

  // Extract document type
  const documentType = extractDocumentType(normalizedText);
  console.log(`[PDF Extract] Document type:`, documentType);

  // Extract document number (10-digit Bulgarian invoice numbers)
  const documentNumber = extractDocumentNumber(normalizedText);
  console.log(`[PDF Extract] Document number:`, documentNumber);

  // Extract date
  const documentDate = extractDate(normalizedText);
  console.log(`[PDF Extract] Document date:`, documentDate);

  // Extract seller and client IDs as a coordinated pair, using known firm ID to disambiguate
  const { sellerId, clientId } = extractSellerAndClientIds(normalizedText, firmVatId);
  console.log(`[PDF Extract] Seller ID:`, sellerId);
  console.log(`[PDF Extract] Client ID:`, clientId);

  // Extract client name
  const clientName = extractClientName(normalizedText);

  // Extract amounts
  const { taxBase, vat, vatRate } = extractAmounts(normalizedText);
  console.log(`[PDF Extract] Tax base:`, taxBase, `VAT:`, vat, `Rate:`, vatRate);

  return {
    pdfIndex: fileIndex,
    fileName,
    documentType,
    documentNumber,
    documentDate,
    sellerId,
    clientId,
    clientName,
    taxBaseAmount: taxBase,
    vatAmount: vat,
    vatRate,
    rawText: text,
    extractionMethod: 'native',
  };
}

/**
 * Extract document type from text.
 */
function extractDocumentType(text: string): string | null {
  const upperText = text.toUpperCase();

  if (upperText.includes('КРЕДИТНО ИЗВЕСТИЕ') || upperText.includes('CREDIT NOTE')) {
    return 'КРЕДИТНО ИЗВЕСТИЕ';
  }
  if (upperText.includes('ДЕБИТНО ИЗВЕСТИЕ') || upperText.includes('DEBIT NOTE')) {
    return 'ДЕБИТНО ИЗВЕСТИЕ';
  }
  if (upperText.includes('ФАКТУРА') || upperText.includes('INVOICE')) {
    return 'ФАКТУРА';
  }

  return null;
}

/**
 * Extract document number.
 * Bulgarian invoices typically have 10-digit numbers.
 */
function extractDocumentNumber(text: string): string | null {
  // Look for patterns like "Фактура № 1234567890" or "№ 1234567890 / DATE"
  const patterns = [
    /(?:фактура|invoice|известие)\s*[№#:]\s*(\d{7,10})/i,
    // Pattern for "№ NUMBER / DATE" format
    /№\s*(\d{7,10})\s*\/\s*\d{1,2}\.\d{1,2}\.\d{4}/i,
    /(?:№|#|No\.?)\s*(\d{7,10})/i,
    /номер\s*[:\s]*(\d{7,10})/i,
    /(\d{10})/, // Fallback: any 10-digit number
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return match[1];
    }
  }

  // Try to find any long number that could be invoice number
  const longNumMatch = text.match(/\b(\d{7,12})\b/);
  return longNumMatch ? longNumMatch[1] : null;
}

/**
 * Extract date from text.
 * Prioritizes invoice issue date patterns over general dates.
 */
function extractDate(text: string): string | null {
  // Priority 0: Date after document number with "/" separator (e.g., "№ 7000005226 / 05.01.2026")
  const numberSlashDatePattern = /№\s*\d{7,10}\s*\/\s*(\d{1,2}\.\d{1,2}\.\d{4})/i;
  const numberSlashMatch = text.match(numberSlashDatePattern);
  if (numberSlashMatch) {
    return numberSlashMatch[1];
  }

  // Priority 1: Specific invoice date patterns (most reliable)
  const invoiceDatePatterns = [
    /(?:дата на издаване|issue date)[:\s]*(\d{1,2}[.\/]\d{1,2}[.\/]\d{4})\s*(?:г\.?)?/i,
    /(?:дата на док(?:умента)?|document date)[:\s]*(\d{1,2}[.\/]\d{1,2}[.\/]\d{4})\s*(?:г\.?)?/i,
    /(?:дата на фактура|invoice date)[:\s]*(\d{1,2}[.\/]\d{1,2}[.\/]\d{4})\s*(?:г\.?)?/i,
    /(?:дата на дан\.\s*събитие|tax event date)[:\s]*(\d{1,2}[.\/]\d{1,2}[.\/]\d{4})\s*(?:г\.?)?/i,
  ];

  for (const pattern of invoiceDatePatterns) {
    const match = text.match(pattern);
    if (match) {
      return match[1].replace(/\//g, '.').replace(/\s/g, '');
    }
  }

  // Priority 2: Generic "дата" keyword near a date (but not contract/offer dates)
  const genericDatePattern = /(?<!договор от\s*)(?<!оферта от\s*)(?:дата|date)[:\s]*(\d{1,2}[.\/]\d{1,2}[.\/]\d{4})/i;
  const genericMatch = text.match(genericDatePattern);
  if (genericMatch) {
    return genericMatch[1].replace(/\//g, '.');
  }

  // Priority 3: Fallback - first date that's NOT preceded by contract/offer keywords
  const allDates = text.matchAll(/(\d{1,2}\.\d{1,2}\.\d{4})\s*(?:г\.?)?/g);
  for (const match of allDates) {
    const idx = match.index || 0;
    const before = text.substring(Math.max(0, idx - 30), idx).toLowerCase();
    // Skip dates that appear after contract/offer keywords
    if (!before.includes('договор') && !before.includes('оферта') && !before.includes('contract') && !before.includes('offer')) {
      return match[1];
    }
  }

  return null;
}

/**
 * Normalize a VAT ID for comparison: uppercase, no spaces, strip "BG" prefix.
 */
function normalizeVatId(id: string): string {
  return id.replace(/\s/g, '').toUpperCase().replace(/^BG/, '');
}

/**
 * Check if two VAT IDs refer to the same entity.
 */
function vatIdsMatch(a: string, b: string): boolean {
  return normalizeVatId(a) === normalizeVatId(b);
}

/**
 * Extract seller and client IDs as a coordinated pair.
 * When firmVatId (our supplier ID) is known, any extracted ID matching it
 * is assigned as seller and the remaining ID becomes the client.
 */
function extractSellerAndClientIds(
  text: string,
  firmVatId: string | null = null
): { sellerId: string | null; clientId: string | null } {
  // Collect all BG VAT numbers found in the text (deduplicated)
  const allBgNumbers: string[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(/BG\s*(\d{9,10})/gi)) {
    const normalized = 'BG' + m[1];
    const key = normalized.toUpperCase();
    if (!seen.has(key)) {
      seen.add(key);
      allBgNumbers.push(normalized);
    }
  }

  // Collect all EIK numbers
  const allEikNumbers: string[] = [];
  const seenEik = new Set<string>();
  for (const m of text.matchAll(/еик[:\s]*(\d{9,13})/gi)) {
    if (!seenEik.has(m[1])) {
      seenEik.add(m[1]);
      allEikNumbers.push(m[1]);
    }
  }

  // PRIORITY: If we know our firm VAT ID, use it to disambiguate
  if (firmVatId) {
    const firmMatch = allBgNumbers.find(bg => vatIdsMatch(bg, firmVatId));

    if (firmMatch) {
      // Our firm is the seller — all other IDs are potential clients
      const otherBg = allBgNumbers.filter(bg => !vatIdsMatch(bg, firmVatId));
      const clientFromBg = otherBg.length > 0 ? otherBg[0] : null;
      const clientFromEik = allEikNumbers.length > 0 ? allEikNumbers[0] : null;

      // Also try section-based client extraction for better accuracy
      const sectionClientId = extractClientIdFromSection(text);
      // Prefer section-based if it doesn't match our firm
      const clientId = sectionClientId && !vatIdsMatch(sectionClientId, firmVatId)
        ? sectionClientId
        : clientFromBg || clientFromEik;

      console.log(`[ID Extract] Firm ID ${firmVatId} found in PDF as seller. Client: ${clientId}`);
      return { sellerId: firmMatch.toUpperCase(), clientId };
    }
  }

  // Fallback: Try section-based extraction
  const sellerId = extractSellerIdFromSection(text);
  const clientId = extractClientIdFromSection(text);

  if (sellerId && clientId) {
    return { sellerId, clientId };
  }

  if (sellerId && !clientId) {
    const clientBg = allBgNumbers.find(bg => bg.toUpperCase() !== sellerId.toUpperCase());
    if (clientBg) return { sellerId, clientId: clientBg };
    return { sellerId, clientId: allEikNumbers[0] || null };
  }

  if (!sellerId && clientId) {
    const sellerBg = allBgNumbers.find(bg => bg.toUpperCase() !== clientId.toUpperCase());
    return { sellerId: sellerBg || null, clientId };
  }

  // Neither found via sections — positional heuristic
  if (allBgNumbers.length >= 2) {
    return { sellerId: allBgNumbers[0], clientId: allBgNumbers[1] };
  }
  if (allBgNumbers.length === 1) {
    return { sellerId: allBgNumbers[0], clientId: allEikNumbers[0] || null };
  }

  return {
    sellerId: null,
    clientId: allEikNumbers[0] || null,
  };
}

/**
 * Extract seller ID from dedicated seller section.
 */
function extractSellerIdFromSection(text: string): string | null {
  const sellerPatterns = [
    /доставчик[^]*?ин\s*ддс\s*[:\s]*(BG\s*\d{9,10})/i,
    /(?:доставчик|продавач|издател|supplier|seller|from)[^]*?(?:ддс|vat|идент)[^:]*[:\s]*(BG\d{9,10})/i,
    /(?:доставчик|продавач|издател|supplier|seller|from)[^]*?(BG\s*\d{9,10})/i,
  ];

  for (const pattern of sellerPatterns) {
    const match = text.match(pattern);
    if (match) {
      return match[1].replace(/\s/g, '').toUpperCase();
    }
  }

  return null;
}

/**
 * Extract client ID from dedicated client section.
 */
function extractClientIdFromSection(text: string): string | null {
  // Try to isolate the client section
  let clientSection = '';

  const clientSectionMatch1 = text.match(/клиент[^]*?(?=доставчик|supplier|фактура\s*№|$)/i);
  if (clientSectionMatch1) {
    clientSection = clientSectionMatch1[0];
  }

  if (!clientSection) {
    const clientSectionMatch2 = text.match(/получател[^]*?(?=доставчик|seller|$)/i);
    if (clientSectionMatch2) {
      clientSection = clientSectionMatch2[0];
    }
  }

  if (clientSection) {
    const inDdsMatch = clientSection.match(/ин\s*ддс\s*[:\s]*(BG\s*\d{9,10})/i);
    if (inDdsMatch) return inDdsMatch[1].replace(/\s/g, '').toUpperCase();

    const identMatch = clientSection.match(/идент\.?\s*№?\s*[:\s]*(\d{9,13})/i);
    if (identMatch) return identMatch[1];

    const eikInClientMatch = clientSection.match(/еик[:\s]*(\d{9,13})/i);
    if (eikInClientMatch) return eikInClientMatch[1];

    const vatInClientMatch = clientSection.match(/(?:ддс|vat)[^:]*[:\s]*(BG\s*\d{9,10})/i);
    if (vatInClientMatch) return vatInClientMatch[1].replace(/\s/g, '').toUpperCase();

    const bgInClientMatch = clientSection.match(/BG\s*(\d{9,10})/i);
    if (bgInClientMatch) return 'BG' + bgInClientMatch[1];
  }

  // Fallback patterns
  const clientPatterns = [
    /клиент[^Д]*?идент\.?\s*№?\s*[:\s]*(\d{9,13})/i,
    /клиент[^Д]*?ин\s*ддс\s*[:\s]*(BG\s*\d{9,10})/i,
    /получател[^Д]*?еик[:\s]*(\d{9,13})/i,
    /получател[^Д]*?(?:ддс|vat)[^:]*[:\s]*(BG\s*\d{9,10})/i,
  ];

  for (const pattern of clientPatterns) {
    const match = text.match(pattern);
    if (match) {
      const id = match[1].replace(/\s/g, '');
      return id.match(/^BG/i) ? id.toUpperCase() : id;
    }
  }

  return null;
}

/**
 * Extract client company name.
 */
function extractClientName(text: string): string | null {
  const patterns = [
    /(?:получател|client|buyer)[:\s]*([А-Яа-яA-Za-z\s"'„"]+?)(?:\s*(?:ддс|еик|адрес|address))/i,
    /(?:фирма|company)[:\s]*([А-Яа-яA-Za-z\s"'„"]+?)(?:\s*(?:ддс|еик|адрес|address))/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return match[1].trim().replace(/\s+/g, ' ');
    }
  }

  return null;
}

/**
 * Extract tax base and VAT amounts.
 */
function extractAmounts(text: string): {
  taxBase: number | null;
  vat: number | null;
  vatRate: number | null;
} {
  let taxBase: number | null = null;
  let vat: number | null = null;
  let vatRate: number | null = null;

  // PRIORITY: Look for BGN amounts first (sales journal uses BGN)
  const taxBaseBgnPatterns = [
    /данъчна основа[^B]*?bgn\s*([\d]+[.,][\d]{2})/i,
    /данъчна основа[^\d]*?([\d]+[.,][\d]{2})\s*(?:лв|bgn)/i,
    /данъчна основа[^\d]*?([\d]+[.,][\d]{2})/i,
    /tax base[^\d]*?([\d]+[.,][\d]{2})/i,
    /д\.о\.[^\d]*?([\d]+[.,][\d]{2})/i,
  ];

  for (const pattern of taxBaseBgnPatterns) {
    const match = text.match(pattern);
    if (match) {
      taxBase = parseAmountFromText(match[1]);
      if (taxBase !== null && taxBase > 0) break;
    }
  }

  // VAT - BGN priority patterns
  const vatBgnPatterns = [
    /начислен\s*ддс[^B]*?bgn\s*([\d]+[.,][\d]{2})/i,
    /начислен\s*ддс[^\d]*?([\d]+[.,][\d]{2})\s*(?:лв|bgn)/i,
    /ддс\s*\([^)]*\)[^\d]*?([\d]+[.,][\d]{2})/i,
    /(?:начислен\s+)?ддс[^\d]*?([\d]+[.,][\d]{2})/i,
    /vat[^\d]*?([\d]+[.,][\d]{2})/i,
  ];

  for (const pattern of vatBgnPatterns) {
    const match = text.match(pattern);
    if (match) {
      vat = parseAmountFromText(match[1]);
      if (vat !== null && vat > 0) break;
    }
  }

  // Try to determine VAT rate from text
  if (text.match(/20[.,]?00?\s*%/) || text.includes('20%') || text.includes('20 %')) {
    vatRate = 20;
  } else if (text.match(/9[.,]?00?\s*%/) || text.includes('9%') || text.includes('9 %')) {
    vatRate = 9;
  } else if (text.includes('0%') || text.includes('нулева ставка')) {
    vatRate = 0;
  }

  // If we found VAT and tax base doesn't match, try total - vat
  if (vat !== null && taxBase === null) {
    const totalPatterns = [
      /сума за плащане[^€E]*?([\d]+[.,][\d]{2})\s*eur/i,
      /сума за плащане[^\d]*?([\d]+[.,][\d]{2})/i,
      /общо[^€E]*?([\d]+[.,][\d]{2})\s*eur/i,
      /общо[^\d]*?([\d]+[.,][\d]{2})/i,
      /total[^€E]*?([\d]+[.,][\d]{2})\s*eur/i,
      /total[^\d]*?([\d]+[.,][\d]{2})/i,
    ];

    for (const pattern of totalPatterns) {
      const match = text.match(pattern);
      if (match) {
        const total = parseAmountFromText(match[1]);
        if (total !== null && total > vat) {
          taxBase = Math.round((total - vat) * 100) / 100;
          break;
        }
      }
    }
  }

  return { taxBase, vat, vatRate };
}

/**
 * Parse amount from text, handling Bulgarian number formatting.
 */
function parseAmountFromText(amountStr: string): number | null {
  if (!amountStr) return null;

  let cleaned = amountStr
    .replace(/\s/g, '')
    .replace(/,/g, '.')
    .replace(/[^\d.\-]/g, '');

  // Handle cases with multiple dots (thousands separator)
  const parts = cleaned.split('.');
  if (parts.length > 2) {
    const decimalPart = parts.pop();
    cleaned = parts.join('') + '.' + decimalPart;
  }

  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

/**
 * Process multiple PDF files and extract invoice data.
 */
export async function extractMultiplePdfInvoices(
  files: File[],
  onProgress?: (completed: number, total: number, currentFileName?: string) => void,
  firmVatId?: string | null
): Promise<ExtractedSalesPdfData[]> {
  const results: ExtractedSalesPdfData[] = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    onProgress?.(i, files.length, file.name);

    try {
      // First, try native text extraction
      const text = await extractPdfText(file);

      // Check if text is garbled (scanned PDF)
      if (isGarbledText(text)) {
        console.log(`[PDF Extract] Detected scanned PDF: ${file.name}, using OCR fallback`);
        const ocrData = await extractScannedPdfWithOcr(file, i);
        results.push(ocrData);
      } else {
        // Native text is readable, use regex parsing
        const data = parseInvoiceFromText(text, i, file.name, firmVatId);
        results.push(data);
      }
    } catch (error) {
      console.error(`Error extracting PDF ${file.name}:`, error);
      results.push({
        pdfIndex: i,
        fileName: file.name,
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
        extractionMethod: 'native',
      });
    }
  }

  onProgress?.(files.length, files.length);
  return results;
}

/**
 * Process multiple scanned PDF files using OCR only.
 * Use this when user explicitly marks files as scanned.
 */
export async function extractMultipleScannedPdfs(
  files: File[],
  startIndex: number = 0,
  onProgress?: (completed: number, total: number, currentFileName?: string) => void
): Promise<ExtractedSalesPdfData[]> {
  const results: ExtractedSalesPdfData[] = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    onProgress?.(i, files.length, file.name);

    try {
      console.log(`[PDF Extract] Processing scanned PDF via OCR: ${file.name}`);
      const ocrData = await extractScannedPdfWithOcr(file, startIndex + i);
      results.push(ocrData);
    } catch (error) {
      console.error(`Error extracting scanned PDF ${file.name}:`, error);
      results.push({
        pdfIndex: startIndex + i,
        fileName: file.name,
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
        extractionMethod: 'ocr',
      });
    }
  }

  onProgress?.(files.length, files.length);
  return results;
}
