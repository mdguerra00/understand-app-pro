-- Compatibility overloads for PostgREST schema cache and partial-arg RPC calls

CREATE OR REPLACE FUNCTION public.admin_manage_user(
  p_action TEXT,
  p_user_id UUID
)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT public.admin_manage_user(p_action, p_user_id, NULL, NULL);
$$;

CREATE OR REPLACE FUNCTION public.admin_manage_user(
  p_action TEXT,
  p_user_id UUID,
  p_status TEXT
)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT public.admin_manage_user(p_action, p_user_id, p_status, NULL);
$$;

REVOKE ALL ON FUNCTION public.admin_manage_user(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_manage_user(TEXT, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_manage_user(TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_manage_user(TEXT, UUID, TEXT) TO authenticated;
