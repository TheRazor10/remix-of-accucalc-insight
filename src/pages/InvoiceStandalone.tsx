import { useState, useCallback } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ShoppingCart, ShoppingBag, Key } from 'lucide-react';
import { InvoiceVerificationTab } from '@/components/InvoiceVerificationTab';
import { SalesVerificationTab } from '@/components/SalesVerificationTab';

declare global {
  interface Window {
    electronAPI?: {
      getApiKey: () => Promise<string>;
      setApiKey: (key: string) => Promise<boolean>;
    };
  }
}

const InvoiceStandalone = () => {
  const [showApiKeyInput, setShowApiKeyInput] = useState(false);
  const [apiKeyValue, setApiKeyValue] = useState('');
  const [apiKeySaved, setApiKeySaved] = useState(false);

  const handleChangeApiKey = useCallback(async () => {
    if (!window.electronAPI) return;
    const current = await window.electronAPI.getApiKey();
    setApiKeyValue(current);
    setApiKeySaved(false);
    setShowApiKeyInput(true);
  }, []);

  const handleSaveApiKey = useCallback(async () => {
    if (!window.electronAPI || !apiKeyValue.trim()) return;
    await window.electronAPI.setApiKey(apiKeyValue.trim());
    setApiKeySaved(true);
    setTimeout(() => {
      setShowApiKeyInput(false);
      setApiKeySaved(false);
    }, 1500);
  }, [apiKeyValue]);

  return (
    <div className="min-h-screen gradient-hero">
      {/* Simple Header */}
      <header className="border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="font-serif text-2xl font-bold text-foreground">
              Сверка на <span className="text-gradient">Фактури</span>
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Standalone версия - без автентикация
            </p>
          </div>
          {window.electronAPI && (
            <button
              onClick={handleChangeApiKey}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground border border-border rounded-md hover:bg-accent transition-colors"
              title="Промяна на API ключ"
            >
              <Key className="h-3.5 w-3.5" />
              API Key
            </button>
          )}
        </div>
        {showApiKeyInput && (
          <div className="container mx-auto px-4 pb-4">
            <div className="flex items-center gap-2 max-w-xl">
              <input
                type="password"
                value={apiKeyValue}
                onChange={(e) => setApiKeyValue(e.target.value)}
                placeholder="Въведете Gemini API ключ..."
                className="flex-1 px-3 py-1.5 text-sm border border-border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                onKeyDown={(e) => e.key === 'Enter' && handleSaveApiKey()}
              />
              <button
                onClick={handleSaveApiKey}
                className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
              >
                {apiKeySaved ? 'Запазено!' : 'Запази'}
              </button>
              <button
                onClick={() => setShowApiKeyInput(false)}
                className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground border border-border rounded-md hover:bg-accent transition-colors"
              >
                Отказ
              </button>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Рестартирайте приложението след промяна на ключа.
            </p>
          </div>
        )}
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
