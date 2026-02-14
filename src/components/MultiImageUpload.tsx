import { useState, useCallback, useRef, useEffect } from 'react';
import { Upload, X, Image as ImageIcon, Loader2, FileText, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { UPLOAD_CONFIG } from '@/config/constants';
import * as pdfjsLib from 'pdfjs-dist';

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];

export interface UploadedFile {
  originalFile: File;
  previewUrl: string;
  imageBlob: Blob; // For sending to OCR (converted from PDF if needed)
  isPdf: boolean;
  lastPageBlob?: Blob; // Last page blob for multi-page PDFs (for merging OCR data)
  pageCount?: number; // Total pages in PDF
}

interface MultiImageUploadProps {
  files: UploadedFile[];
  onFilesChange: (files: UploadedFile[]) => void;
  isLoading?: boolean;
  disabled?: boolean;
}

interface ProcessingProgress {
  current: number;
  total: number;
  currentFileName: string;
}

/**
 * Render a specific PDF page to image blob with proper memory management
 */
async function renderPdfPage(
  pdf: pdfjsLib.PDFDocumentProxy,
  pageNumber: number
): Promise<Blob> {
  const page = await pdf.getPage(pageNumber);
  
  const scale = 2; // Good balance of quality vs memory
  const viewport = page.getViewport({ scale });
  
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d')!;
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  
  // Fill with white background to prevent transparency issues (black images)
  context.fillStyle = '#FFFFFF';
  context.fillRect(0, 0, canvas.width, canvas.height);
  
  await page.render({
    canvasContext: context,
    viewport: viewport,
    canvas: canvas,
  }).promise;
  
  // Clean up page resources
  page.cleanup();
  
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      // Clear canvas to free memory
      canvas.width = 0;
      canvas.height = 0;
      
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('Failed to create blob from canvas'));
      }
    }, 'image/jpeg', 0.85);
  });
}

/**
 * Convert PDF to image blobs (first page, and last page if multi-page)
 */
async function pdfToImages(pdfFile: File): Promise<{
  firstPageBlob: Blob;
  lastPageBlob: Blob | undefined;
  previewUrl: string;
  pageCount: number;
}> {
  const arrayBuffer = await pdfFile.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pageCount = pdf.numPages;
  
  try {
    // Render first page
    const firstPageBlob = await renderPdfPage(pdf, 1);
    
    // Create preview from first page
    const previewUrl = URL.createObjectURL(firstPageBlob);
    
    // Render last page only if PDF has multiple pages
    let lastPageBlob: Blob | undefined;
    if (pageCount > 1) {
      lastPageBlob = await renderPdfPage(pdf, pageCount);
    }
    
    return { firstPageBlob, lastPageBlob, previewUrl, pageCount };
  } finally {
    // Clean up PDF resources
    await pdf.destroy();
  }
}

