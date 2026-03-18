import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface StandardizedPaper {
  doi: string | null;
  title: string;
  authors: Array<{ name: string; affiliation?: string }>;
  abstract: string | null;
  published_date: string | null;
  journal: string | null;
  volume: string | null;
  issue: string | null;
  pages: string | null;
  citation_count: number;
  source: string;
  external_id: string | null;
  external_url: string | null;
  keywords: string[];
  metadata: Record<string, unknown>;
}

function parseCrossrefResults(data: any): StandardizedPaper[] {
  const items = data?.message?.items || [];
  return items.map((item: any) => {
    const authors = (item.author || []).map((a: any) => ({
      name: [a.given, a.family].filter(Boolean).join(" "),
      affiliation: a.affiliation?.[0]?.name,
    }));

    const dateParts = item.published?.["date-parts"]?.[0] ||
      item["published-print"]?.["date-parts"]?.[0] ||
      item["published-online"]?.["date-parts"]?.[0];

    let publishedDate: string | null = null;
    if (dateParts) {
      const [year, month, day] = dateParts;
      publishedDate = `${year}-${String(month || 1).padStart(2, "0")}-${String(day || 1).padStart(2, "0")}`;
    }

    return {
      doi: item.DOI || null,
      title: Array.isArray(item.title) ? item.title[0] : item.title || "Sem título",
      authors,
      abstract: item.abstract?.replace(/<[^>]*>/g, "") || null,
      published_date: publishedDate,
      journal: item["container-title"]?.[0] || null,
      volume: item.volume || null,
      issue: item.issue || null,
      pages: item.page || null,
      citation_count: item["is-referenced-by-count"] || 0,
      source: "crossref",
      external_id: item.DOI || null,
      external_url: item.URL || (item.DOI ? `https://doi.org/${item.DOI}` : null),
      keywords: item.subject || [],
      metadata: {
        type: item.type,
        publisher: item.publisher,
        issn: item.ISSN,
        license: item.license,
      },
    };
  });
}

function parseSemanticScholarResults(data: any): StandardizedPaper[] {
  const items = data?.data || [];
  return items.map((item: any) => {
    const authors = (item.authors || []).map((a: any) => ({
      name: a.name,
    }));

    let publishedDate: string | null = null;
    if (item.year) {
      publishedDate = `${item.year}-01-01`;
    }

    const doi = item.externalIds?.DOI || null;

    return {
      doi,
      title: item.title || "Sem título",
      authors,
      abstract: item.abstract || null,
      published_date: publishedDate,
      journal: item.journal?.name || null,
      volume: item.journal?.volume || null,
      issue: null,
      pages: item.journal?.pages || null,
      citation_count: item.citationCount || 0,
      source: "semantic_scholar",
      external_id: item.paperId || null,
      external_url: item.url || (doi ? `https://doi.org/${doi}` : null),
      keywords: [],
      metadata: {
        paperId: item.paperId,
        externalIds: item.externalIds,
      },
    };
  });
}

function parseOpenAlexResults(data: any): StandardizedPaper[] {
  const items = data?.results || [];
  return items.map((item: any) => {
    const authors = (item.authorships || []).map((a: any) => ({
      name: a.author?.display_name || "Desconhecido",
      affiliation: a.institutions?.[0]?.display_name,
    }));

    const doi = item.doi?.replace("https://doi.org/", "") || null;

    return {
      doi,
      title: item.title || "Sem título",
      authors,
      abstract: item.abstract_inverted_index
        ? reconstructAbstract(item.abstract_inverted_index)
        : null,
      published_date: item.publication_date || null,
      journal: item.primary_location?.source?.display_name || null,
      volume: item.biblio?.volume || null,
      issue: item.biblio?.issue || null,
      pages: item.biblio?.first_page && item.biblio?.last_page
        ? `${item.biblio.first_page}-${item.biblio.last_page}`
        : null,
      citation_count: item.cited_by_count || 0,
      source: "openalex",
      external_id: item.id || null,
      external_url: item.doi || item.id || null,
      keywords: (item.keywords || []).map((k: any) => k.display_name),
      metadata: {
        openalexId: item.id,
        type: item.type,
        is_oa: item.open_access?.is_oa,
      },
    };
  });
}

