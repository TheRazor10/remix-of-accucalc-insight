import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { CalculationResult } from '@/lib/calculationTypes';
import { useAuth } from './useAuth';
import { toast } from './use-toast';
import { Json } from '@/integrations/supabase/types';
export interface FileHistoryItem {
  id: string;
  file_name: string;
  file_type: string;
  title: string | null;
  results: CalculationResult;
  created_at: string;
}

export function useFileHistory() {
  const [history, setHistory] = useState<FileHistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const { user } = useAuth();

  const fetchHistory = useCallback(async () => {
    if (!user) return;
    
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('file_history')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) throw error;
      
      setHistory((data || []).map(item => ({
        ...item,
        results: item.results as unknown as CalculationResult
      })));
    } catch (error) {
      console.error('Error fetching file history:', error);
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  const saveToHistory = useCallback(async (
    fileName: string, 
    fileType: string, 
    title: string | undefined, 
    results: CalculationResult
  ) => {
    if (!user) return;

    try {
      const { error } = await supabase
        .from('file_history')
        .insert([{
          user_id: user.id,
          file_name: fileName,
          file_type: fileType,
          title: title || null,
          results: JSON.parse(JSON.stringify(results)) as Json
        }]);

      if (error) throw error;
      
      // Refresh history after save
      fetchHistory();
    } catch (error) {
      console.error('Error saving to history:', error);
      toast({
        title: 'Грешка',
        description: 'Неуспешно запазване в историята',
        variant: 'destructive',
      });
    }
  }, [user, fetchHistory]);

  const deleteFromHistory = useCallback(async (id: string) => {
    if (!user) return;

    try {
      const { error } = await supabase
        .from('file_history')
        .delete()
        .eq('id', id);

      if (error) throw error;
      
      setHistory(prev => prev.filter(item => item.id !== id));
      toast({
        title: 'Изтрито',
        description: 'Записът е премахнат от историята',
      });
    } catch (error) {
      console.error('Error deleting from history:', error);
      toast({
        title: 'Грешка',
        description: 'Неуспешно изтриване',
        variant: 'destructive',
      });
    }
  }, [user]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  return {
    history,
    isLoading,
    saveToHistory,
    deleteFromHistory,
    refreshHistory: fetchHistory,
  };
}
