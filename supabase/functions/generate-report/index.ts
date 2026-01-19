import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface GenerateReportRequest {
  project_id: string;
  report_type: 'progress' | 'final' | 'executive';
  category_filter?: string[];
  date_from?: string;
  date_to?: string;
}

const REPORT_TYPE_CONFIG = {
  progress: {
    name: 'Relatório de Progresso',
    focus: 'Atividades recentes, experimentos realizados e próximos passos',
    style: 'Técnico e detalhado, com foco em avanços incrementais'
  },
  final: {
    name: 'Relatório Final',
    focus: 'Síntese completa do projeto, todas as descobertas e conclusões',
    style: 'Abrangente e conclusivo, com recomendações finais'
  },
  executive: {
    name: 'Resumo Executivo',
    focus: 'Principais KPIs, resultados de destaque e impacto',
    style: 'Conciso (1-2 páginas), linguagem acessível para gestão'
  }
};

const CATEGORY_LABELS: Record<string, string> = {
  compound: 'Compostos',
  parameter: 'Parâmetros',
  result: 'Resultados',
  method: 'Métodos',
  observation: 'Observações',
  finding: 'Descobertas',
  correlation: 'Correlações',
  anomaly: 'Anomalias',
  benchmark: 'Benchmarks',
  recommendation: 'Recomendações'
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Não autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Validate JWT and get user
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Token inválido" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify project membership
    const { project_id, report_type, category_filter, date_from, date_to } = await req.json() as GenerateReportRequest;

    const { data: membership } = await supabase
      .from('project_members')
      .select('role_in_project')
      .eq('project_id', project_id)
      .eq('user_id', user.id)
      .single();

    if (!membership) {
      return new Response(JSON.stringify({ error: "Acesso negado ao projeto" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get project info
    const { data: project } = await supabase
      .from('projects')
      .select('name, description, objectives')
      .eq('id', project_id)
      .single();

    if (!project) {
      return new Response(JSON.stringify({ error: "Projeto não encontrado" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch knowledge items
    let insightsQuery = supabase
      .from('knowledge_items')
      .select('id, title, content, category, confidence, evidence, extracted_at, project_files(name)')
      .eq('project_id', project_id)
      .is('deleted_at', null)
      .order('extracted_at', { ascending: false });

    if (category_filter && category_filter.length > 0) {
      insightsQuery = insightsQuery.in('category', category_filter);
    }

    if (date_from) {
      insightsQuery = insightsQuery.gte('extracted_at', date_from);
    }

    if (date_to) {
      insightsQuery = insightsQuery.lte('extracted_at', date_to);
    }

    const { data: insights, error: insightsError } = await insightsQuery;

    if (insightsError) {
      console.error("Error fetching insights:", insightsError);
      throw new Error("Erro ao buscar insights");
    }

    // Fetch project files for context
    const { data: files } = await supabase
      .from('project_files')
      .select('name, mime_type, created_at, description')
      .eq('project_id', project_id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(20);

    // Group insights by category
    const insightsByCategory: Record<string, typeof insights> = {};
    for (const insight of insights || []) {
      const cat = insight.category;
      if (!insightsByCategory[cat]) {
        insightsByCategory[cat] = [];
      }
      insightsByCategory[cat].push(insight);
    }

    // Build the prompt
    const typeConfig = REPORT_TYPE_CONFIG[report_type];
    
    let insightsText = '';
    for (const [category, items] of Object.entries(insightsByCategory)) {
      const label = CATEGORY_LABELS[category] || category;
      insightsText += `\n### ${label} (${items.length})\n`;
      for (const item of items) {
        const fileData = item.project_files as unknown as { name: string } | null;
        const fileName = fileData?.name || 'Arquivo desconhecido';
        insightsText += `- **${item.title}** (Confiança: ${item.confidence || 'N/A'}%)\n`;
        insightsText += `  ${item.content}\n`;
        if (item.evidence) {
          insightsText += `  > Evidência: "${item.evidence.substring(0, 200)}${item.evidence.length > 200 ? '...' : ''}"\n`;
        }
        insightsText += `  Fonte: ${fileName}\n\n`;
      }
    }

    let filesText = '';
    for (const file of files || []) {
      filesText += `- ${file.name} (${file.mime_type || 'tipo desconhecido'})\n`;
      if (file.description) {
        filesText += `  ${file.description}\n`;
      }
    }

    const systemPrompt = `Você é um redator técnico especializado em P&D odontológico. 
Sua tarefa é criar um ${typeConfig.name} profissional e bem estruturado.

FOCO DO RELATÓRIO: ${typeConfig.focus}
ESTILO: ${typeConfig.style}

REGRAS IMPORTANTES:
1. Use linguagem técnica mas acessível
2. Cite evidências dos insights quando relevante
3. Mantenha objetividade científica
4. Estruture com seções claras usando markdown
5. Inclua recomendações acionáveis quando apropriado
6. NÃO invente dados - use apenas as informações fornecidas
7. Se houver poucos insights, mencione que o relatório é preliminar`;

    const userPrompt = `## PROJETO: ${project.name}
${project.description ? `Descrição: ${project.description}` : ''}
${project.objectives ? `Objetivos: ${project.objectives}` : ''}

## INSIGHTS EXTRAÍDOS (${insights?.length || 0} total):
${insightsText || 'Nenhum insight disponível ainda.'}

## ARQUIVOS DO PROJETO:
${filesText || 'Nenhum arquivo registrado.'}

---

Gere o relatório completo em português brasileiro.`;

    // Call Lovable AI Gateway with tool calling for structured output
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY não configurada");
    }

    console.log(`Generating ${report_type} report for project ${project_id} with ${insights?.length || 0} insights`);

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "create_report",
              description: "Cria um relatório estruturado de P&D",
              parameters: {
                type: "object",
                properties: {
                  titulo: { 
                    type: "string", 
                    description: "Título do relatório (máx 100 caracteres)" 
                  },
                  resumo: { 
                    type: "string", 
                    description: "Resumo executivo do relatório (máx 500 palavras)" 
                  },
                  conteudo: { 
                    type: "string", 
                    description: "Conteúdo completo do relatório em markdown" 
                  }
                },
                required: ["titulo", "resumo", "conteudo"],
                additionalProperties: false
              }
            }
          }
        ],
        tool_choice: { type: "function", function: { name: "create_report" } }
      }),
    });

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ error: "Limite de requisições excedido. Tente novamente em alguns minutos." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResponse.status === 402) {
        return new Response(JSON.stringify({ error: "Créditos de IA esgotados. Adicione créditos ao workspace." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errorText = await aiResponse.text();
      console.error("AI Gateway error:", aiResponse.status, errorText);
      throw new Error("Erro na geração do relatório pela IA");
    }

    const aiData = await aiResponse.json();
    
    // Extract the tool call result
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall || toolCall.function?.name !== 'create_report') {
      console.error("Unexpected AI response format:", JSON.stringify(aiData));
      throw new Error("Formato de resposta da IA inesperado");
    }

    const reportData = JSON.parse(toolCall.function.arguments);
    
    // Create the report in the database
    const { data: newReport, error: createError } = await supabase
      .from('reports')
      .insert({
        project_id,
        title: reportData.titulo,
        summary: reportData.resumo,
        content: reportData.conteudo,
        status: 'draft',
        created_by: user.id,
        generated_by_ai: true,
        ai_model_used: 'google/gemini-3-flash-preview',
        source_insights_count: insights?.length || 0
      })
      .select('id')
      .single();

    if (createError) {
      console.error("Error creating report:", createError);
      throw new Error("Erro ao salvar o relatório");
    }

    console.log(`Report created successfully: ${newReport.id}`);

    return new Response(JSON.stringify({ 
      success: true, 
      report_id: newReport.id,
      insights_used: insights?.length || 0
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("generate-report error:", error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : "Erro desconhecido" 
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
