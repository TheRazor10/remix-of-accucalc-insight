import * as XLSX from 'xlsx';
import { SalesExcelRow, ExcelInternalCheckResult, SalesJournalParseResult } from './salesComparisonTypes';

/**
 * Parse a Sales Journal (Дневник на продажбите) Excel file.
 * Based on the standard Bulgarian VAT sales journal format.
 * Returns both the rows and the firm's VAT ID from the header.
 */
export async function parseSalesJournal(file: File): Promise<SalesJournalParseResult> {
  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: 'array', cellDates: true });

  const firstSheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[firstSheetName];

  const data = XLSX.utils.sheet_to_json<(string | number | Date | undefined)[]>(worksheet, {
    header: 1,
    raw: true,
    dateNF: 'dd.mm.yyyy'
  });

  if (data.length < 2) {
    throw new Error('File does not contain enough data');
  }

  // Extract firm VAT ID from header rows (usually in first 5 rows)
  let firmVatId: string | null = null;
  for (let i = 0; i < Math.min(5, data.length); i++) {
    const row = data[i];
    if (row && Array.isArray(row)) {
      const rowStr = row.join(' ');
      // Look for "ИН по ЗДДС BG..." or just "BG" followed by digits
      const vatMatch = rowStr.match(/(?:ИН по ЗДДС|ДДС №?|VAT)\s*(BG\s*\d{9,10})/i);
      if (vatMatch) {
        firmVatId = vatMatch[1].replace(/\s/g, '').toUpperCase();
        break;
      }
      // Fallback: look for BG followed by 9-10 digits
      const bgMatch = rowStr.match(/BG\s*(\d{9,10})/i);
      if (bgMatch && !firmVatId) {
        firmVatId = 'BG' + bgMatch[1];
      }
    }
  }

  console.log(`[Sales Parser] Firm VAT ID: ${firmVatId}`);

  // Find header row
  let headerRowIndex = -1;
  for (let i = 0; i < Math.min(15, data.length); i++) {
    const row = data[i];
    if (row && Array.isArray(row)) {
      const rowStr = row.join(' ').toLowerCase();
      if (rowStr.includes('вид') && rowStr.includes('документ')) {
        headerRowIndex = i;
        break;
      }
      // Check for column header row with numbers
      if ((row[0] === '1' || row[0] === 1) &&
          (row[1] === '2' || row[1] === 2) &&
          (row[2] === '3' || row[2] === 3)) {
        headerRowIndex = i;
        break;
      }
    }
  }

  const dataStartRow = headerRowIndex >= 0 ? headerRowIndex + 1 : 1;

  console.log(`[Sales Parser] Header row: ${headerRowIndex}, Data starts at row: ${dataStartRow}`);

  const rows: SalesExcelRow[] = [];

  for (let i = dataStartRow; i < data.length; i++) {
    const row = data[i];
    if (!row || !Array.isArray(row)) continue;

    // Skip column numbers row
    if ((row[0] === '1' || row[0] === 1) &&
        (row[1] === '2' || row[1] === 2) &&
        (row[2] === '3' || row[2] === 3)) {
      continue;
    }

    const documentNumber = formatDocumentNumber(row[3]);
    if (!documentNumber || documentNumber === '' || documentNumber.toLowerCase().includes('общо')) {
      continue;
    }

    const documentType = cleanString(row[2]);
    const documentDate = formatDateValue(row[4]);
    const counterpartyId = cleanString(row[5]);
    const counterpartyName = cleanString(row[6]);

    // Sales journal amount columns (0-indexed, but columns are 1-indexed in Excel)
    // Column 9 (index 9) = Общ размер на ДО за облагане с ДДС
    // Column 10 (index 10) = Всичко начислен ДДС
    // Column 11 (index 11) = ДО на облагаемите доставки със ставка 20%
    // Column 12 (index 12) = Начислен ДДС за доставки по к.11
    const totalTaxBaseCol9 = parseAmount(row[9]);  // Column 10 (0-indexed: 9) - Общ ДО
    const totalVatCol10 = parseAmount(row[10]);    // Column 11 (0-indexed: 10) - Всичко ДДС
    const taxBase20 = parseAmount(row[11]);        // Column 12 (0-indexed: 11) - ДО 20%
    const vat20 = parseAmount(row[12]);            // Column 13 (0-indexed: 12) - ДДС 20%
    const taxBase9 = parseAmount(row[17]);         // Column 18 (0-indexed: 17) - ДО 9%
    const vat9 = parseAmount(row[18]);             // Column 19 (0-indexed: 18) - ДДС 9%
    const taxBase0 = parseAmount(row[19]);         // Column 20 (0-indexed: 19) - ДО 0%

    // Use the actual column 9 and 10 values for totals
    const totalTaxBase = totalTaxBaseCol9;
    const totalVat = totalVatCol10;

    const hasDDS = counterpartyId.toUpperCase().startsWith('BG');

    if (i < dataStartRow + 3) {
      console.log(`[Sales Row ${i + 1}] DocNum: "${documentNumber}", Date: "${documentDate}", Client: "${counterpartyId}"`);
    }

    rows.push({
      rowIndex: i + 1,
      documentType,
      documentNumber,
      documentDate,
      counterpartyId,
      counterpartyName,
      hasDDS,
      taxBase20,
      vat20,
      taxBase9,
      vat9,
      taxBase0,
      totalTaxBase,
      totalVat,
    });
  }

  console.log(`[Sales Parser] Parsed ${rows.length} rows`);
  return { rows, firmVatId };
}

