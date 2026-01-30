import { describe, it, expect } from 'vitest';
import { TradingTransaction, CurrencyConversionResult, TradingStatementResult } from './tradingStatementTypes';
import { CURRENCY_CONFIG } from '@/config/constants';

// Note: The main functions in tradingStatementParser.ts (parseTradingStatementPdf, processTrading212Statement)
// require PDF.js and external API calls. These tests focus on type validation and the expected behavior
// of currency conversion logic.

// Fixed EUR/BGN rate used by the module (Bulgaria currency board)
const EUR_BGN_RATE = CURRENCY_CONFIG.eurBgnRate;

describe('Trading Statement Types', () => {
  describe('TradingTransaction', () => {
    it('should correctly type a transaction object', () => {
      const transaction: TradingTransaction = {
        executionTime: new Date('2024-03-15T10:30:00'),
        instrument: 'AAPL',
        isin: 'US0378331005',
        orderCurrency: 'USD',
        direction: 'Продай',
        quantity: 10,
        price: 175.50,
        transactionValue: 1755.00,
        transactionCurrency: 'USD',
        exchangeRate: 1,
        profitLoss: 250.00,
        total: 2005.00
      };

      expect(transaction.direction).toBe('Продай');
      expect(transaction.quantity).toBe(10);
      expect(transaction.profitLoss).toBe(250.00);
    });

    it('should allow both buy and sell directions', () => {
      const buyTransaction: TradingTransaction = {
        executionTime: new Date(),
        instrument: 'AAPL',
        isin: '',
        orderCurrency: 'USD',
        direction: 'Купи',
        quantity: 5,
        price: 170,
        transactionValue: 850,
        transactionCurrency: 'USD',
        exchangeRate: 1,
        profitLoss: 0,
        total: 850
      };

      const sellTransaction: TradingTransaction = {
        ...buyTransaction,
        direction: 'Продай',
        profitLoss: 50
      };

      expect(buyTransaction.direction).toBe('Купи');
      expect(sellTransaction.direction).toBe('Продай');
    });
  });

  describe('CurrencyConversionResult', () => {
    it('should correctly type a conversion result', () => {
      const conversion: CurrencyConversionResult = {
        originalCurrency: 'USD',
        originalValue: 100,
        convertedBGN: 180.50,
        convertedEUR: 92.30,
        exchangeRateUsed: 1.805,
        date: new Date('2024-03-15'),
        total: 100,
        totalBGN: 180.50
      };

      expect(conversion.originalCurrency).toBe('USD');
      expect(conversion.convertedBGN).toBe(180.50);
    });
  });

  describe('TradingStatementResult', () => {
    it('should correctly type a statement result', () => {
      const result: TradingStatementResult = {
        transactions: [],
        sellTransactions: [],
        conversions: [],
        totalProfitBGN: 500,
        totalProfitEUR: 255.68,
        totalLossBGN: 100,
        totalLossEUR: 51.14,
        totalValueBGN: 10000,
        totalValueEUR: 5113.52,
        summary: {
          totalSellTransactions: 5,
          currenciesInvolved: ['USD', 'EUR'],
          dateRange: {
            from: new Date('2024-01-01'),
            to: new Date('2024-03-15')
          }
        }
      };

      expect(result.totalProfitBGN).toBe(500);
      expect(result.summary.totalSellTransactions).toBe(5);
      expect(result.summary.currenciesInvolved).toContain('USD');
    });

    it('should handle null date range for empty results', () => {
      const emptyResult: TradingStatementResult = {
        transactions: [],
        sellTransactions: [],
        conversions: [],
        totalProfitBGN: 0,
        totalProfitEUR: 0,
        totalLossBGN: 0,
        totalLossEUR: 0,
        totalValueBGN: 0,
        totalValueEUR: 0,
        summary: {
          totalSellTransactions: 0,
          currenciesInvolved: [],
          dateRange: {
            from: null,
            to: null
          }
        }
      };

      expect(emptyResult.summary.dateRange.from).toBeNull();
      expect(emptyResult.summary.dateRange.to).toBeNull();
    });
  });
});

