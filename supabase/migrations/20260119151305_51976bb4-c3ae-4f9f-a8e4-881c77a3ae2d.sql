-- Corrigir função de auditoria para usar UUID corretamente
CREATE OR REPLACE FUNCTION public.audit_trigger_function()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  old_data jsonb;
  new_data jsonb;
  changed_cols text[];
BEGIN
  IF TG_OP = 'DELETE' THEN
    old_data := to_jsonb(OLD);
    INSERT INTO audit_log (table_name, record_id, action, old_data, user_id)
    VALUES (TG_TABLE_NAME, OLD.id, TG_OP, old_data, auth.uid());
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    old_data := to_jsonb(OLD);
    new_data := to_jsonb(NEW);
    -- Calcular campos alterados
    SELECT array_agg(key) INTO changed_cols
    FROM jsonb_each(old_data) AS o(key, value)
    WHERE o.value IS DISTINCT FROM (new_data -> o.key);
    
    INSERT INTO audit_log (table_name, record_id, action, old_data, new_data, changed_fields, user_id)
    VALUES (TG_TABLE_NAME, NEW.id, TG_OP, old_data, new_data, changed_cols, auth.uid());
    RETURN NEW;
  ELSIF TG_OP = 'INSERT' THEN
    new_data := to_jsonb(NEW);
    INSERT INTO audit_log (table_name, record_id, action, new_data, user_id)
    VALUES (TG_TABLE_NAME, NEW.id, TG_OP, new_data, auth.uid());
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$function$;