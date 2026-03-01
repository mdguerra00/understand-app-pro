import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface SearchResult {
  chunk_id: string;
  project_id: string;
  project_name: string;
  source_type: string;
  source_id: string;
  source_title: string;
  chunk_text: string;
  chunk_index: number;
  score_final: number;
  metadata: Record<string, unknown>;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    
    // Get user from auth header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Authorization required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
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

    const { query, limit = 15, project_ids } = await req.json();

    if (!query || query.trim().length < 2) {
      return new Response(
        JSON.stringify({ error: "Query must be at least 2 characters" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get user's projects for RLS filtering
    const { data: userProjects } = await supabase
      .from("project_members")
      .select("project_id")
      .eq("user_id", user.id);

    const allowedProjectIds = userProjects?.map((p) => p.project_id) || [];
    
    if (allowedProjectIds.length === 0) {
      // Still search global chunks even if user has no projects
    }

    // Filter by specific projects if requested, always include global
    const targetProjectIds = project_ids?.length > 0
      ? project_ids.filter((id: string) => allowedProjectIds.includes(id))
      : allowedProjectIds;

    // Extract search terms for ILIKE matching
    const searchTerms = query.split(/\s+/).filter((w: string) => w.length > 2);
    
    let results: SearchResult[] = [];

    // Try Full-Text Search first - project-scoped chunks
    try {
      if (targetProjectIds.length > 0) {
        const { data: ftsData, error: ftsError } = await supabase
          .from("search_chunks")
          .select(`id, project_id, source_type, source_id, chunk_text, chunk_index, metadata, projects!inner(name)`)
          .in("project_id", targetProjectIds)
          .textSearch("tsv", query, { type: "websearch", config: "portuguese" })
          .limit(limit);

        if (!ftsError && ftsData && ftsData.length > 0) {
          results = ftsData.map((row: any, index: number) => ({
            chunk_id: row.id,
            project_id: row.project_id,
            project_name: row.projects?.name || "Unknown",
            source_type: row.source_type,
            source_id: row.source_id,
            source_title: row.metadata?.title || "Untitled",
            chunk_text: row.chunk_text,
            chunk_index: row.chunk_index,
            score_final: 1 - index * 0.05,
            metadata: row.metadata,
          }));
        }
      }

      // Also search global chunks (project_id IS NULL)
      const { data: globalFts } = await supabase
        .from("search_chunks")
        .select(`id, project_id, source_type, source_id, chunk_text, chunk_index, metadata`)
        .is("project_id", null)
        .textSearch("tsv", query, { type: "websearch", config: "portuguese" })
        .limit(limit);

      if (globalFts && globalFts.length > 0) {
        const globalResults = globalFts.map((row: any, index: number) => ({
          chunk_id: row.id,
          project_id: null,
          project_name: "Global",
          source_type: row.source_type,
          source_id: row.source_id,
          source_title: row.metadata?.title || "Untitled",
          chunk_text: row.chunk_text,
          chunk_index: row.chunk_index,
          score_final: 0.95 - index * 0.05,
          metadata: row.metadata,
        }));
        results = [...results, ...globalResults];
      }
    } catch (ftsError) {
      console.warn("FTS search failed, falling back to ILIKE:", ftsError);
    }

    // Fallback to ILIKE if FTS returned no results
    if (results.length === 0 && searchTerms.length > 0) {
      const orConditions = searchTerms.map((term: string) => `chunk_text.ilike.%${term}%`).join(',');
      
      // Search project chunks
      if (targetProjectIds.length > 0) {
        const { data: ilikeData } = await supabase
          .from("search_chunks")
          .select(`id, project_id, source_type, source_id, chunk_text, chunk_index, metadata, projects!inner(name)`)
          .in("project_id", targetProjectIds)
          .or(orConditions)
          .limit(limit);

        if (ilikeData) {
          results = ilikeData.map((row: any, index: number) => ({
            chunk_id: row.id,
            project_id: row.project_id,
            project_name: row.projects?.name || "Unknown",
            source_type: row.source_type,
            source_id: row.source_id,
            source_title: row.metadata?.title || "Untitled",
            chunk_text: row.chunk_text,
            chunk_index: row.chunk_index,
            score_final: 1 - index * 0.05,
            metadata: row.metadata,
          }));
        }
      }

      // Search global chunks
      const { data: globalIlike } = await supabase
        .from("search_chunks")
        .select(`id, project_id, source_type, source_id, chunk_text, chunk_index, metadata`)
        .is("project_id", null)
        .or(orConditions)
        .limit(limit);

      if (globalIlike) {
        const globalResults = globalIlike.map((row: any, index: number) => ({
          chunk_id: row.id,
          project_id: null,
          project_name: "Global",
          source_type: row.source_type,
          source_id: row.source_id,
          source_title: row.metadata?.title || "Untitled",
          chunk_text: row.chunk_text,
          chunk_index: row.chunk_index,
          score_final: 0.95 - index * 0.05,
          metadata: row.metadata,
        }));
        results = [...results, ...globalResults];
      }
    }

    // Deduplicate by source (keep highest scoring chunk per source)
    const seenSources = new Map<string, SearchResult>();
    for (const result of results) {
      const key = `${result.source_type}:${result.source_id}`;
      const existing = seenSources.get(key);
      if (!existing || result.score_final > existing.score_final) {
        seenSources.set(key, result);
      }
    }

    const dedupedResults = Array.from(seenSources.values())
      .sort((a, b) => b.score_final - a.score_final)
      .slice(0, limit);

    return new Response(
      JSON.stringify({
        results: dedupedResults,
        total: dedupedResults.length,
        query,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Search error:", errorMessage);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
