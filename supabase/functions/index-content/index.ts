import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ChunkResult {
  text: string;
  hash: string;
  index: number;
  metadata: Record<string, unknown>;
}

// Generate SHA-256 hash for deduplication
async function generateHash(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Chunk text with overlap
function chunkText(
  text: string,
  prefix: string,
  metadata: Record<string, unknown>,
  chunkSize = 1000,
  overlap = 100
): Omit<ChunkResult, "hash">[] {
  const chunks: Omit<ChunkResult, "hash">[] = [];
  const cleanText = text.replace(/\s+/g, " ").trim();
  
  if (cleanText.length <= chunkSize) {
    chunks.push({
      text: `${prefix}\n\n${cleanText}`,
      index: 0,
      metadata,
    });
    return chunks;
  }

  let start = 0;
  let index = 0;

  while (start < cleanText.length) {
    const end = Math.min(start + chunkSize, cleanText.length);
    let chunkEnd = end;

    // Try to break at sentence or word boundary
    if (end < cleanText.length) {
      const lastPeriod = cleanText.lastIndexOf(".", end);
      const lastSpace = cleanText.lastIndexOf(" ", end);
      
      if (lastPeriod > start + chunkSize * 0.7) {
        chunkEnd = lastPeriod + 1;
      } else if (lastSpace > start + chunkSize * 0.7) {
        chunkEnd = lastSpace;
      }
    }

    const chunkContent = cleanText.slice(start, chunkEnd).trim();
    if (chunkContent.length > 0) {
      chunks.push({
        text: `${prefix}\n\n${chunkContent}`,
        index,
        metadata: { ...metadata, chunk_index: index },
      });
      index++;
    }

    start = chunkEnd - overlap;
    if (start >= cleanText.length - overlap) break;
  }

  return chunks;
}

// Generate embedding using Lovable AI Gateway
async function generateEmbedding(text: string): Promise<number[] | null> {
  try {
    const response = await fetch("https://ai-gateway.lovable.dev/embed", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${Deno.env.get("LOVABLE_API_KEY")}`,
      },
      body: JSON.stringify({
        input: text,
        model: "text-embedding-3-small",
      }),
    });

    if (!response.ok) {
      console.error("Embedding API error:", await response.text());
      return null;
    }

    const data = await response.json();
    return data.data?.[0]?.embedding || null;
  } catch (error) {
    console.error("Embedding generation error:", error);
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get authorization header for user context
    const authHeader = req.headers.get("Authorization");
    
    const { job_id, source_type, source_id, project_id } = await req.json();

    // Validate user has access to project if auth provided
    if (authHeader) {
      const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });
      
      const { data: hasAccess } = await userClient.rpc("is_project_member", {
        _user_id: (await userClient.auth.getUser()).data.user?.id,
        _project_id: project_id,
      });
      
      if (!hasAccess) {
        return new Response(
          JSON.stringify({ error: "Access denied to project" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Update job status to running
    if (job_id) {
      await supabase
        .from("indexing_jobs")
        .update({ status: "running", started_at: new Date().toISOString() })
        .eq("id", job_id);
    }

    let content = "";
    let title = "";
    let projectName = "";
    const metadata: Record<string, unknown> = {
      source_type,
      source_id,
      project_id,
    };

    // Fetch project name
    const { data: project } = await supabase
      .from("projects")
      .select("name")
      .eq("id", project_id)
      .single();
    
    projectName = project?.name || "Projeto";

    // Fetch content based on source type
    if (source_type === "report" || source_type === "reports") {
      const { data: report, error } = await supabase
        .from("reports")
        .select("title, summary, content")
        .eq("id", source_id)
        .is("deleted_at", null)
        .single();

      if (error || !report) {
        throw new Error(`Report not found: ${source_id}`);
      }

      title = report.title;
      content = `${report.title}\n\n${report.summary || ""}\n\n${report.content || ""}`;
      metadata.title = report.title;
    } 
    else if (source_type === "task" || source_type === "tasks") {
      const { data: task, error } = await supabase
        .from("tasks")
        .select("title, description")
        .eq("id", source_id)
        .is("deleted_at", null)
        .single();

      if (error || !task) {
        throw new Error(`Task not found: ${source_id}`);
      }

      title = task.title;
      content = `${task.title}\n\n${task.description || ""}`;
      metadata.title = task.title;

      // Also fetch comments for this task
      const { data: comments } = await supabase
        .from("task_comments")
        .select("content")
        .eq("task_id", source_id)
        .order("created_at", { ascending: true });

      if (comments && comments.length > 0) {
        content += "\n\nComentários:\n" + comments.map((c) => c.content).join("\n");
      }
    }
    else if (source_type === "insight" || source_type === "knowledge_items") {
      const { data: insight, error } = await supabase
        .from("knowledge_items")
        .select("title, content, evidence, category, confidence")
        .eq("id", source_id)
        .is("deleted_at", null)
        .single();

      if (error || !insight) {
        throw new Error(`Insight not found: ${source_id}`);
      }

      title = insight.title;
      content = `${insight.title}\n\nCategoria: ${insight.category}\nConfiança: ${insight.confidence}%\n\n${insight.content}\n\nEvidência: ${insight.evidence || ""}`;
      metadata.title = insight.title;
      metadata.category = insight.category;
      metadata.confidence = insight.confidence;
    }
    else {
      throw new Error(`Unsupported source type: ${source_type}`);
    }

    if (!content.trim()) {
      throw new Error("No content to index");
    }

    // Create prefix for context
    const prefix = `[Tipo: ${source_type}] [Projeto: ${projectName}] [Título: ${title}]`;

    // Generate chunks
    const rawChunks = chunkText(content, prefix, metadata);
    
    // Add hashes to chunks
    const chunks: ChunkResult[] = await Promise.all(
      rawChunks.map(async (chunk) => ({
        ...chunk,
        hash: await generateHash(chunk.text),
      }))
    );

    console.log(`Generated ${chunks.length} chunks for ${source_type}:${source_id}`);

    // Delete existing chunks for this source
    await supabase
      .from("search_chunks")
      .delete()
      .eq("project_id", project_id)
      .eq("source_type", source_type === "reports" ? "report" : source_type === "tasks" ? "task" : source_type === "knowledge_items" ? "insight" : source_type)
      .eq("source_id", source_id);

    // Insert new chunks with embeddings
    let chunksCreated = 0;
    for (const chunk of chunks) {
      const embedding = await generateEmbedding(chunk.text);
      
      if (!embedding) {
        console.warn(`Failed to generate embedding for chunk ${chunk.index}`);
        continue;
      }

      const { error: insertError } = await supabase
        .from("search_chunks")
        .insert({
          project_id,
          source_type: source_type === "reports" ? "report" : source_type === "tasks" ? "task" : source_type === "knowledge_items" ? "insight" : source_type,
          source_id,
          chunk_index: chunk.index,
          chunk_text: chunk.text,
          chunk_hash: chunk.hash,
          embedding: `[${embedding.join(",")}]`,
          metadata: chunk.metadata,
        });

      if (insertError) {
        // Skip duplicate hash errors
        if (!insertError.message.includes("duplicate")) {
          console.error("Insert error:", insertError);
        }
      } else {
        chunksCreated++;
      }
    }

    // Update job status
    if (job_id) {
      await supabase
        .from("indexing_jobs")
        .update({
          status: "done",
          finished_at: new Date().toISOString(),
          chunks_created: chunksCreated,
        })
        .eq("id", job_id);
    }

    return new Response(
      JSON.stringify({
        success: true,
        chunks_created: chunksCreated,
        source_type,
        source_id,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Indexing error:", errorMessage);

    // Try to update job status to error
    try {
      const { job_id } = await req.json().catch(() => ({}));
      if (job_id) {
        const supabase = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
        );
        await supabase
          .from("indexing_jobs")
          .update({
            status: "error",
            finished_at: new Date().toISOString(),
            error_message: errorMessage,
          })
          .eq("id", job_id);
      }
    } catch {}

    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
