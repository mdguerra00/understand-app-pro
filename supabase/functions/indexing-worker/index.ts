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

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const { batch_size = 5 } = await req.json().catch(() => ({}));

    // Get pending jobs (oldest first, highest priority first)
    const { data: jobs, error: fetchError } = await supabase
      .from("indexing_jobs")
      .select("*")
      .eq("status", "queued")
      .order("priority", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(batch_size);

    if (fetchError) {
      throw fetchError;
    }

    if (!jobs || jobs.length === 0) {
      return new Response(
        JSON.stringify({ message: "No pending jobs", processed: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Processing ${jobs.length} indexing jobs`);

    const results: Array<{ job_id: string; status: string; error?: string }> = [];

    for (const job of jobs) {
      try {
        // Mark as running
        await supabase
          .from("indexing_jobs")
          .update({ status: "running", started_at: new Date().toISOString() })
          .eq("id", job.id);

        // Determine source type from job type
        let sourceType = job.source_type;
        if (!sourceType && job.job_type) {
          sourceType = job.job_type.replace("index_", "");
        }

        // Call the index-content function
        const response = await fetch(`${supabaseUrl}/functions/v1/index-content`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify({
            job_id: job.id,
            source_type: sourceType,
            source_id: job.source_id,
            project_id: job.project_id,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Index failed: ${errorText}`);
        }

        const result = await response.json();
        results.push({ job_id: job.id, status: "done", ...result });

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`Job ${job.id} failed:`, errorMessage);

        // Update job with error
        const retryCount = (job.retry_count || 0) + 1;
        const newStatus = retryCount >= 3 ? "error" : "queued";

        await supabase
          .from("indexing_jobs")
          .update({
            status: newStatus,
            error_message: errorMessage,
            retry_count: retryCount,
            finished_at: newStatus === "error" ? new Date().toISOString() : null,
          })
          .eq("id", job.id);

        results.push({ job_id: job.id, status: newStatus, error: errorMessage });
      }
    }

    const successCount = results.filter((r) => r.status === "done").length;
    const errorCount = results.filter((r) => r.status === "error").length;

    return new Response(
      JSON.stringify({
        processed: jobs.length,
        success: successCount,
        errors: errorCount,
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Worker error:", errorMessage);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
