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

async function generateQueryEmbedding(text: string, apiKey: string): Promise<string | null> {
  try {
    const response = await fetch("https://ai.gateway.lovable.dev/v1/embeddings", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "text-embedding-3-small", input: text.substring(0, 8000) }),
    });
    if (!response.ok) return null;
    const data = await response.json();
    const embedding = data.data?.[0]?.embedding;
    return embedding ? JSON.stringify(embedding) : null;
  } catch { return null; }
}

/**
 * Fetch structured experiments + measurements for the user's projects
 */
async function fetchExperimentContext(
  supabase: any,
  projectIds: string[],
  query: string
): Promise<{ contextText: string; evidenceTable: string; experimentSources: any[] }> {
  const searchTerms = query.toLowerCase().split(/\s+/).filter((w: string) => w.length > 2).slice(0, 5);
  
  const { data: experiments } = await supabase
    .from('experiments')
    .select(`
      id, title, objective, summary, source_type, is_qualitative, source_file_id,
      project_files!inner(name),
      projects!inner(name)
    `)
    .in('project_id', projectIds)
    .is('deleted_at', null)
    .limit(50);

  if (!experiments || experiments.length === 0) return { contextText: '', evidenceTable: '', experimentSources: [] };

  const expIds = experiments.map((e: any) => e.id);
  const { data: measurements } = await supabase
    .from('measurements')
    .select('experiment_id, metric, raw_metric_name, value, unit, method, confidence, source_excerpt')
    .in('experiment_id', expIds);

  const { data: conditions } = await supabase
    .from('experiment_conditions')
    .select('experiment_id, key, value')
    .in('experiment_id', expIds);

  // Build map
  const expMap = new Map<string, any>();
  for (const exp of experiments) {
    expMap.set(exp.id, { ...exp, measurements: [], conditions: [] });
  }
  for (const m of (measurements || [])) {
    const exp = expMap.get(m.experiment_id);
    if (exp) exp.measurements.push(m);
  }
  for (const c of (conditions || [])) {
    const exp = expMap.get(c.experiment_id);
    if (exp) exp.conditions.push(c);
  }

  // Filter relevant
  const relevant = Array.from(expMap.values()).filter((exp: any) => {
    const text = `${exp.title} ${exp.objective || ''} ${exp.summary || ''} ${exp.measurements.map((m: any) => m.metric).join(' ')} ${exp.conditions.map((c: any) => `${c.key} ${c.value}`).join(' ')}`.toLowerCase();
    return searchTerms.some((term: string) => text.includes(term));
  });

  if (relevant.length === 0) return { contextText: '', evidenceTable: '', experimentSources: [] };

  // Build context text for AI
  let contextText = '\n\n=== DADOS ESTRUTURADOS DE EXPERIMENTOS ===\n\n';
  const experimentSources: any[] = [];

  for (let i = 0; i < Math.min(relevant.length, 10); i++) {
    const exp = relevant[i];
    contextText += `📋 Experimento: ${exp.title}\n`;
    if (exp.objective) contextText += `   Objetivo: ${exp.objective}\n`;
    contextText += `   Fonte: ${exp.project_files?.name || 'N/A'} | Projeto: ${exp.projects?.name || 'N/A'}\n`;
    contextText += `   Tipo: ${exp.is_qualitative ? 'Qualitativo' : 'Quantitativo'}\n`;
    if (exp.conditions.length > 0) {
      contextText += `   Condições: ${exp.conditions.map((c: any) => `${c.key}=${c.value}`).join(', ')}\n`;
    }
    if (exp.measurements.length > 0) {
      contextText += '   Medições:\n';
      for (const m of exp.measurements) {
        contextText += `   - ${m.metric}: ${m.value} ${m.unit} (${m.method || '-'}, conf: ${m.confidence})\n`;
      }
    }
    contextText += '\n';

    // Build experiment source entry
    const measSummary = exp.measurements.slice(0, 3)
      .map((m: any) => `${m.metric} ${m.value} ${m.unit}`)
      .join(', ');
    experimentSources.push({
      citation: `E${i + 1}`,
      type: 'experiment',
      id: exp.id,
      title: exp.title,
      project: exp.projects?.name || 'Projeto',
      excerpt: `${exp.measurements.length} medições: ${measSummary}${exp.measurements.length > 3 ? '...' : ''}`,
    });
  }

  // Build evidence table directly from structured data (NOT from AI)
  let evidenceTable = '';
  const measRows = relevant.flatMap((exp: any) => 
    exp.measurements.map((m: any) => ({
      experiment: exp.title,
      condition: exp.conditions.map((c: any) => `${c.key}=${c.value}`).join('; ') || '-',
      metric: m.raw_metric_name || m.metric,
      result: `${m.value} ${m.unit}`,
      source: exp.project_files?.name || 'N/A',
    }))
  );

  if (measRows.length > 0) {
    evidenceTable = '| Experimento | Condição-chave | Métrica | Resultado | Fonte |\n';
    evidenceTable += '|-------------|---------------|---------|-----------|-------|\n';
    for (const row of measRows) {
      evidenceTable += `| ${row.experiment} | ${row.condition} | ${row.metric} | ${row.result} | ${row.source} |\n`;
    }
  }

  return { contextText, evidenceTable, experimentSources };
}

