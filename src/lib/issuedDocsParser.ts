import * as XLSX from 'xlsx';
import { IssuedDocRow } from './salesComparisonTypes';

/**
 * Parse a "Справка издадени документи" Excel file.
 * Columns: №, Тип документ, Дата, Дни на падеж, Дата на падеж,
 *          Партньор, Булстат, Данъчна основа, ДДС, Сума за плащане, Тип плащане
 */
export async function parseIssuedDocsExcel(file: File): Promise<IssuedDocRow[]> {
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
    throw new Error('Файлът не съдържа достатъчно данни');
  }

  // Find the header row by looking for column names
  let headerRowIndex = -1;
  let colMap: Record<string, number> = {};

  for (let i = 0; i < Math.min(10, data.length); i++) {
    const row = data[i];
    if (!row || !Array.isArray(row)) continue;

    const rowStr = row.map(c => String(c ?? '').trim().toLowerCase()).join('|');

    // Look for the characteristic column headers
    if (rowStr.includes('тип документ') || rowStr.includes('булстат') || rowStr.includes('данъчна основа')) {
      headerRowIndex = i;

      // Build column map by matching header names
      for (let j = 0; j < row.length; j++) {
        const cellVal = String(row[j] ?? '').trim().toLowerCase();
        if (cellVal === '№' || cellVal === 'no' || cellVal === 'номер') colMap['number'] = j;
        else if (cellVal.includes('тип документ') || cellVal === 'тип') colMap['type'] = j;
        else if (cellVal === 'дата' && !cellVal.includes('падеж')) colMap['date'] = j;
        else if (cellVal.includes('партн')) colMap['partner'] = j;
        else if (cellVal.includes('булстат') || cellVal.includes('еик')) colMap['bulstat'] = j;
        else if (cellVal.includes('данъчна основа')) colMap['taxBase'] = j;
        else if (cellVal === 'ддс' || cellVal === 'vat') colMap['vat'] = j;
        else if (cellVal.includes('сума за плащане') || cellVal.includes('сума')) colMap['total'] = j;
      }
      break;
    }
  }

  // Fallback: assume standard column order if header detection failed
  if (headerRowIndex === -1) {
    headerRowIndex = 0;
    colMap = {
      number: 0,
      type: 1,
      date: 2,
      // 3 = Дни на падеж, 4 = Дата на падеж (skip)
      partner: 5,
      bulstat: 6,
      taxBase: 7,
      vat: 8,
      total: 9,
    };
  }

  const dataStartRow = headerRowIndex + 1;
  const rows: IssuedDocRow[] = [];

  for (let i = dataStartRow; i < data.length; i++) {
    const row = data[i];
    if (!row || !Array.isArray(row)) continue;

    const documentNumber = formatDocNumber(row[colMap['number']]);
    if (!documentNumber || documentNumber === '') continue;

    // Skip summary/total rows
    const firstCell = String(row[0] ?? '').toLowerCase();
    if (firstCell.includes('общо') || firstCell.includes('всичко') || firstCell.includes('total')) continue;

    const documentType = cleanString(row[colMap['type']]);
    const documentDate = formatDateValue(row[colMap['date']]);
    const partnerName = cleanString(row[colMap['partner']]);
    const bulstat = cleanString(row[colMap['bulstat']]);
    const taxBase = parseAmount(row[colMap['taxBase']]);
    const vat = parseAmount(row[colMap['vat']]);
    const totalAmount = parseAmount(row[colMap['total']]);

    rows.push({
      rowIndex: i + 1,
      sourceFile: file.name,
      documentNumber,
      documentType,
      documentDate,
      partnerName,
      bulstat,
      taxBase,
      vat,
      totalAmount,
    });
  }

  console.log(`[Issued Docs Parser] Parsed ${rows.length} rows from ${file.name}`);
  return rows;
}

/**
 * Parse multiple "Справка" Excel files and merge all rows.
 */
export async function parseMultipleIssuedDocs(files: File[]): Promise<IssuedDocRow[]> {
  const allRows: IssuedDocRow[] = [];

  for (const file of files) {
    const rows = await parseIssuedDocsExcel(file);
    allRows.push(...rows);
  }

  console.log(`[Issued Docs Parser] Total rows from ${files.length} file(s): ${allRows.length}`);
  return allRows;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

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

function formatDocNumber(value: string | number | Date | undefined): string {
  if (value === undefined || value === null) return '';
  if (value instanceof Date) return '';
  if (typeof value === 'number') {
    return Number.isInteger(value) ? value.toFixed(0) : value.toString();
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
  const str = String(value).replace(/\s/g, '').replace(/,/g, '.');
  const num = parseFloat(str);
  return isNaN(num) ? null : num;
}
