import {
  SalesExcelRow,
  ExtractedSalesPdfData,
  SalesFieldComparison,
  SalesComparisonResult,
  SalesVerificationSummary,
  SALES_DOCUMENT_TYPE_MAPPING,
  isVerifiableDocumentType,
  isPhysicalIndividualId,
} from './salesComparisonTypes';
import { normalizeSalesDocumentNumber, salesDatesMatch, runExcelInternalChecks } from './salesJournalParser';

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
const MAX_BEST_MATCH_MISMATCHES = 3;

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

  return Math.abs(roundedPdf - roundedExcel) < 0.03;
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
