import ExcelJS from 'exceljs';
import { IssuedDocRow } from './salesComparisonTypes';

/**
 * Parse a "Справка издадени документи" Excel file.
 * Supports multiple column layouts from different accounting software:
 *
 * Format 1: №, Тип документ, Дата, Дни на падеж, Дата на падеж,
 *           Партньор, Булстат, Данъчна основа, ДДС, Сума за плащане, Тип плащане
 *
 * Format 2: Документ, Н-р на документ, Дата на документ, Дата на дан. съб.,
 *           Партньор, ЕИК, Н-р ДДС, Начин на плащане, Дан. основа, ДДС, Общо, Валута, Към документ
 */
export async function parseIssuedDocsExcel(file: File): Promise<IssuedDocRow[]> {
  const arrayBuffer = await file.arrayBuffer();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(arrayBuffer);

  const worksheet = workbook.worksheets[0];

  // Convert to array of arrays (slice(1) to convert from ExcelJS 1-indexed to 0-indexed)
  const data: (string | number | Date | undefined)[][] = [];
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    data.push((row.values as (string | number | Date | undefined)[]).slice(1));
  });

  if (data.length < 2) {
    throw new Error('Файлът не съдържа достатъчно данни');
  }

  // Find the header row and build column map
  let headerRowIndex = -1;
  let colMap: Record<string, number> = {};

  for (let i = 0; i < Math.min(10, data.length); i++) {
    const row = data[i];
    if (!row || !Array.isArray(row)) continue;

    const cells = row.map(c => String(c ?? '').trim().toLowerCase());
    const rowStr = cells.join('|');

    // Detect header row by looking for characteristic column names
    const isHeaderRow =
      rowStr.includes('тип документ') || rowStr.includes('булстат') ||
      rowStr.includes('данъчна основа') || rowStr.includes('дан. основа') ||
      (rowStr.includes('н-р на документ') && rowStr.includes('еик'));

    if (!isHeaderRow) continue;

    headerRowIndex = i;

    // Match each cell to a known column
    for (let j = 0; j < cells.length; j++) {
      const c = cells[j];

      // Document number
      if (c === '№' || c === 'no' || c === 'номер' || c === 'н-р на документ' || c.includes('н-р на документ')) {
        colMap['number'] = j;
      }
      // Document type
      else if (c.includes('тип документ') || c === 'тип' || c === 'документ') {
        // "Документ" in Format 2 is the type column (not to be confused with doc number)
        // Only assign if we haven't already found the number column at this index
        if (!('type' in colMap)) colMap['type'] = j;
      }
      // Document date (exclude "дата на дан. съб." and "дата на падеж")
      else if ((c === 'дата' || c === 'дата на документ') && !c.includes('дан.') && !c.includes('падеж') && !c.includes('съб')) {
        colMap['date'] = j;
      }
      // Partner name
      else if (c.includes('партн')) {
        colMap['partner'] = j;
      }
      // Company ID: Булстат or ЕИК
      else if (c.includes('булстат') || c === 'еик') {
        colMap['bulstat'] = j;
      }
      // VAT number (Н-р ДДС) - use as fallback for bulstat if ЕИК is empty
      else if (c.includes('н-р ддс') || c === 'ддс №' || c === 'ддс номер') {
        colMap['vatNumber'] = j;
      }
      // Tax base: "Данъчна основа" or "Дан. основа"
      else if (c.includes('данъчна основа') || c.includes('дан. основа') || c === 'дан.основа') {
        colMap['taxBase'] = j;
      }
      // VAT amount (must be exact or close to avoid matching VAT number column)
      else if ((c === 'ддс' || c === 'vat') && !c.includes('н-р') && !c.includes('номер') && !c.includes('№')) {
        colMap['vat'] = j;
      }
      // Total: "Сума за плащане" or "Общо"
      else if (c.includes('сума за плащане') || c.includes('сума') || c === 'общо') {
        colMap['total'] = j;
      }
    }

    console.log(`[Issued Docs Parser] Detected header at row ${i + 1}, columns:`, colMap);
    break;
  }

  // If no header detected, throw an error instead of silently guessing columns
  if (headerRowIndex === -1) {
    throw new Error('Неразпознат формат на справката — не бяха открити заглавия на колоните. Проверете дали файлът е правилен.');
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
    // Use ЕИК/Булстат first, fall back to Н-р ДДС if empty
    const bulstat = cleanString(row[colMap['bulstat']]) ||
                    ('vatNumber' in colMap ? cleanString(row[colMap['vatNumber']]) : '');
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
