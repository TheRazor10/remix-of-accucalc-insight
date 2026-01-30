import { TradingTransaction, TradingStatementResult, CurrencyConversionResult } from './tradingStatementTypes';
import { CURRENCY_CONFIG } from '@/config/constants';

// Fixed EUR/BGN rate (Bulgaria is in currency board with EUR)
const EUR_BGN_RATE = CURRENCY_CONFIG.eurBgnRate;

function parseNumber(value: string | undefined): number {
  if (!value) return 0;
  const cleaned = value.replace(/\s/g, '').replace(',', '.');
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : parsed;
}

function parseDate(dateStr: string): Date | null {
  // Format: 2025-11-03 08:04:31
  const match = dateStr.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (match) {
    return new Date(
      parseInt(match[1]),
      parseInt(match[2]) - 1,
      parseInt(match[3]),
      parseInt(match[4]),
      parseInt(match[5]),
      parseInt(match[6])
    );
  }
  return null;
}

export async function parseTradingStatementPdf(file: File): Promise<TradingTransaction[]> {
  const pdfjsLib = await import('pdfjs-dist');
  pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = async (e) => {
      try {
        const typedArray = new Uint8Array(e.target?.result as ArrayBuffer);
        const pdf = await pdfjsLib.getDocument(typedArray).promise;

        const transactions: TradingTransaction[] = [];

        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();
          
          // Get text items with positions
          const items: { text: string; x: number; y: number }[] = [];
          for (const item of textContent.items) {
            if ('str' in item && 'transform' in item) {
              const textItem = item as { str: string; transform: number[] };
              items.push({
                text: textItem.str.trim(),
                x: textItem.transform[4],
                y: textItem.transform[5]
              });
            }
          }

          // Group items by Y position (rows)
          const rowsMap = new Map<number, { text: string; x: number }[]>();
          for (const item of items) {
            if (!item.text) continue;
            const roundedY = Math.round(item.y / 5) * 5;
            if (!rowsMap.has(roundedY)) {
              rowsMap.set(roundedY, []);
            }
            rowsMap.get(roundedY)!.push({ text: item.text, x: item.x });
          }

          // Sort rows by Y (descending) and items within rows by X
          const sortedRows = Array.from(rowsMap.entries())
            .sort((a, b) => b[0] - a[0])
            .map(([, items]) => items.sort((a, b) => a.x - b.x).map(i => i.text));

          // Parse each row looking for transaction patterns
          for (const rowItems of sortedRows) {
            const rowText = rowItems.join(' ');
            
            // Look for date pattern at the start
            const dateMatch = rowText.match(/^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/);
            if (!dateMatch) continue;

            const date = parseDate(dateMatch[1]);
            if (!date) continue;

            // Check if this is a sell transaction (ПОСОКА = "Продай")
            const isProdaj = rowItems.some(item => item === 'Продай');
            if (!isProdaj) continue;

            // Find the transaction currency (ВАЛУТА НА ТРАНЗАКЦИЯТА) - the currency used for P/L
            // Look for the last currency code in the row (transaction currency comes after instrument currency)
            let transactionCurrency = 'EUR';
            const currencyCodes = ['USD', 'GBP', 'CAD', 'EUR', 'BGN', 'GBX'];
            for (let i = rowItems.length - 1; i >= 0; i--) {
              if (currencyCodes.includes(rowItems[i])) {
                // GBX is converted to GBP for transaction purposes
                transactionCurrency = rowItems[i] === 'GBX' ? 'GBP' : rowItems[i];
                break;
              }
            }

            // Extract all numbers from the row (including negative ones)
            const allNumbers: { value: number; index: number }[] = [];
            for (let idx = 0; idx < rowItems.length; idx++) {
              const item = rowItems[idx];
              // Match numbers like "12.34", "-5.67", "1 234.56" (with spaces)
              if (item.match(/^-?\d+[.,]?\d*$/)) {
                allNumbers.push({ value: parseNumber(item), index: idx });
              }
            }

            // The realized P/L (РЕАЛИЗИРАНА ПЕЧАЛБА/ЗАГУБА) is typically the second-to-last number
            // The last number is usually the total (ОБЩО)
            // We need at least 2 numbers to have a realized P/L
            if (allNumbers.length < 2) continue;

            // Get the second-to-last number as realized P/L
            const profitLossEntry = allNumbers[allNumbers.length - 2];
            const profitLoss = profitLossEntry.value;

            // Skip if realized P/L is zero or effectively zero
            if (Math.abs(profitLoss) < 0.001) continue;

            // Exchange rate from PDF is not used - we fetch from BNB instead
            const exchangeRate = 1;

            // Find the instrument (usually a ticker symbol)
            const instrumentIndex = rowItems.findIndex(item => 
              item.match(/^[A-Z]{1,5}$/) && !['EUR', 'USD', 'BGN', 'OTC', 'GBX', 'CAD'].includes(item)
            );
            const instrument = instrumentIndex >= 0 ? rowItems[instrumentIndex] : '';

            // Extract quantity and price from the first few numbers
            const quantity = allNumbers.length > 0 ? allNumbers[0].value : 0;
            const price = allNumbers.length > 1 ? allNumbers[1].value : 0;

            transactions.push({
              executionTime: date,
              instrument,
              isin: '',
              orderCurrency: transactionCurrency,
              direction: 'Продай',
              quantity,
              price,
              transactionValue: allNumbers.length > 2 ? allNumbers[2].value : 0,
              transactionCurrency,
              exchangeRate,
              profitLoss,
              total: allNumbers[allNumbers.length - 1]?.value || 0
            });
          }
        }

        resolve(transactions);
      } catch (error) {
        reject(new Error('Грешка при обработка на Trading 212 отчета: ' + (error as Error).message));
      }
    };

    reader.onerror = () => {
      reject(new Error('Грешка при четене на файла'));
    };

    reader.readAsArrayBuffer(file);
  });
}

