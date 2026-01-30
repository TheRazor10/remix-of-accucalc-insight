import { CalculationResult, AccountDetail } from '@/lib/calculationTypes';
import { TrendingUp, TrendingDown, Wallet, CreditCard, ChevronDown, ChevronUp, Banknote } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';

interface ResultsDisplayProps {
  result: CalculationResult;
}

function formatCurrency(value: number): string {
  return value.toLocaleString('bg-BG', { 
    minimumFractionDigits: 2, 
    maximumFractionDigits: 2 
  }) + ' лв.';
}

interface ResultCardProps {
  title: string;
  value: number;
  icon: React.ReactNode;
  details: AccountDetail[];
  colorClass: string;
  delay: number;
}

function ResultCard({ title, value, icon, details, colorClass, delay }: ResultCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div 
      className={cn(
        "bg-card rounded-xl shadow-card border border-border overflow-hidden opacity-0 animate-fade-in",
      )}
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="p-6">
        <div className="flex items-start justify-between mb-4">
          <div className={cn("p-3 rounded-lg", colorClass)}>
            {icon}
          </div>
          {details.length > 0 && (
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground"
              aria-label={isExpanded ? 'Скрий детайли' : 'Покажи детайли'}
            >
              {isExpanded ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
            </button>
          )}
        </div>
        
        <h3 className="text-sm font-medium text-muted-foreground mb-1">{title}</h3>
        <p className="text-2xl font-semibold text-foreground">{formatCurrency(value)}</p>
        
        {details.length > 0 && (
          <p className="text-xs text-muted-foreground mt-2">
            {details.length} сметки
          </p>
        )}
      </div>
      
      {isExpanded && details.length > 0 && (
        <div className="border-t border-border bg-muted/30 p-4 animate-fade-in">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground">
                <th className="text-left pb-2 font-medium">Сметка</th>
                <th className="text-right pb-2 font-medium">Стойност</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {details.map((item, index) => (
                <tr key={index} className="text-foreground">
                  <td className="py-2">{item.номер} - {item.име}</td>
                  <td className="py-2 text-right">{formatCurrency(item.стойност)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function ResultsDisplay({ result }: ResultsDisplayProps) {
  const profit = result.приходи - result.разходи;
  const isProfitable = profit >= 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ResultCard
          title="Приходи"
          value={result.приходи}
          icon={<TrendingUp className="h-5 w-5 text-accent-foreground" />}
          details={result.details.приходи}
          colorClass="bg-accent/20 text-accent"
          delay={0}
        />
        
        <ResultCard
          title="Разходи"
          value={result.разходи}
          icon={<TrendingDown className="h-5 w-5 text-destructive" />}
          details={result.details.разходи}
          colorClass="bg-destructive/10 text-destructive"
          delay={100}
        />
        
        <ResultCard
          title="Др. вземания"
          value={result.др_вземания}
          icon={<Wallet className="h-5 w-5 text-primary" />}
          details={result.details.др_вземания}
          colorClass="bg-primary/10 text-primary"
          delay={200}
        />
        
        <ResultCard
          title="Др. задължения"
          value={result.др_задължения}
          icon={<CreditCard className="h-5 w-5 text-secondary-foreground" />}
          details={result.details.др_задължения}
          colorClass="bg-secondary text-secondary-foreground"
          delay={300}
        />
        
        <ResultCard
          title="Каса"
          value={result.каса}
          icon={<Banknote className="h-5 w-5 text-primary" />}
          details={result.details.каса}
          colorClass="bg-primary/10 text-primary"
          delay={400}
        />
      </div>
      
      <div 
        className={cn(
          "p-6 rounded-xl border-2 opacity-0 animate-fade-in",
          isProfitable 
            ? "border-accent/30 bg-accent/5" 
            : "border-destructive/30 bg-destructive/5"
        )}
        style={{ animationDelay: '500ms' }}
      >
        <div className="flex items-center gap-4">
          <div className={cn(
            "p-3 rounded-full",
            isProfitable ? "bg-accent/20" : "bg-destructive/20"
          )}>
            {isProfitable 
              ? <TrendingUp className="h-6 w-6 text-accent" />
              : <TrendingDown className="h-6 w-6 text-destructive" />
            }
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground">
              {isProfitable ? 'Печалба' : 'Загуба'}
            </p>
            <p className={cn(
              "text-3xl font-bold",
              isProfitable ? "text-accent" : "text-destructive"
            )}>
              {formatCurrency(Math.abs(profit))}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
