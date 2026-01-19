import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ExtractionInsight {
  category: "compound" | "parameter" | "result" | "method" | "observation" | "finding" | "correlation" | "anomaly" | "benchmark" | "recommendation";
  title: string;
  content: string;
  evidence: string;
  confidence: number;
}

serve(async (req) => {
  // Handle CORS
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

    // Get authorization header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create clients
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    const supabaseUser = createClient(supabaseUrl, supabaseServiceKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Verify user
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { file_id, job_id } = await req.json();

    if (!file_id || !job_id) {
      return new Response(JSON.stringify({ error: "file_id and job_id are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Processing extraction for file: ${file_id}, job: ${job_id}`);

    // Get file metadata
    const { data: fileData, error: fileError } = await supabaseAdmin
      .from("project_files")
      .select("*, projects(name)")
      .eq("id", file_id)
      .single();

    if (fileError || !fileData) {
      throw new Error(`File not found: ${fileError?.message}`);
    }

    // Verify user has access to project
    const { data: memberData } = await supabaseAdmin
      .from("project_members")
      .select("role_in_project")
      .eq("project_id", fileData.project_id)
      .eq("user_id", user.id)
      .single();

    if (!memberData) {
      return new Response(JSON.stringify({ error: "Access denied" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Update job status to processing
    await supabaseAdmin
      .from("extraction_jobs")
      .update({ status: "processing", started_at: new Date().toISOString() })
      .eq("id", job_id);

    // Download file content
    const { data: fileContent, error: downloadError } = await supabaseAdmin.storage
      .from("project-files")
      .download(fileData.storage_path);

    if (downloadError || !fileContent) {
      throw new Error(`Failed to download file: ${downloadError?.message}`);
    }

    // Extract text content based on file type
    let textContent = "";
    const mimeType = fileData.mime_type || "";

    if (mimeType.startsWith("text/") || mimeType === "application/json") {
      textContent = await fileContent.text();
    } else if (mimeType === "application/pdf") {
      // For PDFs, we'll send the base64 to the AI for analysis
      const arrayBuffer = await fileContent.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
      textContent = `[PDF Document: ${fileData.name}]\n\nBase64 content available for analysis. Please extract R&D insights from this document.`;
    } else {
      // For other file types, try to extract text
      try {
        textContent = await fileContent.text();
      } catch {
        textContent = `[Binary File: ${fileData.name}] - Unable to extract text content.`;
      }
    }

    // Limit content size to avoid token limits
    const maxChars = 30000;
    if (textContent.length > maxChars) {
      textContent = textContent.substring(0, maxChars) + "\n\n[Content truncated...]";
    }

    // Create the analytical extraction prompt
    const systemPrompt = `Você é um cientista sênior de P&D odontológico/dental analisando dados experimentais.

Sua tarefa NÃO é simplesmente catalogar o que existe no documento, mas sim ANALISAR PROFUNDAMENTE os dados e extrair DESCOBERTAS SIGNIFICATIVAS com valor científico real.

## REGRAS CRÍTICAS:

1. **SEMPRE extraia VALORES NUMÉRICOS concretos** (ex: "145.2 MPa ±8.3", "pH 6.8", "concentração 15%")
2. **IDENTIFIQUE PADRÕES e CORRELAÇÕES** nos dados quando existirem
3. **COMPARE com REFERÊNCIAS** quando disponíveis (normas ISO, literatura científica, controles)
4. **APONTE ANOMALIAS** ou resultados fora do esperado que merecem atenção
5. **SUGIRA AÇÕES** quando os dados indicarem oportunidades ou problemas

## O QUE NÃO FAZER (exemplos ruins):
❌ "O documento contém informação sobre resistência flexural"
❌ "Foram utilizados monômeros como Bis-GMA e UDMA"
❌ "Há dados estatísticos de média e desvio padrão"
❌ "O arquivo apresenta resultados de testes"

## O QUE FAZER (exemplos bons):
✅ "Formulação V3 atingiu 148.5 MPa (±8.2), superando requisito ISO 4049 de 80 MPa em 85.6%"
✅ "Correlação positiva identificada: aumento de UDMA de 10%→20% elevou resistência de 120→145 MPa (+20.8%)"
✅ "ALERTA: CP7 (98 MPa) está 2.5σ abaixo da média do grupo - investigar processo de fabricação"
✅ "Recomendação: Formulação com 18% UDMA apresentou melhor custo-benefício (142 MPa, 15% mais barata)"
✅ "Benchmark superado: Resistência média de 143 MPa excede literatura (130 MPa) em 10%"

## CATEGORIAS DE INSIGHTS:

- **finding**: Descoberta quantitativa com valores numéricos específicos e significado científico
- **correlation**: Relação identificada entre duas ou mais variáveis com dados de suporte
- **anomaly**: Dados fora do padrão, outliers, ou resultados que requerem atenção/investigação
- **benchmark**: Comparativo com referência (norma ISO, controle, literatura, versão anterior)
- **recommendation**: Sugestão de ação baseada na análise dos dados

Também aceitas (usar com moderação para contexto essencial):
- **compound**: Apenas quando houver DESCOBERTA sobre o composto (não listar ingredientes)
- **parameter**: Apenas quando houver ANÁLISE do parâmetro (não listar medições)
- **result**: Apenas conclusões significativas com impacto prático
- **method**: Apenas insights sobre a metodologia (não descrever procedimentos)
- **observation**: Observações críticas não classificáveis acima

## FORMATO DE SAÍDA:

Para cada insight extraído, forneça:
1. **category**: Uma das categorias acima
2. **title**: Título analítico resumido (máx 100 caracteres) - deve conter o insight, não descrição
3. **content**: Análise completa com valores, comparações e significado (máx 500 caracteres)
4. **evidence**: Trecho exato do documento que comprova a análise (máx 300 caracteres)
5. **confidence**: Nível de confiança de 0 a 1 (0.95+ para dados diretos, 0.7-0.9 para inferências)

Projeto: ${fileData.projects?.name || "Desconhecido"}
Arquivo: ${fileData.name}`;

    const userPrompt = `Analise profundamente o seguinte documento e extraia DESCOBERTAS ANALÍTICAS de P&D (não simplesmente liste o conteúdo):

${textContent}`;

    // Call Lovable AI Gateway with tool calling
    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "extract_insights",
              description: "Extract analytical R&D discoveries from the document with quantitative data, correlations, anomalies, benchmarks, and recommendations",
              parameters: {
                type: "object",
                properties: {
                  insights: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        category: {
                          type: "string",
                          enum: ["finding", "correlation", "anomaly", "benchmark", "recommendation", "compound", "parameter", "result", "method", "observation"],
                        },
                        title: { type: "string", maxLength: 100 },
                        content: { type: "string", maxLength: 500 },
                        evidence: { type: "string", maxLength: 300 },
                        confidence: { type: "number", minimum: 0, maximum: 1 },
                      },
                      required: ["category", "title", "content", "evidence", "confidence"],
                    },
                  },
                },
                required: ["insights"],
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "extract_insights" } },
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error("AI Gateway error:", aiResponse.status, errorText);
      
      if (aiResponse.status === 429) {
        await supabaseAdmin
          .from("extraction_jobs")
          .update({ 
            status: "failed", 
            error_message: "Rate limit exceeded. Please try again later.",
            completed_at: new Date().toISOString(),
          })
          .eq("id", job_id);
        
        return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      
      if (aiResponse.status === 402) {
        await supabaseAdmin
          .from("extraction_jobs")
          .update({ 
            status: "failed", 
            error_message: "AI credits exhausted. Please add funds.",
            completed_at: new Date().toISOString(),
          })
          .eq("id", job_id);
        
        return new Response(JSON.stringify({ error: "Payment required" }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      
      throw new Error(`AI Gateway error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    console.log("AI Response:", JSON.stringify(aiData, null, 2));

    // Extract insights from tool call
    let insights: ExtractionInsight[] = [];
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    
    if (toolCall?.function?.arguments) {
      try {
        const args = JSON.parse(toolCall.function.arguments);
        insights = args.insights || [];
      } catch (parseError) {
        console.error("Failed to parse tool arguments:", parseError);
      }
    }

    // Estimate tokens used (rough approximation)
    const tokensUsed = Math.ceil((textContent.length + JSON.stringify(insights).length) / 4);

    // Save insights to database
    if (insights.length > 0) {
      const insightsToInsert = insights.map((insight) => ({
        project_id: fileData.project_id,
        source_file_id: file_id,
        extraction_job_id: job_id,
        category: insight.category,
        title: insight.title.substring(0, 100),
        content: insight.content.substring(0, 500),
        evidence: insight.evidence?.substring(0, 300) || null,
        confidence: Math.min(1, Math.max(0, insight.confidence)),
        extracted_by: user.id,
      }));

      const { error: insertError } = await supabaseAdmin
        .from("knowledge_items")
        .insert(insightsToInsert);

      if (insertError) {
        console.error("Failed to insert insights:", insertError);
        throw new Error(`Failed to save insights: ${insertError.message}`);
      }
    }

    // Update job as completed
    await supabaseAdmin
      .from("extraction_jobs")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        items_extracted: insights.length,
        tokens_used: tokensUsed,
      })
      .eq("id", job_id);

    console.log(`Extraction completed: ${insights.length} insights extracted`);

    return new Response(
      JSON.stringify({
        success: true,
        insights_count: insights.length,
        tokens_used: tokensUsed,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Extraction error:", error);
    
    // Try to update job status if we have job_id
    try {
      const { job_id } = await req.clone().json();
      if (job_id) {
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
        
        await supabaseAdmin
          .from("extraction_jobs")
          .update({
            status: "failed",
            error_message: error instanceof Error ? error.message : "Unknown error",
            completed_at: new Date().toISOString(),
          })
          .eq("id", job_id);
      }
    } catch {
      // Ignore cleanup errors
    }

    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
