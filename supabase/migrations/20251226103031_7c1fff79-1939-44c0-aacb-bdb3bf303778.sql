-- Create a secure function to get user emails for admin use
CREATE OR REPLACE FUNCTION public.get_user_email(target_user_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_email TEXT;
BEGIN
  -- Only allow admins to call this function
  IF NOT EXISTS (
    SELECT 1 FROM user_roles 
    WHERE user_id = auth.uid() 
    AND role = 'admin'
  ) THEN
    RETURN NULL;
  END IF;
  
  SELECT email INTO user_email
  FROM auth.users
  WHERE id = target_user_id;
  
  RETURN user_email;
END;
$$;

-- Create a view that joins profiles with user emails for admins
CREATE OR REPLACE VIEW public.profiles_with_email AS
SELECT 
  p.id,
  p.user_id,
  p.approved,
  p.created_at,
  p.updated_at,
  public.get_user_email(p.user_id) as email
FROM public.profiles p;

-- Grant access to the view
GRANT SELECT ON public.profiles_with_email TO authenticated;