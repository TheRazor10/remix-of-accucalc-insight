import {
  SalesExcelRow,
  ExtractedSalesPdfData,
  SalesFieldComparison,
  SalesComparisonResult,
  SalesVerificationSummary,
  SALES_DOCUMENT_TYPE_MAPPING,
  isVerifiableDocumentType,
  isPhysicalIndividualId,
  IssuedDocRow,
  ExcelFieldComparison,
  ExcelToExcelComparisonResult,
  ExcelToExcelSummary,
} from './salesComparisonTypes';
import { normalizeSalesDocumentNumber, normalizeSalesDate, salesDatesMatch, runExcelInternalChecks } from './salesJournalParser';

/**
 * Build a comparison result for a matched PDF-Excel pair.
 */
function buildComparisonResult(
  pdfData: ExtractedSalesPdfData,
  matchedRow: SalesExcelRow,
  firmVatId: string | null = null
): SalesComparisonResult {
  const fieldComparisons: SalesFieldComparison[] = [];

  // 1. Document Type
  fieldComparisons.push(
    compareSalesDocumentType(pdfData.documentType, matchedRow.documentType)
  );

  // 2. Document Number
  fieldComparisons.push(
    compareSalesField(
      'documentNumber',
      'Number',
      pdfData.documentNumber,
      matchedRow.documentNumber,
      (a, b) => normalizeSalesDocumentNumber(a) === normalizeSalesDocumentNumber(b)
    )
  );

  // 3. Document Date
  fieldComparisons.push(
    compareSalesField(
      'documentDate',
      'Date',
      pdfData.documentDate,
      matchedRow.documentDate,
      salesDatesMatch
    )
  );

  // 4. Client ID (buyer's VAT/EIK)
  const isPhysicalIndividual = isPhysicalIndividualId(matchedRow.counterpartyId);

  if (isPhysicalIndividual) {
    fieldComparisons.push({
      fieldName: 'clientId',
      fieldLabel: 'Client VAT/EIK',
      pdfValue: pdfData.clientId,
      excelValue: matchedRow.counterpartyId,
      status: 'match',
    });
  } else {
    fieldComparisons.push(
      compareSalesField(
        'clientId',
        'Client VAT/EIK',
        pdfData.clientId,
        matchedRow.counterpartyId,
        (a, b) => {
          if (!a || !b) return false;
          const normA = a.replace(/\s/g, '').toUpperCase().replace(/^BG/, '');
          const normB = b.replace(/\s/g, '').toUpperCase().replace(/^BG/, '');
          return normA === normB;
        }
      )
    );
  }

  // 5. Tax Base Amount
  fieldComparisons.push(
    compareSalesAmount(
      'taxBase',
      'Tax Base',
      pdfData.taxBaseAmount,
      matchedRow.totalTaxBase
    )
  );

  // 6. VAT Amount
  fieldComparisons.push(
    compareSalesAmount(
      'vat',
      'VAT',
      pdfData.vatAmount,
      matchedRow.totalVat
    )
  );

  const hasMismatch = fieldComparisons.some(fc => fc.status === 'suspicious');

  return {
    pdfFileName: pdfData.fileName,
    pdfIndex: pdfData.pdfIndex,
    matchedExcelRow: matchedRow.rowIndex,
    extractedData: pdfData,
    fieldComparisons,
    overallStatus: hasMismatch ? 'suspicious' : 'match',
  };
}

/**
 * Maximum allowed mismatches for best-match fallback.
 * With 6 total fields, allowing at most 3 mismatches prevents
 * completely unrelated rows from being matched.
 */
const MAX_BEST_MATCH_MISMATCHES = 4;

/**
 * Find best matching Excel row for a PDF.
 * Returns null if no row has fewer than MAX_BEST_MATCH_MISMATCHES mismatches.
 */
