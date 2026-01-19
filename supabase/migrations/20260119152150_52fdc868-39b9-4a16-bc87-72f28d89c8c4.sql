-- =============================================
-- FASE 4: Sistema de Relatórios (Completo)
-- =============================================

-- Tabela principal de relatórios
CREATE TABLE public.reports (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT,
  summary TEXT,
  status report_status NOT NULL DEFAULT 'draft',
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at TIMESTAMPTZ,
  submitted_by UUID,
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,
  archived_by UUID,
  deleted_at TIMESTAMPTZ,
  deleted_by UUID
);

CREATE INDEX idx_reports_project_id ON reports(project_id);
CREATE INDEX idx_reports_status ON reports(status);
CREATE INDEX idx_reports_created_by ON reports(created_by);

CREATE TRIGGER update_reports_updated_at
  BEFORE UPDATE ON reports
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Tabela de anexos
CREATE TABLE public.report_attachments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  file_id UUID NOT NULL REFERENCES project_files(id) ON DELETE CASCADE,
  added_by UUID NOT NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(report_id, file_id)
);

CREATE INDEX idx_report_attachments_report_id ON report_attachments(report_id);

-- Tabela de versões
CREATE TABLE public.report_versions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL DEFAULT 1,
  title TEXT NOT NULL,
  content TEXT,
  summary TEXT,
  saved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  saved_by UUID NOT NULL,
  is_autosave BOOLEAN NOT NULL DEFAULT false,
  UNIQUE(report_id, version_number)
);

CREATE INDEX idx_report_versions_report_id ON report_versions(report_id);

CREATE OR REPLACE FUNCTION increment_report_version()
RETURNS TRIGGER AS $$
BEGIN
  SELECT COALESCE(MAX(version_number), 0) + 1 INTO NEW.version_number
  FROM report_versions
  WHERE report_id = NEW.report_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_increment_report_version
  BEFORE INSERT ON report_versions
  FOR EACH ROW
  EXECUTE FUNCTION increment_report_version();

-- RLS para reports
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view project reports"
  ON reports FOR SELECT
  TO authenticated
  USING (deleted_at IS NULL AND is_project_member(auth.uid(), project_id));

CREATE POLICY "Admins can view all reports"
  ON reports FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "Researchers can create reports"
  ON reports FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = created_by AND has_project_role(auth.uid(), project_id, 'researcher'));

CREATE POLICY "Researchers can update own drafts"
  ON reports FOR UPDATE
  TO authenticated
  USING (status = 'draft' AND created_by = auth.uid() AND has_project_role(auth.uid(), project_id, 'researcher'));

CREATE POLICY "Managers can update report status"
  ON reports FOR UPDATE
  TO authenticated
  USING (has_project_role(auth.uid(), project_id, 'manager'));

CREATE POLICY "Managers can delete reports"
  ON reports FOR DELETE
  TO authenticated
  USING (has_project_role(auth.uid(), project_id, 'manager'));

-- RLS para report_attachments
ALTER TABLE report_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view report attachments"
  ON report_attachments FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM reports r WHERE r.id = report_attachments.report_id AND is_project_member(auth.uid(), r.project_id)));

CREATE POLICY "Researchers can add attachments"
  ON report_attachments FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = added_by AND EXISTS (SELECT 1 FROM reports r WHERE r.id = report_attachments.report_id AND r.status = 'draft' AND has_project_role(auth.uid(), r.project_id, 'researcher')));

CREATE POLICY "Researchers can remove attachments"
  ON report_attachments FOR DELETE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM reports r WHERE r.id = report_attachments.report_id AND r.status = 'draft' AND has_project_role(auth.uid(), r.project_id, 'researcher')));

-- RLS para report_versions
ALTER TABLE report_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view report versions"
  ON report_versions FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM reports r WHERE r.id = report_versions.report_id AND is_project_member(auth.uid(), r.project_id)));

CREATE POLICY "Researchers can create versions"
  ON report_versions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = saved_by AND EXISTS (SELECT 1 FROM reports r WHERE r.id = report_versions.report_id AND r.status = 'draft' AND r.created_by = auth.uid()));

-- Dropar função existente e recriar com relatórios
DROP FUNCTION IF EXISTS global_search(text);

CREATE FUNCTION global_search(search_query TEXT)
RETURNS TABLE (
  result_type TEXT,
  result_id UUID,
  title TEXT,
  subtitle TEXT,
  project_id UUID,
  project_name TEXT,
  relevance INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 'project'::TEXT, p.id, p.name, p.description, p.id, p.name,
    CASE WHEN p.name ILIKE search_query || '%' THEN 100 WHEN p.name ILIKE '%' || search_query || '%' THEN 80 ELSE 60 END
  FROM projects p
  WHERE p.deleted_at IS NULL AND is_project_member(auth.uid(), p.id)
    AND (p.name ILIKE '%' || search_query || '%' OR p.description ILIKE '%' || search_query || '%')
  UNION ALL
  SELECT 'task'::TEXT, t.id, t.title, t.description, t.project_id, p.name,
    CASE WHEN t.title ILIKE search_query || '%' THEN 90 WHEN t.title ILIKE '%' || search_query || '%' THEN 70 ELSE 50 END
  FROM tasks t JOIN projects p ON p.id = t.project_id
  WHERE t.deleted_at IS NULL AND p.deleted_at IS NULL AND is_project_member(auth.uid(), t.project_id)
    AND (t.title ILIKE '%' || search_query || '%' OR t.description ILIKE '%' || search_query || '%')
  UNION ALL
  SELECT 'file'::TEXT, f.id, f.name, f.description, f.project_id, p.name,
    CASE WHEN f.name ILIKE search_query || '%' THEN 85 WHEN f.name ILIKE '%' || search_query || '%' THEN 65 ELSE 45 END
  FROM project_files f JOIN projects p ON p.id = f.project_id
  WHERE f.deleted_at IS NULL AND p.deleted_at IS NULL AND is_project_member(auth.uid(), f.project_id)
    AND (f.name ILIKE '%' || search_query || '%' OR f.description ILIKE '%' || search_query || '%')
  UNION ALL
  SELECT 'report'::TEXT, r.id, r.title, r.summary, r.project_id, p.name,
    CASE WHEN r.title ILIKE search_query || '%' THEN 95 WHEN r.title ILIKE '%' || search_query || '%' THEN 75 ELSE 55 END
  FROM reports r JOIN projects p ON p.id = r.project_id
  WHERE r.deleted_at IS NULL AND p.deleted_at IS NULL AND is_project_member(auth.uid(), r.project_id)
    AND (r.title ILIKE '%' || search_query || '%' OR r.summary ILIKE '%' || search_query || '%' OR r.content ILIKE '%' || search_query || '%')
  ORDER BY relevance DESC LIMIT 20;
END;
$$;

-- Triggers de auditoria
CREATE TRIGGER audit_reports
  AFTER INSERT OR UPDATE OR DELETE ON reports
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

CREATE TRIGGER audit_report_attachments
  AFTER INSERT OR DELETE ON report_attachments
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();