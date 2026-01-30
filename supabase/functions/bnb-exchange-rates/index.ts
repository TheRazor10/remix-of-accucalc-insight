import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

// Fixed EUR/BGN rate (Currency Board)
const EUR_BGN_RATE = 1.95583;

// Allowed currencies - whitelist for input validation
const ALLOWED_CURRENCIES = ['USD', 'EUR', 'BGN', 'GBP', 'CHF', 'JPY', 'CAD', 'AUD', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'RON', 'TRY', 'CNY', 'BRL', 'MXN', 'NZD', 'SGD', 'HKD', 'KRW', 'ZAR', 'INR'];

// Date validation regex (YYYY-MM-DD format)
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

// Validate date string format and reasonable range
function isValidDate(dateStr: string): boolean {
  if (!DATE_REGEX.test(dateStr)) return false;
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return false;
  // Frankfurter has data from 1999 onwards
  const minDate = new Date('1999-01-04');
  const maxDate = new Date();
  maxDate.setDate(maxDate.getDate() + 1);
  return date >= minDate && date <= maxDate;
}

// Validate currency is in whitelist
function isValidCurrency(currency: string): boolean {
  return ALLOWED_CURRENCIES.includes(currency.toUpperCase());
}

// Cache for exchange rates
const ratesCache = new Map<string, { rates: Record<string, number>; timestamp: number }>();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

// Fetch historical rates from Frankfurter API (ECB data)
async function fetchFrankfurterRates(
  currency: string,
  startDate: Date,
  endDate: Date
): Promise<Record<string, number>> {
  const rates: Record<string, number> = {};

  try {
    const startStr = startDate.toISOString().split('T')[0];
    const endStr = endDate.toISOString().split('T')[0];

    // Frankfurter API time series endpoint
    // We request EUR as base and get the currency rate, then convert to BGN
    const url = `https://api.frankfurter.dev/v1/${startStr}..${endStr}?symbols=${currency}`;

    console.log(`Fetching Frankfurter rates from: ${url}`);

    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
      }
    });

    if (!response.ok) {
      console.error(`Frankfurter API error: ${response.status}`);
      throw new Error(`Frankfurter API returned ${response.status}`);
    }

    const data = await response.json();
    console.log(`Frankfurter response received, dates: ${Object.keys(data.rates || {}).length}`);

    // data.rates format: { "2025-11-17": { "USD": 1.0567 }, ... }
    // The rate is EUR -> currency, we need currency -> BGN
    // Formula: 1 currency = (1 / EUR_to_currency_rate) * EUR_BGN_RATE
    if (data.rates) {
      for (const [date, rateObj] of Object.entries(data.rates)) {
        const eurToCurrencyRate = (rateObj as Record<string, number>)[currency];
        if (eurToCurrencyRate && eurToCurrencyRate > 0) {
          // Convert: 1 USD = (1 / EUR_USD) * EUR_BGN = BGN rate
          const currencyToBgnRate = EUR_BGN_RATE / eurToCurrencyRate;
          rates[date] = Math.round(currencyToBgnRate * 100000) / 100000; // Round to 5 decimal places
          console.log(`Rate for ${date}: 1 ${currency} = ${rates[date]} BGN (EUR/${currency}=${eurToCurrencyRate})`);
        }
      }
    }

    console.log(`Total rates parsed: ${Object.keys(rates).length}`);

  } catch (error) {
    console.error('Error fetching Frankfurter rates:', error);
  }

  return rates;
}

// Find the closest available rate for a given date
function findClosestRate(rates: Record<string, number>, targetDate: string): number | null {
  if (rates[targetDate]) {
    return rates[targetDate];
  }

  // If exact date not found, find the closest previous date
  const sortedDates = Object.keys(rates).sort();
  let closestRate: number | null = null;
  
  for (const date of sortedDates) {
    if (date <= targetDate) {
      closestRate = rates[date];
    } else {
      break;
    }
  }
  
  // If no previous date found, use the first available
  if (closestRate === null && sortedDates.length > 0) {
    closestRate = rates[sortedDates[0]];
  }

  return closestRate;
}