function findBestSalesMatch(
  pdfData: ExtractedSalesPdfData,
  excelRows: SalesExcelRow[],
  excludeRows: Set<number>
): { row: SalesExcelRow; mismatches: number } | null {
  let bestMatch: { row: SalesExcelRow; mismatches: number } | null = null;

  for (const row of excelRows) {
    if (excludeRows.has(row.rowIndex)) continue;

    const mismatches = countSalesMismatches(pdfData, row);

    if (mismatches > MAX_BEST_MATCH_MISMATCHES) continue;

    if (!bestMatch || mismatches < bestMatch.mismatches) {
      bestMatch = { row, mismatches };
    }

    if (mismatches === 0) break;
  }

  return bestMatch;
}

/**
 * Count mismatches between PDF and Excel row.
 */
function countSalesMismatches(
  pdfData: ExtractedSalesPdfData,
  excelRow: SalesExcelRow
): number {
  let mismatches = 0;

  // Document Number
  if (normalizeSalesDocumentNumber(pdfData.documentNumber) !==
      normalizeSalesDocumentNumber(excelRow.documentNumber)) {
    mismatches++;
  }

  // Document Type
  if (!salesDocumentTypesMatch(pdfData.documentType, excelRow.documentType)) {
    mismatches++;
  }

  // Date
  if (!salesDatesMatch(pdfData.documentDate, excelRow.documentDate)) {
    mismatches++;
  }

  // Client ID
  if (!salesClientIdsMatch(pdfData.clientId, excelRow.counterpartyId)) {
    mismatches++;
  }

  // Tax Base
  if (!salesAmountsMatch(pdfData.taxBaseAmount, excelRow.totalTaxBase)) {
    mismatches++;
  }

  // VAT
  if (!salesAmountsMatch(pdfData.vatAmount, excelRow.totalVat)) {
    mismatches++;
  }

  return mismatches;
}

function salesDocumentTypesMatch(pdfType: string | null, excelType: string): boolean {
  if (!pdfType) return false;

  const normalizedPdfType = pdfType.toUpperCase().trim();
  const variants = SALES_DOCUMENT_TYPE_MAPPING[excelType] || [];

  return variants.some(v => normalizedPdfType.includes(v.toUpperCase()));
}

function salesClientIdsMatch(pdfId: string | null, excelId: string): boolean {
  if (!pdfId) return false;

  const normPdf = pdfId.replace(/\s/g, '').toUpperCase().replace(/^BG/, '');
  const normExcel = excelId.replace(/\s/g, '').toUpperCase().replace(/^BG/, '');

  return normPdf === normExcel;
}

function salesAmountsMatch(pdfAmount: number | null, excelAmount: number | null): boolean {
  if (pdfAmount === null || excelAmount === null) return false;

  const roundedPdf = Math.round(pdfAmount * 100) / 100;
  const roundedExcel = Math.round(excelAmount * 100) / 100;

  return Math.abs(roundedPdf - roundedExcel) < 0.015;
}

// Field comparison helpers
function compareSalesDocumentType(
  pdfType: string | null,
  excelType: string
): SalesFieldComparison {
  const matches = salesDocumentTypesMatch(pdfType, excelType);

  return {
    fieldName: 'documentType',
    fieldLabel: 'Тип документ',
    pdfValue: pdfType,
    excelValue: excelType,
    status: !pdfType ? 'missing' : matches ? 'match' : 'suspicious',
  };
}

function compareSalesField(
  fieldName: string,
  fieldLabel: string,
  pdfValue: string | null,
  excelValue: string | null,
  matchFn: (a: string | null, b: string | null) => boolean
): SalesFieldComparison {
  if (!pdfValue) {
    return {
      fieldName,
      fieldLabel,
      pdfValue,
      excelValue,
      status: 'missing',
    };
  }

  return {
    fieldName,
    fieldLabel,
    pdfValue,
    excelValue,
    status: matchFn(pdfValue, excelValue) ? 'match' : 'suspicious',
  };
}

function compareSalesAmount(
  fieldName: string,
  fieldLabel: string,
  pdfAmount: number | null,
  excelAmount: number | null
): SalesFieldComparison {
  if (pdfAmount === null) {
    return {
      fieldName,
      fieldLabel,
      pdfValue: null,
      excelValue: excelAmount?.toFixed(2) ?? null,
      status: 'missing',
    };
  }

  const matches = salesAmountsMatch(pdfAmount, excelAmount);

  return {
    fieldName,
    fieldLabel,
    pdfValue: pdfAmount.toFixed(2),
    excelValue: excelAmount?.toFixed(2) ?? null,
    status: matches ? 'match' : 'suspicious',
  };
}

