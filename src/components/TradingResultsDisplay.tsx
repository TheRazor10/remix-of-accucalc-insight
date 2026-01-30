import { TradingStatementResult } from '@/lib/tradingStatementTypes';
import { TrendingUp, TrendingDown, ArrowRightLeft, Calendar, ChevronDown, ChevronUp, DollarSign, Euro, Banknote, Receipt, Download } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { exportTradingResults } from '@/lib/exporter';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

function formatCurrency(value: number, currency: string = 'BGN'): string {
  const symbol = currency === 'EUR' ? '€' : currency === 'USD' ? '$' : currency === 'GBP' ? '£' : 'лв.';
  return `${value.toFixed(2)} ${symbol}`;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('bg-BG', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

interface TradingResultsDisplayProps {
  result: TradingStatementResult;
}

export function TradingResultsDisplay({ result }: TradingResultsDisplayProps) {
  const [showDetails, setShowDetails] = useState(false);

  const handleExport = () => {
    const timestamp = new Date().toISOString().split('T')[0];
    exportTradingResults(result, `trading_report_${timestamp}`);
  };
  
  return (
    <div className="space-y-6 animate-fade-in">
      {/* Row 1: Profit & Loss */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Total Profit */}
        <div className="bg-accent/5 border border-accent/20 rounded-xl p-5">
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-lg bg-accent/10">
              <TrendingUp className="h-6 w-6 text-accent" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Обща печалба</p>
              <p className="text-2xl font-bold text-accent">
                {formatCurrency(result.totalProfitBGN, 'BGN')}
              </p>
              <p className="text-sm text-muted-foreground">
                {formatCurrency(result.totalProfitEUR, 'EUR')}
              </p>
            </div>
          </div>
        </div>

        {/* Total Loss */}
        <div className="bg-destructive/5 border border-destructive/20 rounded-xl p-5">
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-lg bg-destructive/10">
              <TrendingDown className="h-6 w-6 text-destructive" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Обща загуба</p>
              <p className="text-2xl font-bold text-destructive">
                {formatCurrency(result.totalLossBGN, 'BGN')}
              </p>
              <p className="text-sm text-muted-foreground">
                {formatCurrency(result.totalLossEUR, 'EUR')}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Row 2: Total Value, Net Result, Transaction Count */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Total Value (Обща стойност) */}
        <div className="bg-chart-1/10 border border-chart-1/30 rounded-xl p-5">
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-lg bg-chart-1/20">
              <Receipt className="h-6 w-6 text-chart-1" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Обща стойност</p>
              <p className="text-2xl font-bold text-foreground">
                {formatCurrency(result.totalValueBGN, 'BGN')}
              </p>
              <p className="text-sm text-muted-foreground">
                {formatCurrency(result.totalValueEUR, 'EUR')}
              </p>
            </div>
          </div>
        </div>

        {/* Net Result */}
        <div className="bg-primary/5 border border-primary/20 rounded-xl p-5">
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-lg bg-primary/10">
              <Banknote className="h-6 w-6 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Нетен резултат</p>
              <p className={cn(
                "text-2xl font-bold",
                result.totalProfitBGN - result.totalLossBGN >= 0 ? "text-accent" : "text-destructive"
              )}>
                {formatCurrency(result.totalProfitBGN - result.totalLossBGN, 'BGN')}
              </p>
              <p className="text-sm text-muted-foreground">
                {formatCurrency(result.totalProfitEUR - result.totalLossEUR, 'EUR')}
              </p>
            </div>
          </div>
        </div>

        {/* Transaction Count */}
        <div className="bg-muted/50 border border-border rounded-xl p-5">
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-lg bg-muted">
              <ArrowRightLeft className="h-6 w-6 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Продажби</p>
              <p className="text-2xl font-bold text-foreground">
                {result.summary.totalSellTransactions}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Date Range, Currencies & Export */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
          {result.summary.dateRange.from && result.summary.dateRange.to && (
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              <span>
                {formatDate(result.summary.dateRange.from).split(',')[0]} - {formatDate(result.summary.dateRange.to).split(',')[0]}
              </span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <DollarSign className="h-4 w-4" />
            <span>Валути: {result.summary.currenciesInvolved.join(', ')}</span>
          </div>
        </div>
        <Button onClick={handleExport} variant="outline" size="sm" className="gap-2">
          <Download className="h-4 w-4" />
          Експорт Excel
        </Button>
      </div>

      {/* Toggle Details */}
      {result.conversions.length > 0 && (
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="flex items-center gap-2 text-sm text-primary hover:text-primary/80 transition-colors"
        >
          {showDetails ? (
            <>
              <ChevronUp className="h-4 w-4" />
              Скрий детайли
            </>
          ) : (
            <>
              <ChevronDown className="h-4 w-4" />
              Покажи детайли ({result.conversions.length} конверсии)
            </>
          )}
        </button>
      )}

      {/* Detailed Conversions Table */}
      {showDetails && (
        <div className="overflow-x-auto animate-fade-in">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Дата</TableHead>
                <TableHead>Оригинална валута</TableHead>
                <TableHead className="text-right">Оригинална стойност</TableHead>
                <TableHead className="text-right">Курс</TableHead>
                <TableHead className="text-right">BGN</TableHead>
                <TableHead className="text-right">EUR</TableHead>
                <TableHead className="text-right">Общо</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.conversions.map((conv, index) => (
                <TableRow key={index}>
                  <TableCell className="font-medium">
                    {formatDate(conv.date).split(',')[0]}
                  </TableCell>
                  <TableCell>{conv.originalCurrency}</TableCell>
                  <TableCell className={cn(
                    "text-right",
                    conv.originalValue >= 0 ? "text-accent" : "text-destructive"
                  )}>
                    {formatCurrency(conv.originalValue, conv.originalCurrency)}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {conv.exchangeRateUsed.toFixed(5)}
                  </TableCell>
                  <TableCell className={cn(
                    "text-right font-medium",
                    conv.convertedBGN >= 0 ? "text-accent" : "text-destructive"
                  )}>
                    {formatCurrency(conv.convertedBGN, 'BGN')}
                  </TableCell>
                  <TableCell className={cn(
                    "text-right font-medium",
                    conv.convertedEUR >= 0 ? "text-accent" : "text-destructive"
                  )}>
                    {formatCurrency(conv.convertedEUR, 'EUR')}
                  </TableCell>
                  <TableCell className="text-right font-medium text-foreground">
                    {formatCurrency(conv.total, conv.originalCurrency)} / {formatCurrency(conv.totalBGN, 'BGN')}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Net Profit/Loss Summary */}
      {(() => {
        const netBGN = result.totalProfitBGN - result.totalLossBGN;
        const netEUR = result.totalProfitEUR - result.totalLossEUR;
        const isNetProfit = netBGN >= 0;
        return (
          <div 
            className={cn(
              "p-4 rounded-xl border",
              isNetProfit 
                ? "border-accent/30 bg-accent/5" 
                : "border-destructive/30 bg-destructive/5"
            )}
          >
            <div className="flex items-center gap-4">
              <div className={cn(
                "p-3 rounded-full",
                isNetProfit ? "bg-accent/10" : "bg-destructive/10"
              )}>
                {isNetProfit ? (
                  <TrendingUp className="h-6 w-6 text-accent" />
                ) : (
                  <TrendingDown className="h-6 w-6 text-destructive" />
                )}
              </div>
              <div>
                <p className="text-sm text-muted-foreground">
                  {isNetProfit ? 'Нетна печалба от продажби' : 'Нетна загуба от продажби'}
                </p>
                <div className="flex items-center gap-4">
                  <p className={cn(
                    "text-2xl font-bold",
                    isNetProfit ? "text-accent" : "text-destructive"
                  )}>
                    {formatCurrency(Math.abs(netBGN), 'BGN')}
                  </p>
                  <span className="text-muted-foreground">/</span>
                  <p className={cn(
                    "text-xl font-semibold",
                    isNetProfit ? "text-accent" : "text-destructive"
                  )}>
                    {formatCurrency(Math.abs(netEUR), 'EUR')}
                  </p>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
