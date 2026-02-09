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
 * Compare a single PDF invoice with Excel data.
 */
export function compareSalesPdfWithExcel(
  pdfData: ExtractedSalesPdfData,
  excelRows: SalesExcelRow[],
  firmVatId: string | null = null,
  excludeRows: Set<number> = new Set()
): SalesComparisonResult {
  const normalizedPdfNumber = normalizeSalesDocumentNumber(pdfData.documentNumber);

  console.log(`[Sales Comparison] Looking for PDF: "${pdfData.documentNumber}" (normalized: "${normalizedPdfNumber}")`);

  let matchedRow: SalesExcelRow | null = null;

  // Phase 1: Exact document number match
  for (const row of excelRows) {
    if (excludeRows.has(row.rowIndex)) continue;

    const normalizedExcelNumber = normalizeSalesDocumentNumber(row.documentNumber);

    if (normalizedExcelNumber === normalizedPdfNumber && normalizedPdfNumber !== '') {
      console.log(`  [Exact Match] Row ${row.rowIndex}`);
      matchedRow = row;
      break;
    }
  }

  // Phase 2: Best match fallback
  if (!matchedRow) {
    console.log(`  [No Exact Match] Trying best match...`);
    const bestMatch = findBestSalesMatch(pdfData, excelRows, excludeRows);

    if (bestMatch) {
      console.log(`  [Best Match] Row ${bestMatch.row.rowIndex} with ${bestMatch.mismatches} mismatches`);
      matchedRow = bestMatch.row;
    }
  }

  // No match found
  if (!matchedRow) {
    console.log(`  [Not Found] No matching Excel row`);
    return {
      pdfFileName: pdfData.fileName,
      pdfIndex: pdfData.pdfIndex,
      matchedExcelRow: null,
      extractedData: pdfData,
      fieldComparisons: [],
      overallStatus: 'not_found',
    };
  }

  // Build field comparisons
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

  console.log(`[Sales Comparison] Client ID check - Excel: "${matchedRow.counterpartyId}", isPhysicalIndividual: ${isPhysicalIndividual}`);

  if (isPhysicalIndividual) {
    console.log(`  [Physical Individual] Marking Client VAT/EIK as match (skipping comparison)`);
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

  // 6. Tax Base Amount
  fieldComparisons.push(
    compareSalesAmount(
      'taxBase',
      'Tax Base',
      pdfData.taxBaseAmount,
      matchedRow.totalTaxBase
    )
  );

  // 7. VAT Amount
  fieldComparisons.push(
    compareSalesAmount(
      'vat',
      'VAT',
      pdfData.vatAmount,
      matchedRow.totalVat
    )
  );

  // Determine overall status
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
 * Find best matching Excel row for a PDF.
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
 */
export function runSalesVerification(
  extractedPdfs: ExtractedSalesPdfData[],
  excelRows: SalesExcelRow[],
  firmVatId: string | null = null
): SalesVerificationSummary {
  const comparisons: SalesComparisonResult[] = [];
  const claimedRows = new Set<number>();

  // Filter Excel rows to only include verifiable document types (Ф-ра, КИ, ДИ)
  const verifiableExcelRows = excelRows.filter(row => isVerifiableDocumentType(row.documentType));
  const excludedRows = excelRows.filter(row => !isVerifiableDocumentType(row.documentType));

  console.log(`[Sales Verification] Total Excel rows: ${excelRows.length}, Verifiable: ${verifiableExcelRows.length}, Excluded (ПЗДДС etc.): ${excludedRows.length}`);

  // Compare each PDF with verifiable Excel rows only
  for (const pdf of extractedPdfs) {
    const result = compareSalesPdfWithExcel(pdf, verifiableExcelRows, firmVatId, claimedRows);
    comparisons.push(result);

    if (result.matchedExcelRow !== null) {
      claimedRows.add(result.matchedExcelRow);
    }
  }

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

  // Count results
  const matchedCount = comparisons.filter(c => c.overallStatus === 'match').length;
  const suspiciousCount = comparisons.filter(c => c.overallStatus === 'suspicious').length;
  const notFoundCount = comparisons.filter(c => c.overallStatus === 'not_found').length;
  const excelCheckErrors = excelChecks.filter(c => c.status === 'error').length;
  const excelCheckWarnings = excelChecks.filter(c => c.status === 'warning').length;

  return {
    totalPdfs: extractedPdfs.length,
    totalExcelRows: verifiableExcelRows.length,
    matchedCount,
    suspiciousCount,
    notFoundCount,
    missingPdfCount: missingPdfRows.length,
    comparisons,
    missingPdfRows,
    excelChecks,
    excelCheckErrors,
    excelCheckWarnings,
  };
}
