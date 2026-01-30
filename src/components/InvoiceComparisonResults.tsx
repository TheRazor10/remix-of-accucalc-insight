import { AlertCircle, Check, HelpCircle, Search, FileX, RefreshCw } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';
import { VerificationSummary, FieldComparison } from '@/lib/invoiceComparisonTypes';
import { cn } from '@/lib/utils';

interface InvoiceComparisonResultsProps {
  summary: VerificationSummary;
}

export function InvoiceComparisonResults({ summary }: InvoiceComparisonResultsProps) {
  const getStatusIcon = (status: FieldComparison['status']) => {
    switch (status) {
      case 'match':
        return <Check className="h-4 w-4 text-emerald-500" />;
      case 'suspicious':
        return <AlertCircle className="h-4 w-4 text-amber-500" />;
      case 'unreadable':
        return <HelpCircle className="h-4 w-4 text-muted-foreground" />;
      case 'missing':
        return <Search className="h-4 w-4 text-muted-foreground" />;
      default:
        return null;
    }
  };

  const renderFieldCell = (comparison: FieldComparison) => {
    const isSuspicious = comparison.status === 'suspicious';
    const isWarning = comparison.status === 'unreadable' || comparison.status === 'missing';
    
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={cn(
            "flex items-center gap-2 cursor-help",
            isSuspicious && "text-amber-600 font-semibold",
            isWarning && "text-muted-foreground"
          )}>
            {getStatusIcon(comparison.status)}
            <span className="truncate max-w-[90px]">
              {comparison.imageValue ?? '—'}
            </span>
            {isSuspicious && (
              <span className="text-amber-600 font-bold text-lg">?</span>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[300px]">
          <div className="space-y-1">
            <p className="font-medium">{comparison.fieldLabel}</p>
            <div className="text-sm">
              <p>
                <span className="text-muted-foreground">Фактура:</span>{' '}
                {comparison.imageValue ?? 'Нечетимо'}
              </p>
              <p>
                <span className="text-muted-foreground">Excel:</span>{' '}
                {comparison.excelValue ?? 'Липсва'}
              </p>
            </div>
            {comparison.status === 'suspicious' && (
              <p className="text-amber-600 text-xs font-medium mt-1">
                ⚠️ Съмнително - проверете!
              </p>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    );
  };

  const getOverallStatusBadge = (status: string) => {
    switch (status) {
      case 'match':
        return <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-200">✓ OK</Badge>;
      case 'suspicious':
        return <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-200">? Съмнителни</Badge>;
      case 'unreadable':
        return <Badge variant="secondary">Нечетимо</Badge>;
      case 'not_found':
        return <Badge variant="secondary">Не е в Excel</Badge>;
      default:
        return null;
    }
  };

  const formatAmount = (value: number | null): string => {
    if (value === null) return '—';
    return value.toLocaleString('bg-BG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  return (
    <div className="space-y-6">
      {/* Summary Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        <SummaryCard
          label="Съвпадения"
          value={summary.matchedCount}
          total={summary.totalImages}
          variant="success"
        />
        <SummaryCard
          label="Съмнителни"
          value={summary.suspiciousCount}
          total={summary.totalImages}
          variant="warning"
        />
        <SummaryCard
          label="Нечетими"
          value={summary.unreadableCount}
          total={summary.totalImages}
          variant="neutral"
        />
        <SummaryCard
          label="Не е в Excel"
          value={summary.notFoundCount}
          total={summary.totalImages}
          variant="info"
        />
        <SummaryCard
          label="Липсва PDF"
          value={summary.missingPdfCount}
          total={summary.totalExcelRows}
          variant="error"
        />
      </div>

      {/* Comparison note */}
      {summary.totalImages !== summary.totalExcelRows && (
        <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
          <p className="text-sm text-amber-700 dark:text-amber-400">
            <AlertCircle className="h-4 w-4 inline mr-2" />
            Внимание: Броят файлове ({summary.totalImages}) се различава от броя редове в Excel ({summary.totalExcelRows})
          </p>
        </div>
      )}

      {/* Results Table */}
      <div className="rounded-lg border border-border overflow-hidden">
        <Table className="table-fixed w-full">
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="w-[15%]">Файл</TableHead>
              <TableHead className="w-[10%]">Вид</TableHead>
              <TableHead className="w-[14%]">Номер</TableHead>
              <TableHead className="w-[11%]">Дата</TableHead>
              <TableHead className="w-[14%]">ИН</TableHead>
              <TableHead className="w-[10%]">ДО</TableHead>
              <TableHead className="w-[10%]">ДДС</TableHead>
              <TableHead className="w-[16%] text-right">Статус</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {summary.comparisons.map((comparison, index) => {
              const fieldMap = Object.fromEntries(
                comparison.fieldComparisons.map(fc => [fc.fieldName, fc])
              );
              
              return (
                <TableRow 
                  key={index}
                  className={cn(
                    comparison.overallStatus === 'suspicious' && "bg-amber-50/50 dark:bg-amber-950/10",
                    comparison.overallStatus === 'unreadable' && "bg-muted/30"
                  )}
                >
                  <TableCell className="font-medium p-2">
                    <div className="flex items-center gap-1">
                      <span className="truncate block" title={comparison.imageFileName}>
                        {comparison.imageFileName}
                      </span>
                      {comparison.extractedData.wasDoubleChecked && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <RefreshCw className="h-3 w-3 text-amber-500 flex-shrink-0" />
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Проверено повторно с Pro модел</p>
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                    {comparison.matchedExcelRow && (
                      <span className="text-xs text-muted-foreground">
                        Ред {comparison.matchedExcelRow}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="p-2">
                    {fieldMap.documentType ? renderFieldCell(fieldMap.documentType) : '—'}
                  </TableCell>
                  <TableCell className="p-2">
                    {fieldMap.documentNumber ? renderFieldCell(fieldMap.documentNumber) : '—'}
                  </TableCell>
                  <TableCell className="p-2">
                    {fieldMap.documentDate ? renderFieldCell(fieldMap.documentDate) : '—'}
                  </TableCell>
                  <TableCell className="p-2">
                    {fieldMap.supplierId ? renderFieldCell(fieldMap.supplierId) : '—'}
                  </TableCell>
                  <TableCell className="p-2">
                    {fieldMap.amount ? renderFieldCell(fieldMap.amount) : '—'}
                  </TableCell>
                  <TableCell className="p-2">
                    {fieldMap.vatAmount ? renderFieldCell(fieldMap.vatAmount) : '—'}
                  </TableCell>
                  <TableCell className="text-right p-2">
                    {getOverallStatusBadge(comparison.overallStatus)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Missing PDF Table */}
      {summary.missingPdfRows.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <FileX className="h-5 w-5 text-blue-500" />
            <h3 className="font-semibold text-foreground">
              Excel редове без качен PDF ({summary.missingPdfRows.length})
            </h3>
          </div>
          <div className="rounded-lg border border-blue-200 dark:border-blue-800 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-blue-50/50 dark:bg-blue-950/20">
                  <TableHead className="w-[60px]">Ред</TableHead>
                  <TableHead>Вид</TableHead>
                  <TableHead>Номер</TableHead>
                  <TableHead>Дата</TableHead>
                  <TableHead>ИН</TableHead>
                  <TableHead>ДО</TableHead>
                  <TableHead>ДДС</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.missingPdfRows.map((row, index) => (
                  <TableRow key={index} className="bg-blue-50/30 dark:bg-blue-950/10">
                    <TableCell className="font-medium">{row.rowIndex}</TableCell>
                    <TableCell>{row.documentType}</TableCell>
                    <TableCell>{row.documentNumber}</TableCell>
                    <TableCell>{row.documentDate}</TableCell>
                    <TableCell>{row.counterpartyId}</TableCell>
                    <TableCell>{formatAmount(row.hasDDS ? row.amountWithDDS : row.amountNoDDS)}</TableCell>
                    <TableCell>{formatAmount(row.vatWithFullCredit)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
        <div className="flex items-center gap-1">
          <Check className="h-4 w-4 text-emerald-500" />
          <span>Съвпадение</span>
        </div>
        <div className="flex items-center gap-1">
          <AlertCircle className="h-4 w-4 text-amber-500" />
          <span className="text-amber-600 font-bold">?</span>
          <span>Съмнителни</span>
        </div>
        <div className="flex items-center gap-1">
          <HelpCircle className="h-4 w-4 text-muted-foreground" />
          <span>Нечетимо</span>
        </div>
        <div className="flex items-center gap-1">
          <FileX className="h-4 w-4 text-blue-500" />
          <span>Липсва PDF</span>
        </div>
        <div className="flex items-center gap-1">
          <RefreshCw className="h-3.5 w-3.5 text-amber-500" />
          <span>Pro проверка</span>
        </div>
      </div>
    </div>
  );
}

interface SummaryCardProps {
  label: string;
  value: number;
  total: number;
  variant: 'success' | 'error' | 'warning' | 'neutral' | 'info';
}

function SummaryCard({ label, value, total, variant }: SummaryCardProps) {
  const variantClasses = {
    success: 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400',
    error: 'bg-destructive/10 border-destructive/20 text-destructive',
    warning: 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400',
    neutral: 'bg-muted border-border text-muted-foreground',
    info: 'bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-400',
  };
  
  return (
    <div className={cn(
      "rounded-lg border p-4 text-center",
      variantClasses[variant]
    )}>
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-sm">{label}</p>
    </div>
  );
}
