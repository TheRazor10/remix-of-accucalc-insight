import {
  InvoiceExcelRow,
  ExtractedInvoiceData,
  FieldComparison,
  ComparisonResult,
  VerificationSummary,
  DOCUMENT_TYPE_MAPPING,
} from './invoiceComparisonTypes';
import { normalizeDocumentNumber, normalizeDate, datesMatch } from './purchaseJournalParser';
import type { UploadedFile } from '@/components/MultiImageUpload';
import { API_CONFIG, INVOICE_CONFIG, STANDALONE_CONFIG } from '@/config/constants';


/**
 * Extract invoice data from an uploaded file using AI OCR
 */
// Custom error for rate limiting
class RateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RateLimitError';
  }
}

// Sleep utility
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Check if error is a retryable error (rate limit or overloaded)
const isRetryableError = (error: unknown): boolean => {
  if (error instanceof RateLimitError) return true;
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return msg.includes('429') ||
           msg.includes('rate limit') ||
           msg.includes('too many requests') ||
           msg.includes('503') ||
           msg.includes('overloaded') ||
           msg.includes('service unavailable');
  }
  return false;
};

// Create unreadable result for failed extractions
const createUnreadableResult = (file: UploadedFile, index: number, usedProModel: boolean = false): ExtractedInvoiceData => ({
  imageIndex: index,
  fileName: file.originalFile.name,
  documentType: null,
  documentNumber: null,
  documentDate: null,
  supplierId: null,
  taxBaseAmount: null,
  vatAmount: null,
  confidence: 'unreadable',
  usedProModel,
});

// Shared helper to parse amount with negative handling
const parseAmountValue = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  
  let amountStr = String(value).trim();
  
  // Handle accounting notation with parentheses for negative: (1208.33) -> -1208.33
  const isNegativeParens = /^\(.*\)$/.test(amountStr);
  if (isNegativeParens) {
    amountStr = '-' + amountStr.slice(1, -1);
  }
  
  // Preserve the negative sign, remove other non-numeric chars except . , -
  const isNegative = amountStr.startsWith('-');
  amountStr = amountStr
    .replace(/\s/g, '')      // Remove spaces
    .replace(/,/g, '.')      // Bulgarian decimal separator
    .replace(/[^\d.\-]/g, ''); // Keep only digits, dots, and minus
  
  // Ensure negative sign is preserved at the start
  if (isNegative && !amountStr.startsWith('-')) {
    amountStr = '-' + amountStr;
  }
  
  const num = parseFloat(amountStr);
  return isNaN(num) ? null : num;
};

/**
 * Sanitize document number by keeping only the leading numeric portion.
 * Bulgarian invoice numbers are purely numeric (10-digit НАП sequence).
 * This removes any garbage appended by OCR (e.g., dates like "/21.01.2026").
 * 
 * Examples:
 *   "05580209291/21.01.2026" → "05580209291"
 *   "1234567890" → "1234567890"
 *   null → null
 */
const sanitizeDocumentNumber = (docNumber: string | null): string | null => {
  if (!docNumber) return null;
  
  // Extract only the leading digits (stops at first non-digit character)
  const match = docNumber.match(/^\d+/);
  return match ? match[0] : docNumber;
};

/**
 * Call the standalone server API for invoice extraction
 */
async function callStandaloneServer(
  base64: string,
  useProModel: boolean,
  ownCompanyIds: string[]
): Promise<any> {
  const response = await fetch(`${STANDALONE_CONFIG.standaloneServerUrl}/extract-invoice`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      imageBase64: base64,
      mimeType: 'image/jpeg',
      useProModel,
      ownCompanyIds: ownCompanyIds.length > 0 ? ownCompanyIds : undefined,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    if (response.status === 429) {
      throw new RateLimitError('Rate limit exceeded');
    }
    throw new Error(`Server error: ${response.status} - ${errorText}`);
  }

  return response.json();
}

/**
 * Extract invoice data from an uploaded file using AI OCR
 * Throws RateLimitError if rate limited (for retry handling)
 * @param useProModel - If true, uses gemini-2.5-pro instead of flash
 */
async function extractInvoiceDataInternal(
  uploadedFile: UploadedFile,
  fileIndex: number,
  useProModel: boolean = false,
  ownCompanyIds: string[] = []
): Promise<ExtractedInvoiceData> {
  try {
    // Convert image blob to base64
    const arrayBuffer = await uploadedFile.imageBlob.arrayBuffer();
    const base64 = btoa(
      new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
    );

    const data = await callStandaloneServer(base64, useProModel, ownCompanyIds);

    const taxBaseAmount = parseAmountValue(data.taxBaseAmount);
    const vatAmount = parseAmountValue(data.vatAmount);
    const documentNumber = sanitizeDocumentNumber(data.documentNumber);

    return {
      imageIndex: fileIndex,
      fileName: uploadedFile.originalFile.name,
      documentType: data.documentType,
      documentNumber,
      documentDate: data.documentDate,
      supplierId: data.supplierId,
      taxBaseAmount,
      vatAmount,
      confidence: data.confidence || 'medium',
      usedProModel: useProModel,
    };
  } catch (error) {
    // Re-throw rate limit errors for retry handling
    if (isRetryableError(error)) {
      throw error;
    }
    
    console.error('Error in extractInvoiceData:', error);
    return createUnreadableResult(uploadedFile, fileIndex, useProModel);
  }
}

