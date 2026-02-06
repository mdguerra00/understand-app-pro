export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      assistant_conversations: {
        Row: {
          created_at: string
          id: string
          project_id: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          project_id?: string | null
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          project_id?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assistant_conversations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      assistant_messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          is_error: boolean
          role: string
          sources: Json | null
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          is_error?: boolean
          role: string
          sources?: Json | null
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          is_error?: boolean
          role?: string
          sources?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "assistant_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "assistant_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          changed_fields: string[] | null
          created_at: string
          id: string
          new_data: Json | null
          old_data: Json | null
          record_id: string
          table_name: string
          user_id: string | null
        }
        Insert: {
          action: string
          changed_fields?: string[] | null
          created_at?: string
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          record_id: string
          table_name: string
          user_id?: string | null
        }
        Update: {
          action?: string
          changed_fields?: string[] | null
          created_at?: string
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          record_id?: string
          table_name?: string
          user_id?: string | null
        }
        Relationships: []
      }
      extraction_jobs: {
        Row: {
          completed_at: string | null
          content_truncated: boolean | null
          created_at: string
          created_by: string
          error_message: string | null
          file_hash: string
          file_id: string
          id: string
          items_extracted: number | null
          parsing_quality: string | null
          project_id: string
          sheets_found: number | null
          started_at: string | null
          status: Database["public"]["Enums"]["extraction_status"]
          tokens_used: number | null
        }
        Insert: {
          completed_at?: string | null
          content_truncated?: boolean | null
          created_at?: string
          created_by: string
          error_message?: string | null
          file_hash: string
          file_id: string
          id?: string
          items_extracted?: number | null
          parsing_quality?: string | null
          project_id: string
          sheets_found?: number | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["extraction_status"]
          tokens_used?: number | null
        }
        Update: {
          completed_at?: string | null
          content_truncated?: boolean | null
          created_at?: string
          created_by?: string
          error_message?: string | null
          file_hash?: string
          file_id?: string
          id?: string
          items_extracted?: number | null
          parsing_quality?: string | null
          project_id?: string
          sheets_found?: number | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["extraction_status"]
          tokens_used?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "extraction_jobs_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "project_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extraction_jobs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      indexing_jobs: {
        Row: {
          chunks_created: number | null
          created_at: string | null
          created_by: string | null
          error_message: string | null
          finished_at: string | null
          id: string
          job_type: string
          priority: number
          project_id: string
          retry_count: number | null
          source_id: string | null
          source_type: string | null
          started_at: string | null
          status: string
        }
        Insert: {
          chunks_created?: number | null
          created_at?: string | null
          created_by?: string | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          job_type: string
          priority?: number
          project_id: string
          retry_count?: number | null
          source_id?: string | null
          source_type?: string | null
          started_at?: string | null
          status?: string
        }
        Update: {
          chunks_created?: number | null
          created_at?: string | null
          created_by?: string | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          job_type?: string
          priority?: number
          project_id?: string
          retry_count?: number | null
          source_id?: string | null
          source_type?: string | null
          started_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "indexing_jobs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_items: {
        Row: {
          category: Database["public"]["Enums"]["knowledge_category"]
          confidence: number | null
          content: string
          deleted_at: string | null
          deleted_by: string | null
          evidence: string | null
          evidence_page: number | null
          evidence_verified: boolean | null
          extracted_at: string
          extracted_by: string
          extraction_job_id: string | null
          id: string
          project_id: string
          related_items: string[] | null
          relationship_type: string | null
          source_file_id: string | null
          title: string
          validated_at: string | null
          validated_by: string | null
        }
        Insert: {
          category: Database["public"]["Enums"]["knowledge_category"]
          confidence?: number | null
          content: string
          deleted_at?: string | null
          deleted_by?: string | null
          evidence?: string | null
          evidence_page?: number | null
          evidence_verified?: boolean | null
          extracted_at?: string
          extracted_by: string
          extraction_job_id?: string | null
          id?: string
          project_id: string
          related_items?: string[] | null
          relationship_type?: string | null
          source_file_id?: string | null
          title: string
          validated_at?: string | null
          validated_by?: string | null
        }
        Update: {
          category?: Database["public"]["Enums"]["knowledge_category"]
          confidence?: number | null
          content?: string
          deleted_at?: string | null
          deleted_by?: string | null
          evidence?: string | null
          evidence_page?: number | null
          evidence_verified?: boolean | null
          extracted_at?: string
          extracted_by?: string
          extraction_job_id?: string | null
          id?: string
          project_id?: string
          related_items?: string[] | null
          relationship_type?: string | null
          source_file_id?: string | null
          title?: string
          validated_at?: string | null
          validated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_items_extraction_job_id_fkey"
            columns: ["extraction_job_id"]
            isOneToOne: false
            referencedRelation: "extraction_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_items_source_file_id_fkey"
            columns: ["source_file_id"]
            isOneToOne: false
            referencedRelation: "project_files"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          department: string | null
          email: string
          full_name: string | null
          id: string
          job_title: string | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          department?: string | null
          email: string
          full_name?: string | null
          id: string
          job_title?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          department?: string | null
          email?: string
          full_name?: string | null
          id?: string
          job_title?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      project_file_versions: {
        Row: {
          created_at: string
          file_id: string
          id: string
          size_bytes: number | null
          storage_path: string
          upload_comment: string | null
          uploaded_by: string
          version_number: number
        }
        Insert: {
          created_at?: string
          file_id: string
          id?: string
          size_bytes?: number | null
          storage_path: string
          upload_comment?: string | null
          uploaded_by: string
          version_number: number
        }
        Update: {
          created_at?: string
          file_id?: string
          id?: string
          size_bytes?: number | null
          storage_path?: string
          upload_comment?: string | null
          uploaded_by?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "project_file_versions_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "project_files"
            referencedColumns: ["id"]
          },
        ]
      }
      project_files: {
        Row: {
          created_at: string
          current_version: number
          deleted_at: string | null
          deleted_by: string | null
          description: string | null
          id: string
          mime_type: string | null
          name: string
          project_id: string
          size_bytes: number | null
          storage_path: string
          updated_at: string
          uploaded_by: string
        }
        Insert: {
          created_at?: string
          current_version?: number
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          id?: string
          mime_type?: string | null
          name: string
          project_id: string
          size_bytes?: number | null
          storage_path: string
          updated_at?: string
          uploaded_by: string
        }
        Update: {
          created_at?: string
          current_version?: number
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          id?: string
          mime_type?: string | null
          name?: string
          project_id?: string
          size_bytes?: number | null
          storage_path?: string
          updated_at?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_files_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_invites: {
        Row: {
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          project_id: string
          role_in_project: Database["public"]["Enums"]["project_role"]
          token_hash: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          expires_at: string
          id?: string
          invited_by: string
          project_id: string
          role_in_project?: Database["public"]["Enums"]["project_role"]
          token_hash: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          project_id?: string
          role_in_project?: Database["public"]["Enums"]["project_role"]
          token_hash?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_invites_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_members: {
        Row: {
          id: string
          invited_by: string | null
          joined_at: string
          project_id: string
          role_in_project: Database["public"]["Enums"]["project_role"]
          user_id: string
        }
        Insert: {
          id?: string
          invited_by?: string | null
          joined_at?: string
          project_id: string
          role_in_project?: Database["public"]["Enums"]["project_role"]
          user_id: string
        }
        Update: {
          id?: string
          invited_by?: string | null
          joined_at?: string
          project_id?: string
          role_in_project?: Database["public"]["Enums"]["project_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_members_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          category: string | null
          created_at: string
          created_by: string
          deleted_at: string | null
          deleted_by: string | null
          description: string | null
          end_date: string | null
          id: string
          name: string
          objectives: string | null
          start_date: string | null
          status: Database["public"]["Enums"]["project_status"]
          updated_at: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          created_by: string
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          end_date?: string | null
          id?: string
          name: string
          objectives?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          updated_at?: string
        }
        Update: {
          category?: string | null
          created_at?: string
          created_by?: string
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          end_date?: string | null
          id?: string
          name?: string
          objectives?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          updated_at?: string
        }
        Relationships: []
      }
      rag_logs: {
        Row: {
          chunks_count: number | null
          chunks_used: string[] | null
          created_at: string | null
          id: string
          latency_ms: number | null
          model_used: string | null
          query: string
          query_embedding: string | null
          response_summary: string | null
          tokens_input: number | null
          tokens_output: number | null
          user_id: string
        }
        Insert: {
          chunks_count?: number | null
          chunks_used?: string[] | null
          created_at?: string | null
          id?: string
          latency_ms?: number | null
          model_used?: string | null
          query: string
          query_embedding?: string | null
          response_summary?: string | null
          tokens_input?: number | null
          tokens_output?: number | null
          user_id: string
        }
        Update: {
          chunks_count?: number | null
          chunks_used?: string[] | null
          created_at?: string | null
          id?: string
          latency_ms?: number | null
          model_used?: string | null
          query?: string
          query_embedding?: string | null
          response_summary?: string | null
          tokens_input?: number | null
          tokens_output?: number | null
          user_id?: string
        }
        Relationships: []
      }
      report_attachments: {
        Row: {
          added_at: string
          added_by: string
          file_id: string
          id: string
          report_id: string
        }
        Insert: {
          added_at?: string
          added_by: string
          file_id: string
          id?: string
          report_id: string
        }
        Update: {
          added_at?: string
          added_by?: string
          file_id?: string
          id?: string
          report_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_attachments_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "project_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_attachments_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
        ]
      }
      report_versions: {
        Row: {
          content: string | null
          id: string
          is_autosave: boolean
          report_id: string
          saved_at: string
          saved_by: string
          summary: string | null
          title: string
          version_number: number
        }
        Insert: {
          content?: string | null
          id?: string
          is_autosave?: boolean
          report_id: string
          saved_at?: string
          saved_by: string
          summary?: string | null
          title: string
          version_number?: number
        }
        Update: {
          content?: string | null
          id?: string
          is_autosave?: boolean
          report_id?: string
          saved_at?: string
          saved_by?: string
          summary?: string | null
          title?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "report_versions_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
        ]
      }
      reports: {
        Row: {
          ai_model_used: string | null
          approved_at: string | null
          approved_by: string | null
          archived_at: string | null
          archived_by: string | null
          content: string | null
          created_at: string
          created_by: string
          deleted_at: string | null
          deleted_by: string | null
          generated_by_ai: boolean | null
          id: string
          project_id: string
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          source_insights_count: number | null
          status: Database["public"]["Enums"]["report_status"]
          submitted_at: string | null
          submitted_by: string | null
          summary: string | null
          title: string
          updated_at: string
        }
        Insert: {
          ai_model_used?: string | null
          approved_at?: string | null
          approved_by?: string | null
          archived_at?: string | null
          archived_by?: string | null
          content?: string | null
          created_at?: string
          created_by: string
          deleted_at?: string | null
          deleted_by?: string | null
          generated_by_ai?: boolean | null
          id?: string
          project_id: string
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_insights_count?: number | null
          status?: Database["public"]["Enums"]["report_status"]
          submitted_at?: string | null
          submitted_by?: string | null
          summary?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          ai_model_used?: string | null
          approved_at?: string | null
          approved_by?: string | null
          archived_at?: string | null
          archived_by?: string | null
          content?: string | null
          created_at?: string
          created_by?: string
          deleted_at?: string | null
          deleted_by?: string | null
          generated_by_ai?: boolean | null
          id?: string
          project_id?: string
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_insights_count?: number | null
          status?: Database["public"]["Enums"]["report_status"]
          submitted_at?: string | null
          submitted_by?: string | null
          summary?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reports_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      search_chunks: {
        Row: {
          chunk_hash: string
          chunk_index: number
          chunk_text: string
          created_at: string | null
          embedding: string | null
          id: string
          metadata: Json
          project_id: string
          source_id: string
          source_type: string
          tsv: unknown
        }
        Insert: {
          chunk_hash: string
          chunk_index?: number
          chunk_text: string
          created_at?: string | null
          embedding?: string | null
          id?: string
          metadata?: Json
          project_id: string
          source_id: string
          source_type: string
          tsv?: unknown
        }
        Update: {
          chunk_hash?: string
          chunk_index?: number
          chunk_text?: string
          created_at?: string | null
          embedding?: string | null
          id?: string
          metadata?: Json
          project_id?: string
          source_id?: string
          source_type?: string
          tsv?: unknown
        }
        Relationships: [
          {
            foreignKeyName: "search_chunks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      task_comments: {
        Row: {
          content: string
          created_at: string
          created_by: string
          id: string
          task_id: string
          updated_at: string
        }
        Insert: {
          content: string
          created_at?: string
          created_by: string
          id?: string
          task_id: string
          updated_at?: string
        }
        Update: {
          content?: string
          created_at?: string
          created_by?: string
          id?: string
          task_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_comments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          assigned_to: string | null
          created_at: string
          created_by: string
          deleted_at: string | null
          deleted_by: string | null
          description: string | null
          due_date: string | null
          id: string
          priority: Database["public"]["Enums"]["task_priority"]
          project_id: string
          status: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string
          created_by: string
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          priority?: Database["public"]["Enums"]["task_priority"]
          project_id: string
          status?: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          created_at?: string
          created_by?: string
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          priority?: Database["public"]["Enums"]["task_priority"]
          project_id?: string
          status?: Database["public"]["Enums"]["task_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_project_role: {
        Args: { _project_id: string; _user_id: string }
        Returns: Database["public"]["Enums"]["project_role"]
      }
      global_search:
        | {
            Args: { search_query: string }
            Returns: {
              project_id: string
              project_name: string
              relevance: number
              result_id: string
              result_type: string
              subtitle: string
              title: string
            }[]
          }
        | {
            Args: { p_user_id: string; search_query: string }
            Returns: {
              id: string
              project_id: string
              project_name: string
              relevance: number
              subtitle: string
              title: string
              type: string
            }[]
          }
      has_project_role: {
        Args: {
          _min_role: Database["public"]["Enums"]["project_role"]
          _project_id: string
          _user_id: string
        }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_project_member: {
        Args: { _project_id: string; _user_id: string }
        Returns: boolean
      }
      search_chunks_hybrid: {
        Args: {
          p_fts_weight?: number
          p_limit?: number
          p_project_ids: string[]
          p_query_embedding: string
          p_query_text: string
          p_semantic_weight?: number
        }
        Returns: {
          chunk_id: string
          chunk_index: number
          chunk_text: string
          metadata: Json
          project_id: string
          project_name: string
          score_final: number
          score_fts: number
          score_semantic: number
          source_id: string
          source_title: string
          source_type: string
        }[]
      }
    }
    Enums: {
      app_role: "admin" | "user"
      extraction_status: "pending" | "processing" | "completed" | "failed"
      knowledge_category:
        | "compound"
        | "parameter"
        | "result"
        | "method"
        | "observation"
        | "finding"
        | "correlation"
        | "anomaly"
        | "benchmark"
        | "recommendation"
        | "cross_reference"
        | "pattern"
        | "contradiction"
        | "gap"
      project_role: "owner" | "manager" | "researcher" | "viewer"
      project_status:
        | "planning"
        | "in_progress"
        | "review"
        | "completed"
        | "archived"
      report_status:
        | "draft"
        | "submitted"
        | "under_review"
        | "approved"
        | "archived"
      task_priority: "low" | "medium" | "high" | "urgent"
      task_status: "todo" | "in_progress" | "review" | "done"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user"],
      extraction_status: ["pending", "processing", "completed", "failed"],
      knowledge_category: [
        "compound",
        "parameter",
        "result",
        "method",
        "observation",
        "finding",
        "correlation",
        "anomaly",
        "benchmark",
        "recommendation",
        "cross_reference",
        "pattern",
        "contradiction",
        "gap",
      ],
      project_role: ["owner", "manager", "researcher", "viewer"],
      project_status: [
        "planning",
        "in_progress",
        "review",
        "completed",
        "archived",
      ],
      report_status: [
        "draft",
        "submitted",
        "under_review",
        "approved",
        "archived",
      ],
      task_priority: ["low", "medium", "high", "urgent"],
      task_status: ["todo", "in_progress", "review", "done"],
    },
  },
} as const
