import { useState, useCallback } from 'react';
import { FileCheck, FileSpreadsheet, ArrowRight, Loader2, RefreshCw, AlertCircle, Download, Zap, Building2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FileUpload } from '@/components/FileUpload';
import { MultiImageUpload, UploadedFile } from '@/components/MultiImageUpload';
import { InvoiceComparisonResults } from '@/components/InvoiceComparisonResults';
import { parsePurchaseJournal } from '@/lib/purchaseJournalParser';
import { extractMultipleInvoices, runVerification, reExtractSuspiciousInvoices } from '@/lib/invoiceComparison';
import { InvoiceExcelRow, VerificationSummary } from '@/lib/invoiceComparisonTypes';
import { exportVerificationResults } from '@/lib/invoiceVerificationExport';
import { toast } from '@/hooks/use-toast';

// Storage key for persisting company IDs
const COMPANY_IDS_STORAGE_KEY = 'invoice_verification_company_ids';

export function InvoiceVerificationTab() {
  const [excelFile, setExcelFile] = useState<File | null>(null);
  const [excelArrayBuffer, setExcelArrayBuffer] = useState<ArrayBuffer | null>(null);
  const [excelData, setExcelData] = useState<InvoiceExcelRow[]>([]);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [extractionProgress, setExtractionProgress] = useState(0);
  const [currentFileName, setCurrentFileName] = useState<string>('');
  const [estimatedTimeLeft, setEstimatedTimeLeft] = useState<string>('');
  const [verificationResult, setVerificationResult] = useState<VerificationSummary | null>(null);
  // Company IDs to exclude - persisted to localStorage
  const [ownCompanyIds, setOwnCompanyIds] = useState<string>(() => {
    try {
      return localStorage.getItem(COMPANY_IDS_STORAGE_KEY) || '';
    } catch {
      return '';
    }
  });

  const handleExcelSelect = useCallback(async (file: File) => {
    setExcelFile(file);
    setVerificationResult(null);

    try {
      // Cache the ArrayBuffer now so export doesn't depend on a stale File reference
      const buffer = await file.arrayBuffer();
      setExcelArrayBuffer(buffer);
      const rows = await parsePurchaseJournal(file);
      setExcelData(rows);
      toast({
        title: 'Excel файл заредeн',
        description: `Намерени ${rows.length} реда с данни`,
      });
    } catch (error) {
      toast({
        title: 'Грешка при парсиране',
        description: (error as Error).message,
        variant: 'destructive',
      });
      setExcelFile(null);
      setExcelArrayBuffer(null);
      setExcelData([]);
    }
  }, []);

  const handleFilesChange = useCallback((newFiles: UploadedFile[]) => {
    setUploadedFiles(newFiles);
    setVerificationResult(null);
  }, []);

  // Handle company IDs change with persistence
  const handleCompanyIdsChange = useCallback((value: string) => {
    setOwnCompanyIds(value);
    try {
      localStorage.setItem(COMPANY_IDS_STORAGE_KEY, value);
    } catch {
      // Ignore localStorage errors
    }
  }, []);

  // Parse company IDs into array
  const parseCompanyIds = useCallback((): string[] => {
    return ownCompanyIds
      .split(/[,;]/)
      .map(id => id.trim())
      .filter(id => id.length > 0);
  }, [ownCompanyIds]);

  const handleVerify = async () => {
    if (uploadedFiles.length === 0) {
      toast({
        title: 'Качете файлове',
        description: 'Моля, качете поне една фактура (снимка или PDF)',
        variant: 'destructive',
      });
      return;
    }

    if (excelData.length === 0) {
      toast({
        title: 'Качете Excel файл',
        description: 'Моля, качете Excel файл с данни за сравнение',
        variant: 'destructive',
      });
      return;
    }

    setIsLoading(true);
    setIsExtracting(true);
    setExtractionProgress(0);

    try {
      // Get parsed company IDs for exclusion
      const companyIdsToExclude = parseCompanyIds();
      
      // Phase 1: Extract data from all files with Flash model
      let extractedInvoices = await extractMultipleInvoices(
        uploadedFiles,
        (completed, total, fileName) => {
          setExtractionProgress((completed / total) * 100);
          if (fileName) {
            setCurrentFileName(fileName);
          }
          // Estimate remaining time: ~5 seconds per file
          const remainingFiles = total - completed;
          const estimatedSeconds = remainingFiles * 5;
          if (estimatedSeconds >= 60) {
            const minutes = Math.ceil(estimatedSeconds / 60);
            setEstimatedTimeLeft(`~${minutes} мин.`);
          } else {
            setEstimatedTimeLeft(`~${estimatedSeconds} сек.`);
          }
        },
        companyIdsToExclude
      );

      setIsExtracting(false);

      // Phase 2: Run initial verification to identify suspicious and unreadable invoices
      let result = runVerification(extractedInvoices, excelData);

      // Phase 3: If there are suspicious or unreadable invoices, retry with Pro model
      const retryIndices = result.comparisons
        .filter(c => c.overallStatus === 'suspicious' || c.overallStatus === 'unreadable')
        .map(c => c.imageIndex);

      if (retryIndices.length > 0) {
        // Count how many will actually be retried (not already using Pro)
        const toRetryCount = retryIndices.filter(
          idx => !extractedInvoices[idx].usedProModel
        ).length;
        
        if (toRetryCount > 0) {
          setIsRetrying(true);
          setExtractionProgress(0);
          
          toast({
            title: 'Проверка на съмнителни и нечетливи',
            description: `Повторно извличане на ${toRetryCount} фактури с Pro модел...`,
          });

          extractedInvoices = await reExtractSuspiciousInvoices(
            retryIndices,
            uploadedFiles,
            extractedInvoices,
            result.comparisons,
            excelData,
            (completed, total, fileName) => {
              setExtractionProgress((completed / total) * 100);
              if (fileName) {
                setCurrentFileName(fileName);
              }
              // Pro is slower: ~10 seconds per file
              const remainingFiles = total - completed;
              const estimatedSeconds = remainingFiles * 10;
              if (estimatedSeconds >= 60) {
                const minutes = Math.ceil(estimatedSeconds / 60);
                setEstimatedTimeLeft(`~${minutes} мин.`);
              } else {
                setEstimatedTimeLeft(`~${estimatedSeconds} сек.`);
              }
            },
            companyIdsToExclude,
            (failedCount) => {
              toast({
                title: 'Проблем със сървъра на Gemini',
                description: `${failedCount} фактури не можаха да бъдат обработени поради претоварен сървър (503). Опитайте отново по-късно.`,
                variant: 'destructive',
              });
            }
          );
          
          setIsRetrying(false);
          
          // Re-run verification with updated extractions
          result = runVerification(extractedInvoices, excelData);
        }
      }

      setVerificationResult(result);
      
      // Count double-checked invoices
      const doubleCheckedCount = extractedInvoices.filter(e => e.wasDoubleChecked).length;

      toast({
        title: 'Сверката завърши',
        description: `${result.matchedCount} съвпадения, ${result.suspiciousCount} съмнителни${doubleCheckedCount > 0 ? ` (${doubleCheckedCount} проверени с Pro)` : ''}`,
      });
    } catch (error) {
      toast({
        title: 'Грешка при сверка',
        description: (error as Error).message,
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
      setIsExtracting(false);
      setIsRetrying(false);
      setCurrentFileName('');
      setEstimatedTimeLeft('');
    }
  };

  const handleClear = () => {
    setExcelFile(null);
    setExcelArrayBuffer(null);
    setExcelData([]);
    setUploadedFiles([]);
    setVerificationResult(null);
  };

  const handleExport = async () => {
    if (!excelFile || !excelArrayBuffer || !verificationResult) return;

    try {
      await exportVerificationResults(excelFile, verificationResult, excelArrayBuffer);
      toast({
        title: 'Файлът е експортиран',
        description: 'Excel файлът със статусите е изтеглен успешно',
      });
    } catch (error) {
      toast({
        title: 'Грешка при експорт',
        description: (error as Error).message,
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="bg-card rounded-2xl shadow-elevated border border-border overflow-hidden">
      {/* Company ID Configuration */}
      <div className="p-6 md:p-8 border-b border-border bg-muted/30">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-primary/10">
            <Building2 className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="font-serif font-semibold text-lg text-foreground">
              Настройки: Вашата фирма
            </h2>
            <p className="text-sm text-muted-foreground">
              Въведете ДДС номер/ЕИК на фирмата, която управлявате
            </p>
          </div>
        </div>
        
        <div className="space-y-2">
          <Label htmlFor="company-ids" className="text-sm text-muted-foreground">
            ДДС номер или ЕИК (разделете с запетая за няколко фирми)
          </Label>
          <Input
            id="company-ids"
            placeholder="напр. BG123456789, 987654321"
            value={ownCompanyIds}
            onChange={(e) => handleCompanyIdsChange(e.target.value)}
            disabled={isLoading}
            className="max-w-md"
          />
          <p className="text-xs text-muted-foreground">
            Тези идентификатори ще бъдат изключени при разпознаване на доставчика от фактурите
          </p>
        </div>
      </div>

      {/* Step 1: Upload Excel */}
      <div className="p-6 md:p-8 border-b border-border">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 rounded-lg bg-primary/10">
            <FileSpreadsheet className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="font-serif font-semibold text-lg text-foreground">
              Стъпка 1: Дневник на покупките
            </h2>
            <p className="text-sm text-muted-foreground">
              Качете Excel файл с данни за фактурите
            </p>
          </div>
        </div>

        {excelFile ? (
          <div className="flex items-center justify-between p-4 rounded-lg bg-muted/50 border border-border">
            <div className="flex items-center gap-3">
              <FileSpreadsheet className="h-5 w-5 text-emerald-500" />
              <div>
                <p className="font-medium text-foreground">{excelFile.name}</p>
                <p className="text-sm text-muted-foreground">
                  {excelData.length} реда с данни
                </p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setExcelFile(null);
                setExcelData([]);
                setVerificationResult(null);
              }}
              disabled={isLoading}
            >
              Смени
            </Button>
          </div>
        ) : (
          <FileUpload
            onFileSelect={handleExcelSelect}
            isLoading={false}
            selectedFile={null}
            onClear={() => {}}
          />
        )}
      </div>

      {/* Step 2: Upload Invoice Files */}
      <div className="p-6 md:p-8 border-b border-border">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 rounded-lg bg-primary/10">
            <FileCheck className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="font-serif font-semibold text-lg text-foreground">
              Стъпка 2: Фактури (снимки или PDF)
            </h2>
            <p className="text-sm text-muted-foreground">
              Качете до 10 файла за сверка
            </p>
          </div>
        </div>

        <MultiImageUpload
          files={uploadedFiles}
          onFilesChange={handleFilesChange}
          isLoading={isLoading}
          disabled={!excelFile}
        />

        {!excelFile && (
          <div className="mt-4 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800">
            <p className="text-sm text-amber-700 dark:text-amber-400 flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              Първо качете Excel файл
            </p>
          </div>
        )}
      </div>

      {/* Verify Button */}
      {excelFile && uploadedFiles.length > 0 && !verificationResult && (
        <div className="p-6 md:p-8 border-b border-border">
          {(isExtracting || isRetrying) ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {isRetrying ? (
                    <Zap className="h-5 w-5 text-amber-500 animate-pulse" />
                  ) : (
                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  )}
                  <div>
                    <p className="text-sm text-foreground font-medium">
                      {isRetrying 
                        ? `Проверка на съмнителни с Pro... (${Math.round(extractionProgress)}%)`
                        : `Извличане на данни... (${Math.round(extractionProgress)}%)`
                      }
                    </p>
                    {currentFileName && (
                      <p className="text-xs text-muted-foreground truncate max-w-[250px]">
                        {currentFileName}
                      </p>
                    )}
                  </div>
                </div>
                {estimatedTimeLeft && (
                  <span className="text-xs text-muted-foreground">
                    Оставащо: {estimatedTimeLeft}
                  </span>
                )}
              </div>
              <Progress value={extractionProgress} className="h-2" />
              <p className="text-xs text-muted-foreground text-center">
                {isRetrying 
                  ? 'Повторно извличане на съмнителни фактури с по-мощен модел'
                  : 'Обработва се бавно за гарантирана точност'
                }
              </p>
            </div>
          ) : (
            <Button
              onClick={handleVerify}
              disabled={isLoading}
              className="w-full gradient-primary text-primary-foreground gap-2"
              size="lg"
            >
              {isLoading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <ArrowRight className="h-5 w-5" />
              )}
              Сверка на данните
            </Button>
          )}
        </div>
      )}

      {/* Results */}
      {verificationResult && (
        <div className="p-6 md:p-8">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-accent/10">
                <ArrowRight className="h-5 w-5 text-accent" />
              </div>
              <h2 className="font-serif font-semibold text-lg text-foreground">
                Резултати от сверката
              </h2>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="default"
                size="sm"
                onClick={handleExport}
                className="gap-2"
              >
                <Download className="h-4 w-4" />
                <span className="hidden sm:inline">Експорт</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleClear}
                className="gap-2"
              >
                <RefreshCw className="h-4 w-4" />
                <span className="hidden sm:inline">Нова сверка</span>
              </Button>
            </div>
          </div>

          <InvoiceComparisonResults summary={verificationResult} />
        </div>
      )}

      {/* Empty state */}
      {!excelFile && uploadedFiles.length === 0 && !verificationResult && (
        <div className="p-6 md:p-8 text-center">
          <div className="py-8">
            <p className="text-muted-foreground">
              Качете Excel файл и фактури (снимки или PDF), за да започнете сверката
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