/**
 * Run internal consistency checks on the sales journal data.
 * Validates VAT calculations, document sequences, etc.
 */
export function runExcelInternalChecks(rows: SalesExcelRow[]): ExcelInternalCheckResult[] {
  const results: ExcelInternalCheckResult[] = [];

  // Track document numbers for sequence check
  const documentNumbers: Map<string, { num: number; rowIndex: number; date: string }[]> = new Map();

  for (const row of rows) {
    // Check 1: Column 9 (totalTaxBase) should equal Column 11 (taxBase20)
    if (row.totalTaxBase !== null && row.taxBase20 !== null) {
      const col9 = Math.round(row.totalTaxBase * 100) / 100;
      const col11 = Math.round(row.taxBase20 * 100) / 100;
      const tolerance = 0.02;

      if (Math.abs(col9 - col11) > tolerance) {
        results.push({
          rowIndex: row.rowIndex,
          documentNumber: row.documentNumber,
          checkType: 'total_mismatch',
          description: 'Column 9 (Total Tax Base) does not match Column 11 (Tax Base 20%)',
          expectedValue: col11.toFixed(2),
          actualValue: col9.toFixed(2),
          status: 'error',
        });
      }
    }

    // Check 2: Column 10 (totalVat) should equal Column 12 (vat20)
    if (row.totalVat !== null && row.vat20 !== null) {
      const col10 = Math.round(row.totalVat * 100) / 100;
      const col12 = Math.round(row.vat20 * 100) / 100;
      const tolerance = 0.02;

      if (Math.abs(col10 - col12) > tolerance) {
        results.push({
          rowIndex: row.rowIndex,
          documentNumber: row.documentNumber,
          checkType: 'total_mismatch',
          description: 'Column 10 (Total VAT) does not match Column 12 (VAT 20%)',
          expectedValue: col12.toFixed(2),
          actualValue: col10.toFixed(2),
          status: 'error',
        });
      }
    }

    // Check 3: VAT calculation (20% rate)
    if (row.taxBase20 !== null && row.vat20 !== null) {
      const expectedVat = Math.round(row.taxBase20 * 0.20 * 100) / 100;
      const actualVat = Math.round(row.vat20 * 100) / 100;
      const tolerance = 0.02;

      if (Math.abs(expectedVat - actualVat) > tolerance) {
        results.push({
          rowIndex: row.rowIndex,
          documentNumber: row.documentNumber,
          checkType: 'vat_calculation',
          description: 'VAT 20% does not match calculated value',
          expectedValue: expectedVat.toFixed(2),
          actualValue: actualVat.toFixed(2),
          status: 'error',
        });
      }
    }

    // Check 4: VAT calculation (9% rate)
    if (row.taxBase9 !== null && row.vat9 !== null) {
      const expectedVat = Math.round(row.taxBase9 * 0.09 * 100) / 100;
      const actualVat = Math.round(row.vat9 * 100) / 100;
      const tolerance = 0.02;

      if (Math.abs(expectedVat - actualVat) > tolerance) {
        results.push({
          rowIndex: row.rowIndex,
          documentNumber: row.documentNumber,
          checkType: 'vat_calculation',
          description: 'VAT 9% does not match calculated value',
          expectedValue: expectedVat.toFixed(2),
          actualValue: actualVat.toFixed(2),
          status: 'error',
        });
      }
    }

    // Track document numbers for sequence analysis
    const docType = row.documentType || 'unknown';
    if (!documentNumbers.has(docType)) {
      documentNumbers.set(docType, []);
    }
    const numericPart = parseInt(row.documentNumber.replace(/\D/g, ''), 10);
    if (!isNaN(numericPart)) {
      documentNumbers.get(docType)!.push({
        num: numericPart,
        rowIndex: row.rowIndex,
        date: row.documentDate,
      });
    }
  }

  // Check 5: Document number sequence analysis
  for (const [docType, entries] of documentNumbers) {
    if (entries.length < 2) continue;

    // Sort by document number
    const sorted = [...entries].sort((a, b) => a.num - b.num);

    // Check for gaps
    for (let i = 1; i < sorted.length; i++) {
      const gap = sorted[i].num - sorted[i - 1].num;
      if (gap > 1) {
        results.push({
          rowIndex: 0,
          documentNumber: `${docType} ${sorted[i - 1].num} - ${sorted[i].num}`,
          checkType: 'number_sequence',
          description: `Gap in numbering: missing ${gap - 1} document(s)`,
          expectedValue: (sorted[i - 1].num + 1).toString(),
          actualValue: sorted[i].num.toString(),
          status: 'warning',
        });
      }
    }

    // Check for duplicates
    const seen = new Map<number, number>();
    for (const entry of entries) {
      if (seen.has(entry.num)) {
        results.push({
          rowIndex: entry.rowIndex,
          documentNumber: entry.num.toString(),
          checkType: 'number_sequence',
          description: `Duplicate document number found`,
          expectedValue: 'Unique',
          actualValue: `Rows ${seen.get(entry.num)} and ${entry.rowIndex}`,
          status: 'error',
        });
      } else {
        seen.set(entry.num, entry.rowIndex);
      }
    }

    // Check date-number order (higher number should have same or later date)
    for (let i = 1; i < sorted.length; i++) {
      const prevDate = parseDate(sorted[i - 1].date);
      const currDate = parseDate(sorted[i].date);

      if (prevDate && currDate && currDate < prevDate) {
        results.push({
          rowIndex: sorted[i].rowIndex,
          documentNumber: sorted[i].num.toString(),
          checkType: 'date_sequence',
          description: `Document date is earlier than previous document`,
          expectedValue: `>= ${sorted[i - 1].date}`,
          actualValue: sorted[i].date,
          status: 'warning',
        });
      }
    }
  }

  return results;
}