/**
 * Extracts invoice data from an uploaded file using AI-powered OCR.
 * Uses a two-phase approach: first attempts with the fast Flash model,
 * then retries with the Pro model if the result is unreadable.
 *
 * @param uploadedFile - The uploaded file containing the invoice image
 * @param fileIndex - Index of the file in the upload batch (for tracking)
 * @returns Extracted invoice data with confidence level
 * @throws {RateLimitError} When API rate limit is exceeded (for retry handling)
 *
 * @example
 * const result = await extractInvoiceData(uploadedFile, 0);
 * if (result.confidence !== 'unreadable') {
 *   console.log(`Invoice ${result.documentNumber}: ${result.taxBaseAmount} BGN`);
 * }
 */
export async function extractInvoiceData(
  uploadedFile: UploadedFile,
  fileIndex: number,
  ownCompanyIds: string[] = []
): Promise<ExtractedInvoiceData> {
  const fileName = uploadedFile.originalFile.name;
  
  // First attempt with Flash model (fast & cheap)
  console.log(`[OCR] Extracting ${fileName} with Flash model...`);
  const flashResult = await extractInvoiceDataInternal(uploadedFile, fileIndex, false, ownCompanyIds);
  console.log(`[OCR] Flash result: confidence=${flashResult.confidence}, docNum=${flashResult.documentNumber}, amount=${flashResult.taxBaseAmount}`);
  
  // If Flash returned unreadable, retry with Pro model
  if (flashResult.confidence === 'unreadable') {
    console.log(`[OCR] Flash returned unreadable, retrying ${fileName} with Pro model...`);
    
    // Small delay before Pro request
    await sleep(2000);
    
    const proResult = await extractInvoiceDataInternal(uploadedFile, fileIndex, true, ownCompanyIds);
    console.log(`[OCR] Pro result: confidence=${proResult.confidence}, docNum=${proResult.documentNumber}, amount=${proResult.taxBaseAmount}`);
    
    return proResult;
  }
  
  return flashResult;
}

/**
 * Count non-null fields in extracted data (for comparison)
 */
function countExtractedFields(data: ExtractedInvoiceData): number {
  let count = 0;
  if (data.documentType) count++;
  if (data.documentNumber) count++;
  if (data.documentDate) count++;
  if (data.supplierId) count++;
  if (data.taxBaseAmount !== null) count++;
  if (data.vatAmount !== null) count++;
  return count;
}

/**
 * Get confidence score (higher is better)
 */
function getConfidenceScore(confidence: ExtractedInvoiceData['confidence']): number {
  switch (confidence) {
    case 'high': return 3;
    case 'medium': return 2;
    case 'low': return 1;
    case 'unreadable': return 0;
    default: return 0;
  }
}

/**
 * Select the better extraction result by comparing against the matched Excel row.
 * If an Excel row is available, picks whichever extraction has fewer mismatches
 * against it — this prevents Pro from making things worse when Flash was closer.
 * Falls back to confidence + field count when no Excel row is available.
 */
export function selectBetterExtraction(
  original: ExtractedInvoiceData,
  retried: ExtractedInvoiceData,
  matchedExcelRow?: InvoiceExcelRow | null
): ExtractedInvoiceData {
  // If we have an Excel row, compare mismatches directly — this is the ground truth
  if (matchedExcelRow) {
    const originalMismatches = countMismatches(original, matchedExcelRow);
    const retriedMismatches = countMismatches(retried, matchedExcelRow);

    console.log(`[SelectBetter] Comparing against Excel row ${matchedExcelRow.rowIndex}: original=${originalMismatches} mismatches, pro=${retriedMismatches} mismatches`);

    if (retriedMismatches < originalMismatches) {
      console.log(`[SelectBetter] Pro has fewer mismatches, using Pro`);
      return { ...retried, wasDoubleChecked: true };
    }
    if (originalMismatches < retriedMismatches) {
      console.log(`[SelectBetter] Original has fewer mismatches, keeping original`);
      return { ...original, wasDoubleChecked: true };
    }
    // Same mismatch count — fall through to confidence/field comparison
    console.log(`[SelectBetter] Same mismatch count, falling through to confidence comparison`);
  }

  const originalScore = getConfidenceScore(original.confidence);
  const retriedScore = getConfidenceScore(retried.confidence);

  if (retriedScore > originalScore) {
    console.log(`[SelectBetter] Pro result has higher confidence (${retried.confidence} > ${original.confidence})`);
    return { ...retried, wasDoubleChecked: true };
  }

  if (originalScore > retriedScore) {
    console.log(`[SelectBetter] Original has higher confidence (${original.confidence} > ${retried.confidence})`);
    return { ...original, wasDoubleChecked: true };
  }

  // Same confidence - compare field count
  const originalFields = countExtractedFields(original);
  const retriedFields = countExtractedFields(retried);

  if (retriedFields > originalFields) {
    console.log(`[SelectBetter] Pro result has more fields (${retriedFields} > ${originalFields})`);
    return { ...retried, wasDoubleChecked: true };
  }

  // Default to original if equal or original has more
  console.log(`[SelectBetter] Keeping original (fields: ${originalFields} vs ${retriedFields})`);
  return { ...original, wasDoubleChecked: true };
}

/**
 * Re-extract suspicious and unreadable invoices using Pro model.
 * Compares Pro result against the matched Excel row (when available) to ensure
 * Pro doesn't make things worse — only adopts Pro if it has fewer mismatches.
 * Skips invoices that already used Pro during initial extraction.
 *
 * @param indices - Indices of suspicious and unreadable invoices to retry
 * @param uploadedFiles - Original uploaded files for re-extraction
 * @param currentExtractions - Current extraction results
 * @param firstPassComparisons - Comparison results from the first matching pass,
 *   used to find the matched Excel row for mismatch-based selection
 * @param excelRows - Excel data for mismatch comparison
 * @param onProgress - Progress callback
 * @param ownCompanyIds - Company IDs to exclude from supplier matching
 */
export async function reExtractSuspiciousInvoices(
  indices: number[],
  uploadedFiles: UploadedFile[],
  currentExtractions: ExtractedInvoiceData[],
  firstPassComparisons: ComparisonResult[],
  excelRows: InvoiceExcelRow[],
  onProgress?: (completed: number, total: number, currentFileName?: string) => void,
  ownCompanyIds: string[] = []
): Promise<ExtractedInvoiceData[]> {
  const results = [...currentExtractions];
  const DELAY_BETWEEN_REQUESTS_MS = API_CONFIG.delayBetweenRequests;

  // Filter out invoices that already used Pro model
  const indicesToRetry = indices.filter(idx => {
    const extraction = currentExtractions[idx];
    if (extraction.usedProModel) {
      console.log(`[ProRetry] Skipping ${extraction.fileName} - already used Pro model`);
      return false;
    }
    return true;
  });

  console.log(`[ProRetry] Will retry ${indicesToRetry.length} of ${indices.length} invoices with Pro model`);

  // Build a lookup for matched Excel rows from the first pass
  const excelRowsByIndex = new Map(excelRows.map(r => [r.rowIndex, r]));

  for (let i = 0; i < indicesToRetry.length; i++) {
    const idx = indicesToRetry[i];
    const file = uploadedFiles[idx];
    const originalExtraction = currentExtractions[idx];

    onProgress?.(i, indicesToRetry.length, file.originalFile.name);

    try {
      console.log(`[ProRetry] Re-extracting ${file.originalFile.name} with Pro model...`);

      // Extract with Pro model (pass company IDs)
      const proResult = await extractInvoiceDataInternal(file, idx, true, ownCompanyIds);

      // Find the Excel row this invoice was matched to in the first pass
      const comparison = firstPassComparisons[idx];
      const matchedExcelRow = comparison?.matchedExcelRow !== null && comparison?.matchedExcelRow !== undefined
        ? excelRowsByIndex.get(comparison.matchedExcelRow) ?? null
        : null;

      // Select the better result — uses Excel row for ground-truth comparison when available
      const betterResult = selectBetterExtraction(originalExtraction, proResult, matchedExcelRow);
      results[idx] = betterResult;

      console.log(`[ProRetry] Result for ${file.originalFile.name}: kept ${betterResult.usedProModel ? 'Pro' : 'original'}`);
    } catch (error) {
      console.error(`[ProRetry] Error re-extracting ${file.originalFile.name}:`, error);
      // Keep original result on error
      results[idx] = { ...originalExtraction, wasDoubleChecked: true };
    }

    // Delay before next request
    if (i < indicesToRetry.length - 1) {
      await sleep(DELAY_BETWEEN_REQUESTS_MS);
    }
  }

  onProgress?.(indicesToRetry.length, indicesToRetry.length);

  return results;
}

/**
 * Extract data from last page of a multi-page PDF
 */
async function extractLastPageData(
  lastPageBlob: Blob,
  fileIndex: number,
  fileName: string
): Promise<ExtractedInvoiceData | null> {
  try {
    const arrayBuffer = await lastPageBlob.arrayBuffer();
    const base64 = btoa(
      new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
    );

    const data = await callStandaloneServer(base64, false, []);

    return {
      imageIndex: fileIndex,
      fileName: fileName,
      documentType: data.documentType,
      documentNumber: sanitizeDocumentNumber(data.documentNumber),
      documentDate: data.documentDate,
      supplierId: data.supplierId,
      taxBaseAmount: parseAmountValue(data.taxBaseAmount),
      vatAmount: parseAmountValue(data.vatAmount),
      confidence: data.confidence || 'medium',
    };
  } catch (error) {
    console.error('Error extracting last page:', error);
    return null;
  }
}

/**
 * Select the better amounts from two page extractions.
 * Invoice totals are always larger than individual line items,
 * so we prefer the page with higher amounts.
 * Also validates that VAT is approximately 20% of tax base.
 */
function selectBetterAmounts(
  firstPage: ExtractedInvoiceData,
  lastPage: ExtractedInvoiceData
): { taxBaseAmount: number | null; vatAmount: number | null } {
  const firstHasAmounts = firstPage.taxBaseAmount !== null;
  const lastHasAmounts = lastPage.taxBaseAmount !== null;

  // If only one page has amounts, use that
  if (firstHasAmounts && !lastHasAmounts) {
    console.log('[MergeAmounts] Only first page has amounts, using first page');
    return { taxBaseAmount: firstPage.taxBaseAmount, vatAmount: firstPage.vatAmount };
  }
  if (lastHasAmounts && !firstHasAmounts) {
    console.log('[MergeAmounts] Only last page has amounts, using last page');
    return { taxBaseAmount: lastPage.taxBaseAmount, vatAmount: lastPage.vatAmount };
  }
  if (!firstHasAmounts && !lastHasAmounts) {
    console.log('[MergeAmounts] Neither page has amounts');
    return { taxBaseAmount: null, vatAmount: null };
  }

  // Both pages have amounts - pick the better one
  const firstTaxBase = Math.abs(firstPage.taxBaseAmount!);
  const lastTaxBase = Math.abs(lastPage.taxBaseAmount!);
  const firstVat = firstPage.vatAmount !== null ? Math.abs(firstPage.vatAmount) : null;
  const lastVat = lastPage.vatAmount !== null ? Math.abs(lastPage.vatAmount) : null;

  // Check if VAT is approximately 20% of tax base (with 5% tolerance)
  const firstVatValid = firstVat !== null && Math.abs(firstVat / firstTaxBase - 0.20) < 0.05;
  const lastVatValid = lastVat !== null && Math.abs(lastVat / lastTaxBase - 0.20) < 0.05;

  console.log(`[MergeAmounts] First page: ДО=${firstTaxBase}, ДДС=${firstVat}, VAT valid=${firstVatValid}`);
  console.log(`[MergeAmounts] Last page: ДО=${lastTaxBase}, ДДС=${lastVat}, VAT valid=${lastVatValid}`);

  // Prefer the page with valid VAT ratio
  if (firstVatValid && !lastVatValid) {
    console.log('[MergeAmounts] First page has valid 20% VAT ratio, using first page');
    return { taxBaseAmount: firstPage.taxBaseAmount, vatAmount: firstPage.vatAmount };
  }
  if (lastVatValid && !firstVatValid) {
    console.log('[MergeAmounts] Last page has valid 20% VAT ratio, using last page');
    return { taxBaseAmount: lastPage.taxBaseAmount, vatAmount: lastPage.vatAmount };
  }

  // Both valid or both invalid - prefer higher amounts (totals > line items)
  if (firstTaxBase > lastTaxBase) {
    console.log(`[MergeAmounts] First page has higher amount (${firstTaxBase} > ${lastTaxBase}), using first page`);
    return { taxBaseAmount: firstPage.taxBaseAmount, vatAmount: firstPage.vatAmount };
  } else {
    console.log(`[MergeAmounts] Last page has higher/equal amount (${lastTaxBase} >= ${firstTaxBase}), using last page`);
    return { taxBaseAmount: lastPage.taxBaseAmount, vatAmount: lastPage.vatAmount };
  }
}

/**
 * Merge data from first and last page extractions
 * For document info (type, number, date, supplier): prefers whichever page has the data
 * For amounts (tax base, VAT): uses smart selection based on which page has the invoice totals
 */
function mergePageData(
  firstPage: ExtractedInvoiceData,
  lastPage: ExtractedInvoiceData | null
): ExtractedInvoiceData {
  if (!lastPage) return firstPage;

  // Smart amount selection - picks the page with actual invoice totals
  const amounts = selectBetterAmounts(firstPage, lastPage);

  // For document info: prefer first page, fall back to last page
  return {
    imageIndex: firstPage.imageIndex,
    fileName: firstPage.fileName,
    documentType: firstPage.documentType ?? lastPage.documentType,
    documentNumber: firstPage.documentNumber ?? lastPage.documentNumber,
    documentDate: firstPage.documentDate ?? lastPage.documentDate,
    supplierId: firstPage.supplierId ?? lastPage.supplierId,
    // AMOUNTS: Smart selection based on which page has the real totals
    taxBaseAmount: amounts.taxBaseAmount,
    vatAmount: amounts.vatAmount,
    confidence: firstPage.confidence === 'unreadable' ? lastPage.confidence :
                lastPage.confidence === 'unreadable' ? firstPage.confidence :
                (firstPage.confidence === 'high' || lastPage.confidence === 'high') ? 'high' : 'medium',
  };
}

/**
 * Process files sequentially with rate limit resilience
 * For multi-page PDFs, extracts from both first and last page and merges
 */
export async function extractMultipleInvoices(
  uploadedFiles: UploadedFile[],
  onProgress?: (completed: number, total: number, currentFileName?: string) => void,
  ownCompanyIds: string[] = []
): Promise<ExtractedInvoiceData[]> {
  const results: ExtractedInvoiceData[] = [];
  
  // Configuration for rate limit resilience
  const DELAY_BETWEEN_REQUESTS_MS = API_CONFIG.delayBetweenRequests;
  const MAX_RETRIES = API_CONFIG.maxRetries;
  const BASE_BACKOFF_MS = API_CONFIG.baseBackoffMs;
  
  for (let i = 0; i < uploadedFiles.length; i++) {
    const file = uploadedFiles[i];
    const hasLastPage = file.lastPageBlob && file.pageCount && file.pageCount > 1;
    
    onProgress?.(i, uploadedFiles.length, file.originalFile.name);
    
    let firstPageResult: ExtractedInvoiceData | null = null;
    let retries = 0;
    
    // Extract from first page
    while (retries <= MAX_RETRIES) {
      try {
        firstPageResult = await extractInvoiceData(file, i, ownCompanyIds);
        break;
      } catch (error) {
        if (isRetryableError(error) && retries < MAX_RETRIES) {
          const backoffMs = Math.pow(3, retries) * BASE_BACKOFF_MS;
          console.log(`Rate limited, retry ${retries + 1}/${MAX_RETRIES} after ${backoffMs / 1000}s`);
          await sleep(backoffMs);
          retries++;
        } else {
          console.error(`Failed to extract ${file.originalFile.name} after ${retries} retries`);
          firstPageResult = createUnreadableResult(file, i);
          break;
        }
      }
    }
    
    // For multi-page PDFs, ALWAYS extract last page (totals are usually there)
    let finalResult = firstPageResult!;
    if (hasLastPage && firstPageResult) {
      // Wait before next request
      await sleep(DELAY_BETWEEN_REQUESTS_MS);
      
      console.log(`[Multi-page] Extracting last page of ${file.originalFile.name} (${file.pageCount} pages) for invoice totals`);
      const lastPageResult = await extractLastPageData(
        file.lastPageBlob!,
        i,
        file.originalFile.name
      );
      
      // Merge: document info from first page, amounts from last page
      finalResult = mergePageData(firstPageResult, lastPageResult);
      console.log(`[Multi-page] Merged result - Tax Base: ${finalResult.taxBaseAmount}, VAT: ${finalResult.vatAmount}`);
    }
    
    results.push(finalResult);
    
    // Delay before next file (skip on last file)
    if (i < uploadedFiles.length - 1) {
      await sleep(DELAY_BETWEEN_REQUESTS_MS);
    }
  }
  
  // Final progress update
  onProgress?.(uploadedFiles.length, uploadedFiles.length);
  
  return results;
}

/**
 * Check if supplier IDs match (with normalization)
 * Reused by both matching logic and field comparison
 */
function supplierIdsMatch(invoiceId: string | null, excelId: string): boolean {
  if (!invoiceId) return false;
  
  const normalizedInvoice = invoiceId.replace(/\s/g, '').toUpperCase();
  const normalizedExcel = excelId.replace(/\s/g, '').toUpperCase();
  
  return normalizedInvoice === normalizedExcel ||
    normalizedInvoice === `BG${normalizedExcel}` ||
    `BG${normalizedInvoice}` === normalizedExcel ||
    normalizedInvoice.endsWith(normalizedExcel) ||
    normalizedExcel.endsWith(normalizedInvoice);
}

/**
 * Check if document types match
 * Reused by both matching logic and field comparison
 */
function documentTypesMatch(invoiceType: string | null, excelType: string): boolean {
  if (!invoiceType) return false;
  
  const normalizedInvoiceType = invoiceType.toUpperCase().trim();
  const variants = DOCUMENT_TYPE_MAPPING[excelType] || [];
  
  return variants.some(v => normalizedInvoiceType.includes(v.toUpperCase()));
}

/**
 * Check if amounts match
 * @param tolerance - The tolerance for the comparison (default: 0.005 for strict matching)
 */
function checkAmountMatch(invoiceAmount: number | null, excelAmount: number | null, tolerance: number = 0.005): boolean {
  if (invoiceAmount === null || excelAmount === null) return false;
  
  const roundedInvoice = Math.round(invoiceAmount * 100) / 100;
  const roundedExcel = Math.round(excelAmount * 100) / 100;
  
  return Math.abs(roundedInvoice - roundedExcel) < tolerance;
}

/**
 * Normalize amounts for credit notes (КРЕДИТНО ИЗВЕСТИЕ)
 * Credit notes should always have negative amounts, but some invoices show them as positive
 * This function ensures the amount is negative for proper comparison
 */
function normalizeCreditNoteAmount(amount: number | null, documentType: string | null): number | null {
  if (amount === null) return null;
  
  // Check if this is a credit note
  const isCreditNote = documentType?.toUpperCase().includes('КРЕДИТНО ИЗВЕСТИЕ') || 
                       documentType?.toUpperCase().includes('CREDIT NOTE') ||
                       documentType?.toUpperCase() === 'КИ';
  
  if (isCreditNote) {
    // Always return negative value for credit notes
    return -Math.abs(amount);
  }
  
  return amount;
}

/**
 * Count mismatches between invoice and Excel row
 * Returns number of mismatching fields (0-6)
 */
function countMismatches(
  invoiceData: ExtractedInvoiceData,
  excelRow: InvoiceExcelRow
): number {
  let mismatches = 0;
  
  // 1. Document Number
  if (normalizeDocumentNumber(invoiceData.documentNumber) !== normalizeDocumentNumber(excelRow.documentNumber)) {
    mismatches++;
  }
  
  // 2. Document Type
  if (!documentTypesMatch(invoiceData.documentType, excelRow.documentType)) {
    mismatches++;
  }
  
  // 3. Date
  if (!datesMatch(invoiceData.documentDate, excelRow.documentDate)) {
    mismatches++;
  }
  
  // 4. Supplier ID
  if (!supplierIdsMatch(invoiceData.supplierId, excelRow.counterpartyId)) {
    mismatches++;
  }
  
  // 5. Amount (ДО) - normalize for credit notes and use 0.03 tolerance
  const expectedAmount = excelRow.hasDDS ? excelRow.amountWithDDS : excelRow.amountNoDDS;
  const normalizedInvoiceAmount = normalizeCreditNoteAmount(invoiceData.taxBaseAmount, invoiceData.documentType);
  const normalizedExcelAmount = normalizeCreditNoteAmount(expectedAmount, excelRow.documentType);
  if (!checkAmountMatch(normalizedInvoiceAmount, normalizedExcelAmount, 0.03)) {
    mismatches++;
  }
  
  // 6. VAT (ДДС) - only count if company has DDS, normalize for credit notes, strict tolerance
  if (excelRow.hasDDS) {
    const normalizedInvoiceVat = normalizeCreditNoteAmount(invoiceData.vatAmount, invoiceData.documentType);
    const normalizedExcelVat = normalizeCreditNoteAmount(excelRow.vatWithFullCredit, excelRow.documentType);
    if (!checkAmountMatch(normalizedInvoiceVat, normalizedExcelVat)) {
      mismatches++;
    }
  }
  
  return mismatches;
}

/**
 * Find exact document number match in Excel rows.
 * Used in Pass 1 of two-pass matching algorithm.
 * @returns The matching Excel row, or null if no exact match exists
 */
function findExactDocumentNumberMatch(
  invoiceData: ExtractedInvoiceData,
  excelRows: InvoiceExcelRow[],
  excludeRows: Set<number>
): InvoiceExcelRow | null {
  if (!invoiceData.documentNumber) return null;
  
  const normalizedInvoiceNumber = normalizeDocumentNumber(invoiceData.documentNumber);
  if (!normalizedInvoiceNumber) return null;
  
  for (const row of excelRows) {
    if (excludeRows.has(row.rowIndex)) continue;
    
    const normalizedExcelNumber = normalizeDocumentNumber(row.documentNumber);
    if (normalizedExcelNumber === normalizedInvoiceNumber) {
      return row;
    }
  }
  
  return null;
}

/**
 * Find best matching Excel row - finds row with fewest mismatches.
 * Enforces a mismatch ceiling to prevent meaningless matches (e.g., unreadable
 * invoices with all-null fields stealing rows from better candidates).
 */
function findBestMatch(
  invoiceData: ExtractedInvoiceData,
  excelRows: InvoiceExcelRow[],
  excludeRows: Set<number> = new Set(),
  maxMismatches: number = 4
): { row: InvoiceExcelRow; mismatches: number } | null {
  let bestMatch: { row: InvoiceExcelRow; mismatches: number } | null = null;

  for (const row of excelRows) {
    // Skip rows already claimed by another invoice
    if (excludeRows.has(row.rowIndex)) continue;

    // Count mismatches for this row
    const mismatches = countMismatches(invoiceData, row);

    // Keep the best match (fewest mismatches)
    if (!bestMatch || mismatches < bestMatch.mismatches) {
      bestMatch = { row, mismatches };
    }

    // Perfect match - no need to continue
    if (mismatches === 0) break;
  }

  // Reject match if too many mismatches - prevents unrelated pairings
  if (bestMatch && bestMatch.mismatches >= maxMismatches) {
    return null;
  }

  return bestMatch;
}

/**
 * Compares extracted invoice data against purchase journal Excel rows.
 * Uses exclusive 1:1 matching to prevent duplicate matches.
 *
 * Matching algorithm (two-phase):
 * 1. **Exact match**: Finds row with identical document number
 * 2. **Best match fallback**: If no exact match, finds row with fewest field mismatches
 *
 * @param invoiceData - OCR-extracted invoice data
 * @param excelRows - Parsed rows from purchase journal Excel file
 * @param excludeRows - Set of row indices already claimed by other invoices (for 1:1 matching)
 * @returns Comparison result with field-by-field analysis and overall status
 *
 * @example
 * const claimedRows = new Set<number>();
 * for (const invoice of extractedInvoices) {
 *   const result = compareInvoiceWithExcel(invoice, excelRows, claimedRows);
 *   if (result.matchedRowIndex !== undefined) {
 *     claimedRows.add(result.matchedRowIndex);
 *   }
 * }
 */
export function compareInvoiceWithExcel(
  invoiceData: ExtractedInvoiceData,
  excelRows: InvoiceExcelRow[],
  excludeRows: Set<number> = new Set()
): ComparisonResult {
  // Phase 1: Try exact document number match
  const normalizedInvoiceNumber = normalizeDocumentNumber(invoiceData.documentNumber);
  
  console.log(`[Comparison] Looking for invoice: "${invoiceData.documentNumber}" (normalized: "${normalizedInvoiceNumber}")`);
  
  let matchedRow: InvoiceExcelRow | null = null;
  
  for (const row of excelRows) {
    // Skip rows already claimed by another invoice
    if (excludeRows.has(row.rowIndex)) continue;
    
    const normalizedExcelNumber = normalizeDocumentNumber(row.documentNumber);
    
    if (normalizedExcelNumber === normalizedInvoiceNumber && normalizedInvoiceNumber !== '') {
      console.log(`  [Exact Match] Row ${row.rowIndex}`);
      matchedRow = row;
      break;
    }
  }
  
  // Phase 2: If no exact match, find best available row (fewest mismatches)
  if (!matchedRow) {
    console.log(`  [No Exact Match] Trying anchor-based matching...`);
    const bestMatch = findBestMatch(invoiceData, excelRows, excludeRows);
    
    if (bestMatch) {
      console.log(`  [Anchor Match] Row ${bestMatch.row.rowIndex} with ${bestMatch.mismatches} mismatches`);
      matchedRow = bestMatch.row;
    }
  }
  
  // No match found at all
  if (!matchedRow) {
    console.log(`  [Not Found] All Excel rows already claimed by other invoices`);
    return {
      imageFileName: invoiceData.fileName,
      imageIndex: invoiceData.imageIndex,
      matchedExcelRow: null,
      extractedData: invoiceData,
      fieldComparisons: [],
      overallStatus: invoiceData.confidence === 'unreadable' ? 'unreadable' : 'not_found',
    };
  }
  
  // Build field comparisons for the matched row
  const fieldComparisons: FieldComparison[] = [];
  
  // 1. Document Type
  fieldComparisons.push(
    compareDocumentType(invoiceData.documentType, matchedRow.documentType)
  );
  
  // 2. Document Number
  fieldComparisons.push(
    compareField(
      'documentNumber',
      'Номер',
      invoiceData.documentNumber,
      matchedRow.documentNumber,
      (a, b) => normalizeDocumentNumber(a) === normalizeDocumentNumber(b)
    )
  );
  
  // 3. Document Date
  fieldComparisons.push(
    compareDate(
      invoiceData.documentDate,
      matchedRow.documentDate
    )
  );
  
  // 4. Supplier ID
  fieldComparisons.push(
    compareSupplierId(invoiceData.supplierId, matchedRow.counterpartyId)
  );
  
  // 5. Amount (ДО) - normalize for credit notes
  const expectedAmount = matchedRow.hasDDS 
    ? matchedRow.amountWithDDS 
    : matchedRow.amountNoDDS;
  const normalizedInvoiceAmount = normalizeCreditNoteAmount(invoiceData.taxBaseAmount, invoiceData.documentType);
  const normalizedExcelAmount = normalizeCreditNoteAmount(expectedAmount, matchedRow.documentType);
  fieldComparisons.push(
    compareAmount('amount', 'ДО', normalizedInvoiceAmount, normalizedExcelAmount, invoiceData.documentType, 0.03)
  );
  
  // 6. VAT Amount (ДДС) - normalize for credit notes
  if (matchedRow.hasDDS) {
    const normalizedInvoiceVat = normalizeCreditNoteAmount(invoiceData.vatAmount, invoiceData.documentType);
    const normalizedExcelVat = normalizeCreditNoteAmount(matchedRow.vatWithFullCredit, matchedRow.documentType);
    fieldComparisons.push(
      compareAmount('vatAmount', 'ДДС', normalizedInvoiceVat, normalizedExcelVat, invoiceData.documentType)
    );
  }
  
  // Determine overall status - 1+ mismatch = suspicious
  const hasMismatch = fieldComparisons.some(fc => fc.status === 'suspicious');
  const hasUnreadable = fieldComparisons.some(fc => fc.status === 'unreadable');
  
  let overallStatus: ComparisonResult['overallStatus'] = 'match';
  if (hasMismatch) {
    overallStatus = 'suspicious';
  } else if (hasUnreadable) {
    overallStatus = 'unreadable';
  }
  
  return {
    imageFileName: invoiceData.fileName,
    imageIndex: invoiceData.imageIndex,
    matchedExcelRow: matchedRow.rowIndex,
    extractedData: invoiceData,
    fieldComparisons,
    overallStatus,
  };
}

