
-- Extend task_status enum with new values
ALTER TYPE task_status ADD VALUE IF NOT EXISTS 'backlog';
ALTER TYPE task_status ADD VALUE IF NOT EXISTS 'blocked';

-- Board columns per project
CREATE TABLE public.project_board_columns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  status_key text NOT NULL,
  position integer NOT NULL DEFAULT 0,
  color text,
  wip_limit integer,
  is_done_column boolean DEFAULT false,
  is_blocked_column boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.project_board_columns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view board columns"
  ON public.project_board_columns FOR SELECT
  USING (is_project_member(auth.uid(), project_id));

CREATE POLICY "Managers can create board columns"
  ON public.project_board_columns FOR INSERT
  WITH CHECK (has_project_role(auth.uid(), project_id, 'manager'::project_role));

CREATE POLICY "Managers can update board columns"
  ON public.project_board_columns FOR UPDATE
  USING (has_project_role(auth.uid(), project_id, 'manager'::project_role));

CREATE POLICY "Managers can delete board columns"
  ON public.project_board_columns FOR DELETE
  USING (has_project_role(auth.uid(), project_id, 'manager'::project_role));

-- Add new fields to tasks
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS column_id uuid REFERENCES project_board_columns(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS column_order integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tags text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS blocked_reason text,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS hypothesis text,
  ADD COLUMN IF NOT EXISTS variables_changed text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS target_metrics text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS success_criteria text,
  ADD COLUMN IF NOT EXISTS procedure text,
  ADD COLUMN IF NOT EXISTS checklist jsonb DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS conclusion text,
  ADD COLUMN IF NOT EXISTS decision text,
  ADD COLUMN IF NOT EXISTS partial_results text,
  ADD COLUMN IF NOT EXISTS external_links text[] DEFAULT '{}';

-- Task activity log
CREATE TABLE public.task_activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  action text NOT NULL,
  field_changed text,
  old_value text,
  new_value text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.task_activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view task activity"
  ON public.task_activity_log FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM tasks t
    WHERE t.id = task_activity_log.task_id
    AND is_project_member(auth.uid(), t.project_id)
  ));

CREATE POLICY "Members can create activity entries"
  ON public.task_activity_log FOR INSERT
  WITH CHECK (auth.uid() = user_id AND EXISTS (
    SELECT 1 FROM tasks t
    WHERE t.id = task_activity_log.task_id
    AND is_project_member(auth.uid(), t.project_id)
  ));

-- Index for performance
CREATE INDEX idx_task_activity_task_id ON public.task_activity_log(task_id);
CREATE INDEX idx_board_columns_project ON public.project_board_columns(project_id);
CREATE INDEX idx_tasks_column_id ON public.tasks(column_id);
CREATE INDEX idx_tasks_column_order ON public.tasks(column_id, column_order);

-- Function to create default board columns for a project
CREATE OR REPLACE FUNCTION public.create_default_board_columns(p_project_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO project_board_columns (project_id, name, status_key, position, color, is_done_column, is_blocked_column)
  VALUES
    (p_project_id, 'Backlog', 'backlog', 0, '#64748b', false, false),
    (p_project_id, 'A Fazer', 'todo', 1, '#3b82f6', false, false),
    (p_project_id, 'Em Andamento', 'in_progress', 2, '#0f766e', false, false),
    (p_project_id, 'Bloqueado', 'blocked', 3, '#ef4444', false, true),
    (p_project_id, 'Revisão', 'review', 4, '#f59e0b', false, false),
    (p_project_id, 'Concluído', 'done', 5, '#22c55e', true, false);
END;
$$;