/**
 * Run complete sales verification.
 * Uses two-pass matching: exact document number matches first, then best-match fallback.
 */
export function runSalesVerification(
  extractedPdfs: ExtractedSalesPdfData[],
  excelRows: SalesExcelRow[],
  firmVatId: string | null = null
): SalesVerificationSummary {
  const comparisons: (SalesComparisonResult | null)[] = new Array(extractedPdfs.length).fill(null);
  const claimedRows = new Set<number>();

  // Filter Excel rows to only include verifiable document types (Ф-ра, КИ, ДИ)
  const verifiableExcelRows = excelRows.filter(row => isVerifiableDocumentType(row.documentType));

  console.log(`[Sales Verification] Total Excel rows: ${excelRows.length}, Verifiable: ${verifiableExcelRows.length}, Excluded (ПЗДДС etc.): ${excelRows.length - verifiableExcelRows.length}`);

  // Safety net: If any PDF's clientId matches our firmVatId, swap clientId and sellerId.
  // This catches cases where OCR or native extraction assigned our own ID as the client.
  if (firmVatId) {
    const normFirm = firmVatId.replace(/\s/g, '').toUpperCase().replace(/^BG/, '');
    for (const pdf of extractedPdfs) {
      if (pdf.clientId) {
        const normClient = pdf.clientId.replace(/\s/g, '').toUpperCase().replace(/^BG/, '');
        if (normClient === normFirm) {
          console.log(`[Sales Verification] Swapping IDs for "${pdf.fileName}": clientId ${pdf.clientId} matches firmVatId`);
          const oldSeller = pdf.sellerId;
          pdf.sellerId = pdf.clientId;
          pdf.clientId = oldSeller;
        }
      }
    }
  }

  // Pass 1: Exact document number matches only
  console.log(`[Sales Verification] Pass 1: Exact matches`);
  for (let i = 0; i < extractedPdfs.length; i++) {
    const pdf = extractedPdfs[i];
    const normalizedPdfNumber = normalizeSalesDocumentNumber(pdf.documentNumber);
    if (normalizedPdfNumber === '') continue;

    for (const row of verifiableExcelRows) {
      if (claimedRows.has(row.rowIndex)) continue;
      const normalizedExcelNumber = normalizeSalesDocumentNumber(row.documentNumber);
      if (normalizedExcelNumber === normalizedPdfNumber) {
        console.log(`  [Pass 1] PDF "${pdf.fileName}" exact match -> Row ${row.rowIndex}`);
        const result = buildComparisonResult(pdf, row, firmVatId);
        comparisons[i] = result;
        claimedRows.add(row.rowIndex);
        break;
      }
    }
  }

  // Pass 2: Best-match fallback for unmatched PDFs
  console.log(`[Sales Verification] Pass 2: Best-match fallback`);
  for (let i = 0; i < extractedPdfs.length; i++) {
    if (comparisons[i] !== null) continue;
    const pdf = extractedPdfs[i];

    const bestMatch = findBestSalesMatch(pdf, verifiableExcelRows, claimedRows);
    if (bestMatch) {
      console.log(`  [Pass 2] PDF "${pdf.fileName}" best match -> Row ${bestMatch.row.rowIndex} (${bestMatch.mismatches} mismatches)`);
      const result = buildComparisonResult(pdf, bestMatch.row, firmVatId);
      comparisons[i] = result;
      claimedRows.add(bestMatch.row.rowIndex);
    } else {
      console.log(`  [Pass 2] PDF "${pdf.fileName}" -> Not Found`);
      comparisons[i] = {
        pdfFileName: pdf.fileName,
        pdfIndex: pdf.pdfIndex,
        matchedExcelRow: null,
        extractedData: pdf,
        fieldComparisons: [],
        overallStatus: 'not_found',
      };
    }
  }

  const finalComparisons = comparisons as SalesComparisonResult[];

  // Find missing PDFs (verifiable Excel rows with no matching PDF)
  // Also filter out foreign firms (non-BG VAT IDs) as they belong in Purchases
  const missingPdfRows = verifiableExcelRows.filter(row => {
    if (claimedRows.has(row.rowIndex)) return false;

    // Check if it's a foreign firm (non-BG VAT prefix)
    const isForeignFirm = row.counterpartyId &&
      /^(RO|CZ|DE|AT|SK|HU|PL|IT|FR|ES|NL|BE|GR|PT|SE|FI|DK|IE|LU|MT|CY|EE|LV|LT|SI|HR)\d/i.test(row.counterpartyId);

    return !isForeignFirm;
  });

  // Run internal Excel checks on ALL rows (including non-verifiable for sequence checks)
  const excelChecks = runExcelInternalChecks(excelRows);

  // Detect failed extractions (PDFs where all key fields are null)
  const failedExtractionFiles: string[] = [];
  for (const pdf of extractedPdfs) {
    const allNull = pdf.documentNumber === null &&
                    pdf.documentDate === null &&
                    pdf.clientId === null &&
                    pdf.taxBaseAmount === null &&
                    pdf.vatAmount === null;
    if (allNull) {
      failedExtractionFiles.push(pdf.fileName);
    }
  }

  // Count results
  const matchedCount = finalComparisons.filter(c => c.overallStatus === 'match').length;
  const suspiciousCount = finalComparisons.filter(c => c.overallStatus === 'suspicious').length;
  const notFoundCount = finalComparisons.filter(c => c.overallStatus === 'not_found').length;
  const excelCheckErrors = excelChecks.filter(c => c.status === 'error').length;
  const excelCheckWarnings = excelChecks.filter(c => c.status === 'warning').length;

  return {
    totalPdfs: extractedPdfs.length,
    totalExcelRows: verifiableExcelRows.length,
    matchedCount,
    suspiciousCount,
    notFoundCount,
    missingPdfCount: missingPdfRows.length,
    failedExtractionCount: failedExtractionFiles.length,
    failedExtractionFiles,
    comparisons: finalComparisons,
    missingPdfRows,
    excelChecks,
    excelCheckErrors,
    excelCheckWarnings,
  };
}

