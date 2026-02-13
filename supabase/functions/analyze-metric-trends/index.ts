import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface MetricTrend {
  metric: string;
  unit: string;
  n: number;
  mean: number;
  stddev: number;
  cv: number; // coefficient of variation
  trend: 'positive' | 'negative' | 'stable' | 'high_dispersion';
  conditionCorrelations: { condition_key: string; condition_value: string; avg: number; n: number }[];
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

    // Fetch all experiments and measurements
    const { data: experiments } = await supabase
      .from('experiments')
      .select('id, title, source_file_id')
      .eq('project_id', project_id)
      .is('deleted_at', null);

    if (!experiments || experiments.length === 0) {
      return new Response(JSON.stringify({ message: "Nenhum experimento encontrado.", trends: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const expIds = experiments.map((e: any) => e.id);
    const [{ data: measurements }, { data: conditions }] = await Promise.all([
      supabase.from('measurements').select('experiment_id, metric, raw_metric_name, value, unit, method, confidence').in('experiment_id', expIds),
      supabase.from('experiment_conditions').select('experiment_id, key, value').in('experiment_id', expIds),
    ]);

    if (!measurements || measurements.length === 0) {
      return new Response(JSON.stringify({ message: "Nenhuma medição encontrada.", trends: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Group by metric
    const metricGroups = new Map<string, { values: number[]; unit: string; rawName: string; experimentIds: string[] }>();
    for (const m of measurements) {
      const key = m.metric;
      if (!metricGroups.has(key)) {
        metricGroups.set(key, { values: [], unit: m.unit, rawName: m.raw_metric_name || m.metric, experimentIds: [] });
      }
      const group = metricGroups.get(key)!;
      group.values.push(Number(m.value));
      group.experimentIds.push(m.experiment_id);
    }

    // Calculate trends for each metric
    const trends: MetricTrend[] = [];

    for (const [metric, group] of metricGroups.entries()) {
      if (group.values.length < 3) continue; // Need at least 3 values for trends

      const n = group.values.length;
      const mean = group.values.reduce((a, b) => a + b, 0) / n;
      const variance = group.values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / (n - 1);
      const stddev = Math.sqrt(variance);
      const cv = mean !== 0 ? (stddev / Math.abs(mean)) * 100 : 0;

      // Determine trend type
      let trend: MetricTrend['trend'] = 'stable';
      if (cv > 30) {
        trend = 'high_dispersion';
      } else {
        // Simple trend detection: compare first half vs second half means
        const sorted = [...group.values].sort((a, b) => a - b);
        const lowerQuartile = sorted[Math.floor(n * 0.25)];
        const upperQuartile = sorted[Math.floor(n * 0.75)];
        const iqr = upperQuartile - lowerQuartile;
        if (iqr / mean > 0.2) {
          // Check correlation with conditions
          trend = 'high_dispersion';
        }
      }

      // Correlate with conditions
      const conditionCorrelations: MetricTrend['conditionCorrelations'] = [];
      const condByExp = new Map<string, { key: string; value: string }[]>();
      for (const c of (conditions || [])) {
        if (!condByExp.has(c.experiment_id)) condByExp.set(c.experiment_id, []);
        condByExp.get(c.experiment_id)!.push(c);
      }

      // Group values by condition
      const condValueMap = new Map<string, number[]>();
      const uniqueExpIds = [...new Set(group.experimentIds)];
      
      for (let i = 0; i < measurements.length; i++) {
        const m = measurements[i];
        if (m.metric !== metric) continue;
        const expConds = condByExp.get(m.experiment_id) || [];
        for (const c of expConds) {
          const key = `${c.key}::${c.value}`;
          if (!condValueMap.has(key)) condValueMap.set(key, []);
          condValueMap.get(key)!.push(Number(m.value));
        }
      }

      for (const [key, values] of condValueMap.entries()) {
        if (values.length < 2) continue;
        const [condKey, condValue] = key.split('::');
        const condAvg = values.reduce((a, b) => a + b, 0) / values.length;
        conditionCorrelations.push({ condition_key: condKey, condition_value: condValue, avg: condAvg, n: values.length });
      }

      trends.push({ metric, unit: group.unit, n, mean, stddev, cv, trend, conditionCorrelations });
    }

    // Save trends as knowledge_items
    // Soft-delete existing statistical_trend items first
    const { data: existingTrends } = await supabase
      .from('knowledge_items')
      .select('id')
      .eq('project_id', project_id)
      .eq('relationship_type', 'statistical_trend')
      .is('deleted_at', null);

    if (existingTrends && existingTrends.length > 0) {
      await supabase
        .from('knowledge_items')
        .update({ deleted_at: new Date().toISOString(), deleted_by: user.id })
        .in('id', existingTrends.map((i: any) => i.id));
    }

    let insightsCreated = 0;
    for (const t of trends) {
      const trendDescription = t.trend === 'high_dispersion'
        ? `Alta dispersão detectada: CV=${t.cv.toFixed(1)}%`
        : t.trend === 'positive' ? 'Tendência positiva detectada'
        : t.trend === 'negative' ? 'Tendência negativa detectada'
        : 'Valores estáveis';

      let content = `${t.metric} (${t.unit}): N=${t.n}, média=${t.mean.toFixed(2)}±${t.stddev.toFixed(2)}, CV=${t.cv.toFixed(1)}%. ${trendDescription}.`;
      
      if (t.conditionCorrelations.length > 0) {
        content += ` Correlações: ${t.conditionCorrelations.map(c => 
          `${c.condition_key}=${c.condition_value} → avg=${c.avg.toFixed(2)} (n=${c.n})`
        ).join('; ')}.`;
      }

      const confidence = t.n >= 10 ? 0.9 : t.n >= 5 ? 0.7 : 0.5;

      const { error } = await supabase.from('knowledge_items').insert({
        project_id,
        category: 'pattern',
        title: `Tendência estatística: ${t.metric}`,
        content: content.substring(0, 500),
        evidence: `Baseado em ${t.n} medições. Média: ${t.mean.toFixed(2)} ${t.unit}, DP: ${t.stddev.toFixed(2)}`,
        confidence,
        extracted_by: user.id,
        relationship_type: 'statistical_trend',
        ref_metric_key: t.metric,
        auto_validated: true,
        auto_validation_reason: 'statistical_engine',
        human_verified: false,
        validated_by: user.id,
        validated_at: new Date().toISOString(),
      });

      if (!error) insightsCreated++;
    }

    return new Response(JSON.stringify({
      success: true,
      trends_detected: trends.length,
      insights_created: insightsCreated,
      metrics_analyzed: metricGroups.size,
      total_measurements: measurements.length,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Metric trends error:", errorMessage);
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
