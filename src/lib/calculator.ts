import { AccountRow, CalculationResult } from './calculationTypes';

/**
 * Checks if a number falls within any of the specified ranges or matches specific values.
 * @param num - The number to check
 * @param ranges - Array of individual numbers or [min, max] tuples representing ranges
 * @returns True if the number is in any range or matches any specific value
 */
function isInRange(num: number, ranges: (number | [number, number])[]): boolean {
  for (const range of ranges) {
    if (Array.isArray(range)) {
      if (num >= range[0] && num <= range[1]) return true;
    } else {
      if (num === range) return true;
    }
  }
  return false;
}

/**
 * Calculates financial metrics from Bulgarian trial balance (оборотна ведомост) data.
 * Processes account rows and aggregates values based on Bulgarian accounting standards.
 *
 * @param data - Array of account rows from the trial balance
 * @returns Calculated financial results with detailed breakdowns
 *
 * @example
 * const data = [
 *   { номер: 701, име: 'Приходи от продажби', оборот_кредит: 10000, ... },
 *   { номер: 601, име: 'Разходи за материали', оборот_дебит: 5000, ... },
 * ];
 * const result = calculateFinancials(data);
 * console.log(result.приходи); // 10000
 *
 * Account ranges:
 * - Revenue (Приходи): 701-709, 721-729 (credit turnover)
 * - Expenses (Разходи): 601-609, 621-629, 302, 304 (debit turnover)
 * - Receivables (Др. вземания): 493, 498, 499, 262, 265, 422, 159 (ending debit balance)
 * - Liabilities (Др. задължения): 490-499, 420-429, 159 (ending credit balance)
 * - Cash (Каса): 501 (BGN), 502 (EUR) (debit - credit balance)
 */
export function calculateFinancials(data: AccountRow[]): CalculationResult {
  // Define the ranges and specific numbers for each category
  const приходиRanges: (number | [number, number])[] = [[701, 709], [721, 729]];
  const разходиRanges: (number | [number, number])[] = [[601, 609], [621, 629], 302, 304];
  const вземанияNumbers: number[] = [493, 498, 499, 262, 265, 422, 159];
  const задълженияRanges: (number | [number, number])[] = [[490, 499], [420, 429], 159];

  const result: CalculationResult = {
    приходи: 0,
    разходи: 0,
    др_вземания: 0,
    др_задължения: 0,
    каса: 0,
    details: {
      приходи: [],
      разходи: [],
      др_вземания: [],
      др_задължения: [],
      каса: [],
    },
  };

  for (const row of data) {
    // Приходи: Sum Оборот_кредит for Номер 701-709
    if (isInRange(row.номер, приходиRanges)) {
      result.приходи += row.оборот_кредит;
      if (row.оборот_кредит > 0) {
        result.details.приходи.push({ номер: row.номер, име: row.име, стойност: row.оборот_кредит });
      }
    }

    // Разходи: Sum Оборот_дебит for Номер 601-609, 621-629, 302, 304
    if (isInRange(row.номер, разходиRanges)) {
      result.разходи += row.оборот_дебит;
      if (row.оборот_дебит > 0) {
        result.details.разходи.push({ номер: row.номер, име: row.име, стойност: row.оборот_дебит });
      }
    }

    // Др. вземания: Sum Крайно_салдо_дебит for specific numbers
    if (вземанияNumbers.includes(row.номер)) {
      result.др_вземания += row.крайно_салдо_дебит;
      if (row.крайно_салдо_дебит > 0) {
        result.details.др_вземания.push({ номер: row.номер, име: row.име, стойност: row.крайно_салдо_дебит });
      }
    }

    // Др. задължения: Sum Крайно_салдо_кредит for ranges
    if (isInRange(row.номер, задълженияRanges)) {
      result.др_задължения += row.крайно_салдо_кредит;
      if (row.крайно_салдо_кредит > 0) {
        result.details.др_задължения.push({ номер: row.номер, име: row.име, стойност: row.крайно_салдо_кредит });
      }
    }

    // Каса: Account 501 (BGN) and 502 (EUR), Дебит positive, Кредит negative
    if (row.номер === 501 || row.номер === 502) {
      const касаValue = row.крайно_салдо_дебит - row.крайно_салдо_кредит;
      result.каса += касаValue;
      if (касаValue !== 0) {
        result.details.каса.push({ номер: row.номер, име: row.име, стойност: касаValue });
      }
    }
  }

  return result;
}
