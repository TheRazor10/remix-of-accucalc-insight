import { InvoiceVerificationTab } from '@/components/InvoiceVerificationTab';

const InvoiceStandalone = () => {
  return (
    <div className="min-h-screen gradient-hero">
      {/* Simple Header */}
      <header className="border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto px-4 py-4">
          <h1 className="font-serif text-2xl font-bold text-foreground">
            Сверка на <span className="text-gradient">Фактури</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Standalone версия - без автентикация
          </p>
        </div>
      </header>
      
      <main className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto">
          <InvoiceVerificationTab />
        </div>
      </main>
    </div>
  );
};

export default InvoiceStandalone;
