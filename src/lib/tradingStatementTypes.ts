export interface TradingTransaction {
  executionTime: Date;
  instrument: string;
  isin: string;
  orderCurrency: string;
  direction: 'Купи' | 'Продай';
  quantity: number;
  price: number;
  transactionValue: number;
  transactionCurrency: string;
  exchangeRate: number;
  profitLoss: number;
  total: number;
}

export interface CurrencyConversionResult {
  originalCurrency: string;
  originalValue: number;
  convertedBGN: number;
  convertedEUR: number;
  exchangeRateUsed: number;
  date: Date;
  total: number; // "ОБЩО" value from the transaction
  totalBGN: number; // "ОБЩО" converted to BGN
}

export interface TradingStatementResult {
  transactions: TradingTransaction[];
  sellTransactions: TradingTransaction[];
  conversions: CurrencyConversionResult[];
  totalProfitBGN: number;  // Sum of positive profit/loss values
  totalProfitEUR: number;
  totalLossBGN: number;    // Sum of negative profit/loss values (stored as positive)
  totalLossEUR: number;
  totalValueBGN: number;   // Sum of "ОБЩО" column converted to BGN
  totalValueEUR: number;   // Sum of "ОБЩО" column converted to EUR
  summary: {
    totalSellTransactions: number;
    currenciesInvolved: string[];
    dateRange: { from: Date | null; to: Date | null };
  };
}

export interface ExchangeRate {
  currency: string;
  rate: number;
  date: string;
}
