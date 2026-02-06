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

    const { analysis_text, file_id, project_id } = await req.json();

    if (!analysis_text || !file_id || !project_id) {
      return new Response(
        JSON.stringify({ error: "analysis_text, file_id and project_id are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify user has researcher+ access to the project
    const { data: membership } = await supabase
      .from("project_members")
      .select("role_in_project")
      .eq("user_id", user.id)
      .eq("project_id", project_id)
      .single();

    if (!membership || !["owner", "manager", "researcher"].includes(membership.role_in_project)) {
      return new Response(
        JSON.stringify({ error: "Sem permissão para adicionar insights neste projeto" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get file name
    const { data: file } = await supabase
      .from("project_files")
      .select("name")
      .eq("id", file_id)
      .single();

    const validCategories = [
      "compound", "parameter", "result", "method", "observation",
      "finding", "correlation", "anomaly", "benchmark", "recommendation",
      "cross_reference", "pattern", "contradiction", "gap"
    ];

    // Use AI to extract structured insights from the analysis
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${lovableApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content: `Você é um extrator de conhecimento científico. Dada uma análise de documento, extraia TODOS os insights individuais como itens estruturados de conhecimento.

REGRAS:
1. Cada insight deve ser uma unidade atômica de informação (um dado, uma descoberta, uma observação).
2. NÃO agrupe múltiplas informações em um único insight.
3. Extraia TODOS os dados quantitativos como insights individuais.
4. Use as categorias válidas: ${validCategories.join(", ")}
5. A confiança deve ser entre 0.0 e 1.0 (1.0 = dado explícito no texto, 0.7 = inferência razoável).
6. O campo "evidence" deve conter o trecho exato ou paráfrase próxima do texto original que suporta o insight.
7. NÃO invente dados que não estejam na análise.

Responda APENAS com um array JSON válido, sem markdown, sem explicações.
Formato: [{"title": "...", "content": "...", "category": "...", "confidence": 0.9, "evidence": "..."}]`
          },
          {
            role: "user",
            content: `Análise do documento "${file?.name || 'desconhecido'}":\n\n${analysis_text}`
          }
        ],
        temperature: 0.1,
        max_tokens: 8000,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI error:", response.status, errorText);
      throw new Error(`AI Gateway error: ${response.status}`);
    }

    const data = await response.json();
    let rawContent = data.choices?.[0]?.message?.content || "[]";

    // Clean potential markdown wrapping
    rawContent = rawContent.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    let insights: any[];
    try {
      insights = JSON.parse(rawContent);
    } catch {
      console.error("Failed to parse insights JSON:", rawContent.substring(0, 500));
      throw new Error("Falha ao estruturar os insights. Tente novamente.");
    }

    if (!Array.isArray(insights) || insights.length === 0) {
      return new Response(
        JSON.stringify({ error: "Nenhum insight foi extraído da análise.", insights_saved: 0 }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate and prepare insights for insertion
    const validInsights = insights
      .filter((i) => i.title && i.content && validCategories.includes(i.category))
      .map((i) => ({
        project_id,
        source_file_id: file_id,
        title: String(i.title).substring(0, 200),
        content: String(i.content),
        category: i.category,
        confidence: Math.min(1, Math.max(0, Number(i.confidence) || 0.7)),
        evidence: i.evidence ? String(i.evidence).substring(0, 500) : null,
        extracted_by: user.id,
      }));

    if (validInsights.length === 0) {
      return new Response(
        JSON.stringify({ error: "Nenhum insight válido foi extraído.", insights_saved: 0 }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Insert all insights
    const { data: savedInsights, error: insertError } = await supabase
      .from("knowledge_items")
      .insert(validInsights)
      .select("id");

    if (insertError) {
      console.error("Insert error:", insertError);
      throw new Error(`Erro ao salvar insights: ${insertError.message}`);
    }

    return new Response(
      JSON.stringify({
        insights_saved: savedInsights?.length || 0,
        total_extracted: insights.length,
        valid_insights: validInsights.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Save analysis insights error:", errorMessage);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
