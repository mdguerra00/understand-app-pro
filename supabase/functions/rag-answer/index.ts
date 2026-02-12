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

// ==========================================
// EMBEDDING
// ==========================================
async function generateQueryEmbedding(text: string, apiKey: string): Promise<string | null> {
  try {
    const response = await fetch("https://ai.gateway.lovable.dev/v1/embeddings", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "text-embedding-3-small", input: text.substring(0, 8000) }),
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data.data?.[0]?.embedding ? JSON.stringify(data.data[0].embedding) : null;
  } catch { return null; }
}

// ==========================================
// FETCH AGGREGATED METRIC SUMMARIES (new!)
// ==========================================
async function fetchMetricSummaries(
  supabase: any,
  projectIds: string[],
  query: string
): Promise<string> {
  const searchTerms = query.toLowerCase().split(/\s+/).filter((w: string) => w.length > 2).slice(0, 5);
  
  // Use the new experiment_metric_summary view via service role
  const { data: summaries } = await supabase
    .from('experiment_metric_summary')
    .select('*')
    .in('project_id', projectIds);

  if (!summaries || summaries.length === 0) return '';

  // Filter relevant summaries
  const relevant = summaries.filter((s: any) => {
    const text = `${s.experiment_title} ${s.metric} ${s.raw_metric_name || ''} ${s.unit}`.toLowerCase();
    return searchTerms.some((term: string) => text.includes(term));
  });

  if (relevant.length === 0) return '';

  let text = '\n\n=== RESUMOS ESTATÍSTICOS DE MÉTRICAS ===\n\n';
  text += '| Experimento | Métrica | N | Min | Max | Média | Mediana | DP | Unidade | Confiança |\n';
  text += '|-------------|---------|---|-----|-----|-------|---------|----|---------|-----------|\n';
  for (const s of relevant.slice(0, 30)) {
    const avg = Number(s.avg_value).toFixed(2);
    const med = Number(s.median_value).toFixed(2);
    const sd = s.stddev_value ? Number(s.stddev_value).toFixed(2) : '-';
    const conf = s.avg_confidence ? (Number(s.avg_confidence) >= 0.8 ? 'alta' : Number(s.avg_confidence) >= 0.6 ? 'média' : 'baixa') : '-';
    text += `| ${s.experiment_title} | ${s.raw_metric_name || s.metric} | ${s.n} | ${Number(s.min_value).toFixed(2)} | ${Number(s.max_value).toFixed(2)} | ${avg} | ${med} | ${sd} | ${s.unit} | ${conf} |\n`;
  }

  // Also fetch condition summaries
  const { data: condSummaries } = await supabase
    .from('condition_metric_summary')
    .select('*')
    .in('project_id', projectIds);

  if (condSummaries && condSummaries.length > 0) {
    const relevantCond = condSummaries.filter((s: any) => {
      const t = `${s.condition_key} ${s.condition_value} ${s.metric}`.toLowerCase();
      return searchTerms.some((term: string) => t.includes(term));
    });
    if (relevantCond.length > 0) {
      text += '\n\n=== RESUMOS POR CONDIÇÃO EXPERIMENTAL ===\n\n';
      text += '| Condição | Valor | Métrica | N | Média | Mediana | DP | Unidade |\n';
      text += '|----------|-------|---------|---|-------|---------|----|---------|\n';
      for (const s of relevantCond.slice(0, 20)) {
        text += `| ${s.condition_key} | ${s.condition_value} | ${s.metric} | ${s.n} | ${Number(s.avg_value).toFixed(2)} | ${Number(s.median_value).toFixed(2)} | ${s.stddev_value ? Number(s.stddev_value).toFixed(2) : '-'} | ${s.unit} |\n`;
      }
    }
  }

  return text;
}

