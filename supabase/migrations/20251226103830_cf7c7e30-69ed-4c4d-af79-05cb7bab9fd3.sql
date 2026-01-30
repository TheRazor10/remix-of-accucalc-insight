-- Enable RLS on the profiles_with_email view
-- Note: Views inherit RLS from underlying tables, but we need to ensure proper access
-- The view uses get_user_email() which already checks for admin role internally

-- Drop the view and recreate with proper security
DROP VIEW IF EXISTS public.profiles_with_email;

-- Recreate as a security invoker view (uses caller's permissions)
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

-- Grant select only to authenticated users
REVOKE ALL ON public.profiles_with_email FROM anon;
REVOKE ALL ON public.profiles_with_email FROM public;
GRANT SELECT ON public.profiles_with_email TO authenticated;