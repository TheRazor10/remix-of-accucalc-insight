import * as XLSX from 'xlsx';
import { SalesVerificationSummary, isPhysicalIndividualId } from './salesComparisonTypes';

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

  const firstSheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[firstSheetName];

  // Get the range of the worksheet
  const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');

  // Find the last column and add a new column for status
  const statusColIndex = range.e.c + 1;
  const statusColLetter = XLSX.utils.encode_col(statusColIndex);

  console.log(`[Sales Export] Original range: ${worksheet['!ref']}, Adding status column at index ${statusColIndex} (${statusColLetter})`);

  // Create status map from row index to status
  const statusMap = createRowStatusMap(summary);

  // Find header row (look for column numbers row: 1, 2, 3...)
  let headerRowIndex = -1;
  let labelRowIndex = -1;

  for (let row = 0; row <= Math.min(15, range.e.r); row++) {
    const cell0 = worksheet[XLSX.utils.encode_cell({ r: row, c: 0 })];
    const cell1 = worksheet[XLSX.utils.encode_cell({ r: row, c: 1 })];
    const cell2 = worksheet[XLSX.utils.encode_cell({ r: row, c: 2 })];

    const val0 = cell0?.v;
    const val1 = cell1?.v;
    const val2 = cell2?.v;

    // Check for numeric header row (1, 2, 3...)
    if ((val0 === 1 || val0 === '1') &&
        (val1 === 2 || val1 === '2') &&
        (val2 === 3 || val2 === '3')) {
      headerRowIndex = row;
      console.log(`[Sales Export] Found numeric header row at worksheet row ${row} (Excel row ${row + 1})`);
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
    const headerCell = XLSX.utils.encode_cell({ r: headerRowIndex, c: statusColIndex });
    worksheet[headerCell] = { t: 's', v: String(statusColIndex + 1) };
    console.log(`[Sales Export] Added column number "${statusColIndex + 1}" at ${headerCell}`);

    // Add "Статус" label in the label row (one row above numeric header)
    if (labelRowIndex >= 0 && labelRowIndex < headerRowIndex) {
      const labelCell = XLSX.utils.encode_cell({ r: labelRowIndex, c: statusColIndex });
      worksheet[labelCell] = { t: 's', v: 'Статус' };
      console.log(`[Sales Export] Added "Статус" label at ${labelCell}`);
    }
  }

  // Add status values for each data row, with document number validation
  let statusesAdded = 0;
  let statusesSkipped = 0;
  for (const [rowIndex, status] of statusMap.entries()) {
    // rowIndex is 1-indexed (Excel row number)
    const worksheetRow = rowIndex - 1;

    if (worksheetRow >= 0 && worksheetRow <= range.e.r) {
      // Validate: check that the row has data in the document number column (column 3, 0-indexed)
      const docNumCell = worksheet[XLSX.utils.encode_cell({ r: worksheetRow, c: 3 })];
      if (docNumCell && docNumCell.v !== undefined && docNumCell.v !== null && docNumCell.v !== '') {
        const cellAddress = XLSX.utils.encode_cell({ r: worksheetRow, c: statusColIndex });
        worksheet[cellAddress] = { t: 's', v: status };
        statusesAdded++;
      } else {
        console.warn(`[Sales Export] Skipping row ${rowIndex}: no document number at expected column`);
        statusesSkipped++;
      }
    }
  }

  console.log(`[Sales Export] Added ${statusesAdded} status values`);

  // Update the worksheet range to include the new column
  range.e.c = statusColIndex;
  worksheet['!ref'] = XLSX.utils.encode_range(range);

  // Update column widths to include the new column
  if (!worksheet['!cols']) {
    worksheet['!cols'] = [];
  }
  worksheet['!cols'][statusColIndex] = { wch: 18 }; // Width for status column

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
