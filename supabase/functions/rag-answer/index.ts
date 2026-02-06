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

// Generate embedding for the query
async function generateQueryEmbedding(text: string, apiKey: string): Promise<string | null> {
  try {
    const response = await fetch("https://ai.gateway.lovable.dev/v1/embeddings", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: text.substring(0, 8000),
      }),
    });

    if (!response.ok) {
      console.warn("Query embedding failed:", response.status);
      return null;
    }

    const data = await response.json();
    const embedding = data.data?.[0]?.embedding;
    if (embedding) {
      return JSON.stringify(embedding);
    }
    return null;
  } catch (error) {
    console.warn("Query embedding error:", error);
    return null;
  }
}

// Generate RAG response using Lovable AI Gateway
async function generateRAGResponse(
  query: string,
  chunks: ChunkSource[],
  apiKey: string,
  conversationHistory?: { role: string; content: string }[],
): Promise<{ response: string }> {
  // Format chunks with citation indices
  const formattedChunks = chunks
    .map((chunk, index) => {
      const citation = `[${index + 1}]`;
      return `${citation} Fonte: ${chunk.source_type} - "${chunk.source_title}" | Projeto: ${chunk.project_name}\n${chunk.chunk_text}`;
    })
    .join("\n\n---\n\n");

  const systemPrompt = `Você é um assistente especializado em P&D de materiais odontológicos. Responda com base nos trechos fornecidos abaixo.

REGRAS ABSOLUTAS (NÃO NEGOCIÁVEIS):
1. Toda afirmação técnica DEVE ter citação no formato [1], [2], etc.
2. Se não houver evidência suficiente nos trechos, diga: "Não encontrei informações suficientes sobre isso nos documentos disponíveis."
3. NUNCA invente dados, valores, percentuais ou informações que não estejam explicitamente nos trechos.
4. Se houver informações conflitantes entre fontes, mencione ambas com suas respectivas citações.
5. Mantenha um tom técnico e objetivo.
6. Seja conciso mas completo.
7. Quando identificar RELAÇÕES entre diferentes fontes, destaque-as explicitamente.
8. Se os trechos contêm insights do tipo "cross_reference", "pattern", "contradiction" ou "gap", integre essas análises na resposta.

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

  // Build messages array with conversation history
  const messages: { role: string; content: string }[] = [
    { role: "system", content: systemPrompt },
  ];

  // Add conversation history for context (last 6 messages)
  if (conversationHistory && conversationHistory.length > 0) {
    const recentHistory = conversationHistory.slice(-6);
    for (const msg of recentHistory) {
      if (msg.role === "user" || msg.role === "assistant") {
        messages.push({ role: msg.role, content: msg.content });
      }
    }
  }

  messages.push({ role: "user", content: userPrompt });

  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages,
      temperature: 0.3,
      max_tokens: 3000,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Lovable AI error:", response.status, errorText);
    
    if (response.status === 429) {
      throw new Error("Rate limit exceeded. Please try again later.");
    }
    if (response.status === 402) {
      throw new Error("AI credits exhausted. Please add more credits.");
    }
    throw new Error(`AI Gateway error: ${response.status}`);
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
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");

    if (!lovableApiKey) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

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

    const { query, chunk_ids, project_ids, conversation_history } = await req.json();

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

    if (chunk_ids && chunk_ids.length > 0) {
      // Use specific chunk_ids
      const { data, error } = await supabase
        .from("search_chunks")
        .select(`
          id, source_type, source_id, chunk_text, chunk_index, metadata,
          project_id, projects!inner(name)
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
      // Hybrid search: semantic + FTS
      const targetProjectIds = project_ids?.length > 0
        ? project_ids.filter((id: string) => allowedProjectIds.includes(id))
        : allowedProjectIds;

      console.log("Searching in projects:", targetProjectIds);
      console.log("Query:", query);

      // Try hybrid search first (semantic + FTS)
      const queryEmbedding = await generateQueryEmbedding(query, lovableApiKey);

      if (queryEmbedding) {
        console.log("Using hybrid search (semantic + FTS)");
        try {
          const { data: hybridData, error: hybridError } = await supabase.rpc("search_chunks_hybrid", {
            p_query_text: query,
            p_query_embedding: queryEmbedding,
            p_project_ids: targetProjectIds,
            p_limit: 15,
            p_semantic_weight: 0.65,
            p_fts_weight: 0.35,
          });

          if (!hybridError && hybridData && hybridData.length > 0) {
            console.log("Hybrid search found:", hybridData.length, "results");
            chunks = hybridData.map((row: any) => ({
              id: row.chunk_id,
              source_type: row.source_type,
              source_id: row.source_id,
              source_title: row.source_title || "Sem título",
              project_name: row.project_name || "Projeto",
              chunk_text: row.chunk_text,
              chunk_index: row.chunk_index || 0,
            }));
          } else {
            console.warn("Hybrid search returned no results or error:", hybridError);
          }
        } catch (hybridErr) {
          console.warn("Hybrid search failed:", hybridErr);
        }
      }

      // Fallback to FTS + ILIKE if hybrid search failed or returned nothing
      if (chunks.length === 0) {
        console.log("Falling back to FTS/ILIKE search");
        
        // Normalize search terms
        const normalizedQuery = query
          .toLowerCase()
          .replace(/[^\w\sáàâãéèêíìîóòôõúùûç]/gi, ' ')
          .replace(/\s+/g, ' ')
          .trim();

        const searchTerms = normalizedQuery
          .split(' ')
          .filter((w: string) => w.length > 2)
          .filter((w: string, i: number, arr: string[]) => arr.indexOf(w) === i)
          .slice(0, 10);

        // Try FTS first
        try {
          const { data: ftsData, error: ftsError } = await supabase
            .from("search_chunks")
            .select(`
              id, project_id, source_type, source_id, chunk_text, chunk_index, metadata,
              projects!inner(name)
            `)
            .in("project_id", targetProjectIds)
            .textSearch("tsv", query, { type: "websearch", config: "portuguese" })
            .limit(15);

          if (!ftsError && ftsData && ftsData.length > 0) {
            chunks = ftsData.map((row: any) => ({
              id: row.id,
              source_type: row.source_type,
              source_id: row.source_id,
              source_title: row.metadata?.title || "Sem título",
              project_name: row.projects?.name || "Projeto",
              chunk_text: row.chunk_text,
              chunk_index: row.chunk_index || 0,
            }));
            console.log("FTS found:", ftsData.length, "results");
          }
        } catch (ftsErr) {
          console.warn("FTS failed:", ftsErr);
        }

        // ILIKE fallback
        if (chunks.length === 0 && searchTerms.length > 0) {
          try {
            const orConditions = searchTerms
              .map((term: string) => `chunk_text.ilike.%${term}%`)
              .join(',');
            
            const { data: ilikeData, error: ilikeError } = await supabase
              .from("search_chunks")
              .select(`
                id, project_id, source_type, source_id, chunk_text, chunk_index, metadata,
                projects!inner(name)
              `)
              .in("project_id", targetProjectIds)
              .or(orConditions)
              .limit(15);

            if (!ilikeError && ilikeData) {
              chunks = ilikeData.map((row: any) => ({
                id: row.id,
                source_type: row.source_type,
                source_id: row.source_id,
                source_title: row.metadata?.title || "Sem título",
                project_name: row.projects?.name || "Projeto",
                chunk_text: row.chunk_text,
                chunk_index: row.chunk_index || 0,
              }));
              console.log("ILIKE found:", ilikeData.length, "results");
            }
          } catch (err) {
            console.error("ILIKE search exception:", err);
          }
        }
      }
    }

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

    // Generate RAG response using Lovable AI
    const { response } = await generateRAGResponse(query, chunks, lovableApiKey, conversation_history);

    const latencyMs = Date.now() - startTime;

    // Log the RAG query
    await supabase.from("rag_logs").insert({
      user_id: user.id,
      query,
      chunks_used: chunks.map((c) => c.id),
      chunks_count: chunks.length,
      response_summary: response.substring(0, 500),
      model_used: "lovable-ai/gemini-3-flash-preview",
      latency_ms: latencyMs,
    });

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
        model_used: "lovable-ai/gemini-3-flash-preview",
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