/**
 * Small delay to allow garbage collection between chunks
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Number of items to display per page for virtualization
const ITEMS_PER_PAGE = 50;

export function MultiImageUpload({
  files,
  onFilesChange,
  isLoading = false,
  disabled = false,
}: MultiImageUploadProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<ProcessingProgress | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const abortRef = useRef(false);

  // Calculate pagination values
  const totalPages = Math.ceil(files.length / ITEMS_PER_PAGE);
  const startIndex = currentPage * ITEMS_PER_PAGE;
  const endIndex = Math.min(startIndex + ITEMS_PER_PAGE, files.length);
  const visibleFiles = files.slice(startIndex, endIndex);

  // Reset to last valid page when files are removed
  useEffect(() => {
    if (currentPage >= totalPages && totalPages > 0) {
      setCurrentPage(totalPages - 1);
    }
  }, [files.length, currentPage, totalPages]);

  // Revoke all blob object URLs on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      for (const file of files) {
        if (file.previewUrl?.startsWith('blob:')) {
          URL.revokeObjectURL(file.previewUrl);
        }
      }
    };
  }, [files]);

  const validateFile = (file: File): string | null => {
    const isImage = ACCEPTED_IMAGE_TYPES.includes(file.type);
    const isPdf = file.type === UPLOAD_CONFIG.acceptedPdfType;

    if (!isImage && !isPdf) {
      return `${file.name}: Невалиден формат. Поддържаме JPG, PNG, WEBP и PDF.`;
    }
    if (file.size > UPLOAD_CONFIG.maxFileSizeMulti) {
      return `${file.name}: Файлът е твърде голям (макс. 20MB).`;
    }
    return null;
  };

  const processFile = async (file: File): Promise<UploadedFile | null> => {
    try {
      if (file.type === UPLOAD_CONFIG.acceptedPdfType) {
        // Convert PDF to image(s) - first page and last page if multi-page
        const { firstPageBlob, lastPageBlob, previewUrl, pageCount } = await pdfToImages(file);
        return {
          originalFile: file,
          previewUrl,
          imageBlob: firstPageBlob,
          isPdf: true,
          lastPageBlob,
          pageCount,
        };
      } else {
        // Regular image
        const previewUrl = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target?.result as string);
          reader.readAsDataURL(file);
        });
        return {
          originalFile: file,
          previewUrl,
          imageBlob: file,
          isPdf: false,
        };
      }
    } catch (error) {
      console.error('Error processing file:', file.name, error);
      return null;
    }
  };

  /**
   * Process files in chunks to prevent memory overload
   */
  const processFilesInChunks = async (
    validFiles: File[],
    existingFiles: UploadedFile[]
  ): Promise<UploadedFile[]> => {
    const allProcessed: UploadedFile[] = [...existingFiles];
    const total = validFiles.length;
    
    for (let i = 0; i < validFiles.length; i += UPLOAD_CONFIG.chunkSize) {
      if (abortRef.current) break;

      const chunk = validFiles.slice(i, i + UPLOAD_CONFIG.chunkSize);

      // Update progress
      setProgress({
        current: i,
        total,
        currentFileName: chunk[0]?.name || '',
      });

      // Process chunk in parallel (small batch)
      const chunkResults = await Promise.all(chunk.map(processFile));
      const successfulFiles = chunkResults.filter((f): f is UploadedFile => f !== null);

      // Add to results immediately so user sees progress
      allProcessed.push(...successfulFiles);
      onFilesChange([...allProcessed]);

      // Small delay between chunks to allow GC and prevent UI freeze
      if (i + UPLOAD_CONFIG.chunkSize < validFiles.length) {
        await delay(100);
      }
    }
    
    setProgress({ current: total, total, currentFileName: '' });
    return allProcessed;
  };

  const handleFiles = useCallback(async (fileList: FileList | File[]) => {
    const fileArray = Array.from(fileList);
    const remainingSlots = UPLOAD_CONFIG.maxFiles - files.length;

    if (fileArray.length > remainingSlots) {
      alert(`Можете да качите още ${remainingSlots} файла (макс. ${UPLOAD_CONFIG.maxFiles}).`);
    }
    
    const filesToAdd = fileArray.slice(0, remainingSlots);
    const errors: string[] = [];
    const validFiles: File[] = [];
    
    for (const file of filesToAdd) {
      const error = validateFile(file);
      if (error) {
        errors.push(error);
      } else {
        validFiles.push(file);
      }
    }
    
    if (errors.length > 0 && errors.length <= 5) {
      alert(errors.join('\n'));
    } else if (errors.length > 5) {
      alert(`${errors.length} файла са невалидни и няма да бъдат качени.`);
    }
    
    if (validFiles.length > 0) {
      setIsProcessing(true);
      abortRef.current = false;
      setProgress({ current: 0, total: validFiles.length, currentFileName: validFiles[0]?.name || '' });
      
      try {
        await processFilesInChunks(validFiles, files);
      } finally {
        setIsProcessing(false);
        setProgress(null);
      }
    }
  }, [files, onFilesChange]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!disabled && !isLoading && !isProcessing) {
      setIsDragOver(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (!disabled && !isLoading && !isProcessing && e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFiles(e.target.files);
    }
    e.target.value = '';
  };

  const removeFile = (index: number) => {
    const removed = files[index];
    // Revoke object URL to free memory (only for blob URLs, not data URLs)
    if (removed?.previewUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(removed.previewUrl);
    }
    onFilesChange(files.filter((_, i) => i !== index));
  };

  const isLoadingState = isLoading || isProcessing;

  return (
    <div className="space-y-4">
      {/* Pagination controls for large file lists */}
      {files.length > ITEMS_PER_PAGE && (
        <div className="flex items-center justify-between bg-muted/50 rounded-lg p-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
            disabled={currentPage === 0}
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            Предишни
          </Button>
          <span className="text-sm text-muted-foreground">
            Показване {startIndex + 1}-{endIndex} от {files.length} файла (стр. {currentPage + 1}/{totalPages})
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))}
            disabled={currentPage >= totalPages - 1}
          >
            Следващи
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      )}

      {/* File Grid */}
      {files.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
          {visibleFiles.map((file, localIndex) => {
            const actualIndex = startIndex + localIndex;
            return (
              <div
                key={file.originalFile.name + file.originalFile.size + actualIndex}
                className="relative aspect-square rounded-lg overflow-hidden border border-border bg-muted/30 group"
              >
                <img
                  src={file.previewUrl}
                  alt={file.originalFile.name}
                  className="w-full h-full object-cover"
                />

                {/* PDF indicator */}
                {file.isPdf && (
                  <div className="absolute top-1 left-1 p-1 rounded bg-primary/90">
                    <FileText className="h-3 w-3 text-primary-foreground" />
                  </div>
                )}

                {/* Overlay with file name */}
                <div className="absolute inset-x-0 bottom-0 bg-black/60 px-2 py-1">
                  <p className="text-xs text-white truncate">{file.originalFile.name}</p>
                </div>

                {/* Remove button */}
                {!isLoadingState && !disabled && (
                  <button
                    onClick={() => removeFile(actualIndex)}
                    className="absolute top-1 right-1 p-1 rounded-full bg-destructive text-destructive-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                    aria-label={`Премахни ${file.originalFile.name}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}

                {/* Loading overlay */}
                {isLoadingState && (
                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                    <Loader2 className="h-6 w-6 animate-spin text-white" />
                  </div>
                )}
              </div>
            );
          })}

          {/* Add more button - only show on last page or when no pagination needed */}
          {(totalPages <= 1 || currentPage === totalPages - 1) && files.length < UPLOAD_CONFIG.maxFiles && !isLoadingState && !disabled && (
            <label
              className={cn(
                "aspect-square rounded-lg border-2 border-dashed border-border",
                "flex flex-col items-center justify-center gap-2 cursor-pointer",
                "hover:border-primary hover:bg-primary/5 transition-colors"
              )}
            >
              <Upload className="h-6 w-6 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Добави</span>
              <input
                type="file"
                accept={[...ACCEPTED_IMAGE_TYPES, UPLOAD_CONFIG.acceptedPdfType].join(',')}
                multiple
                onChange={handleInputChange}
                className="hidden"
              />
            </label>
          )}
        </div>
      )}
      
      {/* Drag and drop area when no files */}
      {files.length === 0 && !isProcessing && (
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={cn(
            "border-2 border-dashed rounded-xl p-8 text-center transition-all",
            isDragOver && "border-primary bg-primary/5 scale-[1.02]",
            !isDragOver && "border-border hover:border-primary/50",
            (disabled || isLoadingState) && "opacity-50 cursor-not-allowed"
          )}
        >
          <div className="flex flex-col items-center gap-4">
            <div className={cn(
              "p-4 rounded-full transition-colors",
              isDragOver ? "bg-primary/10" : "bg-muted"
            )}>
              <ImageIcon className={cn(
                "h-8 w-8",
                isDragOver ? "text-primary" : "text-muted-foreground"
              )} />
            </div>
            
            <div>
              <p className="font-medium text-foreground">
                Качете фактури
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                Плъзнете файлове тук или кликнете за избор
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                JPG, PNG, WEBP, PDF • Макс. {UPLOAD_CONFIG.maxFiles} файла • До 20MB всеки
              </p>
            </div>
            
            <label>
              <Button
                type="button"
                variant="outline"
                disabled={disabled || isLoadingState}
                className="cursor-pointer"
                asChild
              >
                <span>
                  <Upload className="h-4 w-4 mr-2" />
                  Изберете файлове
                </span>
              </Button>
              <input
                type="file"
                accept={[...ACCEPTED_IMAGE_TYPES, UPLOAD_CONFIG.acceptedPdfType].join(',')}
                multiple
                onChange={handleInputChange}
                className="hidden"
                disabled={disabled || isLoadingState}
              />
            </label>
          </div>
        </div>
      )}
      
      {/* Processing indicator when uploading with no existing files */}
      {files.length === 0 && isProcessing && progress && (
        <div className="border-2 border-dashed rounded-xl p-8 text-center border-primary/50 bg-primary/5">
          <div className="flex flex-col items-center gap-4">
            <div className="p-4 rounded-full bg-primary/10">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
            <div className="w-full max-w-xs">
              <p className="font-medium text-foreground mb-2">
                Обработка на файлове...
              </p>
              <Progress value={(progress.current / progress.total) * 100} className="h-2" />
              <p className="text-xs text-muted-foreground mt-2">
                {progress.current} от {progress.total} файла
              </p>
              {progress.currentFileName && (
                <p className="text-xs text-muted-foreground truncate mt-1">
                  {progress.currentFileName}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
      
      {/* Counter */}
      {files.length > 0 && (
        <div className="text-center space-y-2">
          {isProcessing && progress && (
            <div className="max-w-xs mx-auto">
              <Progress value={(progress.current / progress.total) * 100} className="h-2" />
              <p className="text-xs text-muted-foreground mt-1">
                Обработка: {progress.current} от {progress.total}
              </p>
            </div>
          )}
          <p className="text-sm text-muted-foreground">
            {files.length} от {UPLOAD_CONFIG.maxFiles} файла
          </p>
        </div>
      )}
    </div>
  );
}
