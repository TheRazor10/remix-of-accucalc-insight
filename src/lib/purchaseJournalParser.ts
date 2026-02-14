import * as XLSX from 'xlsx';
import { InvoiceExcelRow } from './invoiceComparisonTypes';
import { cleanString, formatDocumentNumber, formatDateValue, parseAmount } from './excelParserUtils';

/**
 * Parse a Purchase Journal (Дневник на покупките) Excel file
 * Extracts specific columns: 3 (type), 4 (number), 5 (date), 6 (ID), 9 and 10 (amounts)
 */
export async function parsePurchaseJournal(file: File): Promise<InvoiceExcelRow[]> {
  const arrayBuffer = await file.arrayBuffer();
  // Use cellDates: true to properly parse Excel dates as Date objects
  const workbook = XLSX.read(arrayBuffer, { type: 'array', cellDates: true });
  
  const firstSheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[firstSheetName];
  
  // Convert to array of arrays with raw: true to preserve date objects
  const data = XLSX.utils.sheet_to_json<(string | number | Date | undefined)[]>(worksheet, { 
    header: 1,
    raw: true,
    dateNF: 'dd.mm.yyyy' // Hint for date formatting
  });
  
  if (data.length < 2) {
    throw new Error('Файлът не съдържа достатъчно данни');
  }
  
  // Find header row - look for row containing "Вид на документа" or column numbers
  let headerRowIndex = -1;
  for (let i = 0; i < Math.min(15, data.length); i++) {
    const row = data[i];
    if (row && Array.isArray(row)) {
      const rowStr = row.join(' ').toLowerCase();
      if (rowStr.includes('вид') && rowStr.includes('документ')) {
        headerRowIndex = i;
        break;
      }
      // Check for column header row with numbers (1, 2, 3, 4, 5, 6...)
      // This is typically the row right before data
      if ((row[0] === '1' || row[0] === 1) && 
          (row[1] === '2' || row[1] === 2) && 
          (row[2] === '3' || row[2] === 3)) {
        headerRowIndex = i; // This IS the header row (column numbers)
        break;
      }
    }
  }
  
  // Data starts after the header row
  const dataStartRow = headerRowIndex >= 0 ? headerRowIndex + 1 : 1;
  
  
  const rows: InvoiceExcelRow[] = [];
  
  for (let i = dataStartRow; i < data.length; i++) {
    const row = data[i];
    if (!row || !Array.isArray(row)) continue;
    
    // Skip the column numbers row (1, 2, 3, 4, 5, 6...) if it wasn't caught as header
    // This row has sequential numbers starting from 1
    if ((row[0] === '1' || row[0] === 1) && 
        (row[1] === '2' || row[1] === 2) && 
        (row[2] === '3' || row[2] === 3)) {
      continue;
    }
    
    // Skip empty rows or summary rows
    const documentNumber = formatDocumentNumber(row[3]); // Column 4 (0-indexed: 3)
    if (!documentNumber || documentNumber === '' || documentNumber.toLowerCase().includes('общо')) {
      continue;
    }
    
    const documentType = cleanString(row[2]);      // Column 3 (0-indexed: 2)
    const documentDate = formatDateValue(row[4]);  // Column 5 (0-indexed: 4) - Handle Date objects
    const counterpartyId = cleanString(row[5]);    // Column 6 (0-indexed: 5)
    const amountNoDDS = parseAmount(row[9]);       // Column 10 (0-indexed: 9) - ДО без право
    const amountWithDDS = parseAmount(row[10]);    // Column 11 (0-indexed: 10) - ДО с право на пълен данъчен кредит
    const vatWithFullCredit = parseAmount(row[11]); // Column 12 (0-indexed: 11) - ДДС с право на пълен данъчен кредит
    
    // Determine if company has DDS based on BG prefix
    const hasDDS = counterpartyId.toUpperCase().startsWith('BG');
    
    
    rows.push({
      rowIndex: i + 1, // 1-indexed for display
      documentType,
      documentNumber,
      documentDate,
      counterpartyId,
      hasDDS,
      amountNoDDS,
      amountWithDDS,
      vatWithFullCredit,
    });
  }
  
  return rows;
}

