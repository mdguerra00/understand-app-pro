-- =====================================================
-- Correção RLS: Sistema de Convites (Fases 1 e 2)
-- =====================================================

-- 1. Política para permitir que usuários autenticados validem convites
-- (necessário para ler o convite ao acessar o link)
CREATE POLICY "Authenticated users can read invites for validation"
  ON project_invites FOR SELECT
  TO authenticated
  USING (true);

-- 2. Política para permitir que o convidado marque o convite como usado
CREATE POLICY "Invitees can mark their invite as used"
  ON project_invites FOR UPDATE
  TO authenticated
  USING (lower(email) = lower(auth.jwt() ->> 'email'))
  WITH CHECK (lower(email) = lower(auth.jwt() ->> 'email'));

-- 3. Política para permitir que convidados se adicionem como membros
-- (apenas se houver um convite válido para eles)
CREATE POLICY "Users can join project via valid invite"
  ON project_members FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid() AND
    EXISTS (
      SELECT 1 FROM project_invites
      WHERE project_invites.project_id = project_members.project_id
        AND lower(project_invites.email) = lower(auth.jwt() ->> 'email')
        AND project_invites.used_at IS NULL
        AND project_invites.expires_at > now()
    )
  );

-- =====================================================
-- Verificar e criar triggers de auditoria se não existirem
-- =====================================================

-- Função de auditoria (garantir que existe)
CREATE OR REPLACE FUNCTION audit_trigger_function()
RETURNS TRIGGER AS $$
DECLARE
  old_data jsonb;
  new_data jsonb;
  changed_cols text[];
BEGIN
  IF TG_OP = 'DELETE' THEN
    old_data := to_jsonb(OLD);
    INSERT INTO audit_log (table_name, record_id, action, old_data, user_id)
    VALUES (TG_TABLE_NAME, OLD.id::text, TG_OP, old_data, auth.uid());
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    old_data := to_jsonb(OLD);
    new_data := to_jsonb(NEW);
    -- Calcular campos alterados
    SELECT array_agg(key) INTO changed_cols
    FROM jsonb_each(old_data) AS o(key, value)
    WHERE o.value IS DISTINCT FROM (new_data -> o.key);
    
    INSERT INTO audit_log (table_name, record_id, action, old_data, new_data, changed_fields, user_id)
    VALUES (TG_TABLE_NAME, NEW.id::text, TG_OP, old_data, new_data, changed_cols, auth.uid());
    RETURN NEW;
  ELSIF TG_OP = 'INSERT' THEN
    new_data := to_jsonb(NEW);
    INSERT INTO audit_log (table_name, record_id, action, new_data, user_id)
    VALUES (TG_TABLE_NAME, NEW.id::text, TG_OP, new_data, auth.uid());
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Criar triggers de auditoria para tabelas principais
DROP TRIGGER IF EXISTS audit_projects ON projects;
CREATE TRIGGER audit_projects
  AFTER INSERT OR UPDATE OR DELETE ON projects
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

DROP TRIGGER IF EXISTS audit_tasks ON tasks;
CREATE TRIGGER audit_tasks
  AFTER INSERT OR UPDATE OR DELETE ON tasks
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

DROP TRIGGER IF EXISTS audit_project_members ON project_members;
CREATE TRIGGER audit_project_members
  AFTER INSERT OR UPDATE OR DELETE ON project_members
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();