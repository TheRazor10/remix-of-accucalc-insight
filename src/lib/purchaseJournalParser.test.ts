import { describe, it, expect } from 'vitest';
import { normalizeDocumentNumber, extractDateComponents, normalizeDate, datesMatch } from './purchaseJournalParser';

describe('normalizeDocumentNumber', () => {
  describe('Leading zeros removal', () => {
    it('should remove leading zeros', () => {
      expect(normalizeDocumentNumber('00012345')).toBe('12345');
    });

    it('should handle single leading zero', () => {
      expect(normalizeDocumentNumber('0123')).toBe('123');
    });

    it('should preserve number without leading zeros', () => {
      expect(normalizeDocumentNumber('12345')).toBe('12345');
    });

    it('should handle all zeros', () => {
      expect(normalizeDocumentNumber('0000')).toBe('');
    });
  });

  describe('Special character removal', () => {
    it('should remove dashes', () => {
      expect(normalizeDocumentNumber('123-456')).toBe('123456');
    });

    it('should remove slashes', () => {
      expect(normalizeDocumentNumber('123/456')).toBe('123456');
    });

    it('should remove spaces', () => {
      expect(normalizeDocumentNumber('123 456')).toBe('123456');
    });

    it('should remove multiple special characters', () => {
      expect(normalizeDocumentNumber('123-456/789')).toBe('123456789');
    });
  });

  describe('Case normalization', () => {
    it('should convert to lowercase', () => {
      expect(normalizeDocumentNumber('ABC123')).toBe('abc123');
    });

    it('should handle mixed case', () => {
      expect(normalizeDocumentNumber('AbC123XyZ')).toBe('abc123xyz');
    });
  });

  describe('Combined normalization', () => {
    it('should apply all normalizations together', () => {
      expect(normalizeDocumentNumber('00ABC-123/456')).toBe('abc123456');
    });

    it('should handle complex invoice numbers', () => {
      expect(normalizeDocumentNumber('0000000012345678901234567890')).toBe('12345678901234567890');
    });
  });

  describe('Edge cases', () => {
    it('should return empty string for null', () => {
      expect(normalizeDocumentNumber(null)).toBe('');
    });

    it('should return empty string for empty string', () => {
      expect(normalizeDocumentNumber('')).toBe('');
    });

    it('should handle string with only special characters', () => {
      expect(normalizeDocumentNumber('---')).toBe('');
    });
  });
});

describe('extractDateComponents', () => {
  describe('DD.MM.YYYY format (Bulgarian standard)', () => {
    it('should parse standard DD.MM.YYYY format', () => {
      const result = extractDateComponents('15.03.2024');
      expect(result).toEqual({ day: 15, month: 3, year: 2024 });
    });

    it('should parse single digit day and month', () => {
      const result = extractDateComponents('1.1.2024');
      expect(result).toEqual({ day: 1, month: 1, year: 2024 });
    });

    it('should parse DD.MM.YY format with 20xx century', () => {
      const result = extractDateComponents('15.03.24');
      expect(result).toEqual({ day: 15, month: 3, year: 2024 });
    });

    it('should parse DD.MM.YY format with 19xx century (year > 50)', () => {
      const result = extractDateComponents('15.03.99');
      expect(result).toEqual({ day: 15, month: 3, year: 1999 });
    });
  });

  describe('DD/MM/YYYY format', () => {
    it('should parse DD/MM/YYYY format', () => {
      const result = extractDateComponents('15/03/2024');
      expect(result).toEqual({ day: 15, month: 3, year: 2024 });
    });

    it('should parse DD/MM/YY format', () => {
      const result = extractDateComponents('15/03/24');
      expect(result).toEqual({ day: 15, month: 3, year: 2024 });
    });
  });

  describe('DD-MM-YYYY format', () => {
    it('should parse DD-MM-YYYY format', () => {
      const result = extractDateComponents('15-03-2024');
      expect(result).toEqual({ day: 15, month: 3, year: 2024 });
    });

    it('should parse DD-MM-YY format', () => {
      const result = extractDateComponents('15-03-24');
      expect(result).toEqual({ day: 15, month: 3, year: 2024 });
    });
  });

  describe('YYYY-MM-DD format (ISO)', () => {
    it('should parse ISO format', () => {
      const result = extractDateComponents('2024-03-15');
      expect(result).toEqual({ day: 15, month: 3, year: 2024 });
    });
  });

  describe('Excel serial date numbers', () => {
    it('should parse Excel serial date', () => {
      // 45366 is approximately 2024-03-15 in Excel serial format
      const result = extractDateComponents('45366');
      expect(result).not.toBeNull();
      expect(result?.year).toBe(2024);
    });

    it('should handle typical Excel date range', () => {
      // Serial date 44197 is 2021-01-01
      const result = extractDateComponents('44197');
      expect(result).not.toBeNull();
    });
  });

  describe('Edge cases', () => {
    it('should return null for null input', () => {
      expect(extractDateComponents(null)).toBeNull();
    });

    it('should return null for empty string', () => {
      expect(extractDateComponents('')).toBeNull();
    });

    it('should return null for whitespace', () => {
      expect(extractDateComponents('   ')).toBeNull();
    });

    it('should return null for invalid format', () => {
      expect(extractDateComponents('not a date')).toBeNull();
    });

    it('should handle leading/trailing whitespace', () => {
      const result = extractDateComponents('  15.03.2024  ');
      expect(result).toEqual({ day: 15, month: 3, year: 2024 });
    });
  });
});