describe('Currency Conversion Logic', () => {
  describe('EUR/BGN conversion', () => {
    it('should use fixed EUR/BGN rate of 1.95583 (Bulgarian currency board)', () => {
      expect(EUR_BGN_RATE).toBe(1.95583);
    });

    it('should correctly convert EUR to BGN', () => {
      const eurAmount = 100;
      const bgnAmount = eurAmount * EUR_BGN_RATE;

      expect(bgnAmount).toBeCloseTo(195.583, 3);
    });

    it('should correctly convert BGN to EUR', () => {
      const bgnAmount = 195.583;
      const eurAmount = bgnAmount / EUR_BGN_RATE;

      expect(eurAmount).toBeCloseTo(100, 2);
    });
  });

  describe('Profit/Loss separation logic', () => {
    it('should categorize positive profit/loss as profit', () => {
      const profitLoss = 250.00;
      const isProfit = profitLoss >= 0;

      expect(isProfit).toBe(true);
    });

    it('should categorize negative profit/loss as loss', () => {
      const profitLoss = -150.00;
      const isLoss = profitLoss < 0;

      expect(isLoss).toBe(true);
    });

    it('should correctly calculate totals from multiple transactions', () => {
      const transactions = [
        { profitLoss: 100, convertedBGN: 180.5 },
        { profitLoss: -50, convertedBGN: -90.25 },
        { profitLoss: 200, convertedBGN: 361 },
        { profitLoss: -30, convertedBGN: -54.15 },
      ];

      let totalProfit = 0;
      let totalLoss = 0;

      for (const tx of transactions) {
        if (tx.convertedBGN >= 0) {
          totalProfit += tx.convertedBGN;
        } else {
          totalLoss += Math.abs(tx.convertedBGN);
        }
      }

      expect(totalProfit).toBeCloseTo(541.5, 2);
      expect(totalLoss).toBeCloseTo(144.4, 2);
    });
  });

  describe('Multi-currency handling', () => {
    it('should identify unique currencies from transactions', () => {
      const transactions: Partial<TradingTransaction>[] = [
        { transactionCurrency: 'USD' },
        { transactionCurrency: 'EUR' },
        { transactionCurrency: 'USD' },
        { transactionCurrency: 'GBP' },
        { transactionCurrency: 'EUR' },
      ];

      const uniqueCurrencies = [...new Set(transactions.map(t => t.transactionCurrency))];

      expect(uniqueCurrencies).toHaveLength(3);
      expect(uniqueCurrencies).toContain('USD');
      expect(uniqueCurrencies).toContain('EUR');
      expect(uniqueCurrencies).toContain('GBP');
    });

    it('should handle GBX to GBP conversion (pence to pounds)', () => {
      const GBX_TO_GBP_RATIO = 100;
      const gbxAmount = 500; // 500 pence
      const gbpAmount = gbxAmount / GBX_TO_GBP_RATIO;

      expect(gbpAmount).toBe(5); // 5 pounds
    });
  });

  describe('Date handling', () => {
    it('should calculate date range from transactions', () => {
      const transactions = [
        { executionTime: new Date('2024-03-01') },
        { executionTime: new Date('2024-03-15') },
        { executionTime: new Date('2024-03-10') },
      ];

      const dates = transactions.map(t => t.executionTime);
      const minDate = new Date(Math.min(...dates.map(d => d.getTime())));
      const maxDate = new Date(Math.max(...dates.map(d => d.getTime())));

      expect(minDate.toISOString().split('T')[0]).toBe('2024-03-01');
      expect(maxDate.toISOString().split('T')[0]).toBe('2024-03-15');
    });

    it('should use local date for exchange rate lookup', () => {
      const date = new Date('2024-03-15T10:30:00');
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const dateStr = `${year}-${month}-${day}`;

      expect(dateStr).toBe('2024-03-15');
    });
  });
});
