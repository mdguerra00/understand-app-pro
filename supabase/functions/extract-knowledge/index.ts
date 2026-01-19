import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ExtractionInsight {
  category: "compound" | "parameter" | "result" | "method" | "observation";
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

    // Create the extraction prompt
    const systemPrompt = `Você é um especialista em P&D odontológico/dental. Sua tarefa é analisar documentos e extrair informações relevantes de pesquisa.

Analise o documento fornecido e extraia insights nas seguintes categorias:
- compound: Compostos químicos, ingredientes, formulações (ex: "Flúor 1450ppm", "Silica hidratada 15%")
- parameter: Parâmetros de testes e medições (ex: "pH 6.8", "Viscosidade 25000 cP", "Dureza Mohs 4")
- result: Resultados de ensaios e conclusões (ex: "Redução de 30% na abrasão", "Aprovado no teste de estabilidade")
- method: Metodologias e procedimentos utilizados (ex: "Teste de abrasividade ISO 11609", "Análise por HPLC")
- observation: Observações importantes e notas relevantes

Para cada insight extraído, forneça:
1. category: Uma das categorias acima
2. title: Título resumido (máx 100 caracteres)
3. content: Descrição completa do insight (máx 500 caracteres)
4. evidence: Trecho exato do documento que comprova o insight (máx 300 caracteres)
5. confidence: Nível de confiança de 0 a 1 (ex: 0.95 para informação clara, 0.7 para inferência)

Projeto: ${fileData.projects?.name || "Desconhecido"}
Arquivo: ${fileData.name}`;

    const userPrompt = `Analise o seguinte documento e extraia todos os insights de P&D relevantes:\n\n${textContent}`;

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
              description: "Extract R&D insights from the document",
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
                          enum: ["compound", "parameter", "result", "method", "observation"],
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
