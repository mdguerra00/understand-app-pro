-- Correção Fase 3: Triggers de auditoria para arquivos
-- (As políticas de storage já existem)

-- Drop triggers se existirem para evitar erro
DROP TRIGGER IF EXISTS audit_project_files ON project_files;
DROP TRIGGER IF EXISTS audit_project_file_versions ON project_file_versions;

-- Criar triggers de auditoria
CREATE TRIGGER audit_project_files
  AFTER INSERT OR UPDATE OR DELETE ON project_files
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

CREATE TRIGGER audit_project_file_versions
  AFTER INSERT ON project_file_versions
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();