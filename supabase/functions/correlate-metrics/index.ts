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

    const { project_id } = await req.json();
    if (!project_id) {
      return new Response(JSON.stringify({ error: "project_id is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify access
    const { data: membership } = await supabase
      .from("project_members")
      .select("role_in_project")
      .eq("user_id", user.id)
      .eq("project_id", project_id)
      .single();

    if (!membership || !["owner", "manager", "researcher"].includes(membership.role_in_project)) {
      return new Response(JSON.stringify({ error: "Sem permissão" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create correlation job
    const { data: job, error: jobError } = await supabase
      .from("correlation_jobs")
      .insert({ project_id, created_by: user.id, status: "processing", started_at: new Date().toISOString() })
      .select("id")
      .single();

    if (jobError || !job) throw new Error("Failed to create correlation job");

    // ==========================================
    // FETCH ALL STRUCTURED DATA
    // ==========================================
    const { data: experiments } = await supabase
      .from('experiments')
      .select('id, title, objective, source_file_id, project_files!inner(name)')
      .eq('project_id', project_id)
      .is('deleted_at', null);

    if (!experiments || experiments.length < 2) {
      await supabase.from("correlation_jobs").update({
        status: "completed", completed_at: new Date().toISOString(),
        metrics_analyzed: 0, insights_created: 0,
      }).eq("id", job.id);

      return new Response(JSON.stringify({
        message: "Menos de 2 experimentos no projeto. Nada para correlacionar.",
        patterns: 0, contradictions: 0, gaps: 0,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const expIds = experiments.map((e: any) => e.id);
    const [{ data: measurements }, { data: conditions }] = await Promise.all([
      supabase.from('measurements').select('experiment_id, metric, raw_metric_name, value, unit, method, confidence').in('experiment_id', expIds),
      supabase.from('experiment_conditions').select('experiment_id, key, value').in('experiment_id', expIds),
    ]);

    // Build per-experiment summary
    const expSummaries = experiments.map((exp: any) => {
      const expMeas = (measurements || []).filter((m: any) => m.experiment_id === exp.id);
      const expConds = (conditions || []).filter((c: any) => c.experiment_id === exp.id);
      return {
        id: exp.id,
        title: exp.title,
        file: exp.project_files?.name,
        conditions: expConds.map((c: any) => `${c.key}=${c.value}`).join(', '),
        metrics: expMeas.map((m: any) => `${m.metric}: ${m.value} ${m.unit}`).join(', '),
        metricsCount: expMeas.length,
      };
    });

    // Build metric repetition map
    const metricMap = new Map<string, { values: number[]; units: string[]; experiments: string[]; conditions: string[] }>();
    for (const exp of expSummaries) {
      const expMeas = (measurements || []).filter((m: any) => m.experiment_id === exp.id);
      const expConds = (conditions || []).filter((c: any) => c.experiment_id === exp.id);
      for (const m of expMeas) {
        if (!metricMap.has(m.metric)) {
          metricMap.set(m.metric, { values: [], units: [], experiments: [], conditions: [] });
        }
        const entry = metricMap.get(m.metric)!;
        entry.values.push(m.value);
        entry.units.push(m.unit);
        entry.experiments.push(exp.title);
        entry.conditions.push(expConds.map((c: any) => `${c.key}=${c.value}`).join(', '));
      }
    }

    // Identify metrics that appear across multiple experiments
    const repeatedMetrics = Array.from(metricMap.entries())
      .filter(([_, v]) => new Set(v.experiments).size >= 2)
      .map(([metric, v]) => ({
        metric,
        n: v.values.length,
        min: Math.min(...v.values),
        max: Math.max(...v.values),
        experiments: [...new Set(v.experiments)],
        units: [...new Set(v.units)],
      }));

    // Identify metrics per experiment (for gap detection)
    const expMetricSets = new Map<string, Set<string>>();
    for (const exp of expSummaries) {
      const expMeas = (measurements || []).filter((m: any) => m.experiment_id === exp.id);
      expMetricSets.set(exp.title, new Set(expMeas.map((m: any) => m.metric)));
    }

    // Build context for AI
    const contextForAI = `PROJETO: Correlação de ${experiments.length} experimentos com ${measurements?.length || 0} medições.

MÉTRICAS REPETIDAS (aparecem em 2+ experimentos):
${repeatedMetrics.map(m => `- ${m.metric}: ${m.n} medições, min=${m.min}, max=${m.max}, em: ${m.experiments.join(', ')}`).join('\n')}

EXPERIMENTOS:
${expSummaries.map(e => `- ${e.title} [${e.file}]: ${e.metricsCount} medições, condições: ${e.conditions || 'N/A'}, métricas: ${e.metrics}`).join('\n')}

COBERTURA DE MÉTRICAS POR EXPERIMENTO:
${Array.from(expMetricSets.entries()).map(([exp, metrics]) => `- ${exp}: ${[...metrics].join(', ')}`).join('\n')}`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${lovableApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content: `Você é um analista de dados de P&D. Dado um conjunto de experimentos e medições, identifique:

1. PATTERNS: Tendências consistentes (ex: "sempre que monômero=UDMA, flexural > 120 MPa")
2. CONTRADICTIONS: Resultados conflitantes (ex: "UDMA mostra flexural alta em exp1 mas baixa em exp2")
3. GAPS: Métricas que faltam (ex: "tem flexural mas não tem sorção na mesma família de testes")

REGRAS:
- Só reporte padrões com evidência numérica
- Contradições devem ter valores específicos
- Gaps devem ser acionáveis
- Max 5 patterns, 5 contradictions, 5 gaps
- Se não encontrar, retorne arrays vazios`
          },
          { role: "user", content: contextForAI },
        ],
        tools: [{
          type: "function",
          function: {
            name: "report_correlations",
            parameters: {
              type: "object",
              properties: {
                patterns: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      title: { type: "string", maxLength: 100 },
                      content: { type: "string", maxLength: 500 },
                      evidence: { type: "string", maxLength: 300 },
                      confidence: { type: "number", minimum: 0, maximum: 1 },
                      related_experiments: { type: "array", items: { type: "string" } },
                    },
                    required: ["title", "content", "evidence", "confidence"],
                  },
                },
                contradictions: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      title: { type: "string", maxLength: 100 },
                      content: { type: "string", maxLength: 500 },
                      evidence: { type: "string", maxLength: 300 },
                      confidence: { type: "number", minimum: 0, maximum: 1 },
                      related_experiments: { type: "array", items: { type: "string" } },
                    },
                    required: ["title", "content", "evidence", "confidence"],
                  },
                },
                gaps: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      title: { type: "string", maxLength: 100 },
                      content: { type: "string", maxLength: 500 },
                      confidence: { type: "number", minimum: 0, maximum: 1 },
                      related_experiments: { type: "array", items: { type: "string" } },
                    },
                    required: ["title", "content", "confidence"],
                  },
                },
              },
              required: ["patterns", "contradictions", "gaps"],
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "report_correlations" } },
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      throw new Error(`AI error: ${response.status}`);
    }

    const aiData = await response.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    let patterns: any[] = [];
    let contradictions: any[] = [];
    let gaps: any[] = [];

    if (toolCall?.function?.arguments) {
      try {
        const args = JSON.parse(toolCall.function.arguments);
        patterns = args.patterns || [];
        contradictions = args.contradictions || [];
        gaps = args.gaps || [];
      } catch {}
    }

    // Soft-delete existing correlation insights for this project
    const { data: existingCorrelations } = await supabase
      .from('knowledge_items')
      .select('id')
      .eq('project_id', project_id)
      .in('category', ['pattern', 'contradiction', 'gap'])
      .eq('relationship_type', 'auto_correlation')
      .is('deleted_at', null);

    if (existingCorrelations && existingCorrelations.length > 0) {
      await supabase
        .from('knowledge_items')
        .update({ deleted_at: new Date().toISOString(), deleted_by: user.id })
        .in('id', existingCorrelations.map((i: any) => i.id));
    }

    // Save new correlation insights
    const allInsights = [
      ...patterns.map((p: any) => ({ ...p, category: 'pattern' as const })),
      ...contradictions.map((c: any) => ({ ...c, category: 'contradiction' as const })),
      ...gaps.map((g: any) => ({ ...g, category: 'gap' as const })),
    ];

    let insightsCreated = 0;
    if (allInsights.length > 0) {
      const toInsert = allInsights.map((insight: any) => ({
        project_id,
        category: insight.category,
        title: insight.title.substring(0, 100),
        content: insight.content.substring(0, 500),
        evidence: insight.evidence?.substring(0, 300) || null,
        confidence: Math.min(1, Math.max(0, insight.confidence)),
        extracted_by: user.id,
        relationship_type: 'auto_correlation',
        auto_validated: true,
        auto_validation_reason: 'correlation_engine',
        human_verified: false,
      }));

      const { data: saved, error: insertError } = await supabase
        .from('knowledge_items')
        .insert(toInsert)
        .select('id');

      if (!insertError && saved) insightsCreated = saved.length;
    }

    // Update job
    await supabase.from("correlation_jobs").update({
      status: "completed",
      completed_at: new Date().toISOString(),
      metrics_analyzed: repeatedMetrics.length,
      patterns_found: patterns.length,
      contradictions_found: contradictions.length,
      gaps_found: gaps.length,
      insights_created: insightsCreated,
    }).eq("id", job.id);

    return new Response(JSON.stringify({
      success: true,
      patterns: patterns.length,
      contradictions: contradictions.length,
      gaps: gaps.length,
      insights_created: insightsCreated,
      metrics_analyzed: repeatedMetrics.length,
      experiments_analyzed: experiments.length,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Correlation engine error:", errorMessage);
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