// Fetch exchange rates from BNB for a date range
async function fetchBNBExchangeRates(
  currency: string, 
  startDate: Date, 
  endDate: Date
): Promise<Record<string, number>> {
  // EUR is fixed
  if (currency === 'EUR') {
    return {}; // Will use EUR_BGN_RATE directly
  }

  if (currency === 'BGN') {
    return {}; // BGN to BGN is always 1
  }

  // GBX (British Pence) needs to be converted to GBP (100 GBX = 1 GBP)
  const isGBX = currency === 'GBX';
  const apiCurrency = isGBX ? 'GBP' : currency;

  const startDateStr = startDate.toISOString().split('T')[0];
  const endDateStr = endDate.toISOString().split('T')[0];
  
  try {
    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bnb-exchange-rates?currency=${apiCurrency}&startDate=${startDateStr}&endDate=${endDateStr}`,
      {
        headers: {
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!response.ok) {
      throw new Error('Failed to fetch exchange rate');
    }

    const data = await response.json();
    let rates = data.allRates || {};
    
    // If GBX, divide all rates by 100 (since 100 GBX = 1 GBP)
    if (isGBX) {
      rates = Object.fromEntries(
        Object.entries(rates).map(([date, rate]) => [date, (rate as number) / 100])
      );
    }
    
    console.log(`Fetched ${currency} rates:`, rates);
    return rates;
  } catch (error) {
    console.error('Error fetching exchange rates:', error);
    return {};
  }
}

// Get rate for a specific date from the rates map (using local date, not UTC)
function getRateForDate(rates: Record<string, number>, date: Date): number {
  // Use local date components to avoid timezone shifts
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const dateStr = `${year}-${month}-${day}`;
  
  // Direct match
  if (rates[dateStr]) {
    return rates[dateStr];
  }
  
  // Find closest previous date
  const sortedDates = Object.keys(rates).sort();
  let closestRate: number | null = null;
  
  for (const d of sortedDates) {
    if (d <= dateStr) {
      closestRate = rates[d];
    } else {
      break;
    }
  }
  
  return closestRate || 1.69; // Fallback
}

export async function processTrading212Statement(
  file: File
): Promise<TradingStatementResult> {
  const transactions = await parseTradingStatementPdf(file);
  
  // Filter only sell transactions
  const sellTransactions = transactions.filter(t => t.direction === 'Продай');
  
  // Process conversions
  const conversions: CurrencyConversionResult[] = [];
  let totalProfitBGN = 0;
  let totalProfitEUR = 0;
  let totalLossBGN = 0;
  let totalLossEUR = 0;
  let totalValueBGN = 0;
  let totalValueEUR = 0;

  if (sellTransactions.length === 0) {
    return {
      transactions,
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
        dateRange: { from: null, to: null }
      }
    };
  }

  // Find date range from all transactions
  const allDates = sellTransactions.map(t => t.executionTime);
  const minDate = new Date(Math.min(...allDates.map(d => d.getTime())));
  const maxDate = new Date(Math.max(...allDates.map(d => d.getTime())));
  
  // Add buffer days
  minDate.setDate(minDate.getDate() - 1);
  maxDate.setDate(maxDate.getDate() + 1);

  // Get unique currencies
  const uniqueCurrencies = [...new Set(sellTransactions.map(tx => tx.transactionCurrency))];
  
  // Fetch all rates for the entire date range at once
  const currencyRatesMap: Record<string, Record<string, number>> = {};
  
  for (const currency of uniqueCurrencies) {
    if (currency !== 'EUR' && currency !== 'BGN') {
      currencyRatesMap[currency] = await fetchBNBExchangeRates(currency, minDate, maxDate);
    }
  }

  // Group transactions by date
  const dateMap = new Map<string, TradingTransaction[]>();
  for (const tx of sellTransactions) {
    const dateKey = `${tx.executionTime.getFullYear()}-${String(tx.executionTime.getMonth() + 1).padStart(2, '0')}-${String(tx.executionTime.getDate()).padStart(2, '0')}`;
    if (!dateMap.has(dateKey)) {
      dateMap.set(dateKey, []);
    }
    dateMap.get(dateKey)!.push(tx);
  }

  // Process each date's transactions
  for (const [, txList] of dateMap.entries()) {
    // Convert each transaction
    for (const tx of txList) {
      const originalValue = tx.profitLoss;
      const totalValue = tx.total;
      const txDate = tx.executionTime;
      let convertedBGN: number;
      let convertedEUR: number;
      let totalBGN: number;
      let totalEUR: number;
      let rateUsed = 1;
      
      // Use transactionCurrency (Валута на транзакцията) for conversions
      if (tx.transactionCurrency === 'BGN') {
        convertedBGN = originalValue;
        convertedEUR = originalValue / EUR_BGN_RATE;
        totalBGN = totalValue;
        totalEUR = totalValue / EUR_BGN_RATE;
        rateUsed = 1;
      } else if (tx.transactionCurrency === 'EUR') {
        convertedBGN = originalValue * EUR_BGN_RATE;
        convertedEUR = originalValue;
        totalBGN = totalValue * EUR_BGN_RATE;
        totalEUR = totalValue;
        rateUsed = EUR_BGN_RATE;
      } else {
        // USD or other currency - get rate for this specific date
        const currencyRates = currencyRatesMap[tx.transactionCurrency] || {};
        const rateToBGN = getRateForDate(currencyRates, txDate);
        convertedBGN = originalValue * rateToBGN;
        convertedEUR = convertedBGN / EUR_BGN_RATE;
        totalBGN = totalValue * rateToBGN;
        totalEUR = totalBGN / EUR_BGN_RATE;
        rateUsed = rateToBGN;
      }

      conversions.push({
        originalCurrency: tx.transactionCurrency, // Валута на транзакцията
        originalValue,
        convertedBGN,
        convertedEUR,
        exchangeRateUsed: rateUsed,
        date: txDate,
        total: tx.total,
        totalBGN
      });

      // Separate profit and loss
      if (convertedBGN >= 0) {
        totalProfitBGN += convertedBGN;
        totalProfitEUR += convertedEUR;
      } else {
        totalLossBGN += Math.abs(convertedBGN);
        totalLossEUR += Math.abs(convertedEUR);
      }
      totalValueBGN += totalBGN;
      totalValueEUR += totalEUR;
    }
  }

  // Build summary
  const dates = sellTransactions.map(t => t.executionTime).filter(d => d);
  const summary = {
    totalSellTransactions: sellTransactions.length,
    currenciesInvolved: [...new Set(sellTransactions.map(t => t.transactionCurrency))],
    dateRange: {
      from: dates.length > 0 ? new Date(Math.min(...dates.map(d => d.getTime()))) : null,
      to: dates.length > 0 ? new Date(Math.max(...dates.map(d => d.getTime()))) : null
    }
  };

  return {
    transactions,
    sellTransactions,
    conversions,
    totalProfitBGN,
    totalProfitEUR,
    totalLossBGN,
    totalLossEUR,
    totalValueBGN,
    totalValueEUR,
    summary
  };
}
