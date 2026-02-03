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
  score_semantic: number;
  score_fts: number;
  score_final: number;
  metadata: Record<string, unknown>;
}

// Generate embedding for query
async function generateQueryEmbedding(query: string): Promise<number[] | null> {
  try {
    const response = await fetch("https://ai.gateway.lovable.dev/embed", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${Deno.env.get("LOVABLE_API_KEY")}`,
      },
      body: JSON.stringify({
        input: query,
        model: "text-embedding-3-small",
      }),
    });

    if (!response.ok) {
      console.error("Embedding API error:", await response.text());
      return null;
    }

    const data = await response.json();
    return data.data?.[0]?.embedding || null;
  } catch (error) {
    console.error("Query embedding error:", error);
    return null;
  }
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
      return new Response(
        JSON.stringify({ results: [], total: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Filter by specific projects if requested
    const targetProjectIds = project_ids?.length > 0
      ? project_ids.filter((id: string) => allowedProjectIds.includes(id))
      : allowedProjectIds;

    // Generate embedding for query
    const queryEmbedding = await generateQueryEmbedding(query);
    
    if (!queryEmbedding) {
      // Fallback to FTS only
      console.warn("Embedding generation failed, using FTS only");
    }

    // Perform hybrid search using raw SQL
    const semanticWeight = 0.65;
    const ftsWeight = 0.35;

    let results: SearchResult[] = [];

    if (queryEmbedding) {
      // Full hybrid search
      const { data, error } = await supabase.rpc("search_chunks_hybrid", {
        p_query_text: query,
        p_query_embedding: `[${queryEmbedding.join(",")}]`,
        p_project_ids: targetProjectIds,
        p_limit: limit * 2,
        p_semantic_weight: semanticWeight,
        p_fts_weight: ftsWeight,
      });

      if (error) {
        console.error("Hybrid search error:", error);
        throw error;
      }

      results = data || [];
    } else {
      // FTS only fallback
      const { data, error } = await supabase
        .from("search_chunks")
        .select(`
          id,
          project_id,
          source_type,
          source_id,
          chunk_text,
          chunk_index,
          metadata,
          projects!inner(name)
        `)
        .in("project_id", targetProjectIds)
        .textSearch("tsv", query, { type: "websearch", config: "portuguese" })
        .limit(limit);

      if (error) {
        throw error;
      }

      results = (data || []).map((row: any, index: number) => ({
        chunk_id: row.id,
        project_id: row.project_id,
        project_name: row.projects?.name || "Unknown",
        source_type: row.source_type,
        source_id: row.source_id,
        source_title: row.metadata?.title || "Untitled",
        chunk_text: row.chunk_text,
        chunk_index: row.chunk_index,
        score_semantic: 0,
        score_fts: 1 - index * 0.05, // Approximate ranking
        score_final: 1 - index * 0.05,
        metadata: row.metadata,
      }));
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
        has_semantic: !!queryEmbedding,
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