// Helper functions
function cleanString(value: string | number | Date | undefined): string {
  if (value === undefined || value === null) return '';
  if (value instanceof Date) {
    const day = value.getDate().toString().padStart(2, '0');
    const month = (value.getMonth() + 1).toString().padStart(2, '0');
    const year = value.getFullYear();
    return `${day}.${month}.${year}`;
  }
  return String(value).trim();
}

function formatDocumentNumber(value: string | number | Date | undefined): string {
  if (value === undefined || value === null) return '';
  if (value instanceof Date) return '';

  if (typeof value === 'number') {
    if (Number.isInteger(value)) {
      return value.toFixed(0);
    }
    return value.toString();
  }

  return String(value).trim();
}

function formatDateValue(value: string | number | Date | undefined): string {
  if (value === undefined || value === null) return '';

  if (value instanceof Date) {
    const day = value.getDate().toString().padStart(2, '0');
    const month = (value.getMonth() + 1).toString().padStart(2, '0');
    const year = value.getFullYear();
    return `${day}.${month}.${year}`;
  }

  if (typeof value === 'number' && value > 30000 && value < 60000) {
    const excelEpoch = new Date(1899, 11, 30);
    const jsDate = new Date(excelEpoch.getTime() + value * 24 * 60 * 60 * 1000);
    const day = jsDate.getDate().toString().padStart(2, '0');
    const month = (jsDate.getMonth() + 1).toString().padStart(2, '0');
    const year = jsDate.getFullYear();
    return `${day}.${month}.${year}`;
  }

  return String(value).trim();
}

function parseAmount(value: string | number | Date | undefined): number | null {
  if (value === undefined || value === null || value === '') return null;
  if (value instanceof Date) return null;

  const str = String(value)
    .replace(/\s/g, '')
    .replace(/,/g, '.');

  const num = parseFloat(str);
  return isNaN(num) ? null : num;
}

/**
 * Parse a date string in DD.MM.YYYY format to a Date object.
 */
function parseDate(dateStr: string): Date | null {
  if (!dateStr) return null;

  const match = dateStr.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!match) return null;

  const day = parseInt(match[1], 10);
  const month = parseInt(match[2], 10) - 1; // JS months are 0-indexed
  const year = parseInt(match[3], 10);

  return new Date(year, month, day);
}

/**
 * Normalize document number for comparison
 */
export function normalizeSalesDocumentNumber(num: string | null): string {
  if (!num) return '';
  return num
    .replace(/^0+/, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase();
}

/**
 * Normalize date for comparison
 */
export function normalizeSalesDate(dateStr: string | null): string {
  if (!dateStr) return '';

  const trimmed = dateStr.trim();

  // DD.MM.YYYY format
  const dotFormat = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
  if (dotFormat) {
    const day = parseInt(dotFormat[1], 10);
    const month = parseInt(dotFormat[2], 10);
    let year = parseInt(dotFormat[3], 10);
    if (year < 100) year = year > 50 ? 1900 + year : 2000 + year;
    return `${day.toString().padStart(2, '0')}.${month.toString().padStart(2, '0')}.${year}`;
  }

  return trimmed;
}

/**
 * Compare dates from PDF and Excel
 */
export function salesDatesMatch(date1: string | null, date2: string | null): boolean {
  const norm1 = normalizeSalesDate(date1);
  const norm2 = normalizeSalesDate(date2);
  return norm1 === norm2 && norm1 !== '';
}
