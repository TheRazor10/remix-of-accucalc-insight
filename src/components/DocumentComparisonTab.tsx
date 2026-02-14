import { useState, useCallback } from 'react';
import { FileCheck, FileStack, FileSpreadsheet, ArrowRight, Loader2, AlertCircle, Download, AlertTriangle, CheckCircle2, ChevronUp, ChevronDown, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { parseSalesJournal } from '@/lib/salesJournalParser';
import { runExcelToExcelComparison } from '@/lib/salesComparison';
import { SalesExcelRow, SalesJournalParseResult, ExcelToExcelSummary } from '@/lib/salesComparisonTypes';
import { parseMultipleIssuedDocs } from '@/lib/issuedDocsParser';
import { exportExcelToExcelResults } from '@/lib/salesVerificationExport';
import { toast } from '@/hooks/use-toast';

export function DocumentComparisonTab() {
  // Sales journal state (needed for Справка comparison)
  const [excelFile, setExcelFile] = useState<File | null>(null);
  const [excelData, setExcelData] = useState<SalesExcelRow[]>([]);
  const [firmVatId, setFirmVatId] = useState<string | null>(null);

  // Secondary Excel (Справка) state
  const [secondaryExcelFiles, setSecondaryExcelFiles] = useState<File[]>([]);
  const [excelComparisonResult, setExcelComparisonResult] = useState<ExcelToExcelSummary | null>(null);
  const [isComparingExcel, setIsComparingExcel] = useState(false);

  const handleExcelSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setExcelFile(file);
    setExcelComparisonResult(null);

    try {
      const result = await parseSalesJournal(file);
      setExcelData(result.rows);
      setFirmVatId(result.firmVatId);
      toast({
        title: 'Excel файл зареден',
        description: `Намерени ${result.rows.length} реда. ИН по ДДС: ${result.firmVatId || 'Не е намерен'}`,
      });
    } catch (error) {
      toast({
        title: 'Грешка при зареждане',
        description: (error as Error).message,
        variant: 'destructive',
      });
      setExcelFile(null);
      setExcelData([]);
      setFirmVatId(null);
    }
  }, []);

  const handleSecondaryExcelChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const excelOnly = files.filter(f =>
      f.name.endsWith('.xlsx') || f.name.endsWith('.xls') || f.name.endsWith('.csv') ||
      f.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      f.type === 'application/vnd.ms-excel'
    );

    if (excelOnly.length !== files.length) {
      toast({
        title: 'Някои файлове бяха пропуснати',
        description: 'Само Excel файлове (.xlsx/.xls) се приемат',
        variant: 'destructive',
      });
    }

    setSecondaryExcelFiles(excelOnly);
    setExcelComparisonResult(null);
  }, []);

  const handleExcelComparison = async () => {
    if (secondaryExcelFiles.length === 0 || excelData.length === 0) return;

    setIsComparingExcel(true);
    try {
      const issuedDocRows = await parseMultipleIssuedDocs(secondaryExcelFiles);
      const result = runExcelToExcelComparison(excelData, issuedDocRows);
      setExcelComparisonResult(result);

      toast({
        title: 'Сравнението приключи',
        description: `${result.matchedCount} съвпадения, ${result.mismatchCount} разлики, ${result.onlyInMainCount} само в дневника, ${result.onlyInSecondaryCount} само в справката`,
      });
    } catch (error) {
      toast({
        title: 'Грешка при сравнение',
        description: (error as Error).message,
        variant: 'destructive',
      });
    } finally {
      setIsComparingExcel(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
      {/* Step 1: Upload Sales Journal Excel */}
      <div className="p-6 md:p-8 border-b border-border">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 rounded-lg bg-primary/10">
            <FileSpreadsheet className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="font-serif font-semibold text-lg text-foreground">
              Стъпка 1: Дневник за продажби
            </h2>
            <p className="text-sm text-muted-foreground">
              Качете Excel файл с дневника за продажби
            </p>
          </div>
        </div>

        <input
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={handleExcelSelect}
          disabled={isComparingExcel}
          className="block w-full text-sm text-muted-foreground
            file:mr-4 file:py-2 file:px-4
            file:rounded-lg file:border-0
            file:text-sm file:font-medium
            file:bg-primary file:text-primary-foreground
            hover:file:bg-primary/90
            disabled:opacity-50"
        />

        {excelFile && (
          <div className="mt-3 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800">
            <p className="text-sm text-foreground flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4 text-emerald-500" />
              {excelFile.name} — {excelData.length} реда
            </p>
            {firmVatId && (
              <p className="text-xs text-muted-foreground mt-1">
                ИН по ДДС: {firmVatId}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Step 2: Placeholder for specific PDF type (coming soon) */}
      <div className="p-6 md:p-8 border-b border-border opacity-50">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 rounded-lg bg-cyan-500/10">
            <FileCheck className="h-5 w-5 text-cyan-500" />
          </div>
          <div>
            <h2 className="font-serif font-semibold text-lg text-foreground">
              Стъпка 2: Специални PDF документи
              <span className="text-sm font-normal text-muted-foreground ml-2">(очаквайте скоро)</span>
            </h2>
            <p className="text-sm text-muted-foreground">
              Тази функционалност е в процес на разработка
            </p>
          </div>
        </div>
      </div>

      {/* Step 3: Upload Secondary Excel Files (Справка) */}
      <div className="p-6 md:p-8 border-b border-border">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 rounded-lg bg-violet-500/10">
            <FileStack className="h-5 w-5 text-violet-500" />
          </div>
          <div>
            <h2 className="font-serif font-semibold text-lg text-foreground">
              Стъпка 3: Справка издадени документи
              <span className="text-sm font-normal text-muted-foreground ml-2">(по избор)</span>
            </h2>
            <p className="text-sm text-muted-foreground">
              Качете един или повече Excel файла за кръстосана проверка с дневника
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            multiple
            onChange={handleSecondaryExcelChange}
            disabled={isComparingExcel || !excelFile}
            className="block w-full text-sm text-muted-foreground
              file:mr-4 file:py-2 file:px-4
              file:rounded-lg file:border-0
              file:text-sm file:font-medium
              file:bg-violet-500 file:text-white
              hover:file:bg-violet-600
              disabled:opacity-50"
          />

          {secondaryExcelFiles.length > 0 && (
            <div className="p-3 rounded-lg bg-violet-50 dark:bg-violet-950/20 border border-violet-200 dark:border-violet-800">
              <p className="text-sm text-foreground flex items-center gap-2">
                <FileStack className="h-4 w-4 text-violet-500" />
                {secondaryExcelFiles.length} файл(а) избрани
              </p>
              <div className="mt-2">
                {secondaryExcelFiles.map((file, idx) => (
                  <p key={idx} className="text-xs text-muted-foreground truncate">
                    {file.name}
                  </p>
                ))}
              </div>
            </div>
          )}

          {secondaryExcelFiles.length > 0 && excelData.length > 0 && !excelComparisonResult && (
            <Button
              onClick={handleExcelComparison}
              disabled={isComparingExcel}
              className="w-full bg-violet-500 hover:bg-violet-600 text-white gap-2"
              size="lg"
            >
              {isComparingExcel ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <ArrowRight className="h-5 w-5" />
              )}
              Сравни с дневника
            </Button>
          )}

          {excelComparisonResult && (
            <ExcelToExcelResults summary={excelComparisonResult} />
          )}
        </div>

        {!excelFile && (
          <div className="mt-4 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800">
            <p className="text-sm text-amber-700 dark:text-amber-400 flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              Първо качете Excel файл (Стъпка 1)
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Excel-to-Excel Results Component ───────────────────────────────────────

function ExcelToExcelResults({ summary }: { summary: ExcelToExcelSummary }) {
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [showOnlyInMain, setShowOnlyInMain] = useState(false);
  const [showOnlyInSecondary, setShowOnlyInSecondary] = useState(false);
  const [showMatched, setShowMatched] = useState(false);
  const [showIndividuals, setShowIndividuals] = useState(false);

  const toggleExpanded = (key: string) => {
    const next = new Set(expandedItems);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setExpandedItems(next);
  };

  const matched = summary.comparisons.filter(c => c.overallStatus === 'match');
  const mismatched = summary.comparisons.filter(c => c.overallStatus === 'mismatch');
  const individuals = summary.comparisons.filter(c => c.overallStatus === 'individual');
  const onlyMain = summary.comparisons.filter(c => c.overallStatus === 'only_in_main');
  const onlySecondary = summary.comparisons.filter(c => c.overallStatus === 'only_in_secondary');

  const fieldStatusClasses = (status: string) => {
    switch (status) {
      case 'match': return 'bg-emerald-50/50 dark:bg-emerald-950/10 border-emerald-200/50';
      case 'mismatch': return 'bg-amber-50/50 dark:bg-amber-950/10 border-amber-200/50';
      case 'individual': return 'bg-blue-50/50 dark:bg-blue-950/10 border-blue-200/50';
      default: return 'bg-muted/30 border-border/50';
    }
  };

  const renderExpandableRow = (item: typeof summary.comparisons[0], key: string, borderColor: string, hoverColor: string, icon: React.ReactNode) => {
    const isExpanded = expandedItems.has(key);
    return (
      <div key={key} className={cn('border rounded-lg overflow-hidden', borderColor)}>
        <button
          className={cn('w-full flex items-center justify-between p-3 text-left', hoverColor)}
          onClick={() => toggleExpanded(key)}
        >
          <div className="flex items-center gap-2">
            {icon}
            <span className="text-sm font-medium">{item.documentNumber}</span>
            <span className="text-xs text-muted-foreground">Ред {item.mainExcelRow}</span>
          </div>
          {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        {isExpanded && item.fieldComparisons.length > 0 && (
          <div className="border-t border-border/30 p-3 bg-background/50 grid grid-cols-1 md:grid-cols-2 gap-3">
            {item.fieldComparisons.map((field, fIdx) => (
              <div key={fIdx} className={cn('p-2 rounded border text-sm', fieldStatusClasses(field.status))}>
                <p className="text-xs text-muted-foreground">
                  {field.fieldLabel}
                  {field.status === 'individual' && (
                    <span className="ml-1 text-blue-500">(физ. лице)</span>
                  )}
                </p>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  <div>
                    <span className="text-xs text-muted-foreground">Дневник:</span>
                    <p className="font-medium truncate">{field.mainValue || '-'}</p>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">Справка:</span>
                    <p className="font-medium truncate">{field.secondaryValue || '-'}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const handleExport = async () => {
    await exportExcelToExcelResults(summary);
  };

  return (
    <div className="space-y-4 mt-4">
      {/* Export button */}
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={handleExport} className="gap-2">
          <Download className="h-4 w-4" />
          Експорт
        </Button>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 text-center">
          <p className="text-xs text-emerald-700 dark:text-emerald-400">Съвпадения</p>
          <p className="text-xl font-bold text-emerald-600">{summary.matchedCount}</p>
        </div>
        <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 text-center">
          <p className="text-xs text-amber-700 dark:text-amber-400">Разлики</p>
          <p className="text-xl font-bold text-amber-600">{summary.mismatchCount}</p>
        </div>
        {summary.individualCount > 0 && (
          <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 text-center">
            <p className="text-xs text-blue-700 dark:text-blue-400">Физ. лица</p>
            <p className="text-xl font-bold text-blue-600">{summary.individualCount}</p>
          </div>
        )}
        <div className="p-3 rounded-lg bg-sky-50 dark:bg-sky-950/20 border border-sky-200 dark:border-sky-800 text-center">
          <p className="text-xs text-sky-700 dark:text-sky-400">Само в дневник</p>
          <p className="text-xl font-bold text-sky-600">{summary.onlyInMainCount}</p>
        </div>
        <div className="p-3 rounded-lg bg-violet-50 dark:bg-violet-950/20 border border-violet-200 dark:border-violet-800 text-center">
          <p className="text-xs text-violet-700 dark:text-violet-400">Само в справка</p>
          <p className="text-xl font-bold text-violet-600">{summary.onlyInSecondaryCount}</p>
        </div>
      </div>

      {/* Mismatches (show first, most important) */}
      {mismatched.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-amber-700 dark:text-amber-400">
            Разлики ({mismatched.length})
          </h4>
          {mismatched.map((item, idx) =>
            renderExpandableRow(
              item,
              `mismatch-${idx}`,
              'border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/10',
              'hover:bg-amber-100/50 dark:hover:bg-amber-900/20',
              <AlertTriangle className="h-4 w-4 text-amber-500" />
            )
          )}
        </div>
      )}

      {/* Individuals */}
      {individuals.length > 0 && (
        <div>
          <button
            className="flex items-center gap-2 text-sm font-medium text-blue-700 dark:text-blue-400 hover:underline"
            onClick={() => setShowIndividuals(!showIndividuals)}
          >
            {showIndividuals ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            <User className="h-4 w-4" />
            Физически лица ({individuals.length})
          </button>
          {showIndividuals && (
            <div className="mt-2 space-y-2">
              {individuals.map((item, idx) =>
                renderExpandableRow(
                  item,
                  `individual-${idx}`,
                  'border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/10',
                  'hover:bg-blue-100/50 dark:hover:bg-blue-900/20',
                  <User className="h-4 w-4 text-blue-500" />
                )
              )}
            </div>
          )}
        </div>
      )}

      {/* Only in main */}
      {onlyMain.length > 0 && (
        <div>
          <button
            className="flex items-center gap-2 text-sm font-medium text-sky-700 dark:text-sky-400 hover:underline"
            onClick={() => setShowOnlyInMain(!showOnlyInMain)}
          >
            {showOnlyInMain ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            Само в дневника ({onlyMain.length})
          </button>
          {showOnlyInMain && (
            <div className="mt-2 space-y-1">
              {onlyMain.map((item, idx) => (
                <div key={idx} className="text-sm p-2 rounded bg-sky-50/50 dark:bg-sky-950/10 border border-sky-200/50 dark:border-sky-800/50">
                  <span className="font-medium">{item.documentNumber}</span>
                  <span className="text-muted-foreground ml-2">Ред {item.mainExcelRow}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Only in secondary */}
      {onlySecondary.length > 0 && (
        <div>
          <button
            className="flex items-center gap-2 text-sm font-medium text-violet-700 dark:text-violet-400 hover:underline"
            onClick={() => setShowOnlyInSecondary(!showOnlyInSecondary)}
          >
            {showOnlyInSecondary ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            Само в справката ({onlySecondary.length})
          </button>
          {showOnlyInSecondary && (
            <div className="mt-2 space-y-1">
              {onlySecondary.map((item, idx) => (
                <div key={idx} className="text-sm p-2 rounded bg-violet-50/50 dark:bg-violet-950/10 border border-violet-200/50 dark:border-violet-800/50">
                  <span className="font-medium">{item.documentNumber}</span>
                  {item.secondarySource && (
                    <span className="text-muted-foreground ml-2">от {item.secondarySource}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Matched rows (expandable) */}
      {matched.length > 0 && (
        <div>
          <button
            className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-400 hover:underline"
            onClick={() => setShowMatched(!showMatched)}
          >
            {showMatched ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            <CheckCircle2 className="h-4 w-4" />
            Съвпадения ({matched.length})
          </button>
          {showMatched && (
            <div className="mt-2 space-y-2">
              {matched.map((item, idx) =>
                renderExpandableRow(
                  item,
                  `match-${idx}`,
                  'border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/10',
                  'hover:bg-emerald-100/50 dark:hover:bg-emerald-900/20',
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                )
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
