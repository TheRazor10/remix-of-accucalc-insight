-- Drop and recreate the view without SECURITY DEFINER
DROP VIEW IF EXISTS public.profiles_with_email;

CREATE VIEW public.profiles_with_email 
WITH (security_invoker = true) AS
SELECT 
  p.id,
  p.user_id,
  p.approved,
  p.created_at,
  p.updated_at,
  public.get_user_email(p.user_id) as email
FROM public.profiles p;