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

// Check if error is a rate limit error
const isRateLimitError = (error: unknown): boolean => {
  if (error instanceof RateLimitError) return true;
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return msg.includes('429') || msg.includes('rate limit') || msg.includes('too many requests');
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
    if (isRateLimitError(error)) {
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
 * Select the better extraction result based on confidence and field count
 */
export function selectBetterExtraction(
  original: ExtractedInvoiceData,
  retried: ExtractedInvoiceData
): ExtractedInvoiceData {
  const originalScore = getConfidenceScore(original.confidence);
  const retriedScore = getConfidenceScore(retried.confidence);
  
  // If confidence differs significantly, use the one with higher confidence
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
 * Re-extract suspicious invoices using Pro model
 * Skips invoices that already used Pro during initial extraction
 */
export async function reExtractSuspiciousInvoices(
  suspiciousIndices: number[],
  uploadedFiles: UploadedFile[],
  currentExtractions: ExtractedInvoiceData[],
  onProgress?: (completed: number, total: number, currentFileName?: string) => void,
  ownCompanyIds: string[] = []
): Promise<ExtractedInvoiceData[]> {
  const results = [...currentExtractions];
  const DELAY_BETWEEN_REQUESTS_MS = API_CONFIG.delayBetweenRequests;
  
  // Filter out invoices that already used Pro model
  const indicesToRetry = suspiciousIndices.filter(idx => {
    const extraction = currentExtractions[idx];
    if (extraction.usedProModel) {
      console.log(`[ProRetry] Skipping ${extraction.fileName} - already used Pro model`);
      return false;
    }
    return true;
  });
  
  console.log(`[ProRetry] Will retry ${indicesToRetry.length} of ${suspiciousIndices.length} suspicious invoices with Pro model`);
  
  for (let i = 0; i < indicesToRetry.length; i++) {
    const idx = indicesToRetry[i];
    const file = uploadedFiles[idx];
    const originalExtraction = currentExtractions[idx];
    
    onProgress?.(i, indicesToRetry.length, file.originalFile.name);
    
    try {
      console.log(`[ProRetry] Re-extracting ${file.originalFile.name} with Pro model...`);
      
      // Extract with Pro model (pass company IDs)
      const proResult = await extractInvoiceDataInternal(file, idx, true, ownCompanyIds);
      
      // Select the better result
      const betterResult = selectBetterExtraction(originalExtraction, proResult);
      results[idx] = betterResult;
      
      console.log(`[ProRetry] Result for ${file.originalFile.name}: kept ${betterResult === proResult ? 'Pro' : 'original'}`);
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
 * Merge data from first and last page extractions
 * For document info (type, number, date, supplier): first page takes priority
 * For amounts (tax base, VAT): LAST PAGE takes priority (totals are usually at the end)
 */
function mergePageData(
  firstPage: ExtractedInvoiceData,
  lastPage: ExtractedInvoiceData | null
): ExtractedInvoiceData {
  if (!lastPage) return firstPage;
  
  // For amounts: prefer last page (invoice totals), fall back to first page
  // For document info: prefer first page, fall back to last page
  return {
    imageIndex: firstPage.imageIndex,
    fileName: firstPage.fileName,
    documentType: firstPage.documentType ?? lastPage.documentType,
    documentNumber: firstPage.documentNumber ?? lastPage.documentNumber,
    documentDate: firstPage.documentDate ?? lastPage.documentDate,
    supplierId: firstPage.supplierId ?? lastPage.supplierId,
    // AMOUNTS: Last page takes priority (invoice totals are on the last page)
    taxBaseAmount: lastPage.taxBaseAmount ?? firstPage.taxBaseAmount,
    vatAmount: lastPage.vatAmount ?? firstPage.vatAmount,
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
        if (isRateLimitError(error) && retries < MAX_RETRIES) {
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
 * Find best matching Excel row - finds row with fewest mismatches (any mismatch count allowed)
 * No longer enforces max 3 mismatches - all documents will be matched and marked suspicious if needed
 */
function findBestMatch(
  invoiceData: ExtractedInvoiceData,
  excelRows: InvoiceExcelRow[],
  excludeRows: Set<number> = new Set()
): { row: InvoiceExcelRow; mismatches: number } | null {
  let bestMatch: { row: InvoiceExcelRow; mismatches: number } | null = null;
  
  for (const row of excelRows) {
    // Skip rows already claimed by another invoice
    if (excludeRows.has(row.rowIndex)) continue;
    
    // Count mismatches for this row
    const mismatches = countMismatches(invoiceData, row);
    
    // Keep the best match (fewest mismatches) - no max limit now
    if (!bestMatch || mismatches < bestMatch.mismatches) {
      bestMatch = { row, mismatches };
    }
    
    // Perfect match - no need to continue
    if (mismatches === 0) break;
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
  // Process invoices sequentially to enable exclusive 1:1 matching
  const comparisons: ComparisonResult[] = [];
  const usedExcelRows = new Set<number>();
  
  for (const invoice of extractedInvoices) {
    const comparison = compareInvoiceWithExcel(invoice, excelRows, usedExcelRows);
    comparisons.push(comparison);
    
    // Mark this row as claimed so no other invoice can use it
    if (comparison.matchedExcelRow !== null) {
      usedExcelRows.add(comparison.matchedExcelRow);
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
