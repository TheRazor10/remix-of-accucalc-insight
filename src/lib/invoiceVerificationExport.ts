import * as XLSX from 'xlsx';
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
  summary: VerificationSummary,
  cachedArrayBuffer?: ArrayBuffer
): Promise<void> {
  // Use cached buffer if available (avoids stale File reference errors), otherwise read the file
  const arrayBuffer = cachedArrayBuffer ?? await originalFile.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: 'array', cellDates: true });

  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');

  // Status column is the next column after the last one (0-indexed)
  const statusCol = range.e.c + 1;

  console.log(`[Export] Adding status column at column ${statusCol + 1}`);

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
      console.log(`[Export] Found numeric header row at Excel row ${row + 1}`);
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
    console.log(`[Export] Added column number "${statusCol + 1}" at row ${headerRowIndex + 1}, col ${statusCol + 1}`);

    // Add "Статус" label in the label row (one row above numeric header)
    if (labelRowIndex >= 0 && labelRowIndex < headerRowIndex) {
      const labelCell = XLSX.utils.encode_cell({ r: labelRowIndex, c: statusCol });
      worksheet[labelCell] = { v: 'Статус', t: 's' };
      console.log(`[Export] Added "Статус" label at row ${labelRowIndex + 1}, col ${statusCol + 1}`);
    }
  }

  // Add status values for each data row
  let statusesAdded = 0;
  for (const [rowIndex, status] of statusMap.entries()) {
    // rowIndex from parser is 1-indexed, SheetJS is 0-indexed
    const sheetRow = rowIndex - 1;

    if (sheetRow >= 0 && sheetRow <= range.e.r) {
      const cellRef = XLSX.utils.encode_cell({ r: sheetRow, c: statusCol });
      worksheet[cellRef] = { v: status, t: 's' };
      statusesAdded++;
    }
  }

  console.log(`[Export] Added ${statusesAdded} status values`);

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