// ─── Pro Re-extraction for Suspicious/Unreadable Sales Invoices ──────────────

const DELAY_BETWEEN_PRO_REQUESTS_MS = 2000;
const PRO_MAX_RETRIES = 3;
const PRO_BASE_BACKOFF_MS = 10000;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Check if error is retryable (overloaded, rate limited, 503)
function isSalesRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return msg.includes('429') || msg.includes('rate limit') ||
           msg.includes('503') || msg.includes('overloaded') ||
           msg.includes('high demand') || msg.includes('service unavailable') ||
           error.name === 'RetryableError';
  }
  return false;
}

/**
 * Count non-null fields in extracted sales data (for comparison).
 */
function countExtractedSalesFields(data: ExtractedSalesPdfData): number {
  let count = 0;
  if (data.documentType) count++;
  if (data.documentNumber) count++;
  if (data.documentDate) count++;
  if (data.clientId) count++;
  if (data.taxBaseAmount !== null) count++;
  if (data.vatAmount !== null) count++;
  return count;
}

/**
 * Get confidence-like score for sales extraction.
 * Since sales extractions don't have a confidence field, we infer from field count.
 */
function getSalesExtractionScore(data: ExtractedSalesPdfData): number {
  return countExtractedSalesFields(data);
}

/**
 * Select the better extraction result by comparing against the matched Excel row.
 * If an Excel row is available, picks whichever extraction has fewer mismatches.
 * Falls back to field count when no Excel row is available.
 */