// ==========================================
// FETCH EXPERIMENT CONTEXT (enriched)
// ==========================================
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
  const [{ data: measurements }, { data: conditions }] = await Promise.all([
    supabase.from('measurements').select('experiment_id, metric, raw_metric_name, value, unit, method, confidence, source_excerpt, value_canonical, unit_canonical').in('experiment_id', expIds),
    supabase.from('experiment_conditions').select('experiment_id, key, value').in('experiment_id', expIds),
  ]);

  const expMap = new Map<string, any>();
  for (const exp of experiments) {
    expMap.set(exp.id, { ...exp, measurements: [], conditions: [] });
  }
  for (const m of (measurements || [])) {
    expMap.get(m.experiment_id)?.measurements.push(m);
  }
  for (const c of (conditions || [])) {
    expMap.get(c.experiment_id)?.conditions.push(c);
  }

  const relevant = Array.from(expMap.values()).filter((exp: any) => {
    const text = `${exp.title} ${exp.objective || ''} ${exp.summary || ''} ${exp.measurements.map((m: any) => m.metric).join(' ')} ${exp.conditions.map((c: any) => `${c.key} ${c.value}`).join(' ')}`.toLowerCase();
    return searchTerms.some((term: string) => text.includes(term));
  });

  if (relevant.length === 0) return { contextText: '', evidenceTable: '', experimentSources: [] };

  let contextText = '\n\n=== DADOS ESTRUTURADOS DE EXPERIMENTOS ===\n\n';
  const experimentSources: any[] = [];

  for (let i = 0; i < Math.min(relevant.length, 10); i++) {
    const exp = relevant[i];
    contextText += `📋 Experimento: ${exp.title}\n`;
    if (exp.objective) contextText += `   Objetivo: ${exp.objective}\n`;
    contextText += `   Fonte: ${exp.project_files?.name || 'N/A'} | Projeto: ${exp.projects?.name || 'N/A'}\n`;
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

// ==========================================
// FETCH KNOWLEDGE ITEMS AS PIVOTS
// ==========================================
async function fetchKnowledgePivots(
  supabase: any,
  projectIds: string[],
  query: string
): Promise<string> {
  const searchTerms = query.toLowerCase().split(/\s+/).filter((w: string) => w.length > 2).slice(0, 5);
  
  // Get relational insights (correlation, contradiction, pattern, gap, cross_reference)
  const { data: pivotInsights } = await supabase
    .from('knowledge_items')
    .select('id, title, content, category, confidence, evidence, source_file_id, neighbor_chunk_ids, related_items')
    .in('project_id', projectIds)
    .in('category', ['correlation', 'contradiction', 'pattern', 'gap', 'cross_reference'])
    .is('deleted_at', null)
    .limit(30);

  if (!pivotInsights || pivotInsights.length === 0) return '';

  const relevant = pivotInsights.filter((i: any) => {
    const text = `${i.title} ${i.content} ${i.evidence || ''}`.toLowerCase();
    return searchTerms.some((term: string) => text.includes(term));
  });

  if (relevant.length === 0) return '';

  let text = '\n\n=== INSIGHTS RELACIONAIS (pivôs de navegação) ===\n\n';
  for (const i of relevant.slice(0, 10)) {
    const icon = i.category === 'contradiction' ? '⚠️' : i.category === 'pattern' ? '🔄' : i.category === 'gap' ? '❓' : '🔗';
    text += `${icon} [${i.category.toUpperCase()}] ${i.title}\n`;
    text += `   ${i.content}\n`;
    if (i.evidence) text += `   Evidência: ${i.evidence}\n`;
    text += '\n';
  }

  // Fetch neighbor chunks for expanded context
  const allNeighborIds = relevant.flatMap((i: any) => i.neighbor_chunk_ids || []).filter(Boolean);
  if (allNeighborIds.length > 0) {
    const { data: neighborChunks } = await supabase
      .from('search_chunks')
      .select('chunk_text, metadata')
      .in('id', allNeighborIds.slice(0, 10));
    
    if (neighborChunks && neighborChunks.length > 0) {
      text += '\n=== CONTEXTO EXPANDIDO (chunks vizinhos dos insights) ===\n\n';
      for (const c of neighborChunks) {
        text += `[${c.metadata?.title || 'doc'}] ${c.chunk_text.substring(0, 300)}\n\n`;
      }
    }
  }

  return text;
}

// ==========================================
// CHUNK SEARCH
// ==========================================
async function searchChunks(
  supabase: any,
  query: string,
  targetProjectIds: string[],
  allowedProjectIds: string[],
  apiKey: string,
  chunkIds?: string[]
): Promise<ChunkSource[]> {
  let chunks: ChunkSource[] = [];

  if (chunkIds && chunkIds.length > 0) {
    const { data } = await supabase
      .from("search_chunks")
      .select(`id, source_type, source_id, chunk_text, chunk_index, metadata, project_id, projects!inner(name)`)
      .in("id", chunkIds)
      .in("project_id", allowedProjectIds);
    chunks = (data || []).map((row: any) => ({
      id: row.id, source_type: row.source_type, source_id: row.source_id,
      source_title: row.metadata?.title || "Sem título",
      project_name: row.projects?.name || "Projeto",
      chunk_text: row.chunk_text, chunk_index: row.chunk_index,
    }));
  } else {
    const queryEmbedding = await generateQueryEmbedding(query, apiKey);

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

  return chunks;
}

// ==========================================
// STEP A: EVIDENCE PLAN (internal, hidden from user)
// ==========================================
async function generateEvidencePlan(
  query: string,
  chunks: ChunkSource[],
  experimentContext: string,
  metricSummaries: string,
  knowledgePivots: string,
  apiKey: string
): Promise<{ plan: string; needsDeepRead: boolean; deepReadFileIds: string[] }> {
  const chunkSummary = chunks.slice(0, 5).map((c, i) => 
    `[${i+1}] ${c.source_title}: ${c.chunk_text.substring(0, 150)}...`
  ).join('\n');

  const planPrompt = `Você é um planejador de pesquisa. Analise a pergunta e os dados disponíveis e crie um PLANO DE EVIDÊNCIA interno.

PERGUNTA: ${query}

DADOS DISPONÍVEIS:
- ${chunks.length} trechos de texto encontrados
- ${experimentContext ? 'Dados estruturados de experimentos disponíveis' : 'Sem dados estruturados'}
- ${metricSummaries ? 'Resumos estatísticos de métricas disponíveis' : 'Sem resumos estatísticos'}
- ${knowledgePivots ? 'Insights relacionais (correlações/contradições/padrões) disponíveis' : 'Sem insights relacionais'}

TRECHOS (resumo):
${chunkSummary}
${experimentContext ? experimentContext.substring(0, 500) : ''}
${metricSummaries ? metricSummaries.substring(0, 500) : ''}
${knowledgePivots ? knowledgePivots.substring(0, 300) : ''}

Responda SOMENTE com JSON:
{
  "hypotheses": ["hipótese 1 a investigar", "hipótese 2"],
  "comparison_axes": ["eixo de comparação 1 (ex: flexural por monômero)", "eixo 2"],
  "trade_offs_to_check": ["trade-off 1 (ex: flexural vs sorção)"],
  "needs_deep_read": false,
  "deep_read_reason": "motivo se precisar de leitura profunda",
  "evidence_gaps": ["lacuna 1", "lacuna 2"],
  "synthesis_strategy": "Como sintetizar a resposta: comparativo, cronológico, por métrica, etc."
}`;

  try {
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [{ role: "user", content: planPrompt }],
        temperature: 0.1,
        max_tokens: 1000,
      }),
    });

    if (!response.ok) {
      return { plan: '', needsDeepRead: false, deepReadFileIds: [] };
    }

    const data = await response.json();
    let raw = data.choices?.[0]?.message?.content || '{}';
    raw = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    
    try {
      const parsed = JSON.parse(raw);
      const planText = `PLANO DE EVIDÊNCIA:
Hipóteses: ${(parsed.hypotheses || []).join('; ')}
Eixos de comparação: ${(parsed.comparison_axes || []).join('; ')}
Trade-offs: ${(parsed.trade_offs_to_check || []).join('; ')}
Lacunas: ${(parsed.evidence_gaps || []).join('; ')}
Estratégia: ${parsed.synthesis_strategy || 'direta'}`;
      
      return {
        plan: planText,
        needsDeepRead: parsed.needs_deep_read || false,
        deepReadFileIds: [],
      };
    } catch {
      return { plan: raw, needsDeepRead: false, deepReadFileIds: [] };
    }
  } catch {
    return { plan: '', needsDeepRead: false, deepReadFileIds: [] };
  }
}

