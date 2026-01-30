import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '@/components/Header';
import { FileUpload } from '@/components/FileUpload';
import { ResultsDisplay } from '@/components/ResultsDisplay';
import { TradingResultsDisplay } from '@/components/TradingResultsDisplay';
import { ExportDialog } from '@/components/ExportDialog';
import { FileHistory } from '@/components/FileHistory';
import { InvoiceVerificationTab } from '@/components/InvoiceVerificationTab';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { parseExcelFile, parsePdfFile } from '@/lib/fileParser';
import { calculateFinancials } from '@/lib/calculator';
import { processTrading212Statement } from '@/lib/tradingStatementParser';
import { CalculationResult } from '@/lib/calculationTypes';
import { TradingStatementResult } from '@/lib/tradingStatementTypes';
import { Download, RefreshCw, FileCheck, ArrowRight, Loader2, TrendingUp, Calculator, History, FileSearch } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useFileHistory } from '@/hooks/useFileHistory';

const Index = () => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<CalculationResult | null>(null);
  const [tradingResult, setTradingResult] = useState<TradingStatementResult | null>(null);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'accounting' | 'trading' | 'invoice'>('accounting');
  const [showHistory, setShowHistory] = useState(false);
  const { user, isLoading: authLoading, isApproved, profile } = useAuth();
  const navigate = useNavigate();
  const { history, isLoading: historyLoading, saveToHistory, deleteFromHistory } = useFileHistory();

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/auth');
    } else if (!authLoading && user && profile && !isApproved) {
      navigate('/pending');
    }
  }, [user, authLoading, isApproved, profile, navigate]);

  // Handler for accounting files
  const handleAccountingFileSelect = useCallback(async (file: File) => {
    setSelectedFile(file);
    setIsLoading(true);
    setResult(null);

    try {
      let accountData;
      let title = '';
      let period = '';
      const fileType = file.name.toLowerCase().endsWith('.pdf') ? 'pdf' : 'xlsx';
      
      if (fileType === 'pdf') {
        accountData = await parsePdfFile(file);
      } else {
        const parsed = await parseExcelFile(file);
        accountData = parsed.rows;
        title = parsed.title;
        period = parsed.period;
      }

      if (accountData.length === 0) {
        throw new Error('Не бяха намерени данни за сметки във файла');
      }

      const calculationResult = calculateFinancials(accountData);
      calculationResult.title = title;
      calculationResult.period = period;
      setResult(calculationResult);
      
      // Save to history
      saveToHistory(file.name, fileType, title, calculationResult);
      
      toast({
        title: 'Успешно обработване',
        description: `Обработени ${accountData.length} сметки`,
      });
    } catch (error) {
      toast({
        title: 'Грешка',
        description: (error as Error).message,
        variant: 'destructive',
      });
      setSelectedFile(null);
    } finally {
      setIsLoading(false);
    }
  }, [saveToHistory]);

  // Handler for loading from history
  const handleHistorySelect = useCallback((historyResult: CalculationResult, fileName: string) => {
    setResult(historyResult);
    setShowHistory(false);
    toast({
      title: 'Заредено от историята',
      description: fileName,
    });
  }, []);

  // Handler for Trading 212 statements
  const handleTradingFileSelect = useCallback(async (file: File) => {
    setSelectedFile(file);
    setIsLoading(true);
    setTradingResult(null);

    try {
      const statementResult = await processTrading212Statement(file);
      setTradingResult(statementResult);
      
      toast({
        title: 'Успешно обработване',
        description: `Намерени ${statementResult.summary.totalSellTransactions} продажби`,
      });
    } catch (error) {
      toast({
        title: 'Грешка',
        description: (error as Error).message,
        variant: 'destructive',
      });
      setSelectedFile(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleClear = useCallback(() => {
    setSelectedFile(null);
    setResult(null);
    setTradingResult(null);
  }, []);

  if (authLoading) {
    return (
      <div className="min-h-screen gradient-hero flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    // Show loading while redirecting
    return (
      <div className="min-h-screen gradient-hero flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen gradient-hero">
      <Header />
      
      <main className="container mx-auto px-4 py-12">
        {/* Hero Section */}
        <section className="text-center mb-12 animate-fade-in">
          <h1 className="font-serif text-4xl md:text-5xl font-bold text-foreground mb-4">
            Финансов <span className="text-gradient">Калкулатор</span>
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Обработете оборотни ведомости или Trading 212 отчети с автоматично 
            изчисление и конвертиране на валути.
          </p>
        </section>

        {/* Tabs for different features */}
        <div className="max-w-4xl mx-auto">
          <Tabs value={activeTab} onValueChange={(v) => {
            setActiveTab(v as 'accounting' | 'trading' | 'invoice');
            handleClear();
          }}>
            <TabsList className="grid w-full grid-cols-3 mb-6">
              <TabsTrigger value="accounting" className="gap-2">
                <Calculator className="h-4 w-4" />
                <span className="hidden sm:inline">Оборотна ведомост</span>
                <span className="sm:hidden">Ведомост</span>
              </TabsTrigger>
              <TabsTrigger value="trading" className="gap-2">
                <TrendingUp className="h-4 w-4" />
                Trading 212
              </TabsTrigger>
              <TabsTrigger value="invoice" className="gap-2">
                <FileSearch className="h-4 w-4" />
                <span className="hidden sm:inline">Сверка фактури</span>
                <span className="sm:hidden">Сверка</span>
              </TabsTrigger>
            </TabsList>

            {/* Accounting Tab */}
            <TabsContent value="accounting">
              <div className="bg-card rounded-2xl shadow-elevated border border-border overflow-hidden">
                {/* Upload Section */}
                <div className="p-6 md:p-8 border-b border-border">
                  <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-primary/10">
                        <FileCheck className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <h2 className="font-serif font-semibold text-lg text-foreground">
                          Качване на оборотна ведомост
                        </h2>
                        <p className="text-sm text-muted-foreground">
                          Поддържаме Excel и PDF формат
                        </p>
                      </div>
                    </div>
                    
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowHistory(!showHistory)}
                      className="gap-2"
                    >
                      <History className="h-4 w-4" />
                      <span className="hidden sm:inline">История</span>
                    </Button>
                  </div>
                  
                  {showHistory ? (
                    <FileHistory
                      history={history}
                      isLoading={historyLoading}
                      onSelect={handleHistorySelect}
                      onDelete={deleteFromHistory}
                    />
                  ) : (
                    <FileUpload
                      onFileSelect={handleAccountingFileSelect}
                      isLoading={isLoading}
                      selectedFile={selectedFile}
                      onClear={handleClear}
                    />
                  )}
                </div>

                {/* Results Section */}
                {result && (
                  <div className="p-6 md:p-8">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                      <div className="flex items-start gap-3">
                        <div className="p-2 rounded-lg bg-accent/10 shrink-0">
                          <ArrowRight className="h-5 w-5 text-accent" />
                        </div>
                        <div>
                          <h2 className="font-serif font-semibold text-lg text-foreground">
                            Резултати
                          </h2>
                          {(result.title || result.period) && (
                            <div className="mt-1">
                              {result.title && (
                                <p className="text-sm text-muted-foreground">
                                  {result.title}
                                </p>
                              )}
                              {result.period && (
                                <p className="text-xs text-muted-foreground mt-0.5">
                                  {result.period}
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleClear}
                          className="gap-2"
                        >
                          <RefreshCw className="h-4 w-4" />
                          <span className="hidden sm:inline">Нов файл</span>
                        </Button>
                        
                        <Button
                          size="sm"
                          onClick={() => setIsExportOpen(true)}
                          className="gradient-primary text-primary-foreground gap-2 hover:opacity-90"
                        >
                          <Download className="h-4 w-4" />
                          <span className="hidden sm:inline">Експорт</span>
                        </Button>
                      </div>
                    </div>
                    
                    <ResultsDisplay result={result} />
                  </div>
                )}

                {/* Empty state */}
                {!selectedFile && !result && (
                  <div className="p-6 md:p-8 text-center">
                    <div className="py-8">
                      <p className="text-muted-foreground">
                        Качете файл, за да видите резултатите
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </TabsContent>

            {/* Trading 212 Tab */}
            <TabsContent value="trading">
              <div className="bg-card rounded-2xl shadow-elevated border border-border overflow-hidden">
                {/* Upload Section */}
                <div className="p-6 md:p-8 border-b border-border">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="p-2 rounded-lg bg-primary/10">
                      <TrendingUp className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <h2 className="font-serif font-semibold text-lg text-foreground">
                        Trading 212 месечен отчет
                      </h2>
                      <p className="text-sm text-muted-foreground">
                        Качете PDF отчет за конвертиране на печалби/загуби
                      </p>
                    </div>
                  </div>
                  
                  <FileUpload
                    onFileSelect={handleTradingFileSelect}
                    isLoading={isLoading}
                    selectedFile={selectedFile}
                    onClear={handleClear}
                  />
                </div>

                {/* Results Section */}
                {tradingResult && (
                  <div className="p-6 md:p-8">
                    <div className="flex items-center justify-between mb-6">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-accent/10">
                          <ArrowRight className="h-5 w-5 text-accent" />
                        </div>
                        <h2 className="font-serif font-semibold text-lg text-foreground">
                          Конвертирани резултати
                        </h2>
                      </div>
                      
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleClear}
                        className="gap-2"
                      >
                        <RefreshCw className="h-4 w-4" />
                        <span className="hidden sm:inline">Нов файл</span>
                      </Button>
                    </div>
                    
                    <TradingResultsDisplay result={tradingResult} />
                  </div>
                )}

                {/* Empty state */}
                {!selectedFile && !tradingResult && (
                  <div className="p-6 md:p-8 text-center">
                    <div className="py-8">
                      <p className="text-muted-foreground">
                        Качете Trading 212 месечен отчет (PDF), за да конвертирате печалби/загуби в BGN и EUR
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </TabsContent>

            {/* Invoice Verification Tab */}
            <TabsContent value="invoice">
              <InvoiceVerificationTab />
            </TabsContent>
          </Tabs>
        </div>
      </main>

      {/* Export Dialog */}
      {result && (
        <ExportDialog
          result={result}
          isOpen={isExportOpen}
          onClose={() => setIsExportOpen(false)}
        />
      )}
    </div>
  );
};

export default Index;
