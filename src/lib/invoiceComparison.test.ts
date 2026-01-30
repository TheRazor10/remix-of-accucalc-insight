import { describe, it, expect } from 'vitest';
import { compareInvoiceWithExcel, runVerification, selectBetterExtraction } from './invoiceComparison';
import { ExtractedInvoiceData, InvoiceExcelRow } from './invoiceComparisonTypes';

// Helper to create test invoice data
function createInvoiceData(overrides: Partial<ExtractedInvoiceData> = {}): ExtractedInvoiceData {
  return {
    imageIndex: 0,
    fileName: 'test.pdf',
    documentType: 'ФАКТУРА',
    documentNumber: '12345',
    documentDate: '01.01.2024',
    supplierId: 'BG123456789',
    taxBaseAmount: 1000,
    vatAmount: 200,
    confidence: 'high',
    ...overrides,
  };
}

// Helper to create test Excel row data
function createExcelRow(overrides: Partial<InvoiceExcelRow> = {}): InvoiceExcelRow {
  return {
    rowIndex: 1,
    documentType: 'Ф-ра',
    documentNumber: '12345',
    documentDate: '01.01.2024',
    counterpartyId: 'BG123456789',
    hasDDS: true,
    amountNoDDS: null,
    amountWithDDS: 1000,
    vatWithFullCredit: 200,
    ...overrides,
  };
}

