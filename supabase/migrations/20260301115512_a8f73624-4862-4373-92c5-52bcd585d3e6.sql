
-- ============================================================
-- FIX 1: Drop admin_manage_user RPC (DEFINER_OR_RPC_BYPASS)
-- Edge functions (manage-user, create-user, toggle-user-status) 
-- already handle these operations more securely.
-- ============================================================
DROP FUNCTION IF EXISTS public.admin_manage_user(text, uuid, jsonb);

-- ============================================================
-- FIX 2: Add FK constraint to assistant_conversations (MISSING_RLS)
-- Ensures data integrity and cascade deletion of orphaned records.
-- ============================================================

-- Clean up any orphaned conversations first
DELETE FROM public.assistant_messages
WHERE conversation_id IN (
  SELECT ac.id FROM public.assistant_conversations ac
  WHERE NOT EXISTS (SELECT 1 FROM auth.users WHERE id = ac.user_id)
);

DELETE FROM public.assistant_conversations
WHERE NOT EXISTS (SELECT 1 FROM auth.users WHERE id = user_id);

-- Add the foreign key constraint
ALTER TABLE public.assistant_conversations
  ADD CONSTRAINT assistant_conversations_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- ============================================================
-- FIX 3: Harden storage policies with path validation (STORAGE_EXPOSURE)
-- Add UUID format validation to prevent path manipulation attacks.
-- ============================================================

-- Drop existing storage policies for project-files bucket
DROP POLICY IF EXISTS "Project members can download files" ON storage.objects;
DROP POLICY IF EXISTS "Researchers can upload to project bucket" ON storage.objects;
DROP POLICY IF EXISTS "Researchers can update own uploads" ON storage.objects;
DROP POLICY IF EXISTS "Researchers can delete own uploads" ON storage.objects;

-- Recreate with UUID format validation
CREATE POLICY "Project members can download files"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'project-files'
    AND array_length(string_to_array(name, '/'), 1) >= 2
    AND (string_to_array(name, '/'))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND is_project_member(auth.uid(), (string_to_array(name, '/'))[1]::uuid)
  );

CREATE POLICY "Researchers can upload to project bucket"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'project-files'
    AND array_length(string_to_array(name, '/'), 1) >= 2
    AND (string_to_array(name, '/'))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND has_project_role(auth.uid(), (string_to_array(name, '/'))[1]::uuid, 'researcher'::project_role)
  );

CREATE POLICY "Researchers can update own uploads"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'project-files'
    AND array_length(string_to_array(name, '/'), 1) >= 2
    AND (string_to_array(name, '/'))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND has_project_role(auth.uid(), (string_to_array(name, '/'))[1]::uuid, 'researcher'::project_role)
  );

CREATE POLICY "Researchers can delete own uploads"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'project-files'
    AND array_length(string_to_array(name, '/'), 1) >= 2
    AND (string_to_array(name, '/'))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND has_project_role(auth.uid(), (string_to_array(name, '/'))[1]::uuid, 'manager'::project_role)
  );
