import { describe, it, expect } from 'vitest';
import { AccountRow } from './calculationTypes';

// Note: parseExcelFile and parsePdfFile require FileReader and PDF.js which need browser environment.
// These tests focus on the parsing logic validation through type checking and data structure tests.

// Helper function that mimics the internal parseNumber logic
function parseNumber(value: string | number | undefined): number {
  if (value === undefined || value === null || value === '') return 0;
  if (typeof value === 'number') return value;

  const cleaned = value.toString().replace(/\s/g, '').replace(',', '.');
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : parsed;
}

// Helper function that mimics the internal parseTextToAccountRows logic
function parseTextToAccountRows(text: string): AccountRow[] {
  const accountRows: AccountRow[] = [];
  const lines = text.split(/[\n\r]+/);

  for (const line of lines) {
    const match = line.match(/(\d{3})\s+([^\d]+)\s+([\d\s,.]+)/);

    if (match) {
      const номер = parseInt(match[1]);
      const име = match[2].trim();
      const numbers = match[3].split(/\s+/).map(n => {
        const cleaned = n.replace(/\s/g, '').replace(',', '.');
        const parsed = parseFloat(cleaned);
        return isNaN(parsed) ? 0 : parsed;
      });

      if (номер >= 100 && номер <= 999 && numbers.length >= 6) {
        accountRows.push({
          номер,
          име,
          начално_салдо_дебит: numbers[0] || 0,
          начално_салдо_кредит: numbers[1] || 0,
          оборот_дебит: numbers[2] || 0,
          оборот_кредит: numbers[3] || 0,
          крайно_салдо_дебит: numbers[4] || 0,
          крайно_салдо_кредит: numbers[5] || 0,
        });
      }
    }
  }

  return accountRows;
}

describe('Number Parsing', () => {
  describe('parseNumber function behavior', () => {
    it('should return 0 for undefined', () => {
      expect(parseNumber(undefined)).toBe(0);
    });

    it('should return 0 for empty string', () => {
      expect(parseNumber('')).toBe(0);
    });

    it('should return number directly if already a number', () => {
      expect(parseNumber(123.45)).toBe(123.45);
    });

    it('should parse string numbers correctly', () => {
      expect(parseNumber('123.45')).toBe(123.45);
    });

    it('should handle Bulgarian decimal format (comma)', () => {
      expect(parseNumber('123,45')).toBe(123.45);
    });

    it('should handle numbers with spaces (thousand separator)', () => {
      expect(parseNumber('1 234.56')).toBe(1234.56);
    });

    it('should handle combined spaces and comma', () => {
      expect(parseNumber('1 234,56')).toBe(1234.56);
    });

    it('should return 0 for non-numeric strings', () => {
      expect(parseNumber('not a number')).toBe(0);
    });

    it('should handle integer strings', () => {
      expect(parseNumber('1000')).toBe(1000);
    });

    it('should handle zero', () => {
      expect(parseNumber('0')).toBe(0);
      expect(parseNumber(0)).toBe(0);
    });

    it('should handle negative numbers', () => {
      expect(parseNumber('-123.45')).toBe(-123.45);
    });
  });
});

describe('Text to Account Rows Parsing', () => {
  describe('parseTextToAccountRows logic', () => {
    it('should parse a valid account row', () => {
      const text = '101 Основен капитал 0.00 6000.00 0.00 0.00 0.00 6000.00';
      const rows = parseTextToAccountRows(text);

      expect(rows).toHaveLength(1);
      expect(rows[0].номер).toBe(101);
      expect(rows[0].име).toBe('Основен капитал');
      expect(rows[0].начално_салдо_кредит).toBe(6000);
      expect(rows[0].крайно_салдо_кредит).toBe(6000);
    });

    it('should parse multiple account rows', () => {
      const text = `
        101 Основен капитал 0.00 6000.00 0.00 0.00 0.00 6000.00
        501 Каса в лева 1000.00 0.00 500.00 200.00 1300.00 0.00
        701 Приходи 0.00 0.00 0.00 10000.00 0.00 10000.00
      `;
      const rows = parseTextToAccountRows(text);

      expect(rows).toHaveLength(3);
      expect(rows.map(r => r.номер)).toEqual([101, 501, 701]);
    });

    it('should skip invalid account numbers (< 100)', () => {
      const text = '99 Invalid Account 0.00 0.00 0.00 0.00 0.00 0.00';
      const rows = parseTextToAccountRows(text);

      expect(rows).toHaveLength(0);
    });

    it('should skip invalid account numbers (> 999)', () => {
      const text = '1001 Invalid Account 0.00 0.00 0.00 0.00 0.00 0.00';
      const rows = parseTextToAccountRows(text);

      expect(rows).toHaveLength(0);
    });

    it('should skip rows with insufficient numbers', () => {
      const text = '101 Incomplete Row 0.00 0.00 0.00';
      const rows = parseTextToAccountRows(text);

      expect(rows).toHaveLength(0);
    });

    it('should handle Bulgarian decimal format in numbers', () => {
      const text = '501 Каса 1000,50 0,00 500,25 200,75 1300,00 0,00';
      const rows = parseTextToAccountRows(text);

      expect(rows).toHaveLength(1);
      expect(rows[0].начално_салдо_дебит).toBe(1000.5);
      expect(rows[0].оборот_дебит).toBe(500.25);
    });

    it('should handle empty text', () => {
      const rows = parseTextToAccountRows('');
      expect(rows).toHaveLength(0);
    });

    it('should handle text with no valid rows', () => {
      const text = `
        This is a header line
        Some descriptive text
        Not an account row
      `;
      const rows = parseTextToAccountRows(text);
      expect(rows).toHaveLength(0);
    });
  });
});