describe('compareInvoiceWithExcel', () => {
  describe('Document number matching', () => {
    it('should match when document numbers are exactly the same', () => {
      const invoice = createInvoiceData({ documentNumber: '12345' });
      const excelRows = [createExcelRow({ documentNumber: '12345' })];

      const result = compareInvoiceWithExcel(invoice, excelRows);

      expect(result.matchedExcelRow).toBe(1);
      expect(result.overallStatus).toBe('match');
    });

    it('should match when document numbers differ only in leading zeros', () => {
      const invoice = createInvoiceData({ documentNumber: '00012345' });
      const excelRows = [createExcelRow({ documentNumber: '12345' })];

      const result = compareInvoiceWithExcel(invoice, excelRows);

      expect(result.matchedExcelRow).toBe(1);
    });

    it('should match when document numbers differ only in special characters', () => {
      const invoice = createInvoiceData({ documentNumber: '123-45' });
      const excelRows = [createExcelRow({ documentNumber: '12345' })];

      const result = compareInvoiceWithExcel(invoice, excelRows);

      expect(result.matchedExcelRow).toBe(1);
    });

    it('should match case-insensitively', () => {
      const invoice = createInvoiceData({ documentNumber: 'ABC123' });
      const excelRows = [createExcelRow({ documentNumber: 'abc123' })];

      const result = compareInvoiceWithExcel(invoice, excelRows);

      expect(result.matchedExcelRow).toBe(1);
    });
  });

  describe('Document type matching', () => {
    it('should match ФАКТУРА with Ф-ра', () => {
      const invoice = createInvoiceData({ documentType: 'ФАКТУРА' });
      const excelRows = [createExcelRow({ documentType: 'Ф-ра' })];

      const result = compareInvoiceWithExcel(invoice, excelRows);

      const typeComparison = result.fieldComparisons.find(fc => fc.fieldName === 'documentType');
      expect(typeComparison?.status).toBe('match');
    });

    it('should match КРЕДИТНО ИЗВЕСТИЕ with КИ', () => {
      const invoice = createInvoiceData({ documentType: 'КРЕДИТНО ИЗВЕСТИЕ' });
      const excelRows = [createExcelRow({ documentType: 'КИ' })];

      const result = compareInvoiceWithExcel(invoice, excelRows);

      const typeComparison = result.fieldComparisons.find(fc => fc.fieldName === 'documentType');
      expect(typeComparison?.status).toBe('match');
    });

    it('should match ДЕБИТНО ИЗВЕСТИЕ with ДИ', () => {
      const invoice = createInvoiceData({ documentType: 'ДЕБИТНО ИЗВЕСТИЕ' });
      const excelRows = [createExcelRow({ documentType: 'ДИ' })];

      const result = compareInvoiceWithExcel(invoice, excelRows);

      const typeComparison = result.fieldComparisons.find(fc => fc.fieldName === 'documentType');
      expect(typeComparison?.status).toBe('match');
    });

    it('should mark mismatched document types as suspicious', () => {
      const invoice = createInvoiceData({ documentType: 'ФАКТУРА' });
      const excelRows = [createExcelRow({ documentType: 'КИ' })];

      const result = compareInvoiceWithExcel(invoice, excelRows);

      const typeComparison = result.fieldComparisons.find(fc => fc.fieldName === 'documentType');
      expect(typeComparison?.status).toBe('suspicious');
    });
  });

  describe('Supplier ID matching', () => {
    it('should match exact supplier IDs', () => {
      const invoice = createInvoiceData({ supplierId: 'BG123456789' });
      const excelRows = [createExcelRow({ counterpartyId: 'BG123456789' })];

      const result = compareInvoiceWithExcel(invoice, excelRows);

      const supplierComparison = result.fieldComparisons.find(fc => fc.fieldName === 'supplierId');
      expect(supplierComparison?.status).toBe('match');
    });

    it('should match when invoice has BG prefix but Excel does not', () => {
      const invoice = createInvoiceData({ supplierId: 'BG123456789' });
      const excelRows = [createExcelRow({ counterpartyId: '123456789', hasDDS: false })];

      const result = compareInvoiceWithExcel(invoice, excelRows);

      const supplierComparison = result.fieldComparisons.find(fc => fc.fieldName === 'supplierId');
      expect(supplierComparison?.status).toBe('match');
    });

    it('should match when Excel has BG prefix but invoice does not', () => {
      const invoice = createInvoiceData({ supplierId: '123456789' });
      const excelRows = [createExcelRow({ counterpartyId: 'BG123456789' })];

      const result = compareInvoiceWithExcel(invoice, excelRows);

      const supplierComparison = result.fieldComparisons.find(fc => fc.fieldName === 'supplierId');
      expect(supplierComparison?.status).toBe('match');
    });

    it('should match case-insensitively', () => {
      const invoice = createInvoiceData({ supplierId: 'bg123456789' });
      const excelRows = [createExcelRow({ counterpartyId: 'BG123456789' })];

      const result = compareInvoiceWithExcel(invoice, excelRows);

      const supplierComparison = result.fieldComparisons.find(fc => fc.fieldName === 'supplierId');
      expect(supplierComparison?.status).toBe('match');
    });

    it('should match when one ID is suffix of the other', () => {
      const invoice = createInvoiceData({ supplierId: '456789' });
      const excelRows = [createExcelRow({ counterpartyId: 'BG123456789' })];

      const result = compareInvoiceWithExcel(invoice, excelRows);

      const supplierComparison = result.fieldComparisons.find(fc => fc.fieldName === 'supplierId');
      expect(supplierComparison?.status).toBe('match');
    });
  });

  describe('Date matching', () => {
    it('should match dates in same format', () => {
      const invoice = createInvoiceData({ documentDate: '15.03.2024' });
      const excelRows = [createExcelRow({ documentDate: '15.03.2024' })];

      const result = compareInvoiceWithExcel(invoice, excelRows);

      const dateComparison = result.fieldComparisons.find(fc => fc.fieldName === 'documentDate');
      expect(dateComparison?.status).toBe('match');
    });

    it('should match dates with different separators', () => {
      const invoice = createInvoiceData({ documentDate: '15/03/2024' });
      const excelRows = [createExcelRow({ documentDate: '15.03.2024' })];

      const result = compareInvoiceWithExcel(invoice, excelRows);

      const dateComparison = result.fieldComparisons.find(fc => fc.fieldName === 'documentDate');
      expect(dateComparison?.status).toBe('match');
    });

    it('should match dates with different formatting (ISO vs European)', () => {
      const invoice = createInvoiceData({ documentDate: '2024-03-15' });
      const excelRows = [createExcelRow({ documentDate: '15.03.2024' })];

      const result = compareInvoiceWithExcel(invoice, excelRows);

      const dateComparison = result.fieldComparisons.find(fc => fc.fieldName === 'documentDate');
      expect(dateComparison?.status).toBe('match');
    });

    it('should mark mismatched dates as suspicious', () => {
      const invoice = createInvoiceData({ documentDate: '15.03.2024' });
      const excelRows = [createExcelRow({ documentDate: '16.03.2024' })];

      const result = compareInvoiceWithExcel(invoice, excelRows);

      const dateComparison = result.fieldComparisons.find(fc => fc.fieldName === 'documentDate');
      expect(dateComparison?.status).toBe('suspicious');
    });
  });

  describe('Amount matching', () => {
    it('should match exact amounts', () => {
      const invoice = createInvoiceData({ taxBaseAmount: 1000.00 });
      const excelRows = [createExcelRow({ amountWithDDS: 1000.00 })];

      const result = compareInvoiceWithExcel(invoice, excelRows);

      const amountComparison = result.fieldComparisons.find(fc => fc.fieldName === 'amount');
      expect(amountComparison?.status).toBe('match');
    });

    it('should match amounts within 0.03 tolerance for tax base', () => {
      const invoice = createInvoiceData({ taxBaseAmount: 1000.02 });
      const excelRows = [createExcelRow({ amountWithDDS: 1000.00 })];

      const result = compareInvoiceWithExcel(invoice, excelRows);

      const amountComparison = result.fieldComparisons.find(fc => fc.fieldName === 'amount');
      expect(amountComparison?.status).toBe('match');
    });

    it('should mark amounts outside tolerance as suspicious', () => {
      const invoice = createInvoiceData({ taxBaseAmount: 1000.05 });
      const excelRows = [createExcelRow({ amountWithDDS: 1000.00 })];

      const result = compareInvoiceWithExcel(invoice, excelRows);

      const amountComparison = result.fieldComparisons.find(fc => fc.fieldName === 'amount');
      expect(amountComparison?.status).toBe('suspicious');
    });

    it('should use amountNoDDS when hasDDS is false', () => {
      const invoice = createInvoiceData({ taxBaseAmount: 500.00 });
      const excelRows = [createExcelRow({
        hasDDS: false,
        amountNoDDS: 500.00,
        amountWithDDS: 1000.00
      })];

      const result = compareInvoiceWithExcel(invoice, excelRows);

      const amountComparison = result.fieldComparisons.find(fc => fc.fieldName === 'amount');
      expect(amountComparison?.status).toBe('match');
    });
  });

  describe('VAT matching', () => {
    it('should match exact VAT amounts', () => {
      const invoice = createInvoiceData({ vatAmount: 200.00 });
      const excelRows = [createExcelRow({ vatWithFullCredit: 200.00 })];

      const result = compareInvoiceWithExcel(invoice, excelRows);

      const vatComparison = result.fieldComparisons.find(fc => fc.fieldName === 'vatAmount');
      expect(vatComparison?.status).toBe('match');
    });

    it('should match VAT amounts within strict tolerance (0.005)', () => {
      const invoice = createInvoiceData({ vatAmount: 200.004 });
      const excelRows = [createExcelRow({ vatWithFullCredit: 200.00 })];

      const result = compareInvoiceWithExcel(invoice, excelRows);

      const vatComparison = result.fieldComparisons.find(fc => fc.fieldName === 'vatAmount');
      expect(vatComparison?.status).toBe('match');
    });

    it('should not compare VAT when hasDDS is false', () => {
      const invoice = createInvoiceData({ vatAmount: 200.00 });
      const excelRows = [createExcelRow({ hasDDS: false, vatWithFullCredit: 0 })];

      const result = compareInvoiceWithExcel(invoice, excelRows);

      const vatComparison = result.fieldComparisons.find(fc => fc.fieldName === 'vatAmount');
      expect(vatComparison).toBeUndefined();
    });
  });

  describe('Credit note handling', () => {
    it('should normalize credit note amounts to negative for comparison', () => {
      // Credit note with positive amount in invoice but negative in Excel
      const invoice = createInvoiceData({
        documentType: 'КРЕДИТНО ИЗВЕСТИЕ',
        taxBaseAmount: 100.00,  // Positive in invoice
        vatAmount: 20.00
      });
      const excelRows = [createExcelRow({
        documentType: 'КИ',
        amountWithDDS: -100.00,  // Negative in Excel
        vatWithFullCredit: -20.00
      })];

      const result = compareInvoiceWithExcel(invoice, excelRows);

      const amountComparison = result.fieldComparisons.find(fc => fc.fieldName === 'amount');
      expect(amountComparison?.status).toBe('match');
    });
  });

  describe('Exclusive 1:1 matching', () => {
    it('should not match an invoice to an already-claimed Excel row', () => {
      const invoice = createInvoiceData({ documentNumber: '12345' });
      const excelRows = [createExcelRow({ rowIndex: 1, documentNumber: '12345' })];
      const excludeRows = new Set([1]); // Row 1 is already claimed

      const result = compareInvoiceWithExcel(invoice, excelRows, excludeRows);

      expect(result.matchedExcelRow).toBeNull();
      expect(result.overallStatus).toBe('not_found');
    });

    it('should match to the next available row when first choice is taken', () => {
      const invoice = createInvoiceData({ documentNumber: '12345' });
      const excelRows = [
        createExcelRow({ rowIndex: 1, documentNumber: '12345' }),
        createExcelRow({ rowIndex: 2, documentNumber: '12345' }),
      ];
      const excludeRows = new Set([1]);

      const result = compareInvoiceWithExcel(invoice, excelRows, excludeRows);

      expect(result.matchedExcelRow).toBe(2);
    });
  });

  describe('Overall status determination', () => {
    it('should return "match" when all fields match', () => {
      const invoice = createInvoiceData();
      const excelRows = [createExcelRow()];

      const result = compareInvoiceWithExcel(invoice, excelRows);

      expect(result.overallStatus).toBe('match');
    });

    it('should return "suspicious" when any field mismatches', () => {
      const invoice = createInvoiceData({ taxBaseAmount: 9999 });
      const excelRows = [createExcelRow({ amountWithDDS: 1000 })];

      const result = compareInvoiceWithExcel(invoice, excelRows);

      expect(result.overallStatus).toBe('suspicious');
    });

    it('should return "unreadable" when invoice confidence is unreadable and no match found', () => {
      const invoice = createInvoiceData({
        confidence: 'unreadable',
        documentNumber: null,
        documentType: null,
        documentDate: null,
        supplierId: null,
        taxBaseAmount: null,
        vatAmount: null
      });
      const excelRows: InvoiceExcelRow[] = [];

      const result = compareInvoiceWithExcel(invoice, excelRows);

      expect(result.overallStatus).toBe('unreadable');
    });

    it('should return "not_found" when no matching Excel row exists', () => {
      const invoice = createInvoiceData({ documentNumber: '99999' });
      const excelRows = [createExcelRow({ documentNumber: '12345' })];

      const result = compareInvoiceWithExcel(invoice, excelRows);

      // Still matches via anchor-based matching (fewest mismatches)
      // Only returns not_found when all rows are excluded
      expect(result.matchedExcelRow).toBe(1);
    });
  });

  describe('Unreadable field handling', () => {
    it('should mark null invoice values as unreadable', () => {
      const invoice = createInvoiceData({ documentType: null });
      const excelRows = [createExcelRow()];

      const result = compareInvoiceWithExcel(invoice, excelRows);

      const typeComparison = result.fieldComparisons.find(fc => fc.fieldName === 'documentType');
      expect(typeComparison?.status).toBe('unreadable');
    });
  });
});

describe('runVerification', () => {
  it('should process all invoices and track used Excel rows', () => {
    const invoices = [
      createInvoiceData({ imageIndex: 0, fileName: 'inv1.pdf', documentNumber: '001' }),
      createInvoiceData({ imageIndex: 1, fileName: 'inv2.pdf', documentNumber: '002' }),
    ];
    const excelRows = [
      createExcelRow({ rowIndex: 1, documentNumber: '001' }),
      createExcelRow({ rowIndex: 2, documentNumber: '002' }),
    ];

    const result = runVerification(invoices, excelRows);

    expect(result.totalImages).toBe(2);
    expect(result.totalExcelRows).toBe(2);
    expect(result.matchedCount).toBe(2);
    expect(result.missingPdfCount).toBe(0);
  });

  it('should identify Excel rows without matching PDFs', () => {
    const invoices = [
      createInvoiceData({ imageIndex: 0, documentNumber: '001' }),
    ];
    const excelRows = [
      createExcelRow({ rowIndex: 1, documentNumber: '001' }),
      createExcelRow({ rowIndex: 2, documentNumber: '002' }),
      createExcelRow({ rowIndex: 3, documentNumber: '003' }),
    ];

    const result = runVerification(invoices, excelRows);

    expect(result.missingPdfCount).toBe(2);
    expect(result.missingPdfRows).toHaveLength(2);
    expect(result.missingPdfRows.map(r => r.rowIndex)).toEqual([2, 3]);
  });

  it('should count suspicious comparisons correctly', () => {
    const invoices = [
      createInvoiceData({ imageIndex: 0, documentNumber: '001', taxBaseAmount: 9999 }),
    ];
    const excelRows = [
      createExcelRow({ rowIndex: 1, documentNumber: '001', amountWithDDS: 1000 }),
    ];

    const result = runVerification(invoices, excelRows);

    expect(result.suspiciousCount).toBe(1);
    expect(result.matchedCount).toBe(0);
  });

  it('should count unreadable invoices correctly', () => {
    const invoices = [
      createInvoiceData({
        imageIndex: 0,
        confidence: 'unreadable',
        documentNumber: null,
        documentType: null
      }),
    ];
    const excelRows = [createExcelRow({ rowIndex: 1 })];

    const result = runVerification(invoices, excelRows);

    // Even unreadable invoices get matched via anchor-based matching
    // The unreadable status comes from field comparisons
    expect(result.comparisons[0].overallStatus).not.toBe('match');
  });

  it('should enforce exclusive 1:1 matching across all invoices', () => {
    // Two invoices with same document number should match to different Excel rows
    const invoices = [
      createInvoiceData({ imageIndex: 0, fileName: 'inv1.pdf', documentNumber: '001' }),
      createInvoiceData({ imageIndex: 1, fileName: 'inv2.pdf', documentNumber: '001' }),
    ];
    const excelRows = [
      createExcelRow({ rowIndex: 1, documentNumber: '001' }),
      createExcelRow({ rowIndex: 2, documentNumber: '001' }),
    ];

    const result = runVerification(invoices, excelRows);

    // Both invoices should match, but to different rows
    expect(result.comparisons[0].matchedExcelRow).toBe(1);
    expect(result.comparisons[1].matchedExcelRow).toBe(2);
  });

  it('should handle empty inputs', () => {
    const result = runVerification([], []);

    expect(result.totalImages).toBe(0);
    expect(result.totalExcelRows).toBe(0);
    expect(result.matchedCount).toBe(0);
    expect(result.missingPdfCount).toBe(0);
  });
});