serve(async (req) => {
  const origin = req.headers.get('Origin');
  const corsHeaders = getCorsHeaders(origin);

  if (req.method === 'OPTIONS') {
    return handleCorsPreflightRequest(origin);
  }

  try {
    const url = new URL(req.url);
    const currencyParam = url.searchParams.get('currency')?.toUpperCase() || 'USD';
    const dateParam = url.searchParams.get('date') || new Date().toISOString().split('T')[0];
    
    // Optional: date range parameters
    const startDateParam = url.searchParams.get('startDate');
    const endDateParam = url.searchParams.get('endDate');

    // Input validation - currency whitelist
    if (!isValidCurrency(currencyParam)) {
      console.log(`Invalid currency requested: ${currencyParam}`);
      return new Response(
        JSON.stringify({ error: 'Invalid currency' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Input validation - date format
    if (!isValidDate(dateParam)) {
      console.log(`Invalid date format: ${dateParam}`);
      return new Response(
        JSON.stringify({ error: 'Invalid date format. Use YYYY-MM-DD.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate optional date range parameters
    if (startDateParam && !isValidDate(startDateParam)) {
      return new Response(
        JSON.stringify({ error: 'Invalid startDate format. Use YYYY-MM-DD.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    if (endDateParam && !isValidDate(endDateParam)) {
      return new Response(
        JSON.stringify({ error: 'Invalid endDate format. Use YYYY-MM-DD.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const currency = currencyParam;
    const date = dateParam;

    console.log(`Request for ${currency} rate on ${date}`);

    // Fixed rates
    if (currency === 'EUR') {
      return new Response(
        JSON.stringify({ 
          currency, 
          rate: EUR_BGN_RATE, 
          date, 
          source: 'fixed' 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (currency === 'BGN') {
      return new Response(
        JSON.stringify({ 
          currency, 
          rate: 1, 
          date, 
          source: 'fixed' 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Determine date range for fetching
    let startDate: Date;
    let endDate: Date;
    
    if (startDateParam && endDateParam) {
      startDate = new Date(startDateParam);
      endDate = new Date(endDateParam);
    } else {
      // For single date, fetch a week range around that date
      const targetDate = new Date(date);
      startDate = new Date(targetDate);
      startDate.setDate(startDate.getDate() - 7);
      endDate = new Date(targetDate);
      endDate.setDate(endDate.getDate() + 1);
    }

    // Create cache key based on currency and date range
    const cacheKey = `frankfurter-${currency}-${startDate.toISOString().split('T')[0]}-${endDate.toISOString().split('T')[0]}`;
    const cached = ratesCache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      console.log(`Cache hit for ${cacheKey}`);
      const rate = findClosestRate(cached.rates, date);
      return new Response(
        JSON.stringify({ 
          currency, 
          rate, 
          date, 
          source: 'cache',
          allRates: cached.rates
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch from Frankfurter (ECB data)
    const rates = await fetchFrankfurterRates(currency, startDate, endDate);
    
    // Cache the results
    if (Object.keys(rates).length > 0) {
      ratesCache.set(cacheKey, { rates, timestamp: Date.now() });
    }

    const rate = findClosestRate(rates, date);
    console.log(`Final rate for ${currency} on ${date}: ${rate}`);

    // If no rate found, use a fallback
    const finalRate = rate || (currency === 'USD' ? 1.69 : 1);

    return new Response(
      JSON.stringify({ 
        currency, 
        rate: finalRate, 
        date,
        eurBgnRate: EUR_BGN_RATE,
        source: rate ? 'frankfurter' : 'fallback',
        allRates: rates
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in exchange-rates:', error);
    const origin = req.headers.get('Origin');
    const corsHeaders = getCorsHeaders(origin);
    return new Response(
      JSON.stringify({ error: 'Failed to fetch exchange rates' }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
