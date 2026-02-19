-- Make admin_manage_user delete action resilient when auth.users has dependent FK rows

CREATE OR REPLACE FUNCTION public.admin_manage_user(
  p_action TEXT,
  p_user_id UUID,
  p_status TEXT DEFAULT NULL,
  p_updates JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_email TEXT;
  v_deleted_email TEXT;
BEGIN
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Não autorizado');
  END IF;

  IF NOT public.has_role(v_caller_id, 'admin') THEN
    RETURN jsonb_build_object('error', 'Apenas administradores podem gerenciar usuários');
  END IF;

  IF v_caller_id = p_user_id THEN
    RETURN jsonb_build_object('error', 'Você não pode executar esta ação na sua própria conta');
  END IF;

  IF p_action = 'toggle_status' THEN
    IF p_status NOT IN ('active', 'disabled') THEN
      RETURN jsonb_build_object('error', 'Status inválido');
    END IF;

    UPDATE public.profiles
    SET status = p_status
    WHERE id = p_user_id;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('error', 'Usuário não encontrado');
    END IF;

    RETURN jsonb_build_object('success', true);
  END IF;

  IF p_action = 'update' THEN
    v_email := NULLIF(trim(COALESCE(p_updates->>'email', '')), '');

    IF v_email IS NULL THEN
      RETURN jsonb_build_object('error', 'Email é obrigatório');
    END IF;

    UPDATE auth.users
    SET
      email = v_email,
      raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb)
        || jsonb_build_object('full_name', COALESCE(p_updates->>'full_name', '')),
      updated_at = now()
    WHERE id = p_user_id;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('error', 'Usuário não encontrado no auth');
    END IF;

    UPDATE public.profiles
    SET
      email = v_email,
      full_name = NULLIF(trim(COALESCE(p_updates->>'full_name', '')), ''),
      job_title = NULLIF(trim(COALESCE(p_updates->>'job_title', '')), ''),
      department = NULLIF(trim(COALESCE(p_updates->>'department', '')), ''),
      phone = NULLIF(trim(COALESCE(p_updates->>'phone', '')), '')
    WHERE id = p_user_id;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('error', 'Perfil de usuário não encontrado');
    END IF;

    RETURN jsonb_build_object('success', true);
  END IF;

  IF p_action = 'delete' THEN
    BEGIN
      DELETE FROM auth.users
      WHERE id = p_user_id;

      IF NOT FOUND THEN
        RETURN jsonb_build_object('error', 'Usuário não encontrado');
      END IF;

      RETURN jsonb_build_object('success', true, 'deletion_mode', 'hard');
    EXCEPTION
      WHEN foreign_key_violation THEN
        -- Fallback for users referenced by business tables without ON DELETE CASCADE.
        v_deleted_email := 'deleted+' || replace(p_user_id::text, '-', '') || '@deleted.local';

        UPDATE auth.users
        SET
          email = v_deleted_email,
          phone = NULL,
          banned_until = '2099-12-31T23:59:59+00'::timestamptz,
          raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb)
            || jsonb_build_object('deleted_by_admin', true),
          updated_at = now()
        WHERE id = p_user_id;

        UPDATE public.profiles
        SET
          status = 'disabled',
          email = v_deleted_email,
          full_name = COALESCE(full_name, 'Usuário removido'),
          job_title = NULL,
          department = NULL,
          phone = NULL,
          updated_at = now()
        WHERE id = p_user_id;

        DELETE FROM public.user_roles
        WHERE user_id = p_user_id;

        RETURN jsonb_build_object('success', true, 'deletion_mode', 'soft');
    END;
  END IF;

  RETURN jsonb_build_object('error', 'Ação inválida');
END;
$$;
