import { useState, useMemo } from 'react';
import { CheckCircle2, AlertTriangle, AlertCircle, FileQuestion, ChevronDown, ChevronUp, FileSpreadsheet, User, FileX2, ScanLine } from 'lucide-react';
import { SalesVerificationSummary, SalesComparisonResult, ExcelInternalCheckResult, isPhysicalIndividualId } from '@/lib/salesComparisonTypes';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface SalesComparisonResultsProps {
  summary: SalesVerificationSummary;
}

// Check if a document is a credit note
function isCreditNote(comparison: SalesComparisonResult): boolean {
  const docType = comparison.extractedData.documentType?.toUpperCase() || '';
  const excelDocType = comparison.fieldComparisons.find(f => f.fieldName === 'documentType')?.excelValue || '';

  return docType.includes('КРЕДИТНО') ||
         docType.includes('CREDIT') ||
         excelDocType === 'КИ';
}

export function SalesComparisonResults({ summary }: SalesComparisonResultsProps) {
  const [expandedItems, setExpandedItems] = useState<Set<number>>(new Set());
  const [showExcelChecks, setShowExcelChecks] = useState(false);
  const [showMissingPdfs, setShowMissingPdfs] = useState(false);
  const [showPhysicalIndividuals, setShowPhysicalIndividuals] = useState(false);
  const [showCreditNotes, setShowCreditNotes] = useState(false);
  const [showScannedPdfs, setShowScannedPdfs] = useState(true);

  const isScannedPdf = (comparison: SalesComparisonResult): boolean => {
    return comparison.extractedData.extractionMethod === 'ocr';
  };

  const isFailedScannedPdf = (comparison: SalesComparisonResult): boolean => {
    if (!isScannedPdf(comparison)) return false;
    const data = comparison.extractedData;
    const missingFields = [
      data.documentType === null,
      data.documentDate === null,
      data.clientId === null,
      data.taxBaseAmount === null,
      data.vatAmount === null,
    ].filter(Boolean).length;
    return missingFields >= 4;
  };

  const { regularComparisons, physicalIndividualComparisons, creditNoteComparisons, scannedComparisons } = useMemo(() => {
    const regular: { comparison: SalesComparisonResult; globalIndex: number }[] = [];
    const physical: { comparison: SalesComparisonResult; globalIndex: number }[] = [];
    const creditNotes: { comparison: SalesComparisonResult; globalIndex: number }[] = [];
    const scanned: { comparison: SalesComparisonResult; globalIndex: number }[] = [];

    for (let i = 0; i < summary.comparisons.length; i++) {
      const comparison = summary.comparisons[i];
      const entry = { comparison, globalIndex: i };
      const excelClientId = comparison.fieldComparisons.find(f => f.fieldName === 'clientId')?.excelValue;

      if (isFailedScannedPdf(comparison)) {
        scanned.push(entry);
      } else if (isCreditNote(comparison)) {
        creditNotes.push(entry);
      } else if (isPhysicalIndividualId(excelClientId)) {
        physical.push(entry);
      } else {
        regular.push(entry);
      }
    }

    return {
      regularComparisons: regular,
      physicalIndividualComparisons: physical,
      creditNoteComparisons: creditNotes,
      scannedComparisons: scanned
    };
  }, [summary.comparisons]);

  const toggleExpanded = (index: number) => {
    const newExpanded = new Set(expandedItems);
    if (newExpanded.has(index)) {
      newExpanded.delete(index);
    } else {
      newExpanded.add(index);
    }
    setExpandedItems(newExpanded);
  };

  const getStatusIcon = (status: SalesComparisonResult['overallStatus']) => {
    switch (status) {
      case 'match':
        return <CheckCircle2 className="h-5 w-5 text-emerald-500" />;
      case 'suspicious':
        return <AlertTriangle className="h-5 w-5 text-amber-500" />;
      case 'not_found':
        return <FileQuestion className="h-5 w-5 text-red-500" />;
      default:
        return <AlertCircle className="h-5 w-5 text-muted-foreground" />;
    }
  };

  const getStatusLabel = (status: SalesComparisonResult['overallStatus']) => {
    switch (status) {
      case 'match':
        return 'Съвпада';
      case 'suspicious':
        return 'Съмнителен';
      case 'not_found':
        return 'Не е намерен';
      default:
        return 'Неизвестен';
    }
  };

  const getStatusBg = (status: SalesComparisonResult['overallStatus']) => {
    switch (status) {
      case 'match':
        return 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800';
      case 'suspicious':
        return 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800';
      case 'not_found':
        return 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800';
      default:
        return 'bg-muted/50 border-border';
    }
  };

  return (
    <div className="space-y-6">
      {/* Excel Internal Checks Section */}
      {summary.excelChecks.length > 0 && (
        <div className="border border-border rounded-lg overflow-hidden">
          <Button
            variant="ghost"
            className="w-full justify-between p-4 h-auto"
            onClick={() => setShowExcelChecks(!showExcelChecks)}
          >
            <div className="flex items-center gap-3">
              <FileSpreadsheet className="h-5 w-5 text-amber-500" />
              <span className="font-medium">
                Проверки на Excel ({summary.excelChecks.length})
              </span>
              {summary.excelCheckErrors > 0 && (
                <span className="px-2 py-0.5 rounded text-xs bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400">
                  {summary.excelCheckErrors} грешки
                </span>
              )}
              {summary.excelCheckWarnings > 0 && (
                <span className="px-2 py-0.5 rounded text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">
                  {summary.excelCheckWarnings} предупреждения
                </span>
              )}
            </div>
            {showExcelChecks ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>

          {showExcelChecks && (
            <div className="border-t border-border p-4 space-y-3">
              {summary.excelChecks.map((check, idx) => (
                <ExcelCheckItem key={idx} check={check} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Failed PDF Extractions Section */}
      {summary.failedExtractionCount > 0 && (
        <div className="border border-red-200 dark:border-red-800 rounded-lg overflow-hidden bg-red-50/50 dark:bg-red-950/20">
          <div className="p-4">
            <div className="flex items-center gap-3 mb-2">
              <AlertCircle className="h-5 w-5 text-red-500" />
              <span className="font-medium">
                Неуспешно извличане ({summary.failedExtractionCount} PDF)
              </span>
            </div>
            <p className="text-sm text-muted-foreground mb-3">
              Тези PDF файлове не можаха да бъдат прочетени. Проверете ги ръчно.
            </p>
            <div className="space-y-1">
              {summary.failedExtractionFiles.map((fileName, idx) => (
                <p key={idx} className="text-sm p-2 rounded bg-red-100/50 dark:bg-red-900/20 text-red-700 dark:text-red-400">
                  {fileName}
                </p>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Missing PDFs Section */}
      {summary.missingPdfRows.length > 0 && (
        <div className="border border-border rounded-lg overflow-hidden">
          <Button
            variant="ghost"
            className="w-full justify-between p-4 h-auto"
            onClick={() => setShowMissingPdfs(!showMissingPdfs)}
          >
            <div className="flex items-center gap-3">
              <FileQuestion className="h-5 w-5 text-blue-500" />
              <span className="font-medium">
                Липсващи PDF файлове ({summary.missingPdfRows.length})
              </span>
            </div>
            {showMissingPdfs ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>

          {showMissingPdfs && (
            <div className="border-t border-border p-4 space-y-2">
              {summary.missingPdfRows.map((row, idx) => (
                <div key={idx} className="text-sm p-2 rounded bg-muted/50">
                  <span className="font-medium">{row.documentNumber}</span>
                  <span className="text-muted-foreground ml-2">
                    ({row.documentDate}) - {row.counterpartyName || row.counterpartyId}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Credit Notes Section */}
      {creditNoteComparisons.length > 0 && (
        <div className="border border-rose-200 dark:border-rose-800 rounded-lg overflow-hidden bg-rose-50/50 dark:bg-rose-950/20">
          <Button
            variant="ghost"
            className="w-full justify-between p-4 h-auto hover:bg-transparent"
            onClick={() => setShowCreditNotes(!showCreditNotes)}
          >
            <div className="flex items-center gap-3">
              <FileX2 className="h-5 w-5 text-rose-500" />
              <span className="font-medium">
                Кредитни известия ({creditNoteComparisons.length})
              </span>
              <span className="text-xs text-muted-foreground">
                (отрицателни суми)
              </span>
            </div>
            {showCreditNotes ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>

          {showCreditNotes && (
            <div className="border-t border-rose-200/50 dark:border-rose-800/50 p-4 space-y-3 bg-background/50">
              {creditNoteComparisons.map(({ comparison, globalIndex }) => (
                <ComparisonItem
                  key={globalIndex}
                  comparison={comparison}
                  index={globalIndex}
                  isExpanded={expandedItems.has(globalIndex)}
                  onToggle={() => toggleExpanded(globalIndex)}
                  getStatusIcon={getStatusIcon}
                  getStatusLabel={getStatusLabel}
                  getStatusBg={getStatusBg}
                  showNegativeAmounts={true}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Scanned PDFs Section */}
      {scannedComparisons.length > 0 && (
        <div className="border border-orange-200 dark:border-orange-800 rounded-lg overflow-hidden bg-orange-50/50 dark:bg-orange-950/20">
          <Button
            variant="ghost"
            className="w-full justify-between p-4 h-auto hover:bg-transparent"
            onClick={() => setShowScannedPdfs(!showScannedPdfs)}
          >
            <div className="flex items-center gap-3">
              <ScanLine className="h-5 w-5 text-orange-500" />
              <span className="font-medium">
                Сканирани фактури ({scannedComparisons.length})
              </span>
              <span className="px-2 py-0.5 rounded text-xs bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400">
                изискват ръчна проверка
              </span>
            </div>
            {showScannedPdfs ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>

          {showScannedPdfs && (
            <div className="border-t border-orange-200/50 dark:border-orange-800/50 p-4 space-y-3 bg-background/50">
              <p className="text-sm text-muted-foreground mb-4 p-3 bg-muted/50 rounded-lg">
                Тези PDF файлове са сканирани или имат нечетлив текст.
                Автоматичната проверка не може да извлече всички данни.
                Моля, проверете ги ръчно.
              </p>
              {scannedComparisons.map(({ comparison, globalIndex }) => (
                <ComparisonItem
                  key={globalIndex}
                  comparison={comparison}
                  index={globalIndex}
                  isExpanded={expandedItems.has(globalIndex)}
                  onToggle={() => toggleExpanded(globalIndex)}
                  getStatusIcon={getStatusIcon}
                  getStatusLabel={getStatusLabel}
                  getStatusBg={getStatusBg}
                  isScanned={true}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Physical Individuals Section */}
      {physicalIndividualComparisons.length > 0 && (
        <div className="border border-blue-200 dark:border-blue-800 rounded-lg overflow-hidden bg-blue-50/50 dark:bg-blue-950/20">
          <Button
            variant="ghost"
            className="w-full justify-between p-4 h-auto hover:bg-transparent"
            onClick={() => setShowPhysicalIndividuals(!showPhysicalIndividuals)}
          >
            <div className="flex items-center gap-3">
              <User className="h-5 w-5 text-blue-500" />
              <span className="font-medium">
                Физически лица ({physicalIndividualComparisons.length})
              </span>
              <span className="text-xs text-muted-foreground">
                (без ДДС номер)
              </span>
            </div>
            {showPhysicalIndividuals ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>

          {showPhysicalIndividuals && (
            <div className="border-t border-blue-200/50 dark:border-blue-800/50 p-4 space-y-3 bg-background/50">
              {physicalIndividualComparisons.map(({ comparison, globalIndex }) => (
                <ComparisonItem
                  key={globalIndex}
                  comparison={comparison}
                  index={globalIndex}
                  isExpanded={expandedItems.has(globalIndex)}
                  onToggle={() => toggleExpanded(globalIndex)}
                  getStatusIcon={getStatusIcon}
                  getStatusLabel={getStatusLabel}
                  getStatusBg={getStatusBg}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* PDF Comparison Results (regular) */}
      <div className="space-y-3">
        <h3 className="font-medium text-foreground">
          Резултати от сравнението PDF - Excel
          {physicalIndividualComparisons.length > 0 && (
            <span className="text-sm text-muted-foreground font-normal ml-2">
              (фирми с ДДС/ЕИК)
            </span>
          )}
        </h3>

        {regularComparisons.map(({ comparison, globalIndex }) => (
          <ComparisonItem
            key={globalIndex}
            comparison={comparison}
            index={globalIndex}
            isExpanded={expandedItems.has(globalIndex)}
            onToggle={() => toggleExpanded(globalIndex)}
            getStatusIcon={getStatusIcon}
            getStatusLabel={getStatusLabel}
            getStatusBg={getStatusBg}
          />
        ))}

        {regularComparisons.length === 0 && (
          <p className="text-sm text-muted-foreground p-4 text-center border rounded-lg">
            Няма фактури към фирми (всички са към физически лица)
          </p>
        )}
      </div>
    </div>
  );
}

interface ComparisonItemProps {
  comparison: SalesComparisonResult;
  index: number;
  isExpanded: boolean;
  onToggle: () => void;
  getStatusIcon: (status: SalesComparisonResult['overallStatus']) => React.ReactNode;
  getStatusLabel: (status: SalesComparisonResult['overallStatus']) => string;
  getStatusBg: (status: SalesComparisonResult['overallStatus']) => string;
  showNegativeAmounts?: boolean;
  isScanned?: boolean;
}

function formatAmountValue(value: string | null, showNegative: boolean): string | null {
  if (!value) return value;
  const num = parseFloat(value);
  if (isNaN(num)) return value;
  if (showNegative && num > 0) {
    return `-${value}`;
  }
  return value;
}

function ComparisonItem({
  comparison,
  index,
  isExpanded,
  onToggle,
  getStatusIcon,
  getStatusLabel,
  getStatusBg,
  showNegativeAmounts = false,
  isScanned = false
}: ComparisonItemProps) {
  return (
    <div
      className={cn(
        'border rounded-lg overflow-hidden transition-colors',
        getStatusBg(comparison.overallStatus)
      )}
    >
      <Button
        variant="ghost"
        className="w-full justify-between p-4 h-auto hover:bg-transparent"
        onClick={onToggle}
      >
        <div className="flex items-center gap-3">
          {isScanned ? (
            <ScanLine className="h-5 w-5 text-orange-500" />
          ) : (
            getStatusIcon(comparison.overallStatus)
          )}
          <div className="text-left">
            <p className="font-medium text-foreground flex items-center gap-2">
              {comparison.pdfFileName}
              {isScanned && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400">
                  сканиран
                </span>
              )}
            </p>
            <p className="text-sm text-muted-foreground">
              {comparison.extractedData.documentNumber || 'Номер не е намерен'} •
              {comparison.matchedExcelRow
                ? ` Ред ${comparison.matchedExcelRow} в Excel`
                : ' Не е намерен в Excel'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">
            {isScanned ? 'Ръчна проверка' : getStatusLabel(comparison.overallStatus)}
          </span>
          {isExpanded ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </div>
      </Button>

      {isExpanded && (
        <div className="border-t border-border/50 p-4 bg-background/50">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {comparison.fieldComparisons.map((field, fieldIdx) => {
              const isAmountField = field.fieldName === 'taxBase' || field.fieldName === 'vat';
              const displayPdfValue = isAmountField && showNegativeAmounts
                ? formatAmountValue(field.pdfValue, true)
                : field.pdfValue;
              const displayExcelValue = isAmountField && showNegativeAmounts
                ? formatAmountValue(field.excelValue, true)
                : field.excelValue;

              return (
                <div
                  key={fieldIdx}
                  className={cn(
                    'p-3 rounded-lg border',
                    field.status === 'match'
                      ? 'bg-emerald-50/50 dark:bg-emerald-950/10 border-emerald-200/50'
                      : field.status === 'suspicious'
                      ? 'bg-amber-50/50 dark:bg-amber-950/10 border-amber-200/50'
                      : 'bg-muted/30 border-border/50'
                  )}
                >
                  <p className="text-xs text-muted-foreground mb-1">
                    {field.fieldLabel}
                  </p>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <span className="text-xs text-muted-foreground">PDF:</span>
                      <p className={cn(
                        "font-medium truncate",
                        isAmountField && showNegativeAmounts && "text-rose-600 dark:text-rose-400"
                      )}>
                        {displayPdfValue || '-'}
                      </p>
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground">Excel:</span>
                      <p className={cn(
                        "font-medium truncate",
                        isAmountField && showNegativeAmounts && "text-rose-600 dark:text-rose-400"
                      )}>
                        {displayExcelValue || '-'}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function ExcelCheckItem({ check }: { check: ExcelInternalCheckResult }) {
  const isError = check.status === 'error';

  return (
    <div className={cn(
      'p-3 rounded-lg border',
      isError
        ? 'bg-red-50/50 dark:bg-red-950/10 border-red-200/50'
        : 'bg-amber-50/50 dark:bg-amber-950/10 border-amber-200/50'
    )}>
      <div className="flex items-start gap-2">
        {isError ? (
          <AlertCircle className="h-4 w-4 text-red-500 mt-0.5" />
        ) : (
          <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5" />
        )}
        <div className="flex-1">
          <p className="text-sm font-medium text-foreground">
            {check.description}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Документ: {check.documentNumber}
            {check.rowIndex > 0 && ` (Ред ${check.rowIndex})`}
          </p>
          <div className="mt-2 text-xs grid grid-cols-2 gap-2">
            <div>
              <span className="text-muted-foreground">Очаквано:</span>
              <span className="ml-1 font-medium">{check.expectedValue}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Реално:</span>
              <span className="ml-1 font-medium">{check.actualValue}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
