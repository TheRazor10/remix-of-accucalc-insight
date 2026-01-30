-- Create table for file upload history
CREATE TABLE public.file_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL DEFAULT 'xlsx',
  title TEXT,
  results JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.file_history ENABLE ROW LEVEL SECURITY;

-- Users can only see their own history
CREATE POLICY "Users can view own file history" 
ON public.file_history 
FOR SELECT 
USING (auth.uid() = user_id);

-- Users can insert their own history
CREATE POLICY "Users can insert own file history" 
ON public.file_history 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

-- Users can delete their own history
CREATE POLICY "Users can delete own file history" 
ON public.file_history 
FOR DELETE 
USING (auth.uid() = user_id);

-- Create index for faster queries
CREATE INDEX idx_file_history_user_created ON public.file_history(user_id, created_at DESC);

-- Function to enforce 100 file limit per user
CREATE OR REPLACE FUNCTION public.enforce_file_history_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Delete oldest entries if user has more than 100 files
  DELETE FROM public.file_history
  WHERE id IN (
    SELECT id FROM public.file_history
    WHERE user_id = NEW.user_id
    ORDER BY created_at DESC
    OFFSET 100
  );
  RETURN NEW;
END;
$$;

-- Trigger to run after insert
CREATE TRIGGER enforce_file_history_limit_trigger
AFTER INSERT ON public.file_history
FOR EACH ROW
EXECUTE FUNCTION public.enforce_file_history_limit();