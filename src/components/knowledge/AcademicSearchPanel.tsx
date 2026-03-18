import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Search,
  BookOpen,
  ExternalLink,
  Save,
  ChevronDown,
  ChevronUp,
  Quote,
  Trash2,
  Users,
  Calendar,
} from 'lucide-react';
import { useAcademicSearch } from '@/hooks/useAcademicSearch';
import type { AcademicPaper } from '@/types/academic';

interface AcademicSearchPanelProps {
  projectId?: string;
  projects?: Array<{ id: string; name: string }>;
}

type AcademicSource = 'crossref' | 'semantic_scholar' | 'openalex';

const sourceLabels: Record<AcademicSource, string> = {
  crossref: 'Crossref',
  semantic_scholar: 'Semantic Scholar',
  openalex: 'OpenAlex',
};

const sourceBadgeColors: Record<string, string> = {
  crossref: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  semantic_scholar: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  openalex: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
};

function formatAuthors(authors: Array<{ name: string; affiliation?: string }>): string {
  if (!authors || authors.length === 0) return 'Autor desconhecido';
  const names = authors.slice(0, 3).map((a) => a.name);
  if (authors.length > 3) {
    names.push('et al.');
  }
  return names.join(', ');
}

function formatYear(dateStr: string | null): string | null {
  if (!dateStr) return null;
  const year = dateStr.substring(0, 4);
  return year && year !== '0000' ? year : null;
}

