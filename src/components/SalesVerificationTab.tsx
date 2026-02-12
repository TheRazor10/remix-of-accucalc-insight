import { useState, useCallback } from 'react';
import { FileCheck, FileSpreadsheet, ArrowRight, Loader2, RefreshCw, AlertCircle, Download, AlertTriangle, CheckCircle2, ScanLine, Building2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { FileUpload } from '@/components/FileUpload';
import { parseSalesJournal } from '@/lib/salesJournalParser';
import { extractMultiplePdfInvoices, extractMultipleScannedPdfs } from '@/lib/pdfTextExtractor';
import { runSalesVerification, reExtractSuspiciousSalesInvoices } from '@/lib/salesComparison';
import { SalesExcelRow, SalesVerificationSummary, ExtractedSalesPdfData } from '@/lib/salesComparisonTypes';
import { SalesComparisonResults } from '@/components/SalesComparisonResults';
import { exportSalesVerificationResults } from '@/lib/salesVerificationExport';
import { toast } from '@/hooks/use-toast';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export function SalesVerificationTab() {
  const [excelFile, setExcelFile] = useState<File | null>(null);
  const [excelData, setExcelData] = useState<SalesExcelRow[]>([]);
  const [firmVatId, setFirmVatId] = useState<string | null>(null);
  const [supplierIdInput, setSupplierIdInput] = useState<string>('');
  const [pdfFiles, setPdfFiles] = useState<File[]>([]);
  const [scannedPdfFiles, setScannedPdfFiles] = useState<File[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractionProgress, setExtractionProgress] = useState(0);
  const [currentFileName, setCurrentFileName] = useState<string>('');
  const [extractionPhase, setExtractionPhase] = useState<'native' | 'scanned'>('native');
  const [verificationResult, setVerificationResult] = useState<SalesVerificationSummary | null>(null);
  const [showExportWarning, setShowExportWarning] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);

  const handleExport = async () => {
    if (!excelFile || !verificationResult) return;

    setIsExporting(true);
    try {
      await exportSalesVerificationResults(excelFile, verificationResult);
      toast({
        title: 'Експортирано успешно',
        description: 'Файлът е изтеглен',
      });
    } catch (error) {
      toast({
        title: 'Грешка при експортиране',
        description: (error as Error).message,
        variant: 'destructive',
      });
    } finally {
      setIsExporting(false);
      setShowExportWarning(false);
    }
  };

  const handleExcelSelect = useCallback(async (file: File) => {
    setExcelFile(file);
    setVerificationResult(null);

    try {
      const result = await parseSalesJournal(file);
      setExcelData(result.rows);
      setFirmVatId(result.firmVatId);
      toast({
        title: 'Excel file loaded',
        description: `Found ${result.rows.length} data rows. Firm VAT ID: ${result.firmVatId || 'Not found'}`,
      });
    } catch (error) {
      toast({
        title: 'Parsing error',
        description: (error as Error).message,
        variant: 'destructive',
      });
      setExcelFile(null);
      setExcelData([]);
      setFirmVatId(null);
    }
  }, []);

  const handlePdfFilesChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const pdfOnly = files.filter(f => f.type === 'application/pdf');

    if (pdfOnly.length !== files.length) {
      toast({
        title: 'Някои файлове бяха пропуснати',
        description: 'Само PDF файлове се приемат',
        variant: 'destructive',
      });
    }

    setPdfFiles(pdfOnly);
    setVerificationResult(null);
  }, []);

  const handleScannedPdfFilesChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const pdfOnly = files.filter(f => f.type === 'application/pdf');

    if (pdfOnly.length !== files.length) {
      toast({
        title: 'Някои файлове бяха пропуснати',
        description: 'Само PDF файлове се приемат',
        variant: 'destructive',
      });
    }

    setScannedPdfFiles(pdfOnly);
    setVerificationResult(null);
  }, []);

  const handleVerify = async () => {
    if (pdfFiles.length === 0 && scannedPdfFiles.length === 0) {
      toast({
        title: 'Качете PDF файлове',
        description: 'Моля качете поне една фактура (PDF)',
        variant: 'destructive',
      });
      return;
    }

    if (excelData.length === 0) {
      toast({
        title: 'Качете Excel файл',
        description: 'Моля качете Excel файл с данни за сравнение',
        variant: 'destructive',
      });
      return;
    }

    setIsLoading(true);
    setIsExtracting(true);
    setExtractionProgress(0);

    try {
      let allExtractedPdfs: ExtractedSalesPdfData[] = [];
      const totalFiles = pdfFiles.length + scannedPdfFiles.length;

      // Determine effective firm VAT ID for extraction disambiguation
      const effectiveFirmVatId = supplierIdInput.trim() || firmVatId;

      // Phase 1: Extract native PDFs
      if (pdfFiles.length > 0) {
        setExtractionPhase('native');
        const nativeExtracted = await extractMultiplePdfInvoices(
          pdfFiles,
          (completed, total, fileName) => {
            const overallProgress = (completed / totalFiles) * 100;
            setExtractionProgress(overallProgress);
            if (fileName) {
              setCurrentFileName(fileName);
            }
          },
          effectiveFirmVatId
        );
        allExtractedPdfs = [...nativeExtracted];
      }

      // Phase 2: Extract scanned PDFs via OCR
      if (scannedPdfFiles.length > 0) {
        setExtractionPhase('scanned');
        const scannedExtracted = await extractMultipleScannedPdfs(
          scannedPdfFiles,
          pdfFiles.length, // Start index after native PDFs
          (completed, total, fileName) => {
            const overallProgress = ((pdfFiles.length + completed) / totalFiles) * 100;
            setExtractionProgress(overallProgress);
            if (fileName) {
              setCurrentFileName(fileName);
            }
          },
          effectiveFirmVatId
        );
        allExtractedPdfs = [...allExtractedPdfs, ...scannedExtracted];
      }

      setIsExtracting(false);

      // Phase 3: Run initial verification
      let result = runSalesVerification(allExtractedPdfs, excelData, effectiveFirmVatId);

      // Phase 4: Re-extract suspicious/not-found scanned invoices with Pro model
      if (scannedPdfFiles.length > 0) {
        const retryIndices = result.comparisons
          .filter(c => c.overallStatus === 'suspicious' || c.overallStatus === 'not_found')
          .map(c => c.extractedData.pdfIndex);

        const toRetryCount = retryIndices.filter(
          idx => allExtractedPdfs[idx]?.extractionMethod === 'ocr' && !allExtractedPdfs[idx]?.usedProModel
        ).length;

        if (toRetryCount > 0) {
          setIsRetrying(true);
          setExtractionProgress(0);

          toast({
            title: 'Проверка на съмнителни',
            description: `Повторно извличане на ${toRetryCount} фактури с Pro модел...`,
          });

          allExtractedPdfs = await reExtractSuspiciousSalesInvoices(
            retryIndices,
            scannedPdfFiles,
            pdfFiles.length,
            allExtractedPdfs,
            result.comparisons,
            excelData,
            effectiveFirmVatId,
            (completed, total, fileName) => {
              setExtractionProgress((completed / total) * 100);
              if (fileName) setCurrentFileName(fileName);
            },
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
          result = runSalesVerification(allExtractedPdfs, excelData, effectiveFirmVatId);
        }
      }

      setVerificationResult(result);

      const scannedCount = scannedPdfFiles.length;
      toast({
        title: 'Сверката приключи',
        description: `${result.matchedCount} съвпадения, ${result.suspiciousCount} съмнителни${scannedCount > 0 ? `, ${scannedCount} сканирани` : ''}`,
      });
    } catch (error) {
      toast({
        title: 'Грешка при сверката',
        description: (error as Error).message,
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
      setIsExtracting(false);
      setIsRetrying(false);
      setCurrentFileName('');
      setExtractionPhase('native');
    }
  };

  const handleClear = () => {
    setExcelFile(null);
    setExcelData([]);
    setSupplierIdInput('');
    setPdfFiles([]);
    setScannedPdfFiles([]);
    setVerificationResult(null);
  };

  return (
    <div className="bg-card rounded-2xl shadow-elevated border border-border overflow-hidden">
      {/* Step 1: Upload Excel */}
      <div className="p-6 md:p-8 border-b border-border">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 rounded-lg bg-primary/10">
            <FileSpreadsheet className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="font-serif font-semibold text-lg text-foreground">
              Стъпка 1: Дневник на продажбите
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

      {/* Supplier ID Input */}
      <div className="p-6 md:p-8 border-b border-border">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-primary/10">
            <Building2 className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="font-serif font-semibold text-lg text-foreground">
              ИН по ЗДДС на доставчика
            </h2>
            <p className="text-sm text-muted-foreground">
              Вашият ДДС номер (доставчик / продавач)
              {firmVatId && (
                <span className="ml-1 text-emerald-600 dark:text-emerald-400">
                  — от Excel: {firmVatId}
                </span>
              )}
            </p>
          </div>
        </div>

        <input
          type="text"
          value={supplierIdInput}
          onChange={(e) => setSupplierIdInput(e.target.value)}
          placeholder={firmVatId || 'BG123456789'}
          disabled={isLoading}
          className="w-full px-4 py-2.5 rounded-lg border border-border bg-background text-foreground
            placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50
            disabled:opacity-50 text-sm"
        />
        {!supplierIdInput && firmVatId && (
          <p className="mt-2 text-xs text-muted-foreground">
            Ще се използва автоматично откритият: {firmVatId}
          </p>
        )}
      </div>

      {/* Step 2a: Upload Native PDF Files */}
      <div className="p-6 md:p-8 border-b border-border">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 rounded-lg bg-primary/10">
            <FileCheck className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="font-serif font-semibold text-lg text-foreground">
              Стъпка 2а: Нативни PDF фактури
            </h2>
            <p className="text-sm text-muted-foreground">
              PDF файлове с текстов слой (генерирани от софтуер)
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <input
            type="file"
            accept=".pdf"
            multiple
            onChange={handlePdfFilesChange}
            disabled={isLoading || !excelFile}
            className="block w-full text-sm text-muted-foreground
              file:mr-4 file:py-2 file:px-4
              file:rounded-lg file:border-0
              file:text-sm file:font-medium
              file:bg-primary file:text-primary-foreground
              hover:file:bg-primary/90
              disabled:opacity-50"
          />

          {pdfFiles.length > 0 && (
            <div className="p-3 rounded-lg bg-muted/50 border border-border">
              <p className="text-sm text-foreground">
                {pdfFiles.length} PDF файла избрани
              </p>
              <div className="mt-2 max-h-32 overflow-y-auto">
                {pdfFiles.slice(0, 5).map((file, idx) => (
                  <p key={idx} className="text-xs text-muted-foreground truncate">
                    {file.name}
                  </p>
                ))}
                {pdfFiles.length > 5 && (
                  <p className="text-xs text-muted-foreground">
                    ... и още {pdfFiles.length - 5} файла
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        {!excelFile && (
          <div className="mt-4 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800">
            <p className="text-sm text-amber-700 dark:text-amber-400 flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              Първо качете Excel файл
            </p>
          </div>
        )}
      </div>

      {/* Step 2b: Upload Scanned PDF Files (OCR) */}
      <div className="p-6 md:p-8 border-b border-border">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 rounded-lg bg-orange-500/10">
            <ScanLine className="h-5 w-5 text-orange-500" />
          </div>
          <div>
            <h2 className="font-serif font-semibold text-lg text-foreground">
              Стъпка 2б: Сканирани PDF фактури
            </h2>
            <p className="text-sm text-muted-foreground">
              PDF файлове от скенер (ще се обработят с OCR)
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <input
            type="file"
            accept=".pdf"
            multiple
            onChange={handleScannedPdfFilesChange}
            disabled={isLoading || !excelFile}
            className="block w-full text-sm text-muted-foreground
              file:mr-4 file:py-2 file:px-4
              file:rounded-lg file:border-0
              file:text-sm file:font-medium
              file:bg-orange-500 file:text-white
              hover:file:bg-orange-600
              disabled:opacity-50"
          />

          {scannedPdfFiles.length > 0 && (
            <div className="p-3 rounded-lg bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-800">
              <p className="text-sm text-foreground flex items-center gap-2">
                <ScanLine className="h-4 w-4 text-orange-500" />
                {scannedPdfFiles.length} сканирани PDF файла (OCR)
              </p>
              <div className="mt-2 max-h-32 overflow-y-auto">
                {scannedPdfFiles.slice(0, 5).map((file, idx) => (
                  <p key={idx} className="text-xs text-muted-foreground truncate">
                    {file.name}
                  </p>
                ))}
                {scannedPdfFiles.length > 5 && (
                  <p className="text-xs text-muted-foreground">
                    ... и още {scannedPdfFiles.length - 5} файла
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

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
      {excelFile && (pdfFiles.length > 0 || scannedPdfFiles.length > 0) && !verificationResult && (
        <div className="p-6 md:p-8 border-b border-border">
          {(isExtracting || isRetrying) ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {isRetrying ? (
                    <RefreshCw className="h-5 w-5 animate-spin text-amber-500" />
                  ) : extractionPhase === 'scanned' ? (
                    <ScanLine className="h-5 w-5 animate-pulse text-orange-500" />
                  ) : (
                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  )}
                  <div>
                    <p className="text-sm text-foreground font-medium">
                      {isRetrying
                        ? `Pro модел: повторно извличане... (${Math.round(extractionProgress)}%)`
                        : extractionPhase === 'scanned'
                          ? `OCR обработка на сканирани PDF... (${Math.round(extractionProgress)}%)`
                          : `Извличане от нативни PDF... (${Math.round(extractionProgress)}%)`
                      }
                    </p>
                    {currentFileName && (
                      <p className="text-xs text-muted-foreground truncate max-w-[250px]">
                        {currentFileName}
                      </p>
                    )}
                  </div>
                </div>
              </div>
              <Progress value={extractionProgress} className="h-2" />
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
                variant="outline"
                size="sm"
                onClick={() => setShowExportWarning(true)}
                className="gap-2"
                disabled={isExporting}
              >
                {isExporting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
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

          {/* Summary stats */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
            <div className="p-4 rounded-lg bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800">
              <div className="flex items-center gap-2 mb-1">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                <span className="text-sm text-emerald-700 dark:text-emerald-400">Съвпадения</span>
              </div>
              <p className="text-2xl font-bold text-emerald-600">{verificationResult.matchedCount}</p>
            </div>

            <div className="p-4 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800">
              <div className="flex items-center gap-2 mb-1">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                <span className="text-sm text-amber-700 dark:text-amber-400">Съмнителни</span>
              </div>
              <p className="text-2xl font-bold text-amber-600">{verificationResult.suspiciousCount}</p>
            </div>

            <div className="p-4 rounded-lg bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-800">
              <div className="flex items-center gap-2 mb-1">
                <ScanLine className="h-4 w-4 text-orange-600" />
                <span className="text-sm text-orange-700 dark:text-orange-400">Сканирани</span>
              </div>
              <p className="text-2xl font-bold text-orange-600">
                {verificationResult.comparisons.filter(c => c.extractedData.extractionMethod === 'ocr').length}
              </p>
            </div>

            <div className="p-4 rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800">
              <div className="flex items-center gap-2 mb-1">
                <AlertCircle className="h-4 w-4 text-red-600" />
                <span className="text-sm text-red-700 dark:text-red-400">Грешки Excel</span>
              </div>
              <p className="text-2xl font-bold text-red-600">{verificationResult.excelCheckErrors}</p>
            </div>

            <div className="p-4 rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800">
              <div className="flex items-center gap-2 mb-1">
                <FileSpreadsheet className="h-4 w-4 text-blue-600" />
                <span className="text-sm text-blue-700 dark:text-blue-400">Липсващи PDF</span>
              </div>
              <p className="text-2xl font-bold text-blue-600">{verificationResult.missingPdfCount}</p>
            </div>

            {verificationResult.failedExtractionCount > 0 && (
              <div className="p-4 rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800">
                <div className="flex items-center gap-2 mb-1">
                  <AlertCircle className="h-4 w-4 text-red-600" />
                  <span className="text-sm text-red-700 dark:text-red-400">Неуспешни PDF</span>
                </div>
                <p className="text-2xl font-bold text-red-600">{verificationResult.failedExtractionCount}</p>
              </div>
            )}
          </div>

          <SalesComparisonResults summary={verificationResult} />
        </div>
      )}

      {/* Empty state */}
      {!excelFile && pdfFiles.length === 0 && scannedPdfFiles.length === 0 && !verificationResult && (
        <div className="p-6 md:p-8 text-center">
          <div className="py-8">
            <p className="text-muted-foreground">
              Качете Excel файл и PDF фактури, за да започнете сверката
            </p>
          </div>
        </div>
      )}

      {/* Export Warning Dialog */}
      <AlertDialog open={showExportWarning} onOpenChange={setShowExportWarning}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Внимание преди експортиране
            </AlertDialogTitle>
            <AlertDialogDescription className="text-base">
              Провери протоколите за ДДС и отчет на касов апарат
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отказ</AlertDialogCancel>
            <AlertDialogAction onClick={handleExport} disabled={isExporting}>
              {isExporting ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Download className="h-4 w-4 mr-2" />
              )}
              Продължи с експорта
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
