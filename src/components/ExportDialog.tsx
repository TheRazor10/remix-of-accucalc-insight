import { useState } from 'react';
import { FileSpreadsheet, FileText, Download, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CalculationResult, ExportFormat } from '@/lib/calculationTypes';
import { exportResults } from '@/lib/exporter';
import { cn } from '@/lib/utils';

interface ExportDialogProps {
  result: CalculationResult;
  isOpen: boolean;
  onClose: () => void;
}

export function ExportDialog({ result, isOpen, onClose }: ExportDialogProps) {
  const [selectedFormat, setSelectedFormat] = useState<ExportFormat>('xlsx');
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async () => {
    setIsExporting(true);
    
    try {
      // Use the title from the parsed file, or fallback to default
      const fileName = result.title 
        ? result.title.replace(/[/\\?%*:|"<>]/g, '_').trim()
        : `Финансов_отчет_${new Date().toISOString().split('T')[0]}`;
      
      await exportResults(result, selectedFormat, fileName);
    } catch (error) {
      console.error('Export error:', error);
    } finally {
      setIsExporting(false);
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div 
        className="absolute inset-0 bg-foreground/20 backdrop-blur-sm"
        onClick={onClose}
      />
      
      <div className="relative bg-card rounded-2xl shadow-elevated border border-border p-6 w-full max-w-md animate-scale-in">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 rounded-full hover:bg-muted transition-colors"
          aria-label="Затвори"
        >
          <X className="h-5 w-5 text-muted-foreground" />
        </button>
        
        <h2 className="text-xl font-serif font-semibold text-foreground mb-2">
          Експортиране на отчет
        </h2>
        <p className="text-sm text-muted-foreground mb-6">
          Изберете формат за експортиране на финансовия отчет
        </p>
        
        <div className="grid grid-cols-2 gap-4 mb-6">
          <button
            onClick={() => setSelectedFormat('xlsx')}
            className={cn(
              "p-4 rounded-xl border-2 transition-all duration-200 flex flex-col items-center gap-3",
              selectedFormat === 'xlsx'
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/50"
            )}
          >
            <div className={cn(
              "p-3 rounded-lg transition-colors",
              selectedFormat === 'xlsx' ? "bg-accent/20" : "bg-muted"
            )}>
              <FileSpreadsheet className={cn(
                "h-8 w-8",
                selectedFormat === 'xlsx' ? "text-accent" : "text-muted-foreground"
              )} />
            </div>
            <div className="text-center">
              <p className="font-medium text-foreground">Excel</p>
              <p className="text-xs text-muted-foreground">.xlsx</p>
            </div>
          </button>
          
          <button
            onClick={() => setSelectedFormat('pdf')}
            className={cn(
              "p-4 rounded-xl border-2 transition-all duration-200 flex flex-col items-center gap-3",
              selectedFormat === 'pdf'
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/50"
            )}
          >
            <div className={cn(
              "p-3 rounded-lg transition-colors",
              selectedFormat === 'pdf' ? "bg-destructive/20" : "bg-muted"
            )}>
              <FileText className={cn(
                "h-8 w-8",
                selectedFormat === 'pdf' ? "text-destructive" : "text-muted-foreground"
              )} />
            </div>
            <div className="text-center">
              <p className="font-medium text-foreground">PDF</p>
              <p className="text-xs text-muted-foreground">.pdf</p>
            </div>
          </button>
        </div>
        
        <Button
          onClick={handleExport}
          disabled={isExporting}
          className="w-full gradient-primary text-primary-foreground hover:opacity-90 transition-opacity"
          size="lg"
        >
          {isExporting ? (
            <span className="flex items-center gap-2">
              <span className="h-4 w-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
              Експортиране...
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <Download className="h-4 w-4" />
              Изтегли {selectedFormat.toUpperCase()}
            </span>
          )}
        </Button>
      </div>
    </div>
  );
}
