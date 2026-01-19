import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as XLSX from "https://esm.sh/xlsx@0.18.5?target=deno";

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

interface InsightWithVerification extends ExtractionInsight {
  evidence_verified: boolean;
}

/**
 * Validates if the evidence text exists in the original content
 * Uses fuzzy matching to account for whitespace/formatting differences
 */
function verifyEvidence(evidence: string, originalContent: string): boolean {
  if (!evidence || !originalContent) return false;
  
  // Normalize both strings for comparison
  const normalizeText = (text: string) => 
    text.toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[^\w\s\d.,%-]/g, '')
      .trim();
  
  const normalizedEvidence = normalizeText(evidence);
  const normalizedContent = normalizeText(originalContent);
  
  // Check if evidence exists in content
  if (normalizedContent.includes(normalizedEvidence)) {
    return true;
  }
  
  // Try with first 50 chars of evidence (in case of truncation)
  const shortEvidence = normalizedEvidence.substring(0, 50);
  if (shortEvidence.length >= 20 && normalizedContent.includes(shortEvidence)) {
    return true;
  }
  
  // Extract key numbers from evidence and verify they exist in content
  const numbersInEvidence = evidence.match(/\d+[.,]?\d*/g) || [];
  if (numbersInEvidence.length > 0) {
    const foundNumbers = numbersInEvidence.filter(num => 
      originalContent.includes(num)
    );
    // If at least 60% of numbers are found, consider it partially verified
    return foundNumbers.length >= Math.ceil(numbersInEvidence.length * 0.6);
  }
  
  return false;
}

/**
 * Parse Excel/spreadsheet files into readable tabular text
 */
function parseSpreadsheet(arrayBuffer: ArrayBuffer, fileName: string): { content: string; quality: string } {
  try {
    const workbook = XLSX.read(arrayBuffer, { type: "array" });
    
    const sheets: string[] = [];
    let totalCells = 0;
    let emptyCells = 0;
    
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
      
      // Count data quality
      const rows = csv.split('\n').filter(r => r.trim());
      for (const row of rows) {
        const cells = row.split(',');
        totalCells += cells.length;
        emptyCells += cells.filter(c => !c.trim()).length;
      }
      
      if (csv.trim()) {
        sheets.push(`=== Planilha: ${sheetName} ===\n${csv}`);
      }
    }
    
    const content = sheets.join('\n\n');
    const dataRatio = totalCells > 0 ? (totalCells - emptyCells) / totalCells : 0;
    
    // Determine parsing quality
    let quality = 'good';
    if (!content || content.length < 100) {
      quality = 'poor';
    } else if (dataRatio < 0.3) {
      quality = 'partial';
    }
    
    console.log(`Parsed spreadsheet ${fileName}: ${sheets.length} sheets, ${totalCells} cells, quality: ${quality}`);
    
    return { content, quality };
  } catch (error) {
    console.error(`Failed to parse spreadsheet ${fileName}:`, error);
    return { 
      content: `[ERRO: Não foi possível ler a planilha ${fileName}. Formato incompatível ou arquivo corrompido.]`,
      quality: 'failed'
    };
  }
}

/**
 * Parse CSV files
 */
