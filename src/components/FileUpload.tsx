import { useCallback, useState } from 'react';
import { Upload, FileSpreadsheet, FileText, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { UPLOAD_CONFIG } from '@/config/constants';

interface FileUploadProps {
  onFileSelect: (file: File) => void;
  isLoading?: boolean;
  selectedFile?: File | null;
  onClear?: () => void;
}

// Magic bytes for file type validation
const FILE_SIGNATURES: Record<string, number[][]> = {
  pdf: [[0x25, 0x50, 0x44, 0x46]], // %PDF
  xlsx: [[0x50, 0x4B, 0x03, 0x04]], // PK.. (ZIP format)
  xls: [[0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]], // OLE2
};

export function FileUpload({ onFileSelect, isLoading, selectedFile, onClear }: FileUploadProps) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const file = e.dataTransfer.files[0];
    if (file && await isValidFile(file)) {
      onFileSelect(file);
    }
  }, [onFileSelect]);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && await isValidFile(file)) {
      onFileSelect(file);
    }
  }, [onFileSelect]);

  const isValidFile = async (file: File): Promise<boolean> => {
    // Check file size first
    if (file.size > UPLOAD_CONFIG.maxFileSizeSingle) {
      return false;
    }

    const validTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'application/pdf',
    ];
    const validExtensions = ['.xlsx', '.xls', '.pdf'];
    
    const typeOrExtensionValid = validTypes.includes(file.type) || 
           validExtensions.some(ext => file.name.toLowerCase().endsWith(ext));

    if (!typeOrExtensionValid) return false;

    // Validate magic bytes for additional security
    try {
      const buffer = await file.slice(0, 8).arrayBuffer();
      const bytes = new Uint8Array(buffer);
      
      const extension = file.name.toLowerCase().split('.').pop();
      const signatures = FILE_SIGNATURES[extension || ''] || [];
      
      if (signatures.length === 0) return typeOrExtensionValid;
      
      return signatures.some(sig => 
        sig.every((byte, i) => bytes[i] === byte)
      );
    } catch {
      // If magic byte check fails, fall back to type/extension check
      return typeOrExtensionValid;
    }
  };

  const getFileIcon = (fileName: string) => {
    if (fileName.toLowerCase().endsWith('.pdf')) {
      return <FileText className="h-8 w-8 text-destructive" />;
    }
    return <FileSpreadsheet className="h-8 w-8 text-accent" />;
  };

  if (selectedFile) {
    return (
      <div className="relative overflow-hidden rounded-xl border-2 border-primary/30 bg-primary/5 p-6 transition-all animate-scale-in">
        <div className="flex items-center gap-4">
          {getFileIcon(selectedFile.name)}
          <div className="flex-1 min-w-0">
            <p className="font-medium text-foreground truncate">{selectedFile.name}</p>
            <p className="text-sm text-muted-foreground">
              {(selectedFile.size / 1024).toFixed(1)} KB
            </p>
          </div>
          {!isLoading && onClear && (
            <button
              onClick={onClear}
              className="p-2 rounded-full hover:bg-muted transition-colors"
              aria-label="Премахни файл"
            >
              <X className="h-5 w-5 text-muted-foreground" />
            </button>
          )}
        </div>
        {isLoading && (
          <div className="mt-4">
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div className="h-full gradient-primary animate-pulse w-full" />
            </div>
            <p className="text-sm text-muted-foreground mt-2 text-center">Обработка на файла...</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={cn(
        "relative overflow-hidden rounded-xl border-2 border-dashed p-12 transition-all duration-300 cursor-pointer group",
        isDragging 
          ? "border-primary bg-primary/10 scale-[1.02]" 
          : "border-border hover:border-primary/50 hover:bg-muted/50"
      )}
    >
      <input
        type="file"
        accept=".xlsx,.xls,.pdf"
        onChange={handleFileChange}
        className="absolute inset-0 opacity-0 cursor-pointer"
        aria-label="Качване на файл"
      />
      
      <div className="flex flex-col items-center gap-4 text-center">
        <div className={cn(
          "p-4 rounded-full transition-all duration-300",
          isDragging 
            ? "gradient-primary text-primary-foreground scale-110" 
            : "bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary"
        )}>
          <Upload className="h-8 w-8" />
        </div>
        
        <div>
          <p className="font-medium text-foreground">
            {isDragging ? 'Пуснете файла тук' : 'Плъзнете файл или кликнете тук'}
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            Поддържани формати: XLSX, XLS, PDF
          </p>
        </div>
      </div>
    </div>
  );
}