// cleanString, formatDocumentNumber, formatDateValue, parseAmount imported from excelParserUtils

/**
 * Normalize document number for comparison
 * Removes leading zeros, special characters, etc.
 */
export function normalizeDocumentNumber(num: string | null): string {
  if (!num) return '';
  return num
    .replace(/^0+/, '')           // Remove leading zeros
    .replace(/[^a-zA-Z0-9]/g, '') // Remove special chars
    .toLowerCase();
}

/**
 * Extract date components (day, month, year) from various formats
 * Returns null if parsing fails
 */
export function extractDateComponents(dateStr: string | null): { day: number; month: number; year: number } | null {
  if (!dateStr) return null;
  
  const trimmed = dateStr.trim();
  if (!trimmed) return null;
  
  // Check if it's an Excel serial date (numeric)
  const numericDate = parseFloat(trimmed);
  if (!isNaN(numericDate) && numericDate > 30000 && numericDate < 60000) {
    // Excel date serial number - convert to date using UTC to avoid timezone shifts
    const excelEpochMs = Date.UTC(1899, 11, 30);
    const jsDate = new Date(excelEpochMs + numericDate * 24 * 60 * 60 * 1000);
    return {
      day: jsDate.getUTCDate(),
      month: jsDate.getUTCMonth() + 1,
      year: jsDate.getUTCFullYear(),
    };
  }
  
  // DD.MM.YYYY or DD.MM.YY format (European - most common for Bulgarian invoices)
  const dotFormat = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
  if (dotFormat) {
    const day = parseInt(dotFormat[1], 10);
    const month = parseInt(dotFormat[2], 10);
    let year = parseInt(dotFormat[3], 10);
    if (year < 100) year = year > 50 ? 1900 + year : 2000 + year;
    return { day, month, year };
  }
  
  // DD/MM/YYYY or DD/MM/YY format (European - user confirmed this is the Excel format)
  const slashFormat = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slashFormat) {
    // User explicitly confirmed Excel uses DD/MM/YY format
    const day = parseInt(slashFormat[1], 10);
    const month = parseInt(slashFormat[2], 10);
    let year = parseInt(slashFormat[3], 10);
    if (year < 100) year = year > 50 ? 1900 + year : 2000 + year;
    return { day, month, year };
  }
  
  // DD-MM-YYYY or DD-MM-YY format
  const dashFormat = trimmed.match(/^(\d{1,2})-(\d{1,2})-(\d{2,4})$/);
  if (dashFormat) {
    const day = parseInt(dashFormat[1], 10);
    const month = parseInt(dashFormat[2], 10);
    let year = parseInt(dashFormat[3], 10);
    if (year < 100) year = year > 50 ? 1900 + year : 2000 + year;
    return { day, month, year };
  }
  
  // YYYY-MM-DD format (ISO)
  const isoFormat = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoFormat) {
    return {
      day: parseInt(isoFormat[3], 10),
      month: parseInt(isoFormat[2], 10),
      year: parseInt(isoFormat[1], 10),
    };
  }
  
  return null;
}

/**
 * Normalize date for comparison
 * Converts various formats to DD.MM.YYYY
 */
export function normalizeDate(dateStr: string | null): string {
  const components = extractDateComponents(dateStr);
  if (!components) return dateStr?.trim() || '';
  
  const { day, month, year } = components;
  return `${day.toString().padStart(2, '0')}.${month.toString().padStart(2, '0')}.${year}`;
}

/**
 * Compare two dates by their components (day, month, year)
 * More robust than string comparison
 */
export function datesMatch(date1: string | null, date2: string | null): boolean {
  const comp1 = extractDateComponents(date1);
  const comp2 = extractDateComponents(date2);
  
  if (!comp1 || !comp2) return false;
  
  return comp1.day === comp2.day && 
         comp1.month === comp2.month && 
         comp1.year === comp2.year;
}
