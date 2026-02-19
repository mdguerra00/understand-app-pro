-- Security hardening for user management and task assignment constraints

-- =============================================
-- PROFILES
-- =============================================
DROP POLICY IF EXISTS "Anyone can view profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can view own and project peer profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own non-status profile" ON public.profiles;
DROP POLICY IF EXISTS "Admins can update any profile" ON public.profiles;

CREATE POLICY "Users can view own and project peer profiles"
ON public.profiles FOR SELECT
TO authenticated
USING (
  id = auth.uid()
  OR public.has_role(auth.uid(), 'admin')
  OR EXISTS (
    SELECT 1
    FROM public.project_members pm_self
    JOIN public.project_members pm_peer ON pm_peer.project_id = pm_self.project_id
    WHERE pm_self.user_id = auth.uid()
      AND pm_peer.user_id = profiles.id
  )
);

CREATE POLICY "Users can insert own profile"
ON public.profiles FOR INSERT
TO authenticated
WITH CHECK (id = auth.uid());

CREATE POLICY "Users can update own non-status profile"
ON public.profiles FOR UPDATE
TO authenticated
USING (id = auth.uid())
WITH CHECK (
  id = auth.uid()
  AND status = (
    SELECT p.status
    FROM public.profiles p
    WHERE p.id = auth.uid()
  )
);

CREATE POLICY "Admins can update any profile"
ON public.profiles FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- =============================================
-- USER ROLES
-- =============================================
DROP POLICY IF EXISTS "Admins can view all roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can manage roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can view all roles and users can view own roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can insert roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can update roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can delete roles" ON public.user_roles;

CREATE POLICY "Admins can view all roles and users can view own roles"
ON public.user_roles FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR user_id = auth.uid());

CREATE POLICY "Admins can insert roles"
ON public.user_roles FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update roles"
ON public.user_roles FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete roles"
ON public.user_roles FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- =============================================
-- PROJECTS / MEMBERS / TASKS (explicitly re-stated)
-- =============================================
DROP POLICY IF EXISTS "Members can view their projects" ON public.projects;
DROP POLICY IF EXISTS "Admins can view all projects including deleted" ON public.projects;
DROP POLICY IF EXISTS "Authenticated users can create projects" ON public.projects;
DROP POLICY IF EXISTS "Owners and managers can update projects" ON public.projects;
DROP POLICY IF EXISTS "Owners can delete projects" ON public.projects;

CREATE POLICY "Members can view their projects"
ON public.projects FOR SELECT
TO authenticated
USING (
  deleted_at IS NULL
  AND public.is_project_member(auth.uid(), id)
);

CREATE POLICY "Admins can view all projects including deleted"
ON public.projects FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Authenticated users can create projects"
ON public.projects FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Owners and managers can update projects"
ON public.projects FOR UPDATE
TO authenticated
USING (public.has_project_role(auth.uid(), id, 'manager'))
WITH CHECK (public.has_project_role(auth.uid(), id, 'manager'));

CREATE POLICY "Owners can delete projects"
ON public.projects FOR DELETE
TO authenticated
USING (public.has_project_role(auth.uid(), id, 'owner'));

DROP POLICY IF EXISTS "Members can view project members" ON public.project_members;
DROP POLICY IF EXISTS "Managers can add members" ON public.project_members;
DROP POLICY IF EXISTS "Managers can update members" ON public.project_members;
DROP POLICY IF EXISTS "Managers can remove members" ON public.project_members;

CREATE POLICY "Members can view project members"
ON public.project_members FOR SELECT
TO authenticated
USING (public.is_project_member(auth.uid(), project_id));

CREATE POLICY "Managers can add members"
ON public.project_members FOR INSERT
TO authenticated
WITH CHECK (public.has_project_role(auth.uid(), project_id, 'manager'));

CREATE POLICY "Managers can update members"
ON public.project_members FOR UPDATE
TO authenticated
USING (public.has_project_role(auth.uid(), project_id, 'manager'))
WITH CHECK (public.has_project_role(auth.uid(), project_id, 'manager'));

CREATE POLICY "Managers can remove members"
ON public.project_members FOR DELETE
TO authenticated
USING (public.has_project_role(auth.uid(), project_id, 'manager'));

DROP POLICY IF EXISTS "Members can view tasks" ON public.tasks;
DROP POLICY IF EXISTS "Researchers can create tasks" ON public.tasks;
DROP POLICY IF EXISTS "Researchers can update tasks" ON public.tasks;
DROP POLICY IF EXISTS "Managers can delete tasks" ON public.tasks;

CREATE POLICY "Members can view tasks"
ON public.tasks FOR SELECT
TO authenticated
USING (
  deleted_at IS NULL
  AND public.is_project_member(auth.uid(), project_id)
);

CREATE POLICY "Researchers can create tasks"
ON public.tasks FOR INSERT
TO authenticated
WITH CHECK (
  public.has_project_role(auth.uid(), project_id, 'researcher')
  AND (
    assigned_to IS NULL
    OR public.is_project_member(assigned_to, project_id)
  )
);

CREATE POLICY "Researchers can update tasks"
ON public.tasks FOR UPDATE
TO authenticated
USING (public.has_project_role(auth.uid(), project_id, 'researcher'))
WITH CHECK (
  public.has_project_role(auth.uid(), project_id, 'researcher')
  AND (
    assigned_to IS NULL
    OR public.is_project_member(assigned_to, project_id)
  )
);

CREATE POLICY "Managers can delete tasks"
ON public.tasks FOR DELETE
TO authenticated
USING (public.has_project_role(auth.uid(), project_id, 'manager'));
