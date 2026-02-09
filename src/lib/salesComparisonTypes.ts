// Types for Sales Verification Feature (Дневник на продажбите)

/**
 * Result of parsing the sales journal Excel file.
 * Contains both the data rows and metadata from the header.
 */
export interface SalesJournalParseResult {
  rows: SalesExcelRow[];
  firmVatId: string | null;  // VAT ID of our firm from the Excel header
}

/**
 * Represents a row from the Sales Journal (Дневник на продажбите) Excel file.
 * Based on the standard Bulgarian VAT sales journal format.
 */
export interface SalesExcelRow {
  rowIndex: number;
  documentType: string;        // Document type (column 3)
  documentNumber: string;      // Document number (column 4)
  documentDate: string;        // Document date (column 5)
  counterpartyId: string;      // Counterparty ID (column 6)
  counterpartyName: string;    // Counterparty name (column 7)
  hasDDS: boolean;             // true if counterpartyId starts with "BG"

  // Amount columns from sales journal
  taxBase20: number | null;    // Column 11 - Tax base for 20% rate
  vat20: number | null;        // Column 12 - VAT 20%
  taxBase9: number | null;     // Column 17 - Tax base for 9% rate
  vat9: number | null;         // Column 18 - VAT 9%
  taxBase0: number | null;     // Column 19 - Tax base for 0% rate

  // Totals from columns 9 and 10
  totalTaxBase: number | null; // Column 9 - Total tax base
  totalVat: number | null;     // Column 10 - Total VAT
}

/**
 * Data extracted from a PDF invoice for sales verification.
 * Since these are native PDFs (not scanned), we extract text directly.
 */
export interface ExtractedSalesPdfData {
  pdfIndex: number;
  fileName: string;
  documentType: string | null;
  documentNumber: string | null;
  documentDate: string | null;
  sellerId: string | null;       // VAT ID of the seller (our firm)
  clientId: string | null;       // VAT ID or EIK of the client (buyer)
  clientName: string | null;     // Client company name
  taxBaseAmount: number | null;  // Tax base (Данъчна основа)
  vatAmount: number | null;      // VAT amount (ДДС)
  vatRate: number | null;        // VAT rate if detected (20%, 9%, 0%)
  rawText: string;               // Full extracted PDF text for debugging
  extractionMethod: 'native' | 'ocr';
}

/**
 * Field comparison result for sales verification.
 */
export interface SalesFieldComparison {
  fieldName: string;
  fieldLabel: string;
  pdfValue: string | null;
  excelValue: string | null;
  status: 'match' | 'suspicious' | 'missing';
}

/**
 * Result of comparing a single PDF with Excel data.
 */
export interface SalesComparisonResult {
  pdfFileName: string;
  pdfIndex: number;
  matchedExcelRow: number | null;
  extractedData: ExtractedSalesPdfData;
  fieldComparisons: SalesFieldComparison[];
  overallStatus: 'match' | 'suspicious' | 'not_found';
}

/**
 * Result of internal Excel consistency check.
 * Validates that calculations within the Excel file are correct.
 */
export interface ExcelInternalCheckResult {
  rowIndex: number;
  documentNumber: string;
  checkType: 'vat_calculation' | 'total_mismatch' | 'date_sequence' | 'number_sequence';
  description: string;
  expectedValue: string;
  actualValue: string;
  status: 'error' | 'warning';
}

/**
 * Summary of the entire sales verification process.
 */
export interface SalesVerificationSummary {
  // PDF-Excel comparison results
  totalPdfs: number;
  totalExcelRows: number;
  matchedCount: number;
  suspiciousCount: number;
  notFoundCount: number;
  missingPdfCount: number;
  failedExtractionCount: number;         // PDFs where extraction failed entirely
  failedExtractionFiles: string[];       // File names of failed PDFs
  comparisons: SalesComparisonResult[];
  missingPdfRows: SalesExcelRow[];  // Excel rows with no matching PDF

  // Internal Excel check results
  excelChecks: ExcelInternalCheckResult[];
  excelCheckErrors: number;
  excelCheckWarnings: number;
}

/**
 * Mapping from Excel document types to expected PDF types.
 * Used for matching documents.
 */
export const SALES_DOCUMENT_TYPE_MAPPING: Record<string, string[]> = {
  'Ф-ра': ['ФАКТУРА', 'Фактура', 'фактура', 'INVOICE', 'Invoice'],
  'КИ': ['КРЕДИТНО ИЗВЕСТИЕ', 'Кредитно известие', 'CREDIT NOTE', 'Credit Note'],
  'ДИ': ['ДЕБИТНО ИЗВЕСТИЕ', 'Дебитно известие', 'DEBIT NOTE', 'Debit Note'],
};

/**
 * Document types that require PDF verification.
 * Other types (like ПЗДДС) are excluded from comparison.
 */
export const VERIFIABLE_DOCUMENT_TYPES = ['Ф-ра', 'КИ', 'ДИ'];

/**
 * Check if a document type requires PDF verification.
 * Uses exact match (case-insensitive) to avoid false positives from substring matching.
 */
export function isVerifiableDocumentType(docType: string): boolean {
  const normalized = docType.trim().toUpperCase();
  return VERIFIABLE_DOCUMENT_TYPES.some(t => normalized === t.toUpperCase());
}

/**
 * Check if a client ID represents a physical individual (placeholder ID).
 * Physical individuals use placeholder IDs like 999999999999999 since they don't have VAT/EIK.
 */
export function isPhysicalIndividualId(clientId: string | null): boolean {
  if (!clientId) return false;
  const normalized = clientId.replace(/\s/g, '');
  // Common placeholder patterns for physical individuals
  return /^9{6,}$/.test(normalized) || // All 9s (like 999999999999999)
         /^0{6,}$/.test(normalized) || // All 0s
         normalized.toUpperCase() === 'ФИЗЛИЦЕ' ||
         normalized.toUpperCase() === 'ФИЗ.ЛИЦЕ';
}
