import ExcelJS from 'exceljs';
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
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(arrayBuffer);

  const worksheet = workbook.worksheets[0];

  // Find the last column and add a new column for status (1-indexed)
  const statusCol = worksheet.columnCount + 1;

  console.log(`[Sales Export] Adding status column at column ${statusCol}`);

  // Create status map from row index to status
  const statusMap = createRowStatusMap(summary);

  // Find header row (look for column numbers row: 1, 2, 3...)
  // ExcelJS rows are 1-indexed
  let headerRowIndex = -1;
  let labelRowIndex = -1;

  const maxScanRow = Math.min(16, worksheet.rowCount);
  for (let row = 1; row <= maxScanRow; row++) {
    const val0 = worksheet.getCell(row, 1).value;
    const val1 = worksheet.getCell(row, 2).value;
    const val2 = worksheet.getCell(row, 3).value;

    // Check for numeric header row (1, 2, 3...)
    if ((val0 === 1 || val0 === '1') &&
        (val1 === 2 || val1 === '2') &&
        (val2 === 3 || val2 === '3')) {
      headerRowIndex = row;
      console.log(`[Sales Export] Found numeric header row at Excel row ${row}`);
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
    worksheet.getCell(headerRowIndex, statusCol).value = String(statusCol);
    console.log(`[Sales Export] Added column number "${statusCol}" at row ${headerRowIndex}, col ${statusCol}`);

    // Add "Статус" label in the label row (one row above numeric header)
    if (labelRowIndex >= 0 && labelRowIndex < headerRowIndex) {
      worksheet.getCell(labelRowIndex, statusCol).value = 'Статус';
      console.log(`[Sales Export] Added "Статус" label at row ${labelRowIndex}, col ${statusCol}`);
    }
  }

  // Add status values for each data row, with document number validation
  let statusesAdded = 0;
  let statusesSkipped = 0;
  for (const [rowIndex, status] of statusMap.entries()) {
    // rowIndex from parser = Excel row number (1-indexed)
    const excelRow = rowIndex;

    if (excelRow >= 1 && excelRow <= worksheet.rowCount) {
      // Validate: check that the row has data in the document number column (column 4, 1-indexed)
      const docNumCell = worksheet.getCell(excelRow, 4).value;
      if (docNumCell !== undefined && docNumCell !== null && docNumCell !== '') {
        worksheet.getCell(excelRow, statusCol).value = status;
        statusesAdded++;
      } else {
        console.warn(`[Sales Export] Skipping row ${rowIndex}: no document number at expected column`);
        statusesSkipped++;
      }
    }
  }

  console.log(`[Sales Export] Added ${statusesAdded} status values`);

  // Set column width for the status column
  worksheet.getColumn(statusCol).width = 18;

  // Generate the output file
  const outputBuffer = await workbook.xlsx.writeBuffer();

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
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Сравнение');
  ws.addRows(rows);

  // Set column widths
  const colWidths = [18, 16, 12, 25, 12, 12, 16, 16, 14, 14, 12, 12];
  colWidths.forEach((width, i) => {
    ws.getColumn(i + 1).width = width;
  });

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
  const summaryWs = wb.addWorksheet('Обобщение');
  summaryWs.addRows(summaryRows);
  summaryWs.getColumn(1).width = 18;
  summaryWs.getColumn(2).width = 10;

  // Download
  const outputBuffer = await wb.xlsx.writeBuffer();
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