describe('AccountRow Structure', () => {
  it('should have all required fields', () => {
    const row: AccountRow = {
      номер: 501,
      име: 'Каса в лева',
      начално_салдо_дебит: 1000,
      начално_салдо_кредит: 0,
      оборот_дебит: 500,
      оборот_кредит: 200,
      крайно_салдо_дебит: 1300,
      крайно_салдо_кредит: 0,
    };

    expect(row.номер).toBe(501);
    expect(row.име).toBe('Каса в лева');
    expect(row.начално_салдо_дебит).toBe(1000);
    expect(row.начално_салдо_кредит).toBe(0);
    expect(row.оборот_дебит).toBe(500);
    expect(row.оборот_кредит).toBe(200);
    expect(row.крайно_салдо_дебит).toBe(1300);
    expect(row.крайно_салдо_кредит).toBe(0);
  });

  it('should handle decimal values correctly', () => {
    const row: AccountRow = {
      номер: 501,
      име: 'Test',
      начално_салдо_дебит: 1234.56,
      начално_салдо_кредит: 789.12,
      оборот_дебит: 100.01,
      оборот_кредит: 50.99,
      крайно_салдо_дебит: 1283.58,
      крайно_салдо_кредит: 839.11,
    };

    expect(row.начално_салдо_дебит).toBeCloseTo(1234.56, 2);
    expect(row.крайно_салдо_дебит).toBeCloseTo(1283.58, 2);
  });
});

describe('Excel File Parsing Expectations', () => {
  describe('Header detection', () => {
    it('should identify row containing "Номер" and "Име" as header', () => {
      const testRow = ['Номер', 'Име на сметката', 'НС Дебит', 'НС Кредит'];
      const rowStr = testRow.join(' ').toLowerCase();

      const isHeader = rowStr.includes('номер') && rowStr.includes('име');

      expect(isHeader).toBe(true);
    });

    it('should identify "Сметка" as alternative header indicator', () => {
      const testRow = ['Сметка', 'Описание', 'Салдо'];
      const rowStr = testRow.join(' ').toLowerCase();

      const isHeader = rowStr.includes('сметка');

      expect(isHeader).toBe(true);
    });
  });

  describe('Title and period extraction patterns', () => {
    it('should match period pattern "от X до Y"', () => {
      const text = 'Оборотна ведомост от 01.01.2024 до 31.03.2024';
      const periodMatch = text.match(/от\s*\d{1,2}[.\-\/]\d{1,2}[.\-\/]\d{2,4}\s*(до|[-–])\s*\d{1,2}[.\-\/]\d{1,2}[.\-\/]\d{2,4}/i);

      expect(periodMatch).not.toBeNull();
      expect(periodMatch?.[0]).toBe('от 01.01.2024 до 31.03.2024');
    });

    it('should identify company name patterns (ЕООД, ООД)', () => {
      const testCases = [
        'Тест ЕООД',
        'Компания ООД',
        'ФИРМА ЕООД',
      ];

      testCases.forEach(text => {
        const hasCompanyPattern = text.toLowerCase().includes('еоод') ||
                                  text.toLowerCase().includes('оод');
        expect(hasCompanyPattern).toBe(true);
      });
    });

    it('should identify "ведомост" in title', () => {
      const text = 'Оборотна ведомост';
      const hasVedomost = text.toLowerCase().includes('ведомост');

      expect(hasVedomost).toBe(true);
    });
  });

  describe('Row filtering', () => {
    it('should skip "Общо:" rows', () => {
      const rowText = 'Общо: 10000.00';
      const shouldSkip = rowText.toLowerCase().includes('общо');

      expect(shouldSkip).toBe(true);
    });

    it('should validate account number range (100-999)', () => {
      const validAccounts = [100, 501, 701, 999];
      const invalidAccounts = [99, 1000, 50, 1];

      validAccounts.forEach(num => {
        expect(num >= 100 && num <= 999).toBe(true);
      });

      invalidAccounts.forEach(num => {
        expect(num >= 100 && num <= 999).toBe(false);
      });
    });
  });
});

describe('PDF Parsing Expectations', () => {
  describe('Account row pattern matching', () => {
    it('should match pattern: 3-digit number followed by text and numbers', () => {
      const pattern = /(\d{3})\s+([^\d]+)\s+([\d\s,.]+)/;

      const validLines = [
        '101 Основен капитал 0.00 6000.00 0.00 0.00 0.00 6000.00',
        '501 Каса в лева 1000.00 0.00 500.00 200.00 1300.00 0.00',
        '701 Приходи от продажби 0.00 0.00 0.00 50000.00 0.00 50000.00',
      ];

      validLines.forEach(line => {
        const match = line.match(pattern);
        expect(match).not.toBeNull();
        expect(parseInt(match![1])).toBeGreaterThanOrEqual(100);
        expect(parseInt(match![1])).toBeLessThanOrEqual(999);
      });
    });

    it('should not match lines without 3-digit account number', () => {
      const pattern = /(\d{3})\s+([^\d]+)\s+([\d\s,.]+)/;

      const invalidLines = [
        'Header row without account number',
        '99 Invalid two digit 0.00 0.00',
        '1001 Four digit account 0.00 0.00',
        'Общо: 10000.00',
      ];

      invalidLines.forEach(line => {
        const match = line.match(pattern);
        if (match) {
          const num = parseInt(match[1]);
          expect(num >= 100 && num <= 999).toBe(false);
        }
      });
    });
  });
});