// ==========================================
// STEP B: SYNTHESIS (final response to user)
// ==========================================
async function generateSynthesis(
  query: string,
  chunks: ChunkSource[],
  experimentContextText: string,
  metricSummaries: string,
  knowledgePivots: string,
  preBuiltEvidenceTable: string,
  evidencePlan: string,
  apiKey: string,
  conversationHistory?: { role: string; content: string }[],
): Promise<{ response: string }> {
  const formattedChunks = chunks
    .map((chunk, index) => `[${index + 1}] Fonte: ${chunk.source_type} - "${chunk.source_title}" | Projeto: ${chunk.project_name}\n${chunk.chunk_text}`)
    .join("\n\n---\n\n");

  const systemPrompt = `Você é um assistente especializado em P&D de materiais odontológicos. Responda com profundidade analítica.

REGRAS ABSOLUTAS (NÃO NEGOCIÁVEIS):
1. Toda afirmação técnica DEVE ter citação [1], [2], etc. ou referência a experimento [E1], [E2]
2. Se não houver evidência, diga: "Não encontrei informações suficientes."
3. NUNCA invente dados ou valores
4. Se houver informações conflitantes, DESTAQUE AMBAS e analise
5. PRIORIZE dados estruturados e resumos estatísticos sobre texto livre
6. A TABELA DE EVIDÊNCIAS foi gerada diretamente dos dados — inclua-a SEM modificar valores
7. SEMPRE tente fazer COMPARAÇÕES entre experimentos quando houver 2+ medições da mesma métrica
8. SEMPRE identifique TRADE-OFFS quando medições de métricas diferentes coexistirem
9. Quando resumos estatísticos existirem, cite tendências: "Em N medições, mediana = X ± DP"
10. Se não conseguir comparar ou correlacionar, explique POR QUÊ (falta método, unidade, condição)

${evidencePlan ? `\n${evidencePlan}\n` : ''}

TRECHOS DISPONÍVEIS:
${formattedChunks}
${experimentContextText}
${metricSummaries}
${knowledgePivots}`;

  const evidenceSection = preBuiltEvidenceTable
    ? `## 2. Evidências\n${preBuiltEvidenceTable}\n\n[Complementar com dados dos trechos e resumos estatísticos se relevante]`
    : `## 2. Evidências\n[Listar evidências com citações — se houver resumos estatísticos, incluir tendências]`;

  const userPrompt = `PERGUNTA: ${query}

FORMATO OBRIGATÓRIO DA RESPOSTA:

## 1. Síntese Técnica
[Resumo factual com citações. Se houver comparações possíveis, começar por elas]

${evidenceSection}

## 3. Comparações e Correlações
[Top 3 evidências quantitativas comparadas. Se 2+ experimentos discordam, analisar. Se há trade-offs (ex: flexural ↑ mas sorção ↑), listar]

## 4. Heurísticas Derivadas
[Regras observadas + nível de confiança. Se não há dados: omitir seção]

## 5. Lacunas
[O que NÃO foi medido. Se tudo respondido: "Nenhuma lacuna identificada."]

## 6. Fontes
[Lista numerada: arquivo + página/planilha + experimento]`;

  const messages: { role: string; content: string }[] = [
    { role: "system", content: systemPrompt },
  ];

  if (conversationHistory && conversationHistory.length > 0) {
    for (const msg of conversationHistory.slice(-6)) {
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
      max_tokens: 5000,
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

// ==========================================
// MAIN HANDLER
// ==========================================
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

    const targetProjectIds = project_ids?.length > 0
      ? project_ids.filter((id: string) => allowedProjectIds.includes(id))
      : allowedProjectIds;

    // ==========================================
    // PARALLEL DATA FETCHING (all sources at once)
    // ==========================================
    const [chunks, expResult, metricSummaries, knowledgePivots] = await Promise.all([
      searchChunks(supabase, query, targetProjectIds, allowedProjectIds, lovableApiKey, chunk_ids),
      fetchExperimentContext(supabase, targetProjectIds, query),
      fetchMetricSummaries(supabase, targetProjectIds, query),
      fetchKnowledgePivots(supabase, targetProjectIds, query),
    ]);

    const { contextText: experimentContextText, evidenceTable: preBuiltEvidenceTable, experimentSources } = expResult;

    // If no data at all, return empty
    if (chunks.length === 0 && !experimentContextText && !metricSummaries && !knowledgePivots) {
      return new Response(JSON.stringify({
        response: "Não encontrei informações relevantes nos documentos disponíveis para responder sua pergunta. Tente reformular a busca ou verifique se o conteúdo já foi indexado.",
        sources: [], chunks_used: 0,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ==========================================
    // STEP A: EVIDENCE PLAN (fast, cheap model)
    // ==========================================
    const evidencePlanResult = await generateEvidencePlan(
      query, chunks, experimentContextText, metricSummaries, knowledgePivots, lovableApiKey
    );

    // ==========================================
    // STEP B: SYNTHESIS (full response with plan context)
    // ==========================================
    const { response } = await generateSynthesis(
      query, chunks, experimentContextText, metricSummaries, knowledgePivots,
      preBuiltEvidenceTable, evidencePlanResult.plan, lovableApiKey, conversation_history
    );

    const latencyMs = Date.now() - startTime;

    // Log
    await supabase.from("rag_logs").insert({
      user_id: user.id, query,
      chunks_used: chunks.map((c) => c.id),
      chunks_count: chunks.length,
      response_summary: response.substring(0, 500),
      model_used: "2-step-pipeline/gemini-3-flash",
      latency_ms: latencyMs,
    });

    const chunkSources = chunks.map((chunk, index) => ({
      citation: `${index + 1}`, type: chunk.source_type,
      id: chunk.source_id, title: chunk.source_title,
      project: chunk.project_name, excerpt: chunk.chunk_text.substring(0, 200) + "...",
    }));

    const sources = [...chunkSources, ...experimentSources];

    return new Response(JSON.stringify({
      response, sources, chunks_used: chunks.length,
      has_experiment_data: !!experimentContextText,
      has_metric_summaries: !!metricSummaries,
      has_knowledge_pivots: !!knowledgePivots,
      pipeline: '2-step',
      model_used: "2-step-pipeline/gemini-3-flash", latency_ms: latencyMs,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("RAG error:", errorMessage);
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
