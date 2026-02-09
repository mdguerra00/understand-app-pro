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

    const { file_id } = await req.json();

    if (!file_id) {
      return new Response(
        JSON.stringify({ error: "file_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get file info and verify access
    const { data: file, error: fileError } = await supabase
      .from("project_files")
      .select("id, name, project_id, mime_type")
      .eq("id", file_id)
      .is("deleted_at", null)
      .single();

    if (fileError || !file) {
      return new Response(
        JSON.stringify({ error: "Arquivo não encontrado" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify user has access to the project
    const { data: membership } = await supabase
      .from("project_members")
      .select("project_id")
      .eq("user_id", user.id)
      .eq("project_id", file.project_id)
      .single();

    if (!membership) {
      return new Response(
        JSON.stringify({ error: "Sem permissão para acessar este arquivo" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get chunks for this file (try multiple source types)
    const { data: chunks, error: chunksError } = await supabase
      .from("search_chunks")
      .select("id, chunk_text, chunk_index, metadata")
      .eq("source_id", file_id)
      .order("chunk_index", { ascending: true });

    if (chunksError) throw chunksError;

    // Also get existing knowledge items for this file
    const { data: existingInsights } = await supabase
      .from("knowledge_items")
      .select("title, content, category, confidence, evidence")
      .eq("source_file_id", file_id)
      .is("deleted_at", null)
      .order("category");

    // ====== NEW: Fetch structured experiments/measurements/conditions ======
    const { data: experiments } = await supabase
      .from("experiments")
      .select("id, title, objective, summary, is_qualitative, source_type")
      .eq("source_file_id", file_id)
      .is("deleted_at", null);

    let structuredDataSection = "";
    if (experiments && experiments.length > 0) {
      const expIds = experiments.map((e: any) => e.id);
      const [{ data: measurements }, { data: conditions }] = await Promise.all([
        supabase.from("measurements")
          .select("experiment_id, metric, raw_metric_name, value, unit, method, confidence, source_excerpt")
          .in("experiment_id", expIds),
        supabase.from("experiment_conditions")
          .select("experiment_id, key, value")
          .in("experiment_id", expIds),
      ]);

      structuredDataSection = "\n\n## Dados Estruturados Extraídos\n\n";
      for (const exp of experiments) {
        structuredDataSection += `### ${exp.title}\n`;
        if (exp.objective) structuredDataSection += `Objetivo: ${exp.objective}\n`;
        const expConds = (conditions || []).filter((c: any) => c.experiment_id === exp.id);
        if (expConds.length > 0) {
          structuredDataSection += `Condições: ${expConds.map((c: any) => `${c.key}=${c.value}`).join(", ")}\n`;
        }
        const expMeas = (measurements || []).filter((m: any) => m.experiment_id === exp.id);
        if (expMeas.length > 0) {
          structuredDataSection += "| Métrica | Valor | Unidade | Método | Confiança |\n";
          structuredDataSection += "|---------|-------|---------|--------|----------|\n";
          for (const m of expMeas) {
            structuredDataSection += `| ${m.raw_metric_name || m.metric} | ${m.value} | ${m.unit} | ${m.method || '-'} | ${m.confidence || '-'} |\n`;
          }
        }
        structuredDataSection += "\n";
      }
    }

    // Build document content from whatever sources are available
    let fullContent = "";
    
    if (chunks && chunks.length > 0) {
      fullContent = chunks.map((c) => c.chunk_text).join("\n\n");
    }

    // If no chunks, build content from knowledge items
    if (!fullContent && existingInsights && existingInsights.length > 0) {
      fullContent = existingInsights
        .map((i) => `## ${i.title}\nCategoria: ${i.category} | Confiança: ${i.confidence}\n${i.content}\n${i.evidence ? `Evidência: ${i.evidence}` : ""}`)
        .join("\n\n---\n\n");
    }

    if (!fullContent) {
      return new Response(
        JSON.stringify({
          error: "Este arquivo ainda não foi processado. Extraia o conhecimento ou reindexe o projeto primeiro.",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build existing insights summary
    const insightsSummary = existingInsights && existingInsights.length > 0
      ? existingInsights.map((i) => `- [${i.category}] ${i.title}: ${i.content}`).join("\n")
      : "Nenhum insight extraído ainda.";

    const systemPrompt = `Você é um cientista de P&D especializado em análise documental. Sua tarefa é realizar uma análise PROFUNDA e EXAUSTIVA do documento fornecido.

REGRAS:
1. Analise TODO o conteúdo do documento sem omitir nenhuma informação relevante.
2. Extraia TODOS os dados quantitativos (números, percentuais, médias, desvios-padrão, etc.).
3. Identifique metodologias, materiais, condições experimentais e resultados.
4. Destaque conclusões, recomendações e limitações do estudo.
5. NÃO invente informações que não estejam no documento.
6. Se houver tabelas ou dados estruturados, preserve a organização.
7. Considere os insights já extraídos automaticamente para complementar sua análise.
8. Se houver "Dados Estruturados Extraídos", PRIORIZE esses valores numéricos verificados. Corrija ou complemente se necessário.`;

    const userPrompt = `## Documento: "${file.name}"
Tipo: ${file.mime_type || "desconhecido"}
Chunks indexados: ${chunks.length}

## Conteúdo Completo do Documento:
${fullContent}
${structuredDataSection}
## Insights Já Extraídos (por IA anterior):
${insightsSummary}

---

Faça uma análise profunda e completa deste documento seguindo EXATAMENTE este formato:

## 📋 Resumo Executivo
[Síntese do documento em 3-5 frases]

## 🎯 Objetivo do Estudo/Documento
[Qual era o objetivo principal]

## 🔬 Metodologia
[Materiais utilizados, métodos, condições experimentais, equipamentos, etc.]

## 📊 Dados e Resultados Quantitativos
[TODOS os valores numéricos encontrados, organizados em formato de lista ou tabela]

## 💡 Principais Descobertas
[Findings mais importantes, correlações, padrões observados]

## ⚠️ Limitações e Ressalvas
[Limitações do estudo, condições não testadas, possíveis vieses]

## 🔗 Conexões com Outros Conhecimentos
[Se os insights existentes revelam conexões com outros documentos do projeto, mencione]

## 📌 Informações Adicionais Relevantes
[Qualquer outra informação útil: referências bibliográficas citadas, padrões seguidos, normas técnicas, etc.]`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${lovableApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.2,
        max_tokens: 6000,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI error:", response.status, errorText);
      if (response.status === 429) {
        throw new Error("Rate limit exceeded. Please try again later.");
      }
      if (response.status === 402) {
        throw new Error("AI credits exhausted. Please add more credits.");
      }
      throw new Error(`AI Gateway error: ${response.status}`);
    }

    const data = await response.json();
    const analysis = data.choices?.[0]?.message?.content || "Erro ao gerar análise.";

    // Build sources from chunks or insights
    const sources = chunks && chunks.length > 0
      ? chunks.slice(0, 15).map((chunk, index) => ({
          citation: `[${index + 1}]`,
          type: "project_files",
          id: file_id,
          title: file.name,
          project: "",
          excerpt: chunk.chunk_text.substring(0, 200) + "...",
        }))
      : (existingInsights || []).slice(0, 15).map((insight, index) => ({
          citation: `[${index + 1}]`,
          type: "knowledge_item",
          id: file_id,
          title: insight.title,
          project: "",
          excerpt: insight.content.substring(0, 200) + "...",
        }));

    return new Response(
      JSON.stringify({
        response: analysis,
        sources,
        file_name: file.name,
        chunks_analyzed: chunks?.length || 0,
        existing_insights: existingInsights?.length || 0,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Analyze document error:", errorMessage);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
