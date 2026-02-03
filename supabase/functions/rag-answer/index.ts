import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ChunkSource {
  id: string;
  source_type: string;
  source_id: string;
  source_title: string;
  project_name: string;
  chunk_text: string;
  chunk_index: number;
}

// Generate RAG response using Perplexity API
async function generateRAGResponse(
  query: string,
  chunks: ChunkSource[],
): Promise<{ response: string }> {
  const PERPLEXITY_API_KEY = Deno.env.get("PERPLEXITY_API_KEY");
  
  if (!PERPLEXITY_API_KEY) {
    throw new Error("PERPLEXITY_API_KEY is not configured");
  }

  // Format chunks with citation indices
  const formattedChunks = chunks
    .map((chunk, index) => {
      const citation = `[${index + 1}]`;
      return `${citation} Fonte: ${chunk.source_type} - "${chunk.source_title}" | Projeto: ${chunk.project_name}\n${chunk.chunk_text}`;
    })
    .join("\n\n---\n\n");

  const systemPrompt = `Você é um assistente especializado em P&D de materiais odontológicos. Responda APENAS com base nos trechos fornecidos abaixo.

REGRAS ABSOLUTAS (NÃO NEGOCIÁVEIS):
1. Toda afirmação técnica DEVE ter citação no formato [1], [2], etc.
2. Se não houver evidência suficiente nos trechos, diga: "Não encontrei informações suficientes sobre isso nos documentos disponíveis."
3. NUNCA invente dados, valores, percentuais ou informações que não estejam explicitamente nos trechos.
4. Se houver informações conflitantes entre fontes, mencione ambas com suas respectivas citações.
5. Mantenha um tom técnico e objetivo.
6. Seja conciso mas completo.

TRECHOS DISPONÍVEIS:
${formattedChunks}`;

  const userPrompt = `PERGUNTA DO USUÁRIO:
${query}

FORMATO DA RESPOSTA (seguir exatamente):

## Síntese
[Resposta consolidada e objetiva com citações [1], [2], etc. para cada afirmação técnica]

## Evidências Utilizadas
${chunks.map((_, i) => `- [${i + 1}] {Breve descrição da evidência}`).join("\n")}

## Lacunas Identificadas
[Liste o que falta informação ou precisa ser investigado mais a fundo. Se tudo foi respondido completamente, escreva "Nenhuma lacuna identificada para esta consulta."]`;

  const response = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${PERPLEXITY_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "sonar",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 2000,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Perplexity API error:", response.status, errorText);
    
    if (response.status === 429) {
      throw new Error("Rate limit exceeded. Please try again later.");
    }
    if (response.status === 402) {
      throw new Error("Perplexity API credits exhausted. Please add more credits.");
    }
    throw new Error(`Perplexity API error: ${response.status}`);
  }

  const data = await response.json();
  return {
    response: data.choices?.[0]?.message?.content || "Erro ao gerar resposta.",
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Require authentication
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

    const { query, chunk_ids, project_ids } = await req.json();

    if (!query || query.trim().length < 5) {
      return new Response(
        JSON.stringify({ error: "Query must be at least 5 characters" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get user's projects
    const { data: userProjects } = await supabase
      .from("project_members")
      .select("project_id")
      .eq("user_id", user.id);

    const allowedProjectIds = userProjects?.map((p) => p.project_id) || [];

    if (allowedProjectIds.length === 0) {
      return new Response(
        JSON.stringify({ 
          error: "Você não tem acesso a nenhum projeto.",
          response: null,
          sources: [] 
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let chunks: ChunkSource[] = [];

    // If specific chunk_ids provided, use those
    if (chunk_ids && chunk_ids.length > 0) {
      const { data, error } = await supabase
        .from("search_chunks")
        .select(`
          id,
          source_type,
          source_id,
          chunk_text,
          chunk_index,
          metadata,
          project_id,
          projects!inner(name)
        `)
        .in("id", chunk_ids)
        .in("project_id", allowedProjectIds);

      if (error) throw error;

      chunks = (data || []).map((row: any) => ({
        id: row.id,
        source_type: row.source_type,
        source_id: row.source_id,
        source_title: row.metadata?.title || "Sem título",
        project_name: row.projects?.name || "Projeto",
        chunk_text: row.chunk_text,
        chunk_index: row.chunk_index,
      }));
    } else {
      // Search for relevant chunks using FTS and ILIKE
      const targetProjectIds = project_ids?.length > 0
        ? project_ids.filter((id: string) => allowedProjectIds.includes(id))
        : allowedProjectIds;

      console.log("Searching in projects:", targetProjectIds);
      console.log("Query:", query);
      
      // Extract search terms for ILIKE matching
      const searchTerms = query.split(/\s+/).filter((w: string) => w.length > 2);
      console.log("Search terms:", searchTerms);
      
      let searchResults: any[] = [];

      // Try Full-Text Search first
      try {
        const { data: ftsData, error: ftsError } = await supabase
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
          .limit(12);

        if (!ftsError && ftsData && ftsData.length > 0) {
          searchResults = ftsData;
          console.log("FTS found:", ftsData.length, "results");
        }
      } catch (ftsError) {
        console.warn("FTS search failed:", ftsError);
      }

      // Fallback to ILIKE if FTS returned no results
      if (searchResults.length === 0 && searchTerms.length > 0) {
        const orConditions = searchTerms.map((term: string) => `chunk_text.ilike.%${term}%`).join(',');
        
        const { data: ilikeData, error: ilikeError } = await supabase
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
          .or(orConditions)
          .limit(12);

        if (!ilikeError && ilikeData) {
          searchResults = ilikeData;
          console.log("ILIKE found:", ilikeData.length, "results");
        }
      }

      chunks = searchResults.map((row: any) => ({
        id: row.id,
        source_type: row.source_type,
        source_id: row.source_id,
        source_title: row.metadata?.title || "Sem título",
        project_name: row.projects?.name || "Projeto",
        chunk_text: row.chunk_text,
        chunk_index: row.chunk_index || 0,
      }));
    }

    // Validate we have chunks
    if (chunks.length === 0) {
      return new Response(
        JSON.stringify({
          response: "Não encontrei informações relevantes nos documentos disponíveis para responder sua pergunta. Tente reformular a busca ou verifique se o conteúdo já foi indexado.",
          sources: [],
          chunks_used: 0,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Generate RAG response using Perplexity
    const { response } = await generateRAGResponse(query, chunks);

    const latencyMs = Date.now() - startTime;

    // Log the RAG query
    await supabase.from("rag_logs").insert({
      user_id: user.id,
      query,
      chunks_used: chunks.map((c) => c.id),
      chunks_count: chunks.length,
      response_summary: response.substring(0, 500),
      model_used: "perplexity/sonar",
      latency_ms: latencyMs,
    });

    // Format sources for response
    const sources = chunks.map((chunk, index) => ({
      citation: `[${index + 1}]`,
      type: chunk.source_type,
      id: chunk.source_id,
      title: chunk.source_title,
      project: chunk.project_name,
      excerpt: chunk.chunk_text.substring(0, 200) + "...",
    }));

    return new Response(
      JSON.stringify({
        response,
        sources,
        chunks_used: chunks.length,
        model_used: "perplexity/sonar",
        latency_ms: latencyMs,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("RAG error:", errorMessage);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