function compareDocumentType(
  invoiceType: string | null,
  excelType: string
): FieldComparison {
  if (!invoiceType) {
    return {
      fieldName: 'documentType',
      fieldLabel: 'Вид',
      imageValue: null,
      excelValue: excelType,
      status: 'unreadable',
    };
  }
  
  return {
    fieldName: 'documentType',
    fieldLabel: 'Вид',
    imageValue: invoiceType,
    excelValue: excelType,
    status: documentTypesMatch(invoiceType, excelType) ? 'match' : 'suspicious',
  };
}

function compareDate(
  invoiceDate: string | null,
  excelDate: string
): FieldComparison {
  if (!invoiceDate) {
    return {
      fieldName: 'documentDate',
      fieldLabel: 'Дата',
      imageValue: null,
      excelValue: normalizeDate(excelDate),
      status: 'unreadable',
    };
  }
  
  // Compare by date components instead of string comparison
  const isMatch = datesMatch(invoiceDate, excelDate);
  
  return {
    fieldName: 'documentDate',
    fieldLabel: 'Дата',
    imageValue: invoiceDate,
    excelValue: normalizeDate(excelDate), // Show normalized for clarity
    status: isMatch ? 'match' : 'suspicious',
  };
}

function compareField(
  fieldName: string,
  fieldLabel: string,
  invoiceValue: string | null,
  excelValue: string,
  compareFn: (a: string, b: string) => boolean
): FieldComparison {
  if (!invoiceValue) {
    return {
      fieldName,
      fieldLabel,
      imageValue: null,
      excelValue,
      status: 'unreadable',
    };
  }
  
  const isMatch = compareFn(invoiceValue, excelValue);
  
  return {
    fieldName,
    fieldLabel,
    imageValue: invoiceValue,
    excelValue,
    status: isMatch ? 'match' : 'suspicious',
  };
}

function compareSupplierId(
  invoiceId: string | null,
  excelId: string
): FieldComparison {
  if (!invoiceId) {
    return {
      fieldName: 'supplierId',
      fieldLabel: 'ИН',
      imageValue: null,
      excelValue: excelId,
      status: 'unreadable',
    };
  }
  
  return {
    fieldName: 'supplierId',
    fieldLabel: 'ИН',
    imageValue: invoiceId,
    excelValue: excelId,
    status: supplierIdsMatch(invoiceId, excelId) ? 'match' : 'suspicious',
  };
}

function compareAmount(
  fieldName: string,
  fieldLabel: string,
  invoiceAmount: number | null,
  excelAmount: number | null,
  documentType?: string | null,
  tolerance: number = 0.005
): FieldComparison {
  if (invoiceAmount === null) {
    return {
      fieldName,
      fieldLabel,
      imageValue: null,
      excelValue: excelAmount !== null ? formatAmount(excelAmount) : null,
      status: 'unreadable',
    };
  }
  
  if (excelAmount === null) {
    return {
      fieldName,
      fieldLabel,
      imageValue: formatAmount(invoiceAmount),
      excelValue: null,
      status: 'missing',
    };
  }
  
  // Round both values to 2 decimal places for fair comparison
  const roundedInvoice = Math.round(invoiceAmount * 100) / 100;
  const roundedExcel = Math.round(excelAmount * 100) / 100;
  
  // Use the provided tolerance (0.03 for tax base, 0.005 for VAT)
  const isMatch = Math.abs(roundedInvoice - roundedExcel) < tolerance;
  
  return {
    fieldName,
    fieldLabel,
    imageValue: formatAmount(invoiceAmount),
    excelValue: formatAmount(excelAmount),
    status: isMatch ? 'match' : 'suspicious',
  };
}

