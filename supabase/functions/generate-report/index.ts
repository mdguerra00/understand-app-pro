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
      .select('id, name, mime_type, created_at, description')
      .eq('project_id', project_id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(20);

    // Fetch document chunks (parsed content from files)
    const { data: documentChunks, error: chunksError } = await supabase
      .from('search_chunks')
      .select('chunk_text, chunk_index, source_id, metadata')
      .eq('project_id', project_id)
      .eq('source_type', 'file')
      .order('source_id', { ascending: true })
      .order('chunk_index', { ascending: true })
      .limit(100); // Limit to prevent token overflow

    if (chunksError) {
      console.error("Error fetching document chunks:", chunksError);
    }

    // Group chunks by source file
    const chunksByFile: Record<string, { title: string; chunks: string[] }> = {};
    for (const chunk of documentChunks || []) {
      const sourceId = chunk.source_id;
      const metadata = chunk.metadata as { title?: string } | null;
      if (!chunksByFile[sourceId]) {
        chunksByFile[sourceId] = {
          title: metadata?.title || 'Documento',
          chunks: []
        };
      }
      chunksByFile[sourceId].chunks.push(chunk.chunk_text);
    }

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
    
    // Build document content section
    let documentsText = '';
    for (const [fileId, fileData] of Object.entries(chunksByFile)) {
      documentsText += `\n### Documento: ${fileData.title}\n`;
      documentsText += `---\n`;
      // Join chunks with line breaks, limit each file's content
      const fullContent = fileData.chunks.join('\n\n');
      const truncatedContent = fullContent.substring(0, 8000); // ~2000 tokens per file
      documentsText += truncatedContent;
      if (fullContent.length > 8000) {
        documentsText += '\n[... conteúdo truncado por limite de tamanho ...]\n';
      }
      documentsText += `\n---\n\n`;
    }

    // Build insights section
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

    const systemPrompt = `Você é um redator técnico-científico que analisa dados de P&D.
Sua tarefa é criar um ${typeConfig.name}.

FOCO: ${typeConfig.focus}
ESTILO: ${typeConfig.style}

## FONTES DE INFORMAÇÃO:

Você receberá DUAS fontes de dados:
1. **CONTEÚDO DOS DOCUMENTOS**: Texto extraído diretamente dos arquivos do projeto (planilhas, PDFs, etc.)
2. **INSIGHTS PRÉ-EXTRAÍDOS**: Resumos analíticos já identificados por IA anteriormente

Você DEVE analisar AMBAS as fontes para gerar o relatório.

## REGRA ABSOLUTA - ZERO ALUCINAÇÃO:

1. Você SÓ pode escrever afirmações que estão EXPLICITAMENTE nos documentos ou insights fornecidos
2. NUNCA adicione conhecimento próprio sobre ciência de materiais, química ou odontologia
3. NUNCA use frases como "conforme esperado", "como se sabe", "correlação conhecida", "é sabido que"
4. NUNCA faça recomendações que NÃO estejam explicitamente nos dados
5. Se não houver dados suficientes, diga "dados insuficientes" em vez de inventar
6. NUNCA interprete ou tire conclusões além do que está literalmente escrito

## ESTRUTURA OBRIGATÓRIA:

Para cada afirmação no relatório:
- CITE a fonte: "Conforme [documento/insight]: [afirmação direta]"
- Use APENAS valores numéricos que aparecem nos documentos ou insights
- Se dois dados parecem se relacionar, diga "os dados indicam" e NÃO "confirma-se" ou "demonstra-se"

## O QUE VOCÊ NÃO PODE FAZER:

- Inventar correlações (ex: "correlação inversa esperada")
- Adicionar teoria científica não mencionada nos documentos
- Fazer recomendações especulativas
- Usar seu conhecimento prévio de química/materiais/odontologia
- Tirar conclusões além dos dados fornecidos
- Usar linguagem afirmativa sobre relações não comprovadas

## O QUE VOCÊ PODE FAZER:

- Analisar o conteúdo completo dos documentos
- Cruzar informações entre documentos e insights
- Identificar padrões nos dados QUANDO EXPLÍCITOS
- Citar valores EXATOS dos documentos
- Apontar lacunas e inconsistências nos dados
- Usar linguagem condicional ("os dados sugerem", "observou-se que")
- PROPOR PRÓXIMOS PASSOS baseados nas lacunas identificadas

## PRÓXIMOS PASSOS - DIRETRIZES:

Ao propor próximos passos, você DEVE:
1. Basear-se APENAS nas lacunas e limitações identificadas nos dados
2. Sugerir experimentos ou análises que preencham gaps específicos encontrados
3. Priorizar ações que validem ou refutem hipóteses implícitas nos dados
4. Ser específico: "Testar formulação X com concentração Y" em vez de "fazer mais testes"
5. Justificar cada sugestão citando a lacuna ou dado que a motiva

Você NÃO pode:
- Sugerir experimentos baseados em conhecimento teórico externo
- Propor ações genéricas sem ligação com os dados analisados
- Fazer recomendações que exigem informações não presentes nos documentos

## FORMATO ESPERADO:

### [Seção]
Conforme o documento '[nome]' / insight '[título]':
- Resultado A: [valor exato]
- Resultado B: [valor exato]

**Limitação:** [o que os dados NÃO mostram]

### Próximos Passos Sugeridos
Com base nas lacunas identificadas:
1. **[Ação específica]** - Justificativa: [citar dado ou lacuna que motiva]
2. **[Ação específica]** - Justificativa: [citar dado ou lacuna que motiva]`;

    const userPrompt = `## PROJETO: ${project.name}
${project.description ? `Descrição: ${project.description}` : ''}
${project.objectives ? `Objetivos: ${project.objectives}` : ''}

## CONTEÚDO DOS DOCUMENTOS (${Object.keys(chunksByFile).length} arquivos):
${documentsText || 'Nenhum documento indexado ainda.'}

## INSIGHTS PRÉ-EXTRAÍDOS (${insights?.length || 0} total):
${insightsText || 'Nenhum insight disponível ainda.'}

## LISTA DE ARQUIVOS:
${filesText || 'Nenhum arquivo registrado.'}

---

Analise profundamente o conteúdo dos documentos E os insights extraídos.
Gere o relatório completo em português brasileiro, citando as fontes específicas.`;

    // Call Lovable AI Gateway with tool calling for structured output
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY não configurada");
    }

    // Multi-model routing: reports always use advanced tier for quality
    const reportModel = report_type === 'executive' 
      ? 'google/gemini-3-flash-preview' // executive summaries are short, standard is fine
      : 'google/gemini-2.5-pro'; // full/progress reports use advanced model

    console.log(`Generating ${report_type} report for project ${project_id} with ${insights?.length || 0} insights and ${Object.keys(chunksByFile).length} documents, model=${reportModel}`);

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: reportModel,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "create_report",
              description: "Cria um relatório estruturado de P&D baseado na análise dos documentos e insights fornecidos",
              parameters: {
                type: "object",
                properties: {
                  titulo: { 
                    type: "string", 
                    description: "Título do relatório (máx 100 caracteres)" 
                  },
                  resumo: { 
                    type: "string", 
                    description: "Resumo baseado na análise dos documentos e insights, sem adições ou interpretações próprias. Use citações explícitas." 
                  },
                  conteudo: { 
                    type: "string", 
                    description: "Relatório em markdown com citações explícitas de documentos e insights. Analise os dados dos documentos. NUNCA adicione conhecimento próprio." 
                  },
                  limitacoes: {
                    type: "string",
                    description: "Lista do que os dados NÃO mostram, lacunas identificadas e áreas que precisam de mais pesquisa. Seja honesto sobre o que não pode ser concluído."
                  },
                  proximos_passos: {
                    type: "string",
                    description: "Próximos passos sugeridos baseados EXCLUSIVAMENTE nas lacunas e dados identificados. Cada sugestão deve citar a lacuna ou dado que a justifica. Seja específico e acionável."
                  }
                },
                required: ["titulo", "resumo", "conteudo", "limitacoes", "proximos_passos"],
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
    
    // Append limitations and next steps sections to content
    let finalContent = reportData.conteudo;
    if (reportData.limitacoes) {
      finalContent += `\n\n---\n\n## Limitações e Lacunas\n\n${reportData.limitacoes}`;
    }
    if (reportData.proximos_passos) {
      finalContent += `\n\n---\n\n## Próximos Passos Sugeridos\n\n${reportData.proximos_passos}`;
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
        ai_model_used: reportModel,
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
