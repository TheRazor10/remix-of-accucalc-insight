import * as XLSX from 'xlsx';
import { SalesVerificationSummary, ExcelToExcelSummary, isPhysicalIndividualId } from './salesComparisonTypes';

/**
 * Status labels for the sales export
 */
const STATUS_LABELS = {
  match: 'Съвпадение',
  suspicious: 'Съмнителен',
  not_found: 'Липсва PDF',
  missing_pdf: 'Липсва PDF',
  physical_individual: 'Физическо лице',
  credit_note: 'Кредитно известие',
} as const;

/**
 * Check if a document is a credit note
 */
function isCreditNote(documentType: string | null): boolean {
  if (!documentType) return false;
  const docType = documentType.toUpperCase();
  return docType.includes('КРЕДИТНО') ||
         docType.includes('CREDIT') ||
         docType === 'КИ';
}

/**
 * Create a map from Excel row index to verification status
 */
function createRowStatusMap(summary: SalesVerificationSummary): Map<number, string> {
  const statusMap = new Map<number, string>();

  // Map comparison results to their matched Excel rows
  for (const comparison of summary.comparisons) {
    if (comparison.matchedExcelRow !== null) {
      // Determine the status based on the document type and comparison result
      const excelClientId = comparison.fieldComparisons.find(f => f.fieldName === 'clientId')?.excelValue;
      const isPhysical = isPhysicalIndividualId(excelClientId);
      const isCreditDoc = isCreditNote(comparison.extractedData.documentType) ||
                          isCreditNote(comparison.fieldComparisons.find(f => f.fieldName === 'documentType')?.excelValue);

      let status: string;
      if (comparison.overallStatus === 'match') {
        if (isPhysical) {
          status = STATUS_LABELS.physical_individual;
        } else if (isCreditDoc) {
          status = STATUS_LABELS.credit_note;
        } else {
          status = STATUS_LABELS.match;
        }
      } else {
        status = STATUS_LABELS[comparison.overallStatus] || comparison.overallStatus;
      }

      statusMap.set(comparison.matchedExcelRow, status);
    }
  }

  // Mark missing PDF rows
  for (const row of summary.missingPdfRows) {
    statusMap.set(row.rowIndex, STATUS_LABELS.missing_pdf);
  }

  console.log('[Sales Export] Status map entries:', Array.from(statusMap.entries()));

  return statusMap;
}

/**
 * Export the original Excel file with an added "Статус" column
 */
export async function exportSalesVerificationResults(
  originalFile: File,
  summary: SalesVerificationSummary
): Promise<void> {
  // Read the original file
  const arrayBuffer = await originalFile.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: 'array', cellDates: true });

  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');

  // Status column is the next column after the last one (0-indexed)
  const statusCol = range.e.c + 1;

  console.log(`[Sales Export] Adding status column at column ${statusCol + 1}`);

  // Create status map from row index to status
  const statusMap = createRowStatusMap(summary);

  // Find header row (look for column numbers row: 1, 2, 3...)
  // SheetJS rows are 0-indexed
  let headerRowIndex = -1;
  let labelRowIndex = -1;

  const maxScanRow = Math.min(15, range.e.r);
  for (let row = 0; row <= maxScanRow; row++) {
    const val0 = worksheet[XLSX.utils.encode_cell({ r: row, c: 0 })]?.v;
    const val1 = worksheet[XLSX.utils.encode_cell({ r: row, c: 1 })]?.v;
    const val2 = worksheet[XLSX.utils.encode_cell({ r: row, c: 2 })]?.v;

    // Check for numeric header row (1, 2, 3...)
    if ((val0 === 1 || val0 === '1') &&
        (val1 === 2 || val1 === '2') &&
        (val2 === 3 || val2 === '3')) {
      headerRowIndex = row;
      console.log(`[Sales Export] Found numeric header row at Excel row ${row + 1}`);
      break;
    }

    // Also check for the label row containing column names
    if (val2 && String(val2).toLowerCase().includes('вид')) {
      labelRowIndex = row;
    }
  }

  // Add header for status column
  if (headerRowIndex >= 0) {
    // Add the column number in the numeric header row
    const headerCell = XLSX.utils.encode_cell({ r: headerRowIndex, c: statusCol });
    worksheet[headerCell] = { v: String(statusCol + 1), t: 's' };
    console.log(`[Sales Export] Added column number "${statusCol + 1}" at row ${headerRowIndex + 1}, col ${statusCol + 1}`);

    // Add "Статус" label in the label row (one row above numeric header)
    if (labelRowIndex >= 0 && labelRowIndex < headerRowIndex) {
      const labelCell = XLSX.utils.encode_cell({ r: labelRowIndex, c: statusCol });
      worksheet[labelCell] = { v: 'Статус', t: 's' };
      console.log(`[Sales Export] Added "Статус" label at row ${labelRowIndex + 1}, col ${statusCol + 1}`);
    }
  }

  // Add status values for each data row, with document number validation
  let statusesAdded = 0;
  let statusesSkipped = 0;
  for (const [rowIndex, status] of statusMap.entries()) {
    // rowIndex from parser is 1-indexed, SheetJS is 0-indexed
    const sheetRow = rowIndex - 1;

    if (sheetRow >= 0 && sheetRow <= range.e.r) {
      // Validate: check that the row has data in the document number column (column 4, 0-indexed: 3)
      const docNumCell = worksheet[XLSX.utils.encode_cell({ r: sheetRow, c: 3 })]?.v;
      if (docNumCell !== undefined && docNumCell !== null && docNumCell !== '') {
        const cellRef = XLSX.utils.encode_cell({ r: sheetRow, c: statusCol });
        worksheet[cellRef] = { v: status, t: 's' };
        statusesAdded++;
      } else {
        console.warn(`[Sales Export] Skipping row ${rowIndex}: no document number at expected column`);
        statusesSkipped++;
      }
    }
  }

  console.log(`[Sales Export] Added ${statusesAdded} status values`);

  // Update the range to include the new column
  range.e.c = statusCol;
  worksheet['!ref'] = XLSX.utils.encode_range(range);

  // Set column width for the status column
  if (!worksheet['!cols']) worksheet['!cols'] = [];
  worksheet['!cols'][statusCol] = { wch: 18 };

  // Generate the output file
  const outputBuffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });

  // Create filename with timestamp
  const originalName = originalFile.name.replace(/\.[^/.]+$/, '');
  const timestamp = new Date().toISOString().slice(0, 10);
  const outputFilename = `${originalName}_сверка_продажби_${timestamp}.xlsx`;

  // Download the file
  const blob = new Blob([outputBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = outputFilename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// ─── Excel-to-Excel Export ──────────────────────────────────────────────────

const EXCEL_COMPARISON_STATUS_LABELS: Record<string, string> = {
  match: 'Съвпадение',
  mismatch: 'Разлика',
  individual: 'Физ. лице',
  only_in_main: 'Само в дневник',
  only_in_secondary: 'Само в справка',
};

/**
 * Export Excel-to-Excel comparison results as a new Excel file.
 */
export async function exportExcelToExcelResults(summary: ExcelToExcelSummary): Promise<void> {
  const rows: (string | number | null)[][] = [];

  // Header row
  rows.push([
    'Номер документ',
    'Статус',
    'Ред в дневник',
    'Файл справка',
    'Дата (Дневник)',
    'Дата (Справка)',
    'Булстат (Дневник)',
    'Булстат (Справка)',
    'Дан. основа (Дневник)',
    'Дан. основа (Справка)',
    'ДДС (Дневник)',
    'ДДС (Справка)',
  ]);

  // Sort: mismatches first, then individuals, then only_in_main, only_in_secondary, then matches
  const order: Record<string, number> = { mismatch: 0, individual: 1, only_in_main: 2, only_in_secondary: 3, match: 4 };
  const sorted = [...summary.comparisons].sort(
    (a, b) => (order[a.overallStatus] ?? 5) - (order[b.overallStatus] ?? 5)
  );

  for (const item of sorted) {
    const dateField = item.fieldComparisons.find(f => f.fieldName === 'date');
    const idField = item.fieldComparisons.find(f => f.fieldName === 'counterpartyId');
    const taxBaseField = item.fieldComparisons.find(f => f.fieldName === 'taxBase');
    const vatField = item.fieldComparisons.find(f => f.fieldName === 'vat');

    rows.push([
      item.documentNumber,
      EXCEL_COMPARISON_STATUS_LABELS[item.overallStatus] || item.overallStatus,
      item.mainExcelRow,
      item.secondarySource,
      dateField?.mainValue ?? null,
      dateField?.secondaryValue ?? null,
      idField?.mainValue ?? null,
      idField?.secondaryValue ?? null,
      taxBaseField?.mainValue ?? null,
      taxBaseField?.secondaryValue ?? null,
      vatField?.mainValue ?? null,
      vatField?.secondaryValue ?? null,
    ]);
  }

  // Create workbook
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);

  // Set column widths
  const colWidths = [18, 16, 12, 25, 12, 12, 16, 16, 14, 14, 12, 12];
  ws['!cols'] = colWidths.map(wch => ({ wch }));

  XLSX.utils.book_append_sheet(wb, ws, 'Сравнение');

  // Summary sheet
  const summaryRows = [
    ['Резултат', 'Брой'],
    ['Съвпадения', summary.matchedCount],
    ['Разлики', summary.mismatchCount],
    ['Физ. лица', summary.individualCount],
    ['Само в дневник', summary.onlyInMainCount],
    ['Само в справка', summary.onlyInSecondaryCount],
    ['', ''],
    ['Общо дневник', summary.totalMainRows],
    ['Общо справка', summary.totalSecondaryRows],
  ];
  const summaryWs = XLSX.utils.aoa_to_sheet(summaryRows);
  summaryWs['!cols'] = [{ wch: 18 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(wb, summaryWs, 'Обобщение');

  // Download
  const outputBuffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  const timestamp = new Date().toISOString().slice(0, 10);
  const filename = `сравнение_дневник_справка_${timestamp}.xlsx`;

  const blob = new Blob([outputBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