async function generateRAGResponse(
  query: string,
  chunks: ChunkSource[],
  experimentContextText: string,
  preBuiltEvidenceTable: string,
  apiKey: string,
  conversationHistory?: { role: string; content: string }[],
): Promise<{ response: string }> {
  const formattedChunks = chunks
    .map((chunk, index) => `[${index + 1}] Fonte: ${chunk.source_type} - "${chunk.source_title}" | Projeto: ${chunk.project_name}\n${chunk.chunk_text}`)
    .join("\n\n---\n\n");

  const systemPrompt = `Você é um assistente especializado em P&D de materiais odontológicos. Responda com base nos trechos e dados estruturados fornecidos.

REGRAS ABSOLUTAS (NÃO NEGOCIÁVEIS):
1. Toda afirmação técnica DEVE ter citação [1], [2], etc. ou referência a experimento
2. Se não houver evidência, diga: "Não encontrei informações suficientes."
3. NUNCA invente dados ou valores
4. Se houver informações conflitantes, mencione ambas
5. PRIORIZE dados estruturados (experimentos/medições) sobre texto livre
6. Se não houver medições quantitativas: "Não encontrei medições quantitativas registradas sobre este tema."
7. A TABELA DE EVIDÊNCIAS abaixo foi gerada diretamente dos dados estruturados — inclua-a na resposta SEM modificar os valores

TRECHOS DISPONÍVEIS:
${formattedChunks}
${experimentContextText}`;

  const evidenceSection = preBuiltEvidenceTable
    ? `## 2. Evidências\n${preBuiltEvidenceTable}\n\n[Complementar com dados dos trechos se relevante]`
    : `## 2. Evidências\n[Listar evidências dos trechos com citações]`;

  const userPrompt = `PERGUNTA: ${query}

FORMATO OBRIGATÓRIO DA RESPOSTA:

## 1. Síntese Técnica
[Resumo factual do que foi observado, com citações]

${evidenceSection}

## 3. Heurísticas Derivadas
[Regras observadas + nível de confiança (alto/médio/baixo). Se não há dados suficientes, omitir esta seção]

## 4. Lacunas
[O que NÃO foi medido ou precisa investigação. Se tudo respondido: "Nenhuma lacuna identificada."]

## 5. Fontes
[Lista numerada: arquivo + página/planilha]`;

  const messages: { role: string; content: string }[] = [
    { role: "system", content: systemPrompt },
  ];

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
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages,
      temperature: 0.3,
      max_tokens: 4000,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    if (response.status === 429) throw new Error("Rate limit exceeded.");
    if (response.status === 402) throw new Error("AI credits exhausted.");
    throw new Error(`AI Gateway error: ${response.status}`);
  }

  const data = await response.json();
  return { response: data.choices?.[0]?.message?.content || "Erro ao gerar resposta." };
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
    if (!lovableApiKey) throw new Error("LOVABLE_API_KEY is not configured");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Authorization required" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { query, chunk_ids, project_ids, conversation_history } = await req.json();

    if (!query || query.trim().length < 5) {
      return new Response(JSON.stringify({ error: "Query must be at least 5 characters" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: userProjects } = await supabase
      .from("project_members")
      .select("project_id")
      .eq("user_id", user.id);

    const allowedProjectIds = userProjects?.map((p: any) => p.project_id) || [];

    if (allowedProjectIds.length === 0) {
      return new Response(JSON.stringify({
        error: "Você não tem acesso a nenhum projeto.", response: null, sources: [],
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Determine target projects
    const targetProjectIds = project_ids?.length > 0
      ? project_ids.filter((id: string) => allowedProjectIds.includes(id))
      : allowedProjectIds;

    // ==========================================
    // FETCH STRUCTURED EXPERIMENT CONTEXT (priority)
    // ==========================================
    const { contextText: experimentContextText, evidenceTable: preBuiltEvidenceTable, experimentSources } = await fetchExperimentContext(supabase, targetProjectIds, query);

    // ==========================================
    // CHUNK SEARCH (existing logic)
    // ==========================================
    let chunks: ChunkSource[] = [];

    if (chunk_ids && chunk_ids.length > 0) {
      const { data, error } = await supabase
        .from("search_chunks")
        .select(`id, source_type, source_id, chunk_text, chunk_index, metadata, project_id, projects!inner(name)`)
        .in("id", chunk_ids)
        .in("project_id", allowedProjectIds);
      if (error) throw error;
      chunks = (data || []).map((row: any) => ({
        id: row.id, source_type: row.source_type, source_id: row.source_id,
        source_title: row.metadata?.title || "Sem título",
        project_name: row.projects?.name || "Projeto",
        chunk_text: row.chunk_text, chunk_index: row.chunk_index,
      }));
    } else {
      const queryEmbedding = await generateQueryEmbedding(query, lovableApiKey);

      if (queryEmbedding) {
        try {
          const { data: hybridData, error: hybridError } = await supabase.rpc("search_chunks_hybrid", {
            p_query_text: query, p_query_embedding: queryEmbedding,
            p_project_ids: targetProjectIds, p_limit: 15,
            p_semantic_weight: 0.65, p_fts_weight: 0.35,
          });
          if (!hybridError && hybridData?.length > 0) {
            chunks = hybridData.map((row: any) => ({
              id: row.chunk_id, source_type: row.source_type, source_id: row.source_id,
              source_title: row.source_title || "Sem título",
              project_name: row.project_name || "Projeto",
              chunk_text: row.chunk_text, chunk_index: row.chunk_index || 0,
            }));
          }
        } catch {}
      }

      // FTS fallback
      if (chunks.length === 0) {
        try {
          const { data: ftsData } = await supabase
            .from("search_chunks")
            .select(`id, project_id, source_type, source_id, chunk_text, chunk_index, metadata, projects!inner(name)`)
            .in("project_id", targetProjectIds)
            .textSearch("tsv", query, { type: "websearch", config: "portuguese" })
            .limit(15);
          if (ftsData?.length) {
            chunks = ftsData.map((row: any) => ({
              id: row.id, source_type: row.source_type, source_id: row.source_id,
              source_title: row.metadata?.title || "Sem título",
              project_name: row.projects?.name || "Projeto",
              chunk_text: row.chunk_text, chunk_index: row.chunk_index || 0,
            }));
          }
        } catch {}

        // ILIKE fallback
        if (chunks.length === 0) {
          const searchTerms = query.toLowerCase().replace(/[^\w\sáàâãéèêíìîóòôõúùûç]/gi, ' ').trim()
            .split(' ').filter((w: string) => w.length > 2).slice(0, 10);
          if (searchTerms.length > 0) {
            try {
              const orConditions = searchTerms.map((term: string) => `chunk_text.ilike.%${term}%`).join(',');
              const { data: ilikeData } = await supabase
                .from("search_chunks")
                .select(`id, project_id, source_type, source_id, chunk_text, chunk_index, metadata, projects!inner(name)`)
                .in("project_id", targetProjectIds)
                .or(orConditions)
                .limit(15);
              if (ilikeData) {
                chunks = ilikeData.map((row: any) => ({
                  id: row.id, source_type: row.source_type, source_id: row.source_id,
                  source_title: row.metadata?.title || "Sem título",
                  project_name: row.projects?.name || "Projeto",
                  chunk_text: row.chunk_text, chunk_index: row.chunk_index || 0,
                }));
              }
            } catch {}
          }
        }
      }
    }

    // If no chunks AND no experiment context, return empty
    if (chunks.length === 0 && !experimentContextText) {
      return new Response(JSON.stringify({
        response: "Não encontrei informações relevantes nos documentos disponíveis para responder sua pergunta. Tente reformular a busca ou verifique se o conteúdo já foi indexado.",
        sources: [], chunks_used: 0,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Generate response with experiment context
    const { response } = await generateRAGResponse(query, chunks, experimentContextText, preBuiltEvidenceTable, lovableApiKey, conversation_history);

    const latencyMs = Date.now() - startTime;

    await supabase.from("rag_logs").insert({
      user_id: user.id, query,
      chunks_used: chunks.map((c) => c.id),
      chunks_count: chunks.length,
      response_summary: response.substring(0, 500),
      model_used: "lovable-ai/gemini-3-flash-preview",
      latency_ms: latencyMs,
    });

    const chunkSources = chunks.map((chunk, index) => ({
      citation: `${index + 1}`, type: chunk.source_type,
      id: chunk.source_id, title: chunk.source_title,
      project: chunk.project_name, excerpt: chunk.chunk_text.substring(0, 200) + "...",
    }));

    // Merge chunk sources with experiment sources
    const sources = [...chunkSources, ...experimentSources];

    return new Response(JSON.stringify({
      response, sources, chunks_used: chunks.length,
      has_experiment_data: !!experimentContextText,
      model_used: "lovable-ai/gemini-3-flash-preview", latency_ms: latencyMs,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("RAG error:", errorMessage);
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