function reconstructAbstract(invertedIndex: Record<string, number[]>): string {
  const words: Array<[number, string]> = [];
  for (const [word, positions] of Object.entries(invertedIndex)) {
    for (const pos of positions) {
      words.push([pos, word]);
    }
  }
  words.sort((a, b) => a[0] - b[0]);
  return words.map(([, word]) => word).join(" ");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Get user from auth header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Autorização necessária" }),
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
        JSON.stringify({ error: "Token inválido" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { query, source = "crossref", limit = 10, project_id, research_id } = await req.json();

    if (!query || query.trim().length < 2) {
      return new Response(
        JSON.stringify({ error: "A consulta deve ter pelo menos 2 caracteres" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const encodedQuery = encodeURIComponent(query.trim());
    let apiUrl: string;
    let papers: StandardizedPaper[] = [];

    switch (source) {
      case "semantic_scholar":
        apiUrl = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodedQuery}&limit=${limit}&fields=title,authors,abstract,year,externalIds,citationCount,journal,url`;
        break;
      case "openalex":
        apiUrl = `https://api.openalex.org/works?search=${encodedQuery}&per_page=${limit}`;
        break;
      case "crossref":
      default:
        apiUrl = `https://api.crossref.org/works?query=${encodedQuery}&rows=${limit}`;
        break;
    }

    const apiResponse = await fetch(apiUrl, {
      headers: {
        "User-Agent": "SmartDentManager/1.0 (mailto:contact@smartdent.app)",
        "Accept": "application/json",
      },
    });

    if (!apiResponse.ok) {
      const errorText = await apiResponse.text();
      console.error(`API ${source} error:`, apiResponse.status, errorText);
      return new Response(
        JSON.stringify({ error: `Erro ao consultar ${source}: ${apiResponse.status}` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const rawResponse = await apiResponse.json();

    switch (source) {
      case "semantic_scholar":
        papers = parseSemanticScholarResults(rawResponse);
        break;
      case "openalex":
        papers = parseOpenAlexResults(rawResponse);
        break;
      case "crossref":
      default:
        papers = parseCrossrefResults(rawResponse);
        break;
    }

    // Upsert papers into academic_papers table
    const upsertedPapers = [];
    for (const paper of papers) {
      if (paper.doi) {
        const { data, error } = await supabase
          .from("academic_papers")
          .upsert(
            {
              doi: paper.doi,
              title: paper.title,
              authors: paper.authors,
              abstract: paper.abstract,
              published_date: paper.published_date,
              journal: paper.journal,
              volume: paper.volume,
              issue: paper.issue,
              pages: paper.pages,
              citation_count: paper.citation_count,
              source: paper.source,
              external_id: paper.external_id,
              external_url: paper.external_url,
              keywords: paper.keywords,
              metadata: paper.metadata,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "doi" }
          )
          .select("id")
          .single();

        if (!error && data) {
          upsertedPapers.push({ ...paper, id: data.id });
        } else {
          // If upsert failed, try to get existing
          const { data: existing } = await supabase
            .from("academic_papers")
            .select("id")
            .eq("doi", paper.doi)
            .single();
          upsertedPapers.push({ ...paper, id: existing?.id || null });
        }
      } else {
        // Papers without DOI - insert directly
        const { data, error } = await supabase
          .from("academic_papers")
          .insert({
            title: paper.title,
            authors: paper.authors,
            abstract: paper.abstract,
            published_date: paper.published_date,
            journal: paper.journal,
            volume: paper.volume,
            issue: paper.issue,
            pages: paper.pages,
            citation_count: paper.citation_count,
            source: paper.source,
            external_id: paper.external_id,
            external_url: paper.external_url,
            keywords: paper.keywords,
            metadata: paper.metadata,
          })
          .select("id")
          .single();

        if (!error && data) {
          upsertedPapers.push({ ...paper, id: data.id });
        } else {
          upsertedPapers.push({ ...paper, id: null });
        }
      }
    }

    // Log the search
    await supabase.from("academic_searches").insert({
      query: query.trim(),
      source,
      results_count: papers.length,
      raw_response: rawResponse,
      searched_by: user.id,
      project_id: project_id || null,
      research_id: research_id || null,
    });

    return new Response(
      JSON.stringify({
        results: upsertedPapers,
        total: upsertedPapers.length,
        query: query.trim(),
        source,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Academic search error:", errorMessage);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