export function selectBetterSalesExtraction(
  original: ExtractedSalesPdfData,
  retried: ExtractedSalesPdfData,
  matchedExcelRow?: SalesExcelRow | null
): ExtractedSalesPdfData {
  if (matchedExcelRow) {
    const originalMismatches = countSalesMismatches(original, matchedExcelRow);
    const retriedMismatches = countSalesMismatches(retried, matchedExcelRow);

    console.log(`[SalesProRetry] Comparing against Excel row ${matchedExcelRow.rowIndex}: original=${originalMismatches} mismatches, pro=${retriedMismatches} mismatches`);

    if (retriedMismatches < originalMismatches) {
      console.log(`[SalesProRetry] Pro has fewer mismatches, using Pro`);
      return { ...retried, wasDoubleChecked: true };
    }
    if (originalMismatches < retriedMismatches) {
      console.log(`[SalesProRetry] Original has fewer mismatches, keeping original`);
      return { ...original, wasDoubleChecked: true };
    }
    console.log(`[SalesProRetry] Same mismatch count, falling through to field comparison`);
  }

  const originalFields = getSalesExtractionScore(original);
  const retriedFields = getSalesExtractionScore(retried);

  if (retriedFields > originalFields) {
    console.log(`[SalesProRetry] Pro result has more fields (${retriedFields} > ${originalFields})`);
    return { ...retried, wasDoubleChecked: true };
  }

  console.log(`[SalesProRetry] Keeping original (fields: ${originalFields} vs ${retriedFields})`);
  return { ...original, wasDoubleChecked: true };
}

/**
 * Re-extract suspicious and not-found sales invoices using Pro model.
 * Only re-extracts OCR-extracted invoices (scanned PDFs).
 * Compares Pro result against the matched Excel row to ensure Pro doesn't make things worse.
 */
export async function reExtractSuspiciousSalesInvoices(
  indices: number[],
  scannedFiles: File[],
  nativePdfCount: number,
  currentExtractions: ExtractedSalesPdfData[],
  firstPassComparisons: SalesComparisonResult[],
  excelRows: SalesExcelRow[],
  firmVatId: string | null = null,
  onProgress?: (completed: number, total: number, currentFileName?: string) => void
): Promise<ExtractedSalesPdfData[]> {
  const results = [...currentExtractions];

  // Only retry OCR-extracted invoices that haven't used Pro yet
  const indicesToRetry = indices.filter(idx => {
    const extraction = currentExtractions[idx];
    if (extraction.usedProModel) {
      console.log(`[SalesProRetry] Skipping ${extraction.fileName} - already used Pro model`);
      return false;
    }
    if (extraction.extractionMethod !== 'ocr') {
      console.log(`[SalesProRetry] Skipping ${extraction.fileName} - native extraction`);
      return false;
    }
    return true;
  });

  console.log(`[SalesProRetry] Will retry ${indicesToRetry.length} of ${indices.length} invoices with Pro model`);

  // Build lookup for Excel rows
  const excelRowsByIndex = new Map(excelRows.map(r => [r.rowIndex, r]));

  // Import the OCR function dynamically to avoid circular deps
  const { extractScannedPdfWithOcr } = await import('./pdfOcrFallback');

  for (let i = 0; i < indicesToRetry.length; i++) {
    const idx = indicesToRetry[i];
    const originalExtraction = currentExtractions[idx];

    // Find the corresponding scanned file
    const scannedFileIndex = idx - nativePdfCount;
    if (scannedFileIndex < 0 || scannedFileIndex >= scannedFiles.length) {
      console.log(`[SalesProRetry] Skipping index ${idx} - no matching scanned file`);
      continue;
    }
    const file = scannedFiles[scannedFileIndex];

    onProgress?.(i, indicesToRetry.length, file.name);

    // Retry loop for Pro model extraction (handles transient 503/overload errors)
    for (let retryAttempt = 0; retryAttempt <= PRO_MAX_RETRIES; retryAttempt++) {
      try {
        console.log(`[SalesProRetry] Re-extracting ${file.name} with Pro model${retryAttempt > 0 ? ` (retry ${retryAttempt}/${PRO_MAX_RETRIES})` : ''}...`);

        const proResult = await extractScannedPdfWithOcr(file, idx, firmVatId, true);

        // Find the Excel row this was matched to in the first pass
        const comparison = firstPassComparisons[idx];
        const matchedExcelRow = comparison?.matchedExcelRow !== null && comparison?.matchedExcelRow !== undefined
          ? excelRowsByIndex.get(comparison.matchedExcelRow) ?? null
          : null;

        const betterResult = selectBetterSalesExtraction(originalExtraction, proResult, matchedExcelRow);
        results[idx] = betterResult;

        console.log(`[SalesProRetry] Result for ${file.name}: kept ${betterResult.usedProModel ? 'Pro' : 'original'}`);
        break;
      } catch (error) {
        if (isSalesRetryableError(error) && retryAttempt < PRO_MAX_RETRIES) {
          const backoffMs = Math.pow(3, retryAttempt) * PRO_BASE_BACKOFF_MS;
          console.log(`[SalesProRetry] ${file.name} failed (overloaded), retry ${retryAttempt + 1}/${PRO_MAX_RETRIES} after ${backoffMs / 1000}s`);
          await sleep(backoffMs);
        } else {
          console.error(`[SalesProRetry] Error re-extracting ${file.name}:`, error);
          results[idx] = { ...originalExtraction, wasDoubleChecked: true };
          break;
        }
      }
    }

    if (i < indicesToRetry.length - 1) {
      await sleep(DELAY_BETWEEN_PRO_REQUESTS_MS);
    }
  }

  onProgress?.(indicesToRetry.length, indicesToRetry.length);

  return results;
}

