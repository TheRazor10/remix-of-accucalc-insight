import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ShoppingCart, ShoppingBag } from 'lucide-react';
import { InvoiceVerificationTab } from '@/components/InvoiceVerificationTab';
import { SalesVerificationTab } from '@/components/SalesVerificationTab';

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
          <Tabs defaultValue="purchases" className="w-full">
            <TabsList className="grid w-full grid-cols-2 mb-6">
              <TabsTrigger value="purchases" className="gap-2">
                <ShoppingCart className="h-4 w-4" />
                Покупки
              </TabsTrigger>
              <TabsTrigger value="sales" className="gap-2">
                <ShoppingBag className="h-4 w-4" />
                Продажби
              </TabsTrigger>
            </TabsList>

            <TabsContent value="purchases">
              <InvoiceVerificationTab />
            </TabsContent>

            <TabsContent value="sales">
              <SalesVerificationTab />
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  );
};

export default InvoiceStandalone;
