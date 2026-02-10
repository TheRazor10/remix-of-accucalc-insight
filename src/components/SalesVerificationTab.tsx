import { useState, useCallback } from 'react';
import { FileCheck, FileSpreadsheet, ArrowRight, Loader2, RefreshCw, AlertCircle, Download, AlertTriangle, CheckCircle2, ScanLine, Building2, FileStack, ChevronUp, ChevronDown, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { FileUpload } from '@/components/FileUpload';
import { parseSalesJournal } from '@/lib/salesJournalParser';
import { extractMultiplePdfInvoices, extractMultipleScannedPdfs } from '@/lib/pdfTextExtractor';
import { runSalesVerification, runExcelToExcelComparison } from '@/lib/salesComparison';
import { SalesExcelRow, SalesVerificationSummary, SalesJournalParseResult, ExtractedSalesPdfData, ExcelToExcelSummary } from '@/lib/salesComparisonTypes';
import { parseMultipleIssuedDocs } from '@/lib/issuedDocsParser';
import { SalesComparisonResults } from '@/components/SalesComparisonResults';
import { exportSalesVerificationResults, exportExcelToExcelResults } from '@/lib/salesVerificationExport';
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
  const [secondaryExcelFiles, setSecondaryExcelFiles] = useState<File[]>([]);
  const [excelComparisonResult, setExcelComparisonResult] = useState<ExcelToExcelSummary | null>(null);
  const [isComparingExcel, setIsComparingExcel] = useState(false);
  const [showExportWarning, setShowExportWarning] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

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

      const result = runSalesVerification(allExtractedPdfs, excelData, effectiveFirmVatId);
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
    setSecondaryExcelFiles([]);
    setExcelComparisonResult(null);
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

      {/* Step 2c: Upload Secondary Excel Files (optional) */}
      <div className="p-6 md:p-8 border-b border-border">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 rounded-lg bg-violet-500/10">
            <FileStack className="h-5 w-5 text-violet-500" />
          </div>
          <div>
            <h2 className="font-serif font-semibold text-lg text-foreground">
              Стъпка 2в: Справка издадени документи
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
            disabled={isLoading || isComparingExcel || !excelFile}
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

      {/* Verify Button */}
      {excelFile && (pdfFiles.length > 0 || scannedPdfFiles.length > 0) && !verificationResult && (
        <div className="p-6 md:p-8 border-b border-border">
          {isExtracting ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {extractionPhase === 'scanned' ? (
                    <ScanLine className="h-5 w-5 animate-pulse text-orange-500" />
                  ) : (
                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  )}
                  <div>
                    <p className="text-sm text-foreground font-medium">
                      {extractionPhase === 'scanned'
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

  const handleExport = () => {
    exportExcelToExcelResults(summary);
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