// ─── Excel-to-Excel Comparison (Справка издадени документи) ─────────────────

/**
 * Compare the main sales journal rows with rows from "Справка издадени документи" files.
 * Matches by document number, then compares date, counterparty ID, tax base, and VAT.
 */
export function runExcelToExcelComparison(
  mainRows: SalesExcelRow[],
  issuedDocRows: IssuedDocRow[]
): ExcelToExcelSummary {
  const comparisons: ExcelToExcelComparisonResult[] = [];
  const matchedMainRows = new Set<number>();
  const matchedSecondaryRows = new Set<number>();

  // Only compare verifiable document types from main
  const verifiableMain = mainRows.filter(row => isVerifiableDocumentType(row.documentType));

  // Index secondary rows by normalized document number for fast lookup
  const secondaryByDocNum = new Map<string, IssuedDocRow[]>();
  for (const row of issuedDocRows) {
    const normNum = normalizeSalesDocumentNumber(row.documentNumber);
    if (!normNum) continue;
    if (!secondaryByDocNum.has(normNum)) {
      secondaryByDocNum.set(normNum, []);
    }
    secondaryByDocNum.get(normNum)!.push(row);
  }

  // Match main rows to secondary
  for (const mainRow of verifiableMain) {
    const normMainNum = normalizeSalesDocumentNumber(mainRow.documentNumber);
    if (!normMainNum) continue;

    const candidates = secondaryByDocNum.get(normMainNum);
    if (candidates && candidates.length > 0) {
      // Pick the first unmatched candidate
      const candidate = candidates.find(c => !matchedSecondaryRows.has(c.rowIndex)) || candidates[0];

      const fields = buildExcelToExcelFields(mainRow, candidate);
      const hasMismatch = fields.some(f => f.status === 'mismatch');
      const hasIndividual = fields.some(f => f.status === 'individual');

      comparisons.push({
        documentNumber: mainRow.documentNumber,
        mainExcelRow: mainRow.rowIndex,
        secondarySource: candidate.sourceFile,
        fieldComparisons: fields,
        overallStatus: hasMismatch ? 'mismatch' : hasIndividual ? 'individual' : 'match',
      });

      matchedMainRows.add(mainRow.rowIndex);
      matchedSecondaryRows.add(candidate.rowIndex);
    }
  }

  // Main rows with no match in secondary
  const onlyInMainRows = verifiableMain.filter(r => !matchedMainRows.has(r.rowIndex));
  for (const row of onlyInMainRows) {
    comparisons.push({
      documentNumber: row.documentNumber,
      mainExcelRow: row.rowIndex,
      secondarySource: null,
      fieldComparisons: [],
      overallStatus: 'only_in_main',
    });
  }

  // Secondary rows with no match in main
  const onlyInSecondaryRows = issuedDocRows.filter(r => !matchedSecondaryRows.has(r.rowIndex));
  for (const row of onlyInSecondaryRows) {
    comparisons.push({
      documentNumber: row.documentNumber,
      mainExcelRow: null,
      secondarySource: row.sourceFile,
      fieldComparisons: [],
      overallStatus: 'only_in_secondary',
    });
  }

  const matchedCount = comparisons.filter(c => c.overallStatus === 'match').length;
  const mismatchCount = comparisons.filter(c => c.overallStatus === 'mismatch').length;
  const individualCount = comparisons.filter(c => c.overallStatus === 'individual').length;

  console.log(`[Excel-to-Excel] Matched: ${matchedCount}, Mismatches: ${mismatchCount}, Individuals: ${individualCount}, Only in main: ${onlyInMainRows.length}, Only in secondary: ${onlyInSecondaryRows.length}`);

  return {
    totalMainRows: verifiableMain.length,
    totalSecondaryRows: issuedDocRows.length,
    matchedCount,
    mismatchCount,
    individualCount,
    onlyInMainCount: onlyInMainRows.length,
    onlyInSecondaryCount: onlyInSecondaryRows.length,
    comparisons,
    onlyInMainRows,
    onlyInSecondaryRows,
  };
}

