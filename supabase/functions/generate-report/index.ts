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
      .select('id, title, content, category, confidence, evidence, evidence_verified, extracted_at, project_files(name)')
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
        insightsText += `- **${item.title}**\n`;
        insightsText += `  Conteúdo: ${item.content}\n`;
        insightsText += `  Confiança: ${item.confidence || 'N/A'}%\n`;
        if (item.evidence) {
          insightsText += `  Evidência Original: "${item.evidence.substring(0, 300)}${item.evidence.length > 300 ? '...' : ''}"\n`;
        }
        if (item.evidence_verified === false) {
          insightsText += `  [!] AVISO: Evidência não verificada no documento original\n`;
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

    const systemPrompt = `Você é um redator técnico que sintetiza dados de P&D.
Sua tarefa é criar um ${typeConfig.name}.

FOCO: ${typeConfig.focus}
ESTILO: ${typeConfig.style}

## REGRA ABSOLUTA - ZERO ALUCINAÇÃO:

1. Você SÓ pode escrever afirmações que estão EXPLICITAMENTE nos insights fornecidos
2. NUNCA adicione conhecimento próprio sobre ciência de materiais, química ou odontologia
3. NUNCA use frases como "conforme esperado", "como se sabe", "correlação conhecida", "é sabido que"
4. NUNCA faça recomendações que NÃO estejam explicitamente nos insights
5. Se não houver dados suficientes, diga "dados insuficientes" em vez de inventar
6. NUNCA interprete ou tire conclusões além do que está literalmente escrito

## ESTRUTURA OBRIGATÓRIA:

Para cada afirmação no relatório:
- CITE a fonte: "Conforme o insight '[título do insight]': [afirmação direta]"
- Use APENAS valores numéricos que aparecem nos insights
- Se dois insights parecem se relacionar, diga "os dados indicam" e NÃO "confirma-se" ou "demonstra-se"

## O QUE VOCÊ NÃO PODE FAZER:

- Inventar correlações (ex: "correlação inversa esperada")
- Adicionar teoria científica não mencionada nos insights
- Fazer recomendações especulativas
- Usar seu conhecimento prévio de química/materiais/odontologia
- Tirar conclusões além dos dados fornecidos
- Usar linguagem afirmativa sobre relações não comprovadas

## O QUE VOCÊ PODE FAZER:

- Organizar os insights por categoria
- Citar valores EXATOS dos insights
- Resumir o que os insights dizem LITERALMENTE
- Apontar lacunas nos dados
- Marcar áreas que precisam de mais pesquisa
- Usar linguagem condicional ("os dados sugerem", "observou-se que")

## FORMATO ESPERADO:

### [Seção]
Conforme o insight '[título]':
- Resultado A: [valor exato do insight]
- Resultado B: [valor exato do insight]

**Limitação:** [o que os dados NÃO mostram]`;

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
              description: "Cria um relatório estruturado de P&D baseado APENAS nos insights fornecidos",
              parameters: {
                type: "object",
                properties: {
                  titulo: { 
                    type: "string", 
                    description: "Título do relatório (máx 100 caracteres)" 
                  },
                  resumo: { 
                    type: "string", 
                    description: "Resumo que cita APENAS dados dos insights, sem adições ou interpretações próprias. Use citações explícitas." 
                  },
                  conteudo: { 
                    type: "string", 
                    description: "Relatório em markdown com citações explícitas no formato [Insight: título]. NUNCA adicione conhecimento próprio ou interpretações especulativas." 
                  },
                  limitacoes: {
                    type: "string",
                    description: "Lista do que os dados NÃO mostram, lacunas identificadas e áreas que precisam de mais pesquisa. Seja honesto sobre o que não pode ser concluído."
                  }
                },
                required: ["titulo", "resumo", "conteudo", "limitacoes"],
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
    
    // Append limitations section to content if provided
    let finalContent = reportData.conteudo;
    if (reportData.limitacoes) {
      finalContent += `\n\n---\n\n## Limitações e Lacunas\n\n${reportData.limitacoes}`;
    }
    
    // Create the report in the database
    const { data: newReport, error: createError } = await supabase
      .from('reports')
      .insert({
        project_id,
        title: reportData.titulo,
        summary: reportData.resumo,
        content: finalContent,
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
