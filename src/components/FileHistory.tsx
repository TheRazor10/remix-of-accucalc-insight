import { FileHistoryItem } from '@/hooks/useFileHistory';
import { CalculationResult } from '@/lib/calculationTypes';
import { History, FileSpreadsheet, Trash2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

interface FileHistoryProps {
  history: FileHistoryItem[];
  isLoading: boolean;
  onSelect: (result: CalculationResult, fileName: string) => void;
  onDelete: (id: string) => void;
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('bg-BG', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatCurrency(value: number): string {
  return value.toLocaleString('bg-BG', { 
    minimumFractionDigits: 2, 
    maximumFractionDigits: 2 
  }) + ' лв.';
}

export function FileHistory({ history, isLoading, onSelect, onDelete }: FileHistoryProps) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (history.length === 0) {
    return (
      <div className="text-center py-8">
        <History className="h-10 w-10 text-muted-foreground mx-auto mb-3 opacity-50" />
        <p className="text-sm text-muted-foreground">Няма записана история</p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-[400px]">
      <div className="space-y-2 pr-4">
        {history.map((item) => {
          const profit = item.results.приходи - item.results.разходи;
          const isProfitable = profit >= 0;
          
          return (
            <div
              key={item.id}
              className="group relative bg-muted/30 hover:bg-muted/50 rounded-lg p-3 transition-colors cursor-pointer border border-transparent hover:border-border"
              onClick={() => onSelect(item.results, item.file_name)}
            >
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-md bg-primary/10 shrink-0">
                  <FileSpreadsheet className="h-4 w-4 text-primary" />
                </div>
                
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm text-foreground truncate">
                    {item.file_name}
                  </p>
                  {item.title && (
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {item.title}
                    </p>
                  )}
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-xs text-muted-foreground">
                      {formatDate(item.created_at)}
                    </span>
                    <span className={cn(
                      "text-xs font-medium",
                      isProfitable ? "text-accent" : "text-destructive"
                    )}>
                      {isProfitable ? '+' : ''}{formatCurrency(profit)}
                    </span>
                  </div>
                </div>
                
                <Button
                  variant="ghost"
                  size="icon"
                  className="opacity-0 group-hover:opacity-100 transition-opacity h-8 w-8 shrink-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(item.id);
                  }}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}
