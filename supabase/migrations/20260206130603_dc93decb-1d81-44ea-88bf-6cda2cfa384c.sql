
-- Table: assistant_conversations
CREATE TABLE public.assistant_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL DEFAULT 'Nova conversa',
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.assistant_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own conversations"
  ON public.assistant_conversations FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own conversations"
  ON public.assistant_conversations FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own conversations"
  ON public.assistant_conversations FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own conversations"
  ON public.assistant_conversations FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER update_assistant_conversations_updated_at
  BEFORE UPDATE ON public.assistant_conversations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Table: assistant_messages
CREATE TABLE public.assistant_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.assistant_conversations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  sources jsonb,
  is_error boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.assistant_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own conversation messages"
  ON public.assistant_messages FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.assistant_conversations ac
    WHERE ac.id = assistant_messages.conversation_id
    AND ac.user_id = auth.uid()
  ));

CREATE POLICY "Users can insert into own conversations"
  ON public.assistant_messages FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.assistant_conversations ac
    WHERE ac.id = assistant_messages.conversation_id
    AND ac.user_id = auth.uid()
  ));

CREATE POLICY "Users can delete from own conversations"
  ON public.assistant_messages FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM public.assistant_conversations ac
    WHERE ac.id = assistant_messages.conversation_id
    AND ac.user_id = auth.uid()
  ));

-- Index for fast message loading
CREATE INDEX idx_assistant_messages_conversation_id ON public.assistant_messages(conversation_id, created_at);
CREATE INDEX idx_assistant_conversations_user_id ON public.assistant_conversations(user_id, updated_at DESC);
