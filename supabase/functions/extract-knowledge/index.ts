import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as XLSX from "https://esm.sh/xlsx@0.18.5?target=deno";
// @ts-ignore - pdfjs-serverless types
import { getDocument } from "https://esm.sh/pdfjs-serverless";
import mammoth from "https://esm.sh/mammoth@1.8.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ExtractionInsight {
  category: "compound" | "parameter" | "result" | "method" | "observation" | "finding" | "correlation" | "anomaly" | "benchmark" | "recommendation" | "cross_reference" | "pattern" | "contradiction" | "gap";
  title: string;
  content: string;
  evidence: string;
  confidence: number;
}

interface InsightWithVerification extends ExtractionInsight {
  evidence_verified: boolean;
}

interface ExperimentExtraction {
  title: string;
  objective?: string;
  summary?: string;
  is_qualitative: boolean;
  measurements: {
    metric: string;
    value: number;
    unit: string;
    method?: string;
    notes?: string;
    confidence: string;
    source_excerpt: string;
  }[];
  conditions: { key: string; value: string }[];
  citations: {
    page?: number;
    sheet_name?: string;
    cell_range?: string;
    excerpt: string;
  }[];
}

// ==========================================
// UTILITY FUNCTIONS
// ==========================================

function verifyEvidence(evidence: string, originalContent: string): boolean {
  if (!evidence || !originalContent) return false;
  const normalizeText = (text: string) =>
    text.toLowerCase().replace(/\s+/g, ' ').replace(/[^\w\s\d.,%-]/g, '').trim();
  const normalizedEvidence = normalizeText(evidence);
  const normalizedContent = normalizeText(originalContent);
  if (normalizedContent.includes(normalizedEvidence)) return true;
  const shortEvidence = normalizedEvidence.substring(0, 50);
  if (shortEvidence.length >= 20 && normalizedContent.includes(shortEvidence)) return true;
  const numbersInEvidence = evidence.match(/\d+[.,]?\d*/g) || [];
  if (numbersInEvidence.length > 0) {
    const foundNumbers = numbersInEvidence.filter(num => originalContent.includes(num));
    return foundNumbers.length >= Math.ceil(numbersInEvidence.length * 0.6);
  }
  return false;
}

async function generateFingerprint(data: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Validate a measurement against anti-hallucination rules:
 * 1. value must be a valid number
 * 2. unit must not be empty
 * 3. source_excerpt must contain the numeric value
 */
function validateMeasurement(m: any): boolean {
  if (typeof m.value !== 'number' || isNaN(m.value)) return false;
  if (!m.unit || String(m.unit).trim() === '') return false;
  if (!m.source_excerpt || String(m.source_excerpt).trim() === '') return false;
  // Check that the excerpt contains the value (as string)
  const valueStr = String(m.value);
  const excerpt = String(m.source_excerpt);
  // Try exact match or close match (e.g., "131" in "131 MPa")
  if (excerpt.includes(valueStr)) return true;
  // Try with comma separator (European format)
  if (excerpt.includes(valueStr.replace('.', ','))) return true;
  return false;
}

// ==========================================
// EXCEL STRUCTURED PARSER
// ==========================================

interface ExcelSheetData {
  sheetName: string;
  headers: string[];
  rows: Record<string, any>[];
  headerRows: string[][]; // First 3 rows for AI mapping
}

function parseExcelStructured(arrayBuffer: ArrayBuffer, fileName: string): {
  sheets: ExcelSheetData[];
  textContent: string;
  quality: string;
  sheetsFound: number;
} {
  try {
    const workbook = XLSX.read(arrayBuffer, { type: "array" });
    const sheets: ExcelSheetData[] = [];
    const textParts: string[] = [];
    let totalCells = 0;
    let emptyCells = 0;

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      
      // Get structured JSON data
      const jsonData = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: "" });
      
      // Get raw rows for header detection
      const rawRows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: "" });
      const headerRows = rawRows.slice(0, 3).map(row => row.map(String));
      const headers = headerRows[0] || [];
      
      // Also generate CSV for text content / insights extraction
      const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
      const rows = csv.split('\n').filter((r: string) => r.trim());
      for (const row of rows) {
        const cells = row.split(',');
        totalCells += cells.length;
        emptyCells += cells.filter((c: string) => !c.trim()).length;
      }
      
      if (jsonData.length > 0) {
        sheets.push({ sheetName, headers, rows: jsonData, headerRows });
        textParts.push(`=== Planilha: ${sheetName} ===\n${csv}`);
      }
    }

    const textContent = textParts.join('\n\n');
    const dataRatio = totalCells > 0 ? (totalCells - emptyCells) / totalCells : 0;
    let quality = 'good';
    if (!textContent || textContent.length < 100) quality = 'poor';
    else if (dataRatio < 0.3) quality = 'partial';

    return { sheets, textContent, quality, sheetsFound: workbook.SheetNames.length };
  } catch (error) {
    console.error(`Failed to parse spreadsheet ${fileName}:`, error);
    return { sheets: [], textContent: '', quality: 'failed', sheetsFound: 0 };
  }
}