function formatAmount(value: number): string {
  return value.toLocaleString('bg-BG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Runs full invoice verification by comparing all extracted invoices against Excel data.
 * Generates a comprehensive summary including matches, mismatches, and unmatched rows.
 *
 * Features:
 * - Exclusive 1:1 matching (each Excel row can only match one invoice)
 * - Detects unreadable invoices that couldn't be processed
 * - Identifies Excel rows with no matching PDF invoice
 * - Provides detailed field-by-field comparison results
 *
 * @param extractedInvoices - Array of OCR-extracted invoice data
 * @param excelRows - Array of parsed purchase journal rows
 * @returns Verification summary with counts, comparisons, and detailed results
 *
 * @example
 * const summary = runVerification(extractedInvoices, excelRows);
 * console.log(`Matched: ${summary.matched}, Suspicious: ${summary.suspicious}`);
 * if (summary.unmatchedExcelRows.length > 0) {
 *   console.log('Warning: Some Excel rows have no matching invoice');
 * }
 */
export function runVerification(
  extractedInvoices: ExtractedInvoiceData[],
  excelRows: InvoiceExcelRow[]
): VerificationSummary {
  const comparisons: ComparisonResult[] = new Array(extractedInvoices.length);
  const usedExcelRows = new Set<number>();
  const processedInvoices = new Set<number>();
  
  // ============ PASS 1: Exact document number matches first ============
  // Only process high/medium confidence invoices with a document number
  // Sort by confidence (high before medium) to prioritize best extractions
  const pass1Candidates = extractedInvoices
    .map((invoice, idx) => ({ invoice, idx }))
    .filter(({ invoice }) => 
      (invoice.confidence === 'high' || invoice.confidence === 'medium') &&
      invoice.documentNumber !== null
    )
    .sort((a, b) => {
      // High confidence first
      if (a.invoice.confidence === 'high' && b.invoice.confidence !== 'high') return -1;
      if (b.invoice.confidence === 'high' && a.invoice.confidence !== 'high') return 1;
      return 0;
    });
  
  console.log(`[TwoPass] Pass 1: ${pass1Candidates.length} candidates with high/medium confidence and document number`);
  
  for (const { invoice, idx } of pass1Candidates) {
    const exactMatch = findExactDocumentNumberMatch(invoice, excelRows, usedExcelRows);
    
    if (exactMatch) {
      console.log(`[TwoPass] Pass 1 MATCH: Invoice ${idx} (${invoice.documentNumber}) → Row ${exactMatch.rowIndex}`);
      
      // Claim the row and mark invoice as processed
      usedExcelRows.add(exactMatch.rowIndex);
      processedInvoices.add(idx);
      
      // Build the comparison result for this exact match
      comparisons[idx] = compareInvoiceWithExcel(invoice, excelRows, new Set(
        [...usedExcelRows].filter(r => r !== exactMatch.rowIndex)
      ));
      // Ensure we use the exact match row (compareInvoiceWithExcel should find it)
      comparisons[idx].matchedExcelRow = exactMatch.rowIndex;
    }
  }
  
  console.log(`[TwoPass] Pass 1 complete: ${processedInvoices.size} exact matches claimed`);
  
  // ============ PASS 2: Fallback matching for remaining invoices ============
  // Sort by confidence descending so readable invoices claim rows before
  // unreadable ones, preventing unreadable invoices from stealing rows
  // that would be better matches for invoices with actual extracted data.
  const pass2Candidates = extractedInvoices
    .map((invoice, idx) => ({ invoice, idx }))
    .filter(({ idx }) => !processedInvoices.has(idx))
    .sort((a, b) => getConfidenceScore(b.invoice.confidence) - getConfidenceScore(a.invoice.confidence));

  console.log(`[TwoPass] Pass 2: Processing ${pass2Candidates.length} remaining invoices (sorted by confidence)`);

  for (const { invoice, idx } of pass2Candidates) {
    const comparison = compareInvoiceWithExcel(invoice, excelRows, usedExcelRows);
    comparisons[idx] = comparison;

    // Mark this row as claimed so no other invoice can use it
    if (comparison.matchedExcelRow !== null) {
      usedExcelRows.add(comparison.matchedExcelRow);
      console.log(`[TwoPass] Pass 2: Invoice ${idx} (${invoice.fileName}) → Row ${comparison.matchedExcelRow} (${comparison.overallStatus})`);
    } else {
      console.log(`[TwoPass] Pass 2: Invoice ${idx} (${invoice.fileName}) → No match found (${comparison.overallStatus})`);
    }
  }
  
  // Find Excel rows that have no matching PDF
  const missingPdfRows = excelRows.filter(
    row => !usedExcelRows.has(row.rowIndex)
  );
  
  // Use actual counts from results - no more formula-based estimates
  const missingPdfCount = missingPdfRows.length;
  const notFoundCount = comparisons.filter(c => c.overallStatus === 'not_found').length;
  
  return {
    totalImages: extractedInvoices.length,
    totalExcelRows: excelRows.length,
    matchedCount: comparisons.filter(c => c.overallStatus === 'match').length,
    suspiciousCount: comparisons.filter(c => c.overallStatus === 'suspicious').length,
    unreadableCount: comparisons.filter(c => c.overallStatus === 'unreadable').length,
    notFoundCount,
    missingPdfCount,
    comparisons,
    missingPdfRows,
  };
}