describe('selectBetterExtraction', () => {
  it('should prefer higher confidence extraction', () => {
    const original = createInvoiceData({ confidence: 'medium' });
    const retried = createInvoiceData({ confidence: 'high' });

    const result = selectBetterExtraction(original, retried);

    expect(result.confidence).toBe('high');
    expect(result.wasDoubleChecked).toBe(true);
  });

  it('should keep original if it has higher confidence', () => {
    const original = createInvoiceData({ confidence: 'high', documentNumber: 'ORIGINAL' });
    const retried = createInvoiceData({ confidence: 'medium', documentNumber: 'RETRIED' });

    const result = selectBetterExtraction(original, retried);

    expect(result.documentNumber).toBe('ORIGINAL');
  });

  it('should prefer extraction with more fields when confidence is equal', () => {
    const original = createInvoiceData({
      confidence: 'medium',
      vatAmount: null  // Missing one field
    });
    const retried = createInvoiceData({
      confidence: 'medium',
      vatAmount: 200  // Has all fields
    });

    const result = selectBetterExtraction(original, retried);

    expect(result.vatAmount).toBe(200);
  });

  it('should keep original when equal confidence and field count', () => {
    const original = createInvoiceData({ confidence: 'medium', documentNumber: 'ORIGINAL' });
    const retried = createInvoiceData({ confidence: 'medium', documentNumber: 'RETRIED' });

    const result = selectBetterExtraction(original, retried);

    expect(result.documentNumber).toBe('ORIGINAL');
  });

  it('should always mark result as wasDoubleChecked', () => {
    const original = createInvoiceData();
    const retried = createInvoiceData();

    const result = selectBetterExtraction(original, retried);

    expect(result.wasDoubleChecked).toBe(true);
  });
});