/**
 * Use AI to map Excel headers to metrics/conditions/units.
 * AI only sees headers (first 3 rows), NOT the data.
 */
async function mapExcelHeaders(
  sheets: ExcelSheetData[],
  apiKey: string,
  metricsCatalog: any[]
): Promise<any> {
  const headerSummary = sheets.map(s => ({
    sheet: s.sheetName,
    headers: s.headerRows,
    row_count: s.rows.length,
  }));

  const catalogSummary = metricsCatalog.map(m => 
    `${m.canonical_name} (${m.display_name}, ${m.unit}) aliases: ${m.aliases?.join(', ')}`
  ).join('\n');

  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        {
          role: "system",
          content: `Você é um mapeador de colunas de planilhas científicas. Dado os cabeçalhos de uma planilha Excel, identifique:
- Quais colunas contêm MÉTRICAS (valores numéricos de medição)
- Quais colunas contêm UNIDADES
- Quais colunas contêm CONDIÇÕES experimentais (key-value)
- Quais colunas contêm IDENTIFICADORES de amostra/grupo

Use o catálogo de métricas canônicas quando possível:
${catalogSummary}

REGRAS:
1. Se uma coluna tem nome como "RF (MPa)" ou "Flexural Strength", mapeie para a métrica canônica + unidade
2. Se a unidade está no nome da coluna (ex: "MPa"), extraia-a
3. Colunas como "Grupo", "Amostra", "Material" são condições
4. Se não consegue mapear com certeza, marque como "unknown"`,
        },
        {
          role: "user",
          content: `Mapeie as colunas destas planilhas:\n${JSON.stringify(headerSummary, null, 2)}`,
        },
      ],
      tools: [{
        type: "function",
        function: {
          name: "map_columns",
          description: "Map spreadsheet columns to metrics, units and conditions",
          parameters: {
            type: "object",
            properties: {
              sheet_mappings: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    sheet_name: { type: "string" },
                    experiment_title: { type: "string", description: "Suggested experiment title based on sheet content" },
                    columns: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          column_name: { type: "string" },
                          role: { type: "string", enum: ["metric", "unit", "condition", "identifier", "unknown"] },
                          canonical_metric: { type: "string", description: "Canonical metric name if role=metric" },
                          unit: { type: "string", description: "Unit extracted from column name or inferred" },
                          condition_key: { type: "string", description: "Condition key if role=condition" },
                        },
                        required: ["column_name", "role"],
                      },
                    },
                  },
                  required: ["sheet_name", "experiment_title", "columns"],
                },
              },
            },
            required: ["sheet_mappings"],
          },
        },
      }],
      tool_choice: { type: "function", function: { name: "map_columns" } },
    }),
  });

  if (!response.ok) {
    console.warn("Header mapping AI call failed:", response.status);
    return null;
  }

  const data = await response.json();
  const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
  if (toolCall?.function?.arguments) {
    try {
      return JSON.parse(toolCall.function.arguments);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Generate structured experiments from Excel data using AI column mapping
 */
function generateExcelExperiments(
  sheets: ExcelSheetData[],
  mapping: any,
  fileId: string
): ExperimentExtraction[] {
  if (!mapping?.sheet_mappings) return [];
  const experiments: ExperimentExtraction[] = [];

  for (const sheetMapping of mapping.sheet_mappings) {
    const sheet = sheets.find(s => s.sheetName === sheetMapping.sheet_name);
    if (!sheet) continue;

    const metricColumns = (sheetMapping.columns || []).filter((c: any) => c.role === 'metric');
    const conditionColumns = (sheetMapping.columns || []).filter((c: any) => c.role === 'condition');
    const identifierColumns = (sheetMapping.columns || []).filter((c: any) => c.role === 'identifier');

    // Extract conditions from first data row as defaults
    const conditions: { key: string; value: string }[] = [];

    // Build measurements from each data row
    const measurements: ExperimentExtraction['measurements'] = [];
    const citations: ExperimentExtraction['citations'] = [];

    for (let rowIdx = 0; rowIdx < sheet.rows.length; rowIdx++) {
      const row = sheet.rows[rowIdx];
      
      // Build row identifier for citations
      const rowId = identifierColumns.map((c: any) => String(row[c.column_name] || '')).filter(Boolean).join(' | ');

      // Extract conditions from this row
      for (const cc of conditionColumns) {
        const val = String(row[cc.column_name] || '').trim();
        if (val && !conditions.find(c => c.key === (cc.condition_key || cc.column_name) && c.value === val)) {
          conditions.push({ key: cc.condition_key || cc.column_name, value: val });
        }
      }

      // Extract measurements
      for (const mc of metricColumns) {
        const rawValue = row[mc.column_name];
        const numValue = parseFloat(String(rawValue).replace(',', '.'));
        if (isNaN(numValue)) continue;

        const excerpt = `Sheet: ${sheet.sheetName}, Row: ${rowIdx + 2}, Col: ${mc.column_name}, Value: ${rawValue}${rowId ? `, Sample: ${rowId}` : ''}`;
        
        measurements.push({
          metric: mc.canonical_metric || mc.column_name,
          value: numValue,
          unit: mc.unit || '',
          confidence: 'high',
          source_excerpt: excerpt,
        });

        citations.push({
          sheet_name: sheet.sheetName,
          cell_range: `Row ${rowIdx + 2}, Col ${mc.column_name}`,
          excerpt: excerpt.substring(0, 300),
        });
      }
    }

    // Only create experiment if we have data
    if (measurements.length > 0 || conditions.length > 0) {
      experiments.push({
        title: sheetMapping.experiment_title || `Dados: ${sheet.sheetName}`,
        objective: undefined,
        summary: `${measurements.length} medições extraídas de ${sheet.rows.length} linhas na planilha "${sheet.sheetName}"`,
        is_qualitative: measurements.length === 0,
        measurements,
        conditions,
        citations,
      });
    }
  }

  return experiments;
}

// ==========================================
// PDF/WORD PARSERS (existing + fallback)
// ==========================================

function parseCSV(text: string): { content: string; quality: string } {
  try {
    const lines = text.split('\n').filter((l: string) => l.trim());
    if (lines.length < 2) return { content: text, quality: 'poor' };
    const formatted = lines.map((line: string, i: number) => {
      if (i === 0) return `CABEÇALHO: ${line}`;
      return `LINHA ${i}: ${line}`;
    }).join('\n');
    return { content: formatted, quality: 'good' };
  } catch {
    return { content: text, quality: 'partial' };
  }
}

// ==========================================
// METRICS CATALOG NORMALIZATION
// ==========================================

async function normalizeMetric(supabase: any, metric: string): Promise<string> {
  const normalized = metric.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  
  // Search catalog by canonical name or aliases
  const { data: catalog } = await supabase
    .from('metrics_catalog')
    .select('canonical_name, aliases')
    .limit(100);

  if (catalog) {
    for (const entry of catalog) {
      if (entry.canonical_name === normalized) return entry.canonical_name;
      if (entry.aliases?.includes(normalized)) return entry.canonical_name;
      if (entry.aliases?.includes(metric.toLowerCase())) return entry.canonical_name;
    }
  }

  // Auto-create if not found
  try {
    await supabase.from('metrics_catalog').insert({
      canonical_name: normalized,
      display_name: metric,
      unit: '',
      aliases: [normalized, metric.toLowerCase()],
      category: 'other',
    });
  } catch {
    // Ignore duplicate
  }

  return normalized;
}

// ==========================================
// SAVE EXPERIMENTS TO DB
// ==========================================

async function saveExperiments(
  supabase: any,
  experiments: ExperimentExtraction[],
  projectId: string,
  fileId: string,
  jobId: string,
  userId: string,
  sourceType: string,
): Promise<number> {
  let totalMeasurements = 0;

  for (const exp of experiments) {
    // Validate measurements with anti-hallucination rules
    const validMeasurements = exp.measurements.filter(validateMeasurement);
    const discarded = exp.measurements.length - validMeasurements.length;
    if (discarded > 0) {
      console.log(`Anti-hallucination: discarded ${discarded} invalid measurements for "${exp.title}"`);
    }

    // Create experiment
    const { data: expRecord, error: expError } = await supabase
      .from('experiments')
      .insert({
        project_id: projectId,
        source_file_id: fileId,
        extraction_job_id: jobId,
        title: exp.title,
        objective: exp.objective || null,
        summary: exp.summary || null,
        source_type: sourceType,
        is_qualitative: exp.is_qualitative || validMeasurements.length === 0,
        extracted_by: userId,
      })
      .select('id')
      .single();

    if (expError || !expRecord) {
      console.error('Failed to create experiment:', expError);
      continue;
    }

    // Save measurements (normalized)
    for (const m of validMeasurements) {
      const canonicalMetric = await normalizeMetric(supabase, m.metric);
      await supabase.from('measurements').insert({
        experiment_id: expRecord.id,
        metric: canonicalMetric,
        value: m.value,
        unit: m.unit,
        method: m.method || null,
        notes: m.notes || null,
        confidence: m.confidence || 'medium',
        source_excerpt: m.source_excerpt.substring(0, 500),
      });
      totalMeasurements++;
    }

    // Save conditions
    for (const c of exp.conditions) {
      await supabase.from('experiment_conditions').insert({
        experiment_id: expRecord.id,
        key: c.key,
        value: c.value,
      });
    }

    // Save citations
    for (const cit of exp.citations) {
      await supabase.from('experiment_citations').insert({
        experiment_id: expRecord.id,
        file_id: fileId,
        page: cit.page || null,
        sheet_name: cit.sheet_name || null,
        cell_range: cit.cell_range || null,
        excerpt: cit.excerpt.substring(0, 500),
      });
    }
  }

  return totalMeasurements;
}

// ==========================================
// MAIN HANDLER
// ==========================================

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
      return new Response(JSON.stringify({ error: "Missing authorization header" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    const supabaseUser = createClient(supabaseUrl, supabaseServiceKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { file_id, job_id, force } = await req.json();
    if (!file_id || !job_id) {
      return new Response(JSON.stringify({ error: "file_id and job_id are required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Processing extraction for file: ${file_id}, job: ${job_id}`);

    // Get file metadata
    const { data: fileData, error: fileError } = await supabaseAdmin
      .from("project_files")
      .select("*, projects(name)")
      .eq("id", file_id)
      .single();

    if (fileError || !fileData) throw new Error(`File not found: ${fileError?.message}`);

    // Verify user has access
    const { data: memberData } = await supabaseAdmin
      .from("project_members")
      .select("role_in_project")
      .eq("project_id", fileData.project_id)
      .eq("user_id", user.id)
      .single();

    if (!memberData) {
      return new Response(JSON.stringify({ error: "Access denied" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Update job status to processing
    await supabaseAdmin
      .from("extraction_jobs")
      .update({ status: "processing", started_at: new Date().toISOString() })
      .eq("id", job_id);

    // Download file
    const { data: fileContent, error: downloadError } = await supabaseAdmin.storage
      .from("project-files")
      .download(fileData.storage_path);

    if (downloadError || !fileContent) throw new Error(`Failed to download file: ${downloadError?.message}`);

    // ==========================================
    // FINGERPRINT CHECK (Idempotency)
    // ==========================================
    const arrayBuffer = await fileContent.arrayBuffer();
    const fingerprint = await generateFingerprint(arrayBuffer);

    // Save fingerprint on file record
    await supabaseAdmin
      .from("project_files")
      .update({ content_fingerprint: fingerprint })
      .eq("id", file_id);

    // Save fingerprint on job
    await supabaseAdmin
      .from("extraction_jobs")
      .update({ content_fingerprint: fingerprint })
      .eq("id", job_id);

    // Check for existing completed job with same fingerprint (skip if force=true)
    if (!force) {
      const { data: existingJob } = await supabaseAdmin
        .from("extraction_jobs")
        .select("id, items_extracted, completed_at")
        .eq("content_fingerprint", fingerprint)
        .eq("project_id", fileData.project_id)
        .eq("status", "completed")
        .neq("id", job_id)
        .limit(1)
        .single();

      if (existingJob) {
        console.log(`Idempotency: skipping extraction, found existing job ${existingJob.id}`);
        await supabaseAdmin
          .from("extraction_jobs")
          .update({
            status: "completed",
            completed_at: new Date().toISOString(),
            items_extracted: existingJob.items_extracted,
            error_message: `Conteúdo idêntico já processado (job: ${existingJob.id})`,
          })
          .eq("id", job_id);

        return new Response(JSON.stringify({
          success: true,
          insights_count: existingJob.items_extracted || 0,
          skipped: true,
          message: "Conteúdo idêntico já foi processado anteriormente",
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // ==========================================
    // FILE PARSING
    // ==========================================
    let textContent = "";
    let parsingQuality = "unknown";
    let sheetsFound = 0;
    let contentTruncated = false;
    let excelSheets: ExcelSheetData[] = [];
    const mimeType = fileData.mime_type || "";
    const fileName = fileData.name || "";
    const isExcel = mimeType.includes("spreadsheet") || mimeType.includes("excel") ||
      mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      mimeType === "application/vnd.ms-excel" || fileName.endsWith(".xlsx") || fileName.endsWith(".xls");

    if (isExcel) {
      console.log(`Parsing Excel file (structured): ${fileName}`);
      const parsed = parseExcelStructured(arrayBuffer, fileName);
      excelSheets = parsed.sheets;
      textContent = parsed.textContent;
      parsingQuality = parsed.quality;
      sheetsFound = parsed.sheetsFound;
      textContent = `[Arquivo: ${fileName}]\n[Abas: ${parsed.sheetsFound}]\n\n${textContent}`;

    } else if (mimeType === "text/csv" || fileName.endsWith(".csv")) {
      const rawText = new TextDecoder().decode(arrayBuffer);
      const parsed = parseCSV(rawText);
      textContent = parsed.content;
      parsingQuality = parsed.quality;

    } else if (mimeType.startsWith("text/") || mimeType === "application/json") {
      textContent = new TextDecoder().decode(arrayBuffer);
      parsingQuality = textContent.length > 100 ? "good" : "partial";

    } else if (mimeType === "application/pdf") {
      console.log(`Processing PDF: ${fileData.name}`);
      try {
        const uint8Array = new Uint8Array(arrayBuffer);
        const pdfDoc = await getDocument({ data: uint8Array, useSystemFonts: true }).promise;
        const textParts: string[] = [];
        for (let i = 1; i <= pdfDoc.numPages; i++) {
          const page = await pdfDoc.getPage(i);
          const content = await page.getTextContent();
          const pageText = content.items.map((item: any) => item.str).join(' ');
          if (pageText.trim()) textParts.push(`--- Página ${i} ---\n${pageText}`);
        }
        const extractedText = textParts.join('\n\n');
        if (extractedText.length > 100) {
          textContent = `[PDF: ${fileData.name}]\n[Páginas: ${pdfDoc.numPages}]\n\n${extractedText}`;
          parsingQuality = "good";
        } else if (extractedText.length > 0) {
          textContent = `[PDF: ${fileData.name}]\n[Páginas: ${pdfDoc.numPages}]\n\n${extractedText}`;
          parsingQuality = "partial";
        } else {
          textContent = `[PDF: ${fileData.name}]\n[AVISO: PDF sem texto extraível]`;
          parsingQuality = "failed";
        }
      } catch (pdfError: unknown) {
        const errorMessage = pdfError instanceof Error ? pdfError.message : String(pdfError);
        console.error("PDF parsing error:", pdfError);
        textContent = `[PDF: ${fileData.name}]\n[ERRO: ${errorMessage}]`;
        parsingQuality = "failed";
      }

    } else if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || fileName.endsWith(".docx")) {
      console.log(`Parsing DOCX: ${fileName}`);
      try {
        const result = await mammoth.extractRawText({ arrayBuffer });
        textContent = result.value || "";
        parsingQuality = textContent.length > 500 ? "good" : textContent.length > 50 ? "partial" : "poor";
        textContent = `[Word: ${fileName}]\n\n${textContent}`;
      } catch (docxError: unknown) {
        const errorMessage = docxError instanceof Error ? docxError.message : String(docxError);
        console.error("DOCX parsing error:", docxError);
        textContent = `[Word: ${fileName}]\n[ERRO: ${errorMessage}]`;
        parsingQuality = "failed";
      }

    } else {
      try {
        textContent = new TextDecoder().decode(arrayBuffer);
        const nonPrintable = (textContent.match(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g) || []).length;
        if (nonPrintable > textContent.length * 0.1) {
          textContent = `[Arquivo binário não suportado: ${fileData.name}]`;
          parsingQuality = "unsupported";
        } else {
          parsingQuality = "partial";
        }
      } catch {
        textContent = `[ERRO: Não foi possível ler: ${fileData.name}]`;
        parsingQuality = "failed";
      }
    }

    // Update job with parsing info
    await supabaseAdmin.from("extraction_jobs").update({
      parsing_quality: parsingQuality,
      sheets_found: sheetsFound > 0 ? sheetsFound : null,
    }).eq("id", job_id);

    console.log(`File parsed: quality=${parsingQuality}, length=${textContent.length}`);

    // Early return for failed parsing
    if (parsingQuality === "failed" || parsingQuality === "unsupported") {
      // Create qualitative experiment as fallback
      const fallbackExperiment: ExperimentExtraction = {
        title: `Documento: ${fileName}`,
        summary: "Documento sem dados quantitativos extraíveis",
        is_qualitative: true,
        measurements: [],
        conditions: [],
        citations: [{
          excerpt: textContent.substring(0, 300) || "Arquivo não processável",
        }],
      };

      const sourceType = isExcel ? 'excel' : mimeType === 'application/pdf' ? 'pdf' : 'word';
      await saveExperiments(supabaseAdmin, [fallbackExperiment], fileData.project_id, file_id, job_id, user.id, sourceType);

      await supabaseAdmin.from("extraction_jobs").update({
        status: "completed",
        completed_at: new Date().toISOString(),
        items_extracted: 0,
        error_message: `Arquivo não pôde ser processado: ${parsingQuality}`,
      }).eq("id", job_id);

      return new Response(JSON.stringify({
        success: true, insights_count: 0, experiments_count: 1,
        parsing_quality: parsingQuality, message: "Fallback qualitativo criado",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Truncate if needed
    const maxChars = 120000;
    if (textContent.length > maxChars) {
      contentTruncated = true;
      textContent = textContent.substring(0, maxChars) +
        `\n\n[⚠️ TRUNCADO: ${Math.ceil(textContent.length / 1000)}k chars, processados ${maxChars / 1000}k]`;
      await supabaseAdmin.from("extraction_jobs").update({ content_truncated: true }).eq("id", job_id);
    }

    // ==========================================
    // EXCEL: STRUCTURED EXTRACTION (AI only maps headers)
    // ==========================================
    let experimentsCount = 0;
    let measurementsCount = 0;

    if (isExcel && excelSheets.length > 0) {
      console.log(`Excel structured extraction: ${excelSheets.length} sheets`);

      // Fetch metrics catalog for normalization
      const { data: metricsCatalog } = await supabaseAdmin
        .from('metrics_catalog')
        .select('canonical_name, display_name, unit, aliases');

      // AI maps headers only
      const mapping = await mapExcelHeaders(excelSheets, lovableApiKey, metricsCatalog || []);
      
      if (mapping) {
        const experiments = generateExcelExperiments(excelSheets, mapping, file_id);
        measurementsCount = await saveExperiments(
          supabaseAdmin, experiments, fileData.project_id, file_id, job_id, user.id, 'excel'
        );
        experimentsCount = experiments.length;
        console.log(`Excel: created ${experimentsCount} experiments with ${measurementsCount} measurements`);
      }
    }

    // ==========================================
    // AI EXTRACTION (insights + experiments for PDF/Word)
    // ==========================================

    const systemPrompt = `Você é um cientista sênior de P&D odontológico analisando dados experimentais.

## ⚠️ REGRA ABSOLUTA - NUNCA VIOLAR:
1. **NUNCA invente valores** não escritos EXPLICITAMENTE no documento
2. "evidence" DEVE ser **CÓPIA EXATA** de um trecho do documento
3. **Preferível ZERO insights a UM fabricado**

## REGRA PARA MEASUREMENTS (OBRIGATÓRIA):
- Um measurement só pode ser criado se houver:
  1. Um número explícito no documento
  2. Uma unidade associada (ou inferível pelo contexto)
  3. Um trecho citável que contenha o número
- Se faltar qualquer um dos 3, NÃO criar measurement
- Preferir ZERO measurements a UM fabricado

## CATEGORIAS:
finding, correlation, anomaly, benchmark, recommendation, observation, compound, parameter, result, method, cross_reference, pattern, contradiction, gap

Projeto: ${fileData.projects?.name || "Desconhecido"}
Arquivo: ${fileData.name}
Qualidade: ${parsingQuality}`;

    const userPrompt = `Analise e extraia descobertas COMPROVADAS + experimentos estruturados.

CONTEÚDO:
---
${textContent}
---

Se ilegível, retorne apenas um insight de "observation".`;

    // Build tools array - always extract insights, also extract experiments for non-Excel files
    const tools: any[] = [{
      type: "function",
      function: {
        name: "extract_all",
        description: "Extract verified insights AND structured experiments from document",
        parameters: {
          type: "object",
          properties: {
            insights: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  category: { type: "string", enum: ["finding", "correlation", "anomaly", "benchmark", "recommendation", "compound", "parameter", "result", "method", "observation", "cross_reference", "pattern", "contradiction", "gap"] },
                  title: { type: "string", maxLength: 100 },
                  content: { type: "string", maxLength: 500 },
                  evidence: { type: "string", maxLength: 300 },
                  confidence: { type: "number", minimum: 0, maximum: 1 },
                },
                required: ["category", "title", "content", "evidence", "confidence"],
              },
            },
            experiments: {
              type: "array",
              description: "Structured experiments with measurements. Only for PDF/Word docs with quantitative data.",
              items: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  objective: { type: "string" },
                  summary: { type: "string" },
                  is_qualitative: { type: "boolean" },
                  measurements: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        metric: { type: "string" },
                        value: { type: "number" },
                        unit: { type: "string" },
                        method: { type: "string" },
                        confidence: { type: "string", enum: ["high", "medium", "low"] },
                        source_excerpt: { type: "string", description: "EXACT quote containing the number" },
                      },
                      required: ["metric", "value", "unit", "confidence", "source_excerpt"],
                    },
                  },
                  conditions: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        key: { type: "string" },
                        value: { type: "string" },
                      },
                      required: ["key", "value"],
                    },
                  },
                  citations: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        page: { type: "integer" },
                        excerpt: { type: "string" },
                      },
                      required: ["excerpt"],
                    },
                  },
                },
                required: ["title", "is_qualitative", "measurements", "conditions", "citations"],
              },
            },
          },
          required: ["insights", "experiments"],
        },
      },
    }];

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
        tools,
        tool_choice: { type: "function", function: { name: "extract_all" } },
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error("AI Gateway error:", aiResponse.status, errorText);

      if (aiResponse.status === 429 || aiResponse.status === 402) {
        const msg = aiResponse.status === 429 ? "Rate limit exceeded" : "AI credits exhausted";
        await supabaseAdmin.from("extraction_jobs").update({
          status: "failed", error_message: msg, completed_at: new Date().toISOString(),
        }).eq("id", job_id);
        return new Response(JSON.stringify({ error: msg }), {
          status: aiResponse.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI Gateway error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    let rawInsights: ExtractionInsight[] = [];
    let rawExperiments: ExperimentExtraction[] = [];

    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    if (toolCall?.function?.arguments) {
      try {
        const args = JSON.parse(toolCall.function.arguments);
        rawInsights = args.insights || [];
        rawExperiments = args.experiments || [];
      } catch (parseError) {
        console.error("Failed to parse tool arguments:", parseError);
      }
    }

    // Validate insights evidence
    const validatedInsights: InsightWithVerification[] = rawInsights.map((insight) => {
      const evidenceVerified = verifyEvidence(insight.evidence, textContent);
      let adjustedConfidence = insight.confidence;
      if (!evidenceVerified) {
        adjustedConfidence = Math.min(0.5, insight.confidence * 0.5);
      }
      return { ...insight, confidence: adjustedConfidence, evidence_verified: evidenceVerified };
    });

    const verifiedCount = validatedInsights.filter(i => i.evidence_verified).length;
    const tokensUsed = Math.ceil((textContent.length + JSON.stringify(validatedInsights).length) / 4);

    // Save insights
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

      const { error: insertError } = await supabaseAdmin.from("knowledge_items").insert(insightsToInsert);
      if (insertError) {
        console.error("Failed to insert insights:", insertError);
        throw new Error(`Failed to save insights: ${insertError.message}`);
      }
    }

    // Save experiments from AI (for PDF/Word - Excel already handled above)
    if (!isExcel && rawExperiments.length > 0) {
      const sourceType = mimeType === 'application/pdf' ? 'pdf' :
        (mimeType?.includes('word') || fileName.endsWith('.docx')) ? 'word' : 'pdf';
      
      const expMeasurements = await saveExperiments(
        supabaseAdmin, rawExperiments, fileData.project_id, file_id, job_id, user.id, sourceType
      );
      experimentsCount += rawExperiments.length;
      measurementsCount += expMeasurements;
    }

    // PDF/Word fallback: if no experiments were extracted, create qualitative one
    if (!isExcel && experimentsCount === 0 && (parsingQuality === 'partial' || parsingQuality === 'poor' || rawExperiments.length === 0)) {
      const sourceType = mimeType === 'application/pdf' ? 'pdf' : 'word';
      const fallback: ExperimentExtraction = {
        title: `Análise: ${fileName}`,
        summary: rawExperiments.length === 0 
          ? "Nenhum experimento quantitativo identificado no documento" 
          : "Documento com dados parciais",
        is_qualitative: true,
        measurements: [],
        conditions: [],
        citations: [{
          excerpt: textContent.substring(0, 300),
          page: 1,
        }],
      };
      await saveExperiments(supabaseAdmin, [fallback], fileData.project_id, file_id, job_id, user.id, sourceType);
      experimentsCount += 1;
    }

    // ==========================================
    // CROSS-DOCUMENT ANALYSIS
    // ==========================================
    let crossDocInsights = 0;
    try {
      if (validatedInsights.length > 0) {
        const { data: existingInsights } = await supabaseAdmin
          .from("knowledge_items")
          .select("id, title, content, category, confidence, evidence, source_file_id")
          .eq("project_id", fileData.project_id)
          .neq("source_file_id", file_id)
          .is("deleted_at", null)
          .limit(50);

        if (existingInsights && existingInsights.length >= 2) {
          const newSummary = validatedInsights.map((i, idx) => `[NEW-${idx + 1}] ${i.category}: ${i.title} — ${i.content}`).join("\n");
          const existSummary = existingInsights.map((i, idx) => `[EX-${idx + 1}] (id:${i.id}) ${i.category}: ${i.title} — ${i.content}`).join("\n");

          const crossDocResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: { Authorization: `Bearer ${lovableApiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "google/gemini-3-flash-preview",
              messages: [
                { role: "system", content: `Analise relações entre insights.\nNOVOS:\n${newSummary}\n\nEXISTENTES:\n${existSummary}\n\nIdentifique: cross_reference, pattern, contradiction, gap. Max 5. Se não há relações, retorne array vazio.` },
                { role: "user", content: "Identifique relações cross-document." },
              ],
              tools: [{
                type: "function",
                function: {
                  name: "report_relationships",
                  parameters: {
                    type: "object",
                    properties: {
                      relationships: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            category: { type: "string", enum: ["cross_reference", "pattern", "contradiction", "gap"] },
                            title: { type: "string", maxLength: 100 },
                            content: { type: "string", maxLength: 500 },
                            evidence: { type: "string", maxLength: 300 },
                            confidence: { type: "number", minimum: 0, maximum: 1 },
                            related_existing_ids: { type: "array", items: { type: "string" } },
                          },
                          required: ["category", "title", "content", "confidence", "related_existing_ids"],
                        },
                      },
                    },
                    required: ["relationships"],
                  },
                },
              }],
              tool_choice: { type: "function", function: { name: "report_relationships" } },
            }),
          });

          if (crossDocResponse.ok) {
            const crossData = await crossDocResponse.json();
            const crossToolCall = crossData.choices?.[0]?.message?.tool_calls?.[0];
            if (crossToolCall?.function?.arguments) {
              try {
                const args = JSON.parse(crossToolCall.function.arguments);
                const relationships = args.relationships || [];
                if (relationships.length > 0) {
                  const items = relationships.map((rel: any) => ({
                    project_id: fileData.project_id,
                    source_file_id: file_id,
                    extraction_job_id: job_id,
                    category: rel.category,
                    title: rel.title.substring(0, 100),
                    content: rel.content.substring(0, 500),
                    evidence: rel.evidence?.substring(0, 300) || null,
                    confidence: Math.min(1, Math.max(0, rel.confidence)),
                    evidence_verified: false,
                    extracted_by: user.id,
                    related_items: rel.related_existing_ids || [],
                    relationship_type: rel.category,
                  }));
                  const { error } = await supabaseAdmin.from("knowledge_items").insert(items);
                  if (!error) crossDocInsights = items.length;
                }
              } catch {}
            }
          }
        }
      }
    } catch (crossDocError) {
      console.warn("Cross-document analysis failed (non-fatal):", crossDocError);
    }

    // Update job as completed
    const totalItems = validatedInsights.length + crossDocInsights;
    await supabaseAdmin.from("extraction_jobs").update({
      status: "completed",
      completed_at: new Date().toISOString(),
      items_extracted: totalItems,
      tokens_used: tokensUsed,
      parsing_quality: parsingQuality,
    }).eq("id", job_id);

    console.log(`Extraction completed: ${validatedInsights.length} insights, ${experimentsCount} experiments, ${measurementsCount} measurements`);

    return new Response(JSON.stringify({
      success: true,
      insights_count: validatedInsights.length,
      experiments_count: experimentsCount,
      measurements_count: measurementsCount,
      cross_doc_insights: crossDocInsights,
      verified_count: verifiedCount,
      parsing_quality: parsingQuality,
      tokens_used: tokensUsed,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error) {
    console.error("Extraction error:", error);
    try {
      const { job_id } = await req.clone().json();
      if (job_id) {
        const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
        await supabaseAdmin.from("extraction_jobs").update({
          status: "failed",
          error_message: error instanceof Error ? error.message : "Unknown error",
          completed_at: new Date().toISOString(),
        }).eq("id", job_id);
      }
    } catch {}

    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
