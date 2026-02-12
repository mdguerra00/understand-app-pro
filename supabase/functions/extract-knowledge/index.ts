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
      
      // Get ALL raw rows first
      const rawRows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: "" });
      
      // Find the real header row using multiple heuristics:
      // 1. Look for rows with known metric keywords (RF, MF, MPa, etc.)
      // 2. Look for rows with short text labels that look like column headers
      // 3. Fall back to first row with ≥3 meaningful cells
      const metricKeywords = ['rf', 'mf', 'mpa', 'along', 'dureza', 'hardness', 'flexural', 'strength',
        'valor', 'value', 'média', 'media', 'mean', 'amostra', 'sample', 'grupo', 'group',
        'resistência', 'módulo', 'modulo', 'sorção', 'conversão', 'delta', 'desvio', 'std'];
      
      let headerRowIdx = 0;
      let bestScore = 0;
      
      for (let i = 0; i < Math.min(rawRows.length, 20); i++) {
        const row = rawRows[i];
        if (!row) continue;
        const cells = row.map((c: any) => String(c).trim().toLowerCase());
        const nonEmpty = cells.filter((s: string) => s.length > 0 && s.length < 80);
        if (nonEmpty.length < 2) continue;
        
        // Score: count how many cells match metric keywords
        let score = 0;
        for (const cell of nonEmpty) {
          for (const kw of metricKeywords) {
            if (cell.includes(kw)) { score += 3; break; }
          }
          // Bonus for short text labels (likely headers, not data)
          if (cell.length >= 2 && cell.length <= 30 && isNaN(Number(cell))) score += 1;
        }
        // Bonus for having many non-empty cells (looks like a header row)
        score += Math.min(nonEmpty.length, 8);
        
        if (score > bestScore) {
          bestScore = score;
          headerRowIdx = i;
        }
      }
      
      // If best score is very low, try finding the row just before the first numeric-heavy row
      if (bestScore < 5) {
        for (let i = 1; i < Math.min(rawRows.length, 20); i++) {
          const row = rawRows[i];
          if (!row) continue;
          const numericCount = row.filter((c: any) => {
            const n = parseFloat(String(c).replace(',', '.'));
            return !isNaN(n) && String(c).trim().length > 0;
          }).length;
          if (numericCount >= 3) {
            // The previous row is likely the header
            headerRowIdx = Math.max(0, i - 1);
            break;
          }
        }
      }

      // Use detected header row
      const headers = (rawRows[headerRowIdx] || []).map((h: any) => String(h).trim());
      
      // Build JSON using detected header row
      const dataRows: Record<string, any>[] = [];
      for (let i = headerRowIdx + 1; i < rawRows.length; i++) {
        const row = rawRows[i];
        if (!row || row.every((c: any) => String(c).trim() === '')) continue;
        const obj: Record<string, any> = {};
        for (let j = 0; j < headers.length; j++) {
          const key = headers[j] || `col_${j}`;
          obj[key] = row[j] !== undefined ? row[j] : '';
        }
        dataRows.push(obj);
      }
      
      // Header rows for AI (the detected header + next 2 data rows as context)
      const headerRows = [
        headers,
        ...(dataRows.slice(0, 2).map(r => headers.map(h => String(r[h] || ''))))
      ];
      
      // CSV for text content
      const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
      const csvRows = csv.split('\n').filter((r: string) => r.trim());
      for (const row of csvRows) {
        const cells = row.split(',');
        totalCells += cells.length;
        emptyCells += cells.filter((c: string) => !c.trim()).length;
      }
      
      if (dataRows.length > 0) {
        sheets.push({ sheetName, headers, rows: dataRows, headerRows });
        textParts.push(`=== Planilha: ${sheetName} ===\n${csv}`);
        console.log(`Sheet "${sheetName}": detected header at row ${headerRowIdx + 1}, headers: [${headers.filter(Boolean).join(', ')}], ${dataRows.length} data rows`);
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
      const parsed = JSON.parse(toolCall.function.arguments);
      console.log(`AI header mapping result: ${JSON.stringify(parsed).substring(0, 500)}`);
      return parsed;
    } catch (e) {
      console.error("Failed to parse header mapping:", e);
      return null;
    }
  }
  console.warn("No tool_calls in AI header mapping response. Message:", JSON.stringify(data.choices?.[0]?.message).substring(0, 300));
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
  if (!mapping?.sheet_mappings) {
    console.warn("No sheet_mappings in AI response");
    return [];
  }
  const experiments: ExperimentExtraction[] = [];

  for (const sheetMapping of mapping.sheet_mappings) {
    // Fuzzy match sheet name (AI may return slightly different name)
    let sheet = sheets.find(s => s.sheetName === sheetMapping.sheet_name);
    if (!sheet) {
      sheet = sheets.find(s => s.sheetName.toLowerCase().includes(sheetMapping.sheet_name.toLowerCase()) ||
        sheetMapping.sheet_name.toLowerCase().includes(s.sheetName.toLowerCase()));
    }
    if (!sheet) {
      // Fallback: if only 1 sheet and 1 mapping, use it
      if (sheets.length === 1 && mapping.sheet_mappings.length === 1) {
        sheet = sheets[0];
      } else {
        console.warn(`Sheet not found: "${sheetMapping.sheet_name}". Available: ${sheets.map(s => s.sheetName).join(', ')}`);
        continue;
      }
    }

    const allColumns = sheetMapping.columns || [];
    const metricColumns = allColumns.filter((c: any) => c.role === 'metric');
    const conditionColumns = allColumns.filter((c: any) => c.role === 'condition');
    const identifierColumns = allColumns.filter((c: any) => c.role === 'identifier');

    // Get actual keys from first data row for fuzzy column matching
    const actualKeys = sheet.rows.length > 0 ? Object.keys(sheet.rows[0]) : sheet.headers;
    console.log(`Sheet "${sheet.sheetName}": ${sheet.rows.length} rows, keys: ${actualKeys.slice(0, 10).join(', ')}`);
    console.log(`Mapping: ${metricColumns.length} metrics, ${conditionColumns.length} conditions, ${identifierColumns.length} identifiers`);

    // Build a fuzzy column resolver: AI column_name -> actual key in row
    const resolveColumn = (aiColName: string): string | null => {
      if (!aiColName) return null;
      // Exact match
      if (actualKeys.includes(aiColName)) return aiColName;
      // Case-insensitive
      const lower = aiColName.toLowerCase().trim();
      const found = actualKeys.find(k => k.toLowerCase().trim() === lower);
      if (found) return found;
      // Substring match
      const partial = actualKeys.find(k => 
        k.toLowerCase().includes(lower) || lower.includes(k.toLowerCase())
      );
      if (partial) return partial;
      // Normalize: remove spaces, parens, special chars
      const normalize = (s: string) => s.toLowerCase().replace(/[\s\-_()[\]\/\\.,;:]+/g, '');
      const norm = normalize(aiColName);
      const normMatch = actualKeys.find(k => normalize(k) === norm || normalize(k).includes(norm) || norm.includes(normalize(k)));
      if (normMatch) return normMatch;
      return null;
    };

    const conditions: { key: string; value: string }[] = [];
    const measurements: ExperimentExtraction['measurements'] = [];
    const citations: ExperimentExtraction['citations'] = [];

    // Log column resolution
    for (const mc of metricColumns) {
      const resolved = resolveColumn(mc.column_name);
      console.log(`  Metric col "${mc.column_name}" -> resolved: "${resolved || 'NOT FOUND'}"`);
    }

    for (let rowIdx = 0; rowIdx < sheet.rows.length; rowIdx++) {
      const row = sheet.rows[rowIdx];
      
      // Build row identifier
      const rowId = identifierColumns
        .map((c: any) => { const k = resolveColumn(c.column_name); return k ? String(row[k] || '') : ''; })
        .filter(Boolean).join(' | ');

      // Extract conditions
      for (const cc of conditionColumns) {
        const key = resolveColumn(cc.column_name);
        if (!key) continue;
        const val = String(row[key] || '').trim();
        if (val && !conditions.find(c => c.key === (cc.condition_key || cc.column_name) && c.value === val)) {
          conditions.push({ key: cc.condition_key || cc.column_name, value: val });
        }
      }

      // Extract measurements
      for (const mc of metricColumns) {
        const key = resolveColumn(mc.column_name);
        if (!key) continue;
        const rawValue = row[key];
        if (rawValue === '' || rawValue === undefined || rawValue === null) continue;
        const numValue = parseFloat(String(rawValue).replace(',', '.'));
        if (isNaN(numValue)) continue;

        const excerpt = `Sheet: ${sheet.sheetName}, Row: ${rowIdx + 2}, Col: ${key}, Value: ${rawValue}${rowId ? `, Sample: ${rowId}` : ''}`;
        
        measurements.push({
          metric: mc.canonical_metric || mc.column_name,
          value: numValue,
          unit: mc.unit || '',
          confidence: 'high',
          source_excerpt: excerpt,
        });

        citations.push({
          sheet_name: sheet.sheetName,
          cell_range: `Row ${rowIdx + 2}, Col ${key}`,
          excerpt: excerpt.substring(0, 300),
        });
      }
    }

    console.log(`Sheet "${sheet.sheetName}": generated ${measurements.length} measurements, ${conditions.length} conditions`);

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
// METRICS CATALOG NORMALIZATION (with unit normalization)
// ==========================================

async function normalizeMetric(supabase: any, metric: string, unit?: string): Promise<{ canonicalMetric: string; canonicalUnit: string; conversionFactor: number }> {
  const normalized = metric.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  
  // Search catalog by canonical name or aliases
  const { data: catalog } = await supabase
    .from('metrics_catalog')
    .select('canonical_name, aliases, canonical_unit, unit_aliases, conversion_factor, unit')
    .limit(100);

  if (catalog) {
    for (const entry of catalog) {
      if (entry.canonical_name === normalized || entry.aliases?.includes(normalized) || entry.aliases?.includes(metric.toLowerCase())) {
        // Check unit normalization
        const canonicalUnit = entry.canonical_unit || entry.unit || unit || '';
        let conversionFactor = 1.0;
        
        if (unit && entry.unit_aliases && entry.unit_aliases.length > 0) {
          // Check if the provided unit is an alias
          const unitLower = unit.toLowerCase().trim();
          if (entry.unit_aliases.includes(unitLower) && entry.conversion_factor) {
            conversionFactor = Number(entry.conversion_factor);
          }
        }
        
        return { canonicalMetric: entry.canonical_name, canonicalUnit, conversionFactor };
      }
    }
  }

  // Auto-create if not found
  try {
    await supabase.from('metrics_catalog').insert({
      canonical_name: normalized,
      display_name: metric,
      unit: unit || '',
      canonical_unit: unit || '',
      aliases: [normalized, metric.toLowerCase()],
      unit_aliases: [],
      category: 'other',
    });
  } catch {
    // Ignore duplicate
  }

  return { canonicalMetric: normalized, canonicalUnit: unit || '', conversionFactor: 1.0 };
}

// ==========================================
// SAVE EXPERIMENTS TO DB
// ==========================================

async function softDeleteExistingExperiments(
  supabase: any,
  projectId: string,
  fileId: string,
): Promise<void> {
  const { data: existing } = await supabase
    .from('experiments')
    .select('id')
    .eq('project_id', projectId)
    .eq('source_file_id', fileId)
    .is('deleted_at', null);

  if (!existing || existing.length === 0) return;

  const ids = existing.map((e: any) => e.id);
  console.log(`Force reprocess: soft-deleting ${ids.length} existing experiments for file ${fileId}`);

  // Soft-delete experiments (measurements/conditions/citations remain for audit but are orphaned)
  await supabase
    .from('experiments')
    .update({ deleted_at: new Date().toISOString() })
    .in('id', ids);
}

async function saveExperiments(
  supabase: any,
  experiments: ExperimentExtraction[],
  projectId: string,
  fileId: string,
  jobId: string,
  userId: string,
  sourceType: string,
  force: boolean = false,
): Promise<number> {
  // If force reprocessing, soft-delete existing experiments first
  if (force) {
    await softDeleteExistingExperiments(supabase, projectId, fileId);
  }

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

    // Save measurements (normalized) + create citation per measurement
    for (let i = 0; i < validMeasurements.length; i++) {
      const m = validMeasurements[i];
      const { canonicalMetric, canonicalUnit, conversionFactor } = await normalizeMetric(supabase, m.metric, m.unit);

      const { data: measRecord } = await supabase.from('measurements').insert({
        experiment_id: expRecord.id,
        metric: canonicalMetric,
        raw_metric_name: m.metric, // preserve original name
        value: m.value,
        unit: m.unit,
        value_canonical: m.value * conversionFactor,
        unit_canonical: canonicalUnit,
        method: m.method || null,
        notes: m.notes || null,
        confidence: m.confidence || 'medium',
        source_excerpt: m.source_excerpt.substring(0, 500),
      }).select('id').single();

      totalMeasurements++;

      // Find matching citation for this measurement (by index or excerpt match)
      const matchingCit = exp.citations[i] || exp.citations[0];
      if (matchingCit && measRecord) {
        await supabase.from('experiment_citations').insert({
          experiment_id: expRecord.id,
          measurement_id: measRecord.id,
          file_id: fileId,
          page: matchingCit.page || null,
          sheet_name: matchingCit.sheet_name || null,
          cell_range: matchingCit.cell_range || null,
          excerpt: (matchingCit.excerpt || m.source_excerpt).substring(0, 500),
        });
      }
    }

    // Save experiment-level citations (not linked to specific measurement)
    // Only save citations that weren't already linked to measurements
    const remainingCitations = exp.citations.slice(validMeasurements.length);
    for (const cit of remainingCitations) {
      await supabase.from('experiment_citations').insert({
        experiment_id: expRecord.id,
        file_id: fileId,
        page: cit.page || null,
        sheet_name: cit.sheet_name || null,
        cell_range: cit.cell_range || null,
        excerpt: cit.excerpt.substring(0, 500),
      });
    }

    // If no citations at all (qualitative with no measurements), add experiment-level citation
    if (exp.citations.length === 0 && validMeasurements.length === 0) {
      await supabase.from('experiment_citations').insert({
        experiment_id: expRecord.id,
        file_id: fileId,
        excerpt: exp.summary || exp.title,
      });
    }

    // Save conditions
    for (const c of exp.conditions) {
      await supabase.from('experiment_conditions').insert({
        experiment_id: expRecord.id,
        key: c.key,
        value: c.value,
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
      await saveExperiments(supabaseAdmin, [fallbackExperiment], fileData.project_id, file_id, job_id, user.id, sourceType, !!force);

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
          supabaseAdmin, experiments, fileData.project_id, file_id, job_id, user.id, 'excel', !!force
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
      // Soft-delete existing insights for this file before inserting new ones
      const { data: existingInsights } = await supabaseAdmin
        .from('knowledge_items')
        .select('id')
        .eq('source_file_id', file_id)
        .eq('project_id', fileData.project_id)
        .is('deleted_at', null);

      if (existingInsights && existingInsights.length > 0) {
        console.log(`Soft-deleting ${existingInsights.length} existing insights for file ${file_id}`);
        await supabaseAdmin
          .from('knowledge_items')
          .update({ deleted_at: new Date().toISOString(), deleted_by: user.id })
          .in('id', existingInsights.map((i: any) => i.id));
      }

      const insightsToInsert = validatedInsights.map((insight) => {
        // Smart validation: auto-validate only when evidence is verified AND confidence >= 0.8
        const shouldAutoValidate = insight.evidence_verified && insight.confidence >= 0.8;
        // For Excel-sourced deterministic data, always auto-validate
        const isExcelDeterministic = isExcel && insight.evidence_verified;
        const autoValidate = shouldAutoValidate || isExcelDeterministic;
        
        return {
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
          // Smart validation instead of auto-validate-all
          auto_validated: autoValidate,
          auto_validation_reason: autoValidate 
            ? (isExcelDeterministic ? 'excel_deterministic' : 'high_confidence_verified_evidence')
            : null,
          human_verified: false,
          // Only set validated_by/at for auto-validated items
          ...(autoValidate ? { validated_by: user.id, validated_at: new Date().toISOString() } : {}),
        };
      });

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
        supabaseAdmin, rawExperiments, fileData.project_id, file_id, job_id, user.id, sourceType, !!force
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
      await saveExperiments(supabaseAdmin, [fallback], fileData.project_id, file_id, job_id, user.id, sourceType, !!force);
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