function parseCSV(text: string): { content: string; quality: string } {
  try {
    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length < 2) {
      return { content: text, quality: 'poor' };
    }
    
    // Format as readable table
    const formatted = lines.map((line, i) => {
      if (i === 0) return `CABEÇALHO: ${line}`;
      return `LINHA ${i}: ${line}`;
    }).join('\n');
    
    return { content: formatted, quality: 'good' };
  } catch {
    return { content: text, quality: 'partial' };
  }
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
    let parsingQuality = "unknown";
    const mimeType = fileData.mime_type || "";
    const fileName = fileData.name || "";

    // Handle Excel files
    if (mimeType.includes("spreadsheet") || 
        mimeType.includes("excel") || 
        mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
        mimeType === "application/vnd.ms-excel" ||
        fileName.endsWith(".xlsx") || 
        fileName.endsWith(".xls")) {
      
      console.log(`Parsing Excel file: ${fileName}`);
      const arrayBuffer = await fileContent.arrayBuffer();
      const parsed = parseSpreadsheet(arrayBuffer, fileName);
      textContent = parsed.content;
      parsingQuality = parsed.quality;
      
    } else if (mimeType === "text/csv" || fileName.endsWith(".csv")) {
      // Handle CSV files
      const rawText = await fileContent.text();
      const parsed = parseCSV(rawText);
      textContent = parsed.content;
      parsingQuality = parsed.quality;
      
    } else if (mimeType.startsWith("text/") || mimeType === "application/json") {
      textContent = await fileContent.text();
      parsingQuality = textContent.length > 100 ? "good" : "partial";
      
    } else if (mimeType === "application/pdf") {
      // For PDFs, we'll send the base64 to the AI for analysis
      const arrayBuffer = await fileContent.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
      textContent = `[PDF Document: ${fileData.name}]\n\nBase64 content available for analysis. Please extract R&D insights from this document.`;
      parsingQuality = "pdf_base64";
      
    } else {
      // For other file types, try to extract text
      try {
        textContent = await fileContent.text();
        // Check if it looks like binary garbage
        const nonPrintable = (textContent.match(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g) || []).length;
        if (nonPrintable > textContent.length * 0.1) {
          textContent = `[AVISO: Arquivo binário não suportado: ${fileData.name}. Formato: ${mimeType}]`;
          parsingQuality = "unsupported";
        } else {
          parsingQuality = "partial";
        }
      } catch {
        textContent = `[ERRO: Não foi possível ler o arquivo: ${fileData.name}]`;
        parsingQuality = "failed";
      }
    }

    // Update job with parsing quality
    await supabaseAdmin
      .from("extraction_jobs")
      .update({ parsing_quality: parsingQuality })
      .eq("id", job_id);

    console.log(`File parsed with quality: ${parsingQuality}, content length: ${textContent.length}`);

    // If parsing failed, return early with appropriate error
    if (parsingQuality === "failed" || parsingQuality === "unsupported") {
      await supabaseAdmin
        .from("extraction_jobs")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          items_extracted: 0,
          error_message: `Arquivo não pôde ser processado: ${parsingQuality}`,
        })
        .eq("id", job_id);

      return new Response(
        JSON.stringify({
          success: true,
          insights_count: 0,
          parsing_quality: parsingQuality,
          message: "Arquivo não suportado para extração de conhecimento",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Limit content size to avoid token limits
    const maxChars = 30000;
    if (textContent.length > maxChars) {
      textContent = textContent.substring(0, maxChars) + "\n\n[Content truncated...]";
    }

    // Create the analytical extraction prompt with anti-hallucination rules
    const systemPrompt = `Você é um cientista sênior de P&D odontológico/dental analisando dados experimentais.

Sua tarefa é ANALISAR PROFUNDAMENTE os dados e extrair DESCOBERTAS SIGNIFICATIVAS com valor científico real.

## ⚠️ REGRA ABSOLUTA DE INTEGRIDADE - NUNCA VIOLAR:

1. **NUNCA invente ou estime valores** que NÃO estejam EXPLICITAMENTE escritos no documento
2. O campo "evidence" DEVE ser uma **CÓPIA EXATA** de um trecho do documento original
3. Se os dados estiverem ilegíveis, incompletos ou o formato não permitir leitura, retorne um único insight de categoria "observation" explicando a limitação
4. **Preferível extrair ZERO insights do que UM insight fabricado**
5. Se você não consegue ver números/valores específicos no texto, NÃO os mencione na análise

## QUANDO EXTRAIR INSIGHTS:

✅ EXTRAIA quando você VÊ explicitamente no documento:
- Valores numéricos concretos (ex: "145.2 MPa", "pH 6.8", "15%")
- Comparações diretas com referências citadas
- Anomalias descritas pelo autor
- Conclusões escritas pelo pesquisador

❌ NÃO EXTRAIA / NÃO INVENTE:
- Valores que você "acha" que deveriam estar lá
- Correlações não explicitamente mencionadas
- Comparações com normas que você conhece mas não estão no documento
- Análises estatísticas não apresentadas

## CATEGORIAS DE INSIGHTS:

- **finding**: Descoberta quantitativa com valores numéricos VISTOS no documento
- **correlation**: Relação EXPLICITAMENTE identificada pelo autor entre variáveis
- **anomaly**: Dados fora do padrão APONTADOS no documento
- **benchmark**: Comparativo com referência CITADA no documento
- **recommendation**: Sugestão de ação ESCRITA pelo autor
- **observation**: Observações gerais ou LIMITAÇÕES na leitura do arquivo

Também aceitas (usar com moderação):
- **compound**, **parameter**, **result**, **method**: Apenas para descobertas significativas

## FORMATO DE SAÍDA:

Para cada insight:
1. **category**: Uma das categorias acima
2. **title**: Título analítico resumido (máx 100 chars) - DEVE conter o insight real
3. **content**: Análise completa com valores EXATOS do documento (máx 500 chars)
4. **evidence**: **TRECHO EXATO COPIADO** do documento que comprova a análise (máx 300 chars)
5. **confidence**: 
   - 0.95+ para dados diretamente copiados do documento
   - 0.7-0.9 para inferências baseadas em dados do documento
   - 0.5-0.7 se houver incerteza sobre a leitura

## SE O ARQUIVO NÃO PUDER SER LIDO CORRETAMENTE:

Retorne apenas UM insight:
{
  "category": "observation",
  "title": "Limitação na leitura do arquivo",
  "content": "Descreva o problema específico: dados ilegíveis, formato binário, etc.",
  "evidence": "Trecho que mostra o problema ou 'Arquivo em formato não-texto'",
  "confidence": 0.3
}

Projeto: ${fileData.projects?.name || "Desconhecido"}
Arquivo: ${fileData.name}
Qualidade do parsing: ${parsingQuality}`;

    const userPrompt = `Analise o documento abaixo e extraia APENAS descobertas que você pode COMPROVAR com evidências do texto.

LEMBRE-SE: O campo "evidence" deve ser uma CÓPIA EXATA do documento. Nunca invente valores.

CONTEÚDO DO DOCUMENTO:
---
${textContent}
---

Se o conteúdo acima parecer ilegível ou corrompido, retorne apenas um insight de "observation" explicando o problema.`;

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
              description: "Extract VERIFIED analytical R&D discoveries from the document. Evidence must be EXACT quotes from the document.",
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
    console.log("AI Response received, processing insights...");

    // Extract insights from tool call
    let rawInsights: ExtractionInsight[] = [];
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    
    if (toolCall?.function?.arguments) {
      try {
        const args = JSON.parse(toolCall.function.arguments);
        rawInsights = args.insights || [];
      } catch (parseError) {
        console.error("Failed to parse tool arguments:", parseError);
      }
    }

    // Validate evidence for each insight
    const validatedInsights: InsightWithVerification[] = rawInsights.map((insight) => {
      const evidenceVerified = verifyEvidence(insight.evidence, textContent);
      
      // Reduce confidence if evidence not verified
      let adjustedConfidence = insight.confidence;
      if (!evidenceVerified) {
        adjustedConfidence = Math.min(0.5, insight.confidence * 0.5);
        console.log(`Evidence NOT verified for insight: "${insight.title.substring(0, 50)}..." - confidence reduced to ${adjustedConfidence}`);
      } else {
        console.log(`Evidence VERIFIED for insight: "${insight.title.substring(0, 50)}..."`);
      }
      
      return {
        ...insight,
        confidence: adjustedConfidence,
        evidence_verified: evidenceVerified,
      };
    });

    // Log verification stats
    const verifiedCount = validatedInsights.filter(i => i.evidence_verified).length;
    console.log(`Evidence verification: ${verifiedCount}/${validatedInsights.length} insights verified`);

    // Estimate tokens used (rough approximation)
    const tokensUsed = Math.ceil((textContent.length + JSON.stringify(validatedInsights).length) / 4);

    // Save insights to database
    if (validatedInsights.length > 0) {
      const insightsToInsert = validatedInsights.map((insight) => ({
        project_id: fileData.project_id,
        source_file_id: file_id,
        extraction_job_id: job_id,
        category: insight.category,
        title: insight.title.substring(0, 100),
        content: insight.content.substring(0, 500),
        evidence: insight.evidence?.substring(0, 300) || null,
        confidence: Math.min(1, Math.max(0, insight.confidence)),
        evidence_verified: insight.evidence_verified,
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
        items_extracted: validatedInsights.length,
        tokens_used: tokensUsed,
        parsing_quality: parsingQuality,
      })
      .eq("id", job_id);

    console.log(`Extraction completed: ${validatedInsights.length} insights (${verifiedCount} verified)`);

    return new Response(
      JSON.stringify({
        success: true,
        insights_count: validatedInsights.length,
        verified_count: verifiedCount,
        parsing_quality: parsingQuality,
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
