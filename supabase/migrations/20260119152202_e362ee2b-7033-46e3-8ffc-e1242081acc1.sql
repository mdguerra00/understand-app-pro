-- Corrigir search_path na função increment_report_version
CREATE OR REPLACE FUNCTION increment_report_version()
RETURNS TRIGGER 
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  SELECT COALESCE(MAX(version_number), 0) + 1 INTO NEW.version_number
  FROM report_versions
  WHERE report_id = NEW.report_id;
  RETURN NEW;
END;
$$;