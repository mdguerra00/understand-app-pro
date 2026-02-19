
-- 1) Add status column to profiles for user activation/deactivation
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

-- 2) Create trigger function to validate assigned_to is a project member
CREATE OR REPLACE FUNCTION public.validate_task_assignee()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only validate if assigned_to is set and changed
  IF NEW.assigned_to IS NOT NULL AND (OLD IS NULL OR OLD.assigned_to IS DISTINCT FROM NEW.assigned_to) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.project_members
      WHERE project_id = NEW.project_id
        AND user_id = NEW.assigned_to
    ) THEN
      RAISE EXCEPTION 'O usuário atribuído não é membro deste projeto';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- 3) Create trigger on tasks table
DROP TRIGGER IF EXISTS validate_task_assignee_trigger ON public.tasks;
CREATE TRIGGER validate_task_assignee_trigger
  BEFORE INSERT OR UPDATE ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_task_assignee();

-- 4) Create function to track last login (called from auth hook or manually)
CREATE OR REPLACE FUNCTION public.update_last_sign_in()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles 
  SET updated_at = now()
  WHERE id = NEW.id;
  RETURN NEW;
END;
$$;
