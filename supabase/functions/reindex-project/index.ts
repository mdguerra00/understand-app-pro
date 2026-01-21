import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Require authentication
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Authorization required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(
        JSON.stringify({ error: "Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { project_id } = await req.json();

    if (!project_id) {
      return new Response(
        JSON.stringify({ error: "project_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check user has manager+ role in project
    const { data: hasRole } = await supabase.rpc("has_project_role", {
      _user_id: user.id,
      _project_id: project_id,
      _min_role: "manager",
    });

    if (!hasRole) {
      return new Response(
        JSON.stringify({ error: "Requires manager or owner role" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Delete existing chunks for this project
    const { error: deleteError } = await supabase
      .from("search_chunks")
      .delete()
      .eq("project_id", project_id);

    if (deleteError) {
      console.error("Delete chunks error:", deleteError);
    }

    // Cancel any pending jobs for this project
    await supabase
      .from("indexing_jobs")
      .update({ status: "error", error_message: "Cancelled by reindex" })
      .eq("project_id", project_id)
      .eq("status", "queued");

    // Get all reports
    const { data: reports } = await supabase
      .from("reports")
      .select("id")
      .eq("project_id", project_id)
      .is("deleted_at", null);

    // Get all tasks
    const { data: tasks } = await supabase
      .from("tasks")
      .select("id")
      .eq("project_id", project_id)
      .is("deleted_at", null);

    // Get all insights
    const { data: insights } = await supabase
      .from("knowledge_items")
      .select("id")
      .eq("project_id", project_id)
      .is("deleted_at", null);

    // Create indexing jobs
    const jobs: Array<{
      job_type: string;
      project_id: string;
      source_type: string;
      source_id: string;
      created_by: string;
      priority: number;
    }> = [];

    // Reports (highest priority)
    for (const report of reports || []) {
      jobs.push({
        job_type: "index_report",
        project_id,
        source_type: "report",
        source_id: report.id,
        created_by: user.id,
        priority: 10,
      });
    }

    // Tasks
    for (const task of tasks || []) {
      jobs.push({
        job_type: "index_task",
        project_id,
        source_type: "task",
        source_id: task.id,
        created_by: user.id,
        priority: 8,
      });
    }

    // Insights
    for (const insight of insights || []) {
      jobs.push({
        job_type: "index_insight",
        project_id,
        source_type: "insight",
        source_id: insight.id,
        created_by: user.id,
        priority: 9,
      });
    }

    if (jobs.length > 0) {
      const { error: insertError } = await supabase
        .from("indexing_jobs")
        .insert(jobs);

      if (insertError) {
        throw insertError;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        jobs_created: jobs.length,
        breakdown: {
          reports: reports?.length || 0,
          tasks: tasks?.length || 0,
          insights: insights?.length || 0,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Reindex error:", errorMessage);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