function buildExcelToExcelFields(
  main: SalesExcelRow,
  secondary: IssuedDocRow
): ExcelFieldComparison[] {
  const fields: ExcelFieldComparison[] = [];

  // Date
  const datesMatch = salesDatesMatch(main.documentDate, secondary.documentDate);
  fields.push({
    fieldName: 'date',
    fieldLabel: 'Дата',
    mainValue: main.documentDate,
    secondaryValue: secondary.documentDate,
    status: !main.documentDate || !secondary.documentDate ? 'missing' : datesMatch ? 'match' : 'mismatch',
  });

  // Counterparty ID (counterpartyId vs bulstat)
  // If either side is all-9s (physical individual placeholder), flag as 'individual' not 'mismatch'
  // Справка IDs can be 13 digits where last 4 are "office" code - trim to first 9 for comparison
  const isIndividual = isPhysicalIndividualId(main.counterpartyId) || isPhysicalIndividualId(secondary.bulstat);
  const normMainId = main.counterpartyId.replace(/\s/g, '').toUpperCase().replace(/^BG/, '');
  let normSecId = secondary.bulstat.replace(/\s/g, '').toUpperCase().replace(/^BG/, '');
  // If secondary ID is 13 digits, trim to first 9 (remove office suffix)
  if (/^\d{13}$/.test(normSecId)) {
    normSecId = normSecId.substring(0, 9);
  }
  const idsMatch = normMainId === normSecId || !normMainId || !normSecId;
  let idStatus: ExcelFieldComparison['status'];
  if (!main.counterpartyId || !secondary.bulstat) idStatus = 'missing';
  else if (idsMatch) idStatus = 'match';
  else if (isIndividual) idStatus = 'individual';
  else idStatus = 'mismatch';
  fields.push({
    fieldName: 'counterpartyId',
    fieldLabel: 'Булстат / ИН',
    mainValue: main.counterpartyId,
    secondaryValue: secondary.bulstat,
    status: idStatus,
  });

  // Tax Base
  const taxBaseMatch = excelAmountsMatch(main.totalTaxBase, secondary.taxBase);
  fields.push({
    fieldName: 'taxBase',
    fieldLabel: 'Данъчна основа',
    mainValue: main.totalTaxBase?.toFixed(2) ?? null,
    secondaryValue: secondary.taxBase?.toFixed(2) ?? null,
    status: main.totalTaxBase === null || secondary.taxBase === null ? 'missing' : taxBaseMatch ? 'match' : 'mismatch',
  });

  // VAT (exact match, no tolerance)
  const vatMatch = excelAmountsMatch(main.totalVat, secondary.vat);
  fields.push({
    fieldName: 'vat',
    fieldLabel: 'ДДС',
    mainValue: main.totalVat?.toFixed(2) ?? null,
    secondaryValue: secondary.vat?.toFixed(2) ?? null,
    status: main.totalVat === null || secondary.vat === null ? 'missing' : vatMatch ? 'match' : 'mismatch',
  });

  return fields;
}

function excelAmountsMatch(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return false;
  return Math.abs(Math.round(a * 100) - Math.round(b * 100)) <= 1; // 0.01 tolerance
}