describe('normalizeDate', () => {
  it('should normalize DD/MM/YYYY to DD.MM.YYYY', () => {
    expect(normalizeDate('15/03/2024')).toBe('15.03.2024');
  });

  it('should normalize DD-MM-YYYY to DD.MM.YYYY', () => {
    expect(normalizeDate('15-03-2024')).toBe('15.03.2024');
  });

  it('should normalize ISO format to DD.MM.YYYY', () => {
    expect(normalizeDate('2024-03-15')).toBe('15.03.2024');
  });

  it('should pad single digit day and month', () => {
    expect(normalizeDate('1.1.2024')).toBe('01.01.2024');
  });

  it('should return original string if unparseable', () => {
    expect(normalizeDate('invalid date')).toBe('invalid date');
  });

  it('should return empty string for null', () => {
    expect(normalizeDate(null)).toBe('');
  });

  it('should handle DD.MM.YY by expanding to 4-digit year', () => {
    expect(normalizeDate('15.03.24')).toBe('15.03.2024');
  });
});

describe('datesMatch', () => {
  describe('Same format comparisons', () => {
    it('should match identical DD.MM.YYYY dates', () => {
      expect(datesMatch('15.03.2024', '15.03.2024')).toBe(true);
    });

    it('should not match different dates', () => {
      expect(datesMatch('15.03.2024', '16.03.2024')).toBe(false);
    });

    it('should not match different months', () => {
      expect(datesMatch('15.03.2024', '15.04.2024')).toBe(false);
    });

    it('should not match different years', () => {
      expect(datesMatch('15.03.2024', '15.03.2023')).toBe(false);
    });
  });

  describe('Cross-format comparisons', () => {
    it('should match DD.MM.YYYY with DD/MM/YYYY', () => {
      expect(datesMatch('15.03.2024', '15/03/2024')).toBe(true);
    });

    it('should match DD.MM.YYYY with YYYY-MM-DD (ISO)', () => {
      expect(datesMatch('15.03.2024', '2024-03-15')).toBe(true);
    });

    it('should match DD/MM/YYYY with DD-MM-YYYY', () => {
      expect(datesMatch('15/03/2024', '15-03-2024')).toBe(true);
    });

    it('should match 2-digit year with 4-digit year', () => {
      expect(datesMatch('15.03.24', '15.03.2024')).toBe(true);
    });
  });

  describe('Padding differences', () => {
    it('should match dates with and without leading zeros', () => {
      expect(datesMatch('1.1.2024', '01.01.2024')).toBe(true);
    });

    it('should match mixed padding', () => {
      expect(datesMatch('1.03.2024', '01.3.2024')).toBe(true);
    });
  });

  describe('Edge cases', () => {
    it('should return false when first date is null', () => {
      expect(datesMatch(null, '15.03.2024')).toBe(false);
    });

    it('should return false when second date is null', () => {
      expect(datesMatch('15.03.2024', null)).toBe(false);
    });

    it('should return false when both dates are null', () => {
      expect(datesMatch(null, null)).toBe(false);
    });

    it('should return false for unparseable dates', () => {
      expect(datesMatch('invalid', '15.03.2024')).toBe(false);
    });

    it('should return false when both dates are unparseable', () => {
      expect(datesMatch('invalid1', 'invalid2')).toBe(false);
    });
  });

  describe('Real-world invoice date scenarios', () => {
    it('should match Bulgarian invoice date with Excel date', () => {
      // Invoice shows: 15.03.2024
      // Excel shows: 15/03/24
      expect(datesMatch('15.03.2024', '15/03/24')).toBe(true);
    });

    it('should match OCR extracted date with normalized date', () => {
      // OCR might extract: 15.3.2024 (no leading zero on month)
      // Excel shows: 15.03.2024
      expect(datesMatch('15.3.2024', '15.03.2024')).toBe(true);
    });

    it('should handle year-end dates correctly', () => {
      expect(datesMatch('31.12.2024', '31.12.2024')).toBe(true);
    });

    it('should handle year-start dates correctly', () => {
      expect(datesMatch('01.01.2024', '1.1.2024')).toBe(true);
    });
  });
});
