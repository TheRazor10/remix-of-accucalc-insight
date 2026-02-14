/**
 * Shared utility functions for Excel journal parsers.
 * Used by both purchaseJournalParser.ts and salesJournalParser.ts.
 */

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
