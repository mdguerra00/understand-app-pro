
-- =========================================================
-- 1. PROFILES: restrict SELECT to self or shared-project members
-- =========================================================
DROP POLICY IF EXISTS "Anyone can view profiles" ON public.profiles;

CREATE POLICY "Users can view own or shared project profiles"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (
    id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.project_members pm_self
      JOIN public.project_members pm_other
        ON pm_other.project_id = pm_self.project_id
      WHERE pm_self.user_id = auth.uid()
        AND pm_other.user_id = profiles.id
    )
    OR has_role(auth.uid(), 'admin'::app_role)
  );

-- =========================================================
-- 2. PROJECT_INVITES: drop open SELECT; keep manager + invitee-own-email
-- =========================================================
DROP POLICY IF EXISTS "Authenticated users can read invites for validation" ON public.project_invites;

CREATE POLICY "Invitees can view their own invite"
  ON public.project_invites FOR SELECT
  TO authenticated
  USING (lower(email) = lower((auth.jwt() ->> 'email')));

-- =========================================================
-- 3. NOTIFICATIONS: strict INSERT (recipient must be self).
--    System notifications for other users now via SECURITY DEFINER trigger.
-- =========================================================
DROP POLICY IF EXISTS "Authenticated can insert notifications" ON public.notifications;

CREATE POLICY "Users can insert own notifications"
  ON public.notifications FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Trigger: when task.assigned_to changes, notify the new assignee.
CREATE OR REPLACE FUNCTION public.notify_task_assigned()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF NEW.assigned_to IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.assigned_to IS NOT DISTINCT FROM NEW.assigned_to THEN
    RETURN NEW;
  END IF;
  IF NEW.assigned_to = v_actor THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (user_id, project_id, type, title, message, link)
  VALUES (
    NEW.assigned_to,
    NEW.project_id,
    'task_assigned',
    'Nova tarefa atribuída',
    'Você foi designado para: "' || LEFT(NEW.title, 80) || '"',
    '/projects/' || NEW.project_id || '?tab=tasks&task=' || NEW.id
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_task_assigned_ins ON public.tasks;
DROP TRIGGER IF EXISTS trg_notify_task_assigned_upd ON public.tasks;

CREATE TRIGGER trg_notify_task_assigned_ins
  AFTER INSERT ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.notify_task_assigned();

CREATE TRIGGER trg_notify_task_assigned_upd
  AFTER UPDATE OF assigned_to ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.notify_task_assigned();

-- =========================================================
-- 4. PRODUCTS family: scope reads
-- =========================================================
-- products / product_timeline_events: no project_id column → restrict to authenticated only
DROP POLICY IF EXISTS "Authenticated can view products" ON public.products;
CREATE POLICY "Authenticated can view products"
  ON public.products FOR SELECT
  TO authenticated
  USING (deleted_at IS NULL);

DROP POLICY IF EXISTS "Authenticated can view timeline events" ON public.product_timeline_events;
CREATE POLICY "Authenticated can view timeline events"
  ON public.product_timeline_events FOR SELECT
  TO authenticated
  USING (true);

-- product_developments / product_changes: scope to project members (project_id may be null = global)
DROP POLICY IF EXISTS "Authenticated can view product developments" ON public.product_developments;
CREATE POLICY "Members can view product developments"
  ON public.product_developments FOR SELECT
  TO authenticated
  USING (
    deleted_at IS NULL
    AND (
      project_id IS NULL
      OR is_project_member(auth.uid(), project_id)
      OR has_role(auth.uid(), 'admin'::app_role)
    )
  );

DROP POLICY IF EXISTS "Authenticated can view product changes" ON public.product_changes;
CREATE POLICY "Members can view product changes"
  ON public.product_changes FOR SELECT
  TO authenticated
  USING (
    deleted_at IS NULL
    AND (
      project_id IS NULL
      OR is_project_member(auth.uid(), project_id)
      OR has_role(auth.uid(), 'admin'::app_role)
    )
  );

-- =========================================================
-- 5. METRICS_CATALOG: admin-only writes
-- =========================================================
DROP POLICY IF EXISTS "Authenticated users can create metrics" ON public.metrics_catalog;
DROP POLICY IF EXISTS "Authenticated users can update metrics" ON public.metrics_catalog;

CREATE POLICY "Admins can insert metrics"
  ON public.metrics_catalog FOR INSERT
  TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update metrics"
  ON public.metrics_catalog FOR UPDATE
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete metrics"
  ON public.metrics_catalog FOR DELETE
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- =========================================================
-- 6. KNOWLEDGE_FACTS_VERSIONS / _LOGS: scope to project members of the fact
-- =========================================================
DROP POLICY IF EXISTS "Users can view fact versions" ON public.knowledge_facts_versions;
CREATE POLICY "Members can view fact versions"
  ON public.knowledge_facts_versions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.knowledge_facts kf
      WHERE kf.id = knowledge_facts_versions.fact_id
        AND (
          kf.project_id IS NULL
          OR is_project_member(auth.uid(), kf.project_id)
          OR has_role(auth.uid(), 'admin'::app_role)
        )
    )
  );

DROP POLICY IF EXISTS "Users can view fact logs" ON public.knowledge_facts_logs;
CREATE POLICY "Members can view fact logs"
  ON public.knowledge_facts_logs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.knowledge_facts kf
      WHERE kf.id = knowledge_facts_logs.fact_id
        AND (
          kf.project_id IS NULL
          OR is_project_member(auth.uid(), kf.project_id)
          OR has_role(auth.uid(), 'admin'::app_role)
        )
    )
  );

-- =========================================================
-- 7. STORAGE: drop broad authenticated read/update/delete; keep narrow
--    policies + add explicit global/ access policies.
-- =========================================================
DROP POLICY IF EXISTS "Allow authenticated reads" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated updates" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated deletes" ON storage.objects;

CREATE POLICY "Authenticated can read global files"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'project-files'
    AND (string_to_array(name, '/'))[1] = 'global'
  );

CREATE POLICY "Authenticated can update global files"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'project-files'
    AND (string_to_array(name, '/'))[1] = 'global'
  )
  WITH CHECK (
    bucket_id = 'project-files'
    AND (string_to_array(name, '/'))[1] = 'global'
  );

CREATE POLICY "Authenticated can delete global files"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'project-files'
    AND (string_to_array(name, '/'))[1] = 'global'
  );

-- =========================================================
-- 8. Revoke EXECUTE on internal SECURITY DEFINER helpers from anon
-- =========================================================
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.has_project_role(uuid, uuid, project_role) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_project_member(uuid, uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_project_role(uuid, uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.global_search(text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.global_search(text, uuid) FROM anon, PUBLIC;

GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_project_role(uuid, uuid, project_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_project_member(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_project_role(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.global_search(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.global_search(text, uuid) TO authenticated;
