import ExcelJS from 'exceljs';
import { VerificationSummary } from './invoiceComparisonTypes';

/**
 * Status labels for the export
 */
const STATUS_LABELS = {
  match: 'Съвпадение',
  mismatch: 'Несъответствие',
  unreadable: 'Нечетимо',
  not_found: 'Липсва в Excel',
  missing_pdf: 'Липсва PDF',
} as const;

/**
 * Create a map from Excel row index to verification status
 * The rowIndex from parsing is 1-indexed based on the data array position
 */
function createRowStatusMap(summary: VerificationSummary): Map<number, string> {
  const statusMap = new Map<number, string>();

  // Map comparison results to their matched Excel rows
  for (const comparison of summary.comparisons) {
    if (comparison.matchedExcelRow !== null) {
      const status = STATUS_LABELS[comparison.overallStatus] || comparison.overallStatus;
      statusMap.set(comparison.matchedExcelRow, status);
    }
  }

  // Mark missing PDF rows
  for (const row of summary.missingPdfRows) {
    statusMap.set(row.rowIndex, STATUS_LABELS.missing_pdf);
  }

  console.log('[Export] Status map entries:', Array.from(statusMap.entries()));

  return statusMap;
}

/**
 * Export the original Excel file with an added "Статус" column
 */
export async function exportVerificationResults(
  originalFile: File,
  summary: VerificationSummary
): Promise<void> {
  // Read the original file
  const arrayBuffer = await originalFile.arrayBuffer();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(arrayBuffer);

  const worksheet = workbook.worksheets[0];

  // Find the last column and add a new column for status
  // ExcelJS columnCount is 1-indexed, so statusCol is the next column (1-indexed)
  const statusCol = worksheet.columnCount + 1;

  console.log(`[Export] Adding status column at column ${statusCol}`);

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
      console.log(`[Export] Found numeric header row at Excel row ${row}`);
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
    console.log(`[Export] Added column number "${statusCol}" at row ${headerRowIndex}, col ${statusCol}`);

    // Add "Статус" label in the label row (one row above numeric header)
    if (labelRowIndex >= 0 && labelRowIndex < headerRowIndex) {
      worksheet.getCell(labelRowIndex, statusCol).value = 'Статус';
      console.log(`[Export] Added "Статус" label at row ${labelRowIndex}, col ${statusCol}`);
    }
  }

  // Add status values for each data row
  // The parser rowIndex is 1-indexed from the data array (which excluded empty rows),
  // but maps to actual Excel rows. In the old xlsx code: worksheetRow = rowIndex - 1 (0-indexed)
  // In ExcelJS (1-indexed): the Excel row = rowIndex (directly)

  let statusesAdded = 0;
  for (const [rowIndex, status] of statusMap.entries()) {
    // rowIndex from parser corresponds to Excel row number (1-indexed)
    // In old code: worksheetRow = rowIndex - 1 (0-indexed), then encode_cell({r: worksheetRow})
    // encode_cell with r=0 = Excel row 1, so Excel row = worksheetRow + 1 = rowIndex
    const excelRow = rowIndex;

    if (excelRow >= 1 && excelRow <= worksheet.rowCount) {
      worksheet.getCell(excelRow, statusCol).value = status;
      statusesAdded++;
    }
  }

  console.log(`[Export] Added ${statusesAdded} status values`);

  // Set column width for the status column
  worksheet.getColumn(statusCol).width = 18;

  // Generate the output file
  const outputBuffer = await workbook.xlsx.writeBuffer();

  // Create filename with timestamp
  const originalName = originalFile.name.replace(/\.[^/.]+$/, '');
  const timestamp = new Date().toISOString().slice(0, 10);
  const outputFilename = `${originalName}_сверка_${timestamp}.xlsx`;

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