export function AcademicSearchPanel({ projectId, projects }: AcademicSearchPanelProps) {
  const [query, setQuery] = useState('');
  const [source, setSource] = useState<AcademicSource>('crossref');
  const [selectedProjectId, setSelectedProjectId] = useState<string>(projectId || '');
  const [expandedPapers, setExpandedPapers] = useState<Set<string>>(new Set());

  const {
    searchPapers,
    results,
    isSearching,
    savedPapers,
    loadingSaved,
    linkPaper,
    unlinkPaper,
  } = useAcademicSearch(selectedProjectId || projectId);

  const handleSearch = () => {
    if (query.trim().length < 2) return;
    searchPapers(query, source);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch();
  };

  const toggleAbstract = (paperId: string) => {
    setExpandedPapers((prev) => {
      const next = new Set(prev);
      if (next.has(paperId)) {
        next.delete(paperId);
      } else {
        next.add(paperId);
      }
      return next;
    });
  };

  const handleSave = (paper: AcademicPaper & { id: string | null }) => {
    const targetProject = selectedProjectId || projectId;
    if (!targetProject) return;
    if (!paper.id) return;
    linkPaper(paper.id, targetProject);
  };

  const isSaved = (paper: AcademicPaper & { id: string | null }) => {
    if (!paper.id) return false;
    return savedPapers.some(
      (sp) => sp.paper_id === paper.id || sp.academic_papers?.id === paper.id
    );
  };

  const getSavedLinkId = (paper: AcademicPaper & { id: string | null }) => {
    if (!paper.id) return null;
    const link = savedPapers.find(
      (sp) => sp.paper_id === paper.id || sp.academic_papers?.id === paper.id
    );
    return link?.id || null;
  };

  const effectiveProjectId = selectedProjectId || projectId;

  return (
    <div className="space-y-4">
      {/* Search controls */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            Busca Acadêmica
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar artigos acadêmicos..."
                className="pl-9"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
              />
            </div>
            <Select value={source} onValueChange={(v) => setSource(v as AcademicSource)}>
              <SelectTrigger className="w-full sm:w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="crossref">Crossref</SelectItem>
                <SelectItem value="semantic_scholar">Semantic Scholar</SelectItem>
                <SelectItem value="openalex">OpenAlex</SelectItem>
              </SelectContent>
            </Select>
            {projects && projects.length > 0 && !projectId && (
              <Select value={selectedProjectId || 'none'} onValueChange={(v) => setSelectedProjectId(v === 'none' ? '' : v)}>
                <SelectTrigger className="w-full sm:w-[200px]">
                  <SelectValue placeholder="Selecionar projeto" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem projeto</SelectItem>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button onClick={handleSearch} disabled={isSearching || query.trim().length < 2}>
              {isSearching ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  Buscando...
                </span>
              ) : (
                <>
                  <Search className="h-4 w-4 mr-2" />
                  Buscar
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Loading skeleton */}
      {isSearching && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardContent className="pt-4 space-y-2">
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
                <div className="flex gap-2">
                  <Skeleton className="h-5 w-20" />
                  <Skeleton className="h-5 w-16" />
                  <Skeleton className="h-5 w-24" />
                </div>
                <Skeleton className="h-12 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Results */}
      {!isSearching && results.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {results.length} resultado{results.length !== 1 ? 's' : ''} encontrado{results.length !== 1 ? 's' : ''}
          </p>
          {results.map((paper, index) => {
            const paperId = paper.id || `temp-${index}`;
            const isExpanded = expandedPapers.has(paperId);
            const saved = isSaved(paper);
            const year = formatYear(paper.published_date);

            return (
              <Card key={paperId} className="hover:shadow-md transition-shadow">
                <CardContent className="pt-4 space-y-2">
                  {/* Title */}
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-medium text-sm leading-snug flex-1">
                      {paper.external_url ? (
                        <a
                          href={paper.external_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:underline hover:text-primary"
                        >
                          {paper.title}
                          <ExternalLink className="inline-block h-3 w-3 ml-1 opacity-50" />
                        </a>
                      ) : (
                        paper.title
                      )}
                    </h3>
                    {effectiveProjectId && paper.id && (
                      saved ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="shrink-0 text-destructive hover:text-destructive"
                          onClick={() => {
                            const linkId = getSavedLinkId(paper);
                            if (linkId) unlinkPaper(linkId);
                          }}
                        >
                          <Trash2 className="h-4 w-4 mr-1" />
                          Remover
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          className="shrink-0"
                          onClick={() => handleSave(paper)}
                        >
                          <Save className="h-4 w-4 mr-1" />
                          Salvar
                        </Button>
                      )
                    )}
                  </div>

                  {/* Authors */}
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Users className="h-3 w-3 shrink-0" />
                    <span>{formatAuthors(paper.authors)}</span>
                  </div>

                  {/* Metadata badges */}
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant="outline"
                      className={sourceBadgeColors[paper.source] || ''}
                    >
                      {sourceLabels[paper.source as AcademicSource] || paper.source}
                    </Badge>
                    {paper.journal && (
                      <Badge variant="secondary" className="text-xs">
                        {paper.journal}
                      </Badge>
                    )}
                    {year && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Calendar className="h-3 w-3" />
                        {year}
                      </span>
                    )}
                    {paper.citation_count > 0 && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Quote className="h-3 w-3" />
                        {paper.citation_count} citações
                      </span>
                    )}
                    {paper.doi && (
                      <a
                        href={`https://doi.org/${paper.doi}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-primary hover:underline"
                      >
                        DOI: {paper.doi}
                      </a>
                    )}
                  </div>

                  {/* Expandable abstract */}
                  {paper.abstract && (
                    <Collapsible open={isExpanded} onOpenChange={() => toggleAbstract(paperId)}>
                      <CollapsibleTrigger asChild>
                        <Button variant="ghost" size="sm" className="text-xs px-0 h-auto py-1">
                          {isExpanded ? (
                            <>
                              <ChevronUp className="h-3 w-3 mr-1" />
                              Ocultar resumo
                            </>
                          ) : (
                            <>
                              <ChevronDown className="h-3 w-3 mr-1" />
                              Ver resumo
                            </>
                          )}
                        </Button>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <p className="text-xs text-muted-foreground mt-1 leading-relaxed bg-muted/30 rounded p-3">
                          {paper.abstract}
                        </p>
                      </CollapsibleContent>
                    </Collapsible>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Saved papers section */}
      {effectiveProjectId && savedPapers.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <Save className="h-4 w-4" />
            Artigos salvos no projeto ({savedPapers.length})
          </h3>
          {loadingSaved ? (
            <div className="space-y-2">
              {[1, 2].map((i) => (
                <Card key={i}>
                  <CardContent className="pt-4">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-1/2 mt-2" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            savedPapers.map((link) => {
              const paper = link.academic_papers;
              if (!paper) return null;
              const year = formatYear(paper.published_date);

              return (
                <Card key={link.id} className="border-primary/20">
                  <CardContent className="pt-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-medium text-sm leading-snug flex-1">
                        {paper.external_url ? (
                          <a
                            href={paper.external_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:underline hover:text-primary"
                          >
                            {paper.title}
                            <ExternalLink className="inline-block h-3 w-3 ml-1 opacity-50" />
                          </a>
                        ) : (
                          paper.title
                        )}
                      </h3>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="shrink-0 text-destructive hover:text-destructive"
                        onClick={() => unlinkPaper(link.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Users className="h-3 w-3 shrink-0" />
                      <span>{formatAuthors(paper.authors)}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        variant="outline"
                        className={sourceBadgeColors[paper.source] || ''}
                      >
                        {sourceLabels[paper.source as AcademicSource] || paper.source}
                      </Badge>
                      {paper.journal && (
                        <Badge variant="secondary" className="text-xs">
                          {paper.journal}
                        </Badge>
                      )}
                      {year && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Calendar className="h-3 w-3" />
                          {year}
                        </span>
                      )}
                      {paper.citation_count > 0 && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Quote className="h-3 w-3" />
                          {paper.citation_count} citações
                        </span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      )}

      {/* Empty state */}
      {!isSearching && results.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="py-8 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <BookOpen className="h-6 w-6 text-primary" />
            </div>
            <h3 className="font-medium">Buscar artigos acadêmicos</h3>
            <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
              Pesquise em bases como Crossref, Semantic Scholar e OpenAlex para encontrar artigos relevantes para sua pesquisa.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
