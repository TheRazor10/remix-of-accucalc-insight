// Types for Invoice Comparison Feature

export interface InvoiceExcelRow {
  rowIndex: number;
  documentType: string;        // Вид на документа (column 3)
  documentNumber: string;      // Номер на документа (column 4)
  documentDate: string;        // Дата на документа (column 5)
  counterpartyId: string;      // Идентификационен номер на контрагента (column 6)
  hasDDS: boolean;             // true if counterpartyId starts with "BG"
  amountNoDDS: number | null;  // Column 10 - ДО без право на данъчен кредит
  amountWithDDS: number | null; // Column 11 - ДО с право на пълен данъчен кредит
  vatWithFullCredit: number | null; // Column 12 - ДДС с право на пълен данъчен кредит
}

export interface ExtractedInvoiceData {
  imageIndex: number;
  fileName: string;
  documentType: string | null;
  documentNumber: string | null;
  documentDate: string | null;
  supplierId: string | null;     // ДДС № or ЕИК
  taxBaseAmount: number | null;  // Данъчна основа
  vatAmount: number | null;      // ДДС (VAT amount)
  confidence: 'high' | 'medium' | 'low' | 'unreadable';
  rawResponse?: string;
  usedProModel?: boolean;        // Whether Pro model was used for this extraction
  wasDoubleChecked?: boolean;    // Whether this was re-extracted after suspicious verification
}

export interface FieldComparison {
  fieldName: string;
  fieldLabel: string;
  imageValue: string | null;
  excelValue: string | null;
  status: 'match' | 'suspicious' | 'unreadable' | 'missing';
}

export interface ComparisonResult {
  imageFileName: string;
  imageIndex: number;
  matchedExcelRow: number | null;
  extractedData: ExtractedInvoiceData;
  fieldComparisons: FieldComparison[];
  overallStatus: 'match' | 'suspicious' | 'unreadable' | 'not_found';
}

export interface VerificationSummary {
  totalImages: number;
  totalExcelRows: number;
  matchedCount: number;
  suspiciousCount: number;
  unreadableCount: number;
  notFoundCount: number;
  missingPdfCount: number;
  comparisons: ComparisonResult[];
  missingPdfRows: InvoiceExcelRow[]; // Excel rows with no matching PDF
}

// Mapping from Excel document types to invoice document types
export const DOCUMENT_TYPE_MAPPING: Record<string, string[]> = {
  'Ф-ра': ['ФАКТУРА', 'Фактура', 'фактура', 'INVOICE'],
  'КИ': ['КРЕДИТНО ИЗВЕСТИЕ', 'Кредитно известие', 'CREDIT NOTE'],
  'ДИ': ['ДЕБИТНО ИЗВЕСТИЕ', 'Дебитно известие', 'DEBIT NOTE'],
};
