import * as XLSX from 'xlsx';

/**
 * Shared utility functions for Excel journal parsers.
 * Used by both purchaseJournalParser.ts and salesJournalParser.ts.
 */

type CellValue = string | number | Date | undefined;

/**
 * Read an Excel file (.xlsx or .xls) and return its first worksheet as a 2D array.
 */
export async function readExcelFile(file: File): Promise<CellValue[][]> {
  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: 'array', cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error(
      'Файлът не съдържа листове — уверете се, че файлът не е празен.'
    );
  }
  const worksheet = workbook.Sheets[sheetName];
  const jsonData = XLSX.utils.sheet_to_json<CellValue[]>(worksheet, {
    header: 1,
    raw: true,
    defval: undefined,
  });

  // Filter out completely empty rows
  return jsonData.filter(row => row.some(cell => cell !== undefined && cell !== null && cell !== ''));
}

export function cleanString(value: string | number | Date | undefined): string {
  if (value === undefined || value === null) return '';
  if (value instanceof Date) {
    const day = value.getDate().toString().padStart(2, '0');
    const month = (value.getMonth() + 1).toString().padStart(2, '0');
    const year = value.getFullYear();
    return `${day}.${month}.${year}`;
  }
  return String(value).trim();
}

/**
 * Format document number - handles large numbers that might be in scientific notation
 */
export function formatDocumentNumber(value: string | number | Date | undefined): string {
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

/**
 * Format date value - handles Date objects from Excel properly.
 */
export function formatDateValue(value: string | number | Date | undefined): string {
  if (value === undefined || value === null) return '';

  // If it's a Date object (from cellDates: true), format it correctly
  if (value instanceof Date) {
    const day = value.getDate().toString().padStart(2, '0');
    const month = (value.getMonth() + 1).toString().padStart(2, '0');
    const year = value.getFullYear();
    return `${day}.${month}.${year}`;
  }

  // If it's a number, it might be an Excel serial date
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

export function parseAmount(value: string | number | Date | undefined): number | null {
  if (value === undefined || value === null || value === '') return null;
  if (value instanceof Date) return null;

  const str = String(value)
    .replace(/\s/g, '')      // Remove spaces
    .replace(/,/g, '.');     // Bulgarian decimal separator

  const num = parseFloat(str);
  return isNaN(num) ? null : num;
}
