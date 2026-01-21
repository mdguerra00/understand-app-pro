import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CommandDialog,
  CommandInput,
  CommandList,
} from '@/components/ui/command';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { 
  FolderKanban, 
  CheckSquare, 
  FileIcon, 
  FileText, 
  Brain,
  Sparkles,
  Search,
  Loader2,
  ExternalLink,
  ChevronRight
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface SearchResult {
  chunk_id: string;
  project_id: string;
  project_name: string;
  source_type: string;
  source_id: string;
  source_title: string;
  chunk_text: string;
  score_final: number;
  metadata: Record<string, unknown>;
}

interface RAGResponse {
  response: string;
  sources: Array<{
    citation: string;
    type: string;
    id: string;
    title: string;
    project: string;
    excerpt: string;
  }>;
  chunks_used: number;
  latency_ms: number;
}

interface SmartSearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SmartSearchDialog({ open, onOpenChange }: SmartSearchDialogProps) {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'quick' | 'smart'>('quick');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [ragResponse, setRagResponse] = useState<RAGResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [ragLoading, setRagLoading] = useState(false);
  const navigate = useNavigate();

  // Keyboard shortcut
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, [open, onOpenChange]);

  // Reset on close
  useEffect(() => {
    if (!open) {
      setQuery('');
      setResults([]);
      setRagResponse(null);
      setMode('quick');
    }
  }, [open]);

  // Quick search (existing global_search)
  const quickSearch = useCallback(async (searchQuery: string) => {
    if (searchQuery.trim().length < 2) {
      setResults([]);
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('global_search', {
        search_query: searchQuery.trim(),
      });

      if (error) throw error;
      
      // Map to SearchResult format
      setResults((data || []).map((r: any) => ({
        chunk_id: r.result_id,
        project_id: r.project_id,
        project_name: r.project_name,
        source_type: r.result_type,
        source_id: r.result_id,
        source_title: r.title,
        chunk_text: r.subtitle || '',
        score_final: r.relevance / 100,
        metadata: {},
      })));
    } catch (error) {
      console.error('Quick search error:', error);
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Smart search (hybrid semantic + FTS)
  const smartSearch = useCallback(async (searchQuery: string) => {
    if (searchQuery.trim().length < 3) {
      setResults([]);
      return;
    }

    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/search-hybrid`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ query: searchQuery.trim(), limit: 15 }),
        }
      );

      if (!response.ok) throw new Error('Search failed');

      const data = await response.json();
      setResults(data.results || []);
    } catch (error) {
      console.error('Smart search error:', error);
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (mode === 'quick') {
        quickSearch(query);
      } else {
        smartSearch(query);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query, mode, quickSearch, smartSearch]);

  // Generate RAG summary
  const generateSummary = async () => {
    if (query.trim().length < 5) return;

    setRagLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/rag-answer`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ 
            query: query.trim(),
            chunk_ids: results.slice(0, 12).map(r => r.chunk_id),
          }),
        }
      );

      if (!response.ok) throw new Error('RAG failed');

      const data = await response.json();
      setRagResponse(data);
    } catch (error) {
      console.error('RAG error:', error);
    } finally {
      setRagLoading(false);
    }
  };

  const handleSelect = (result: SearchResult) => {
    onOpenChange(false);

    if (result.source_type === 'project') {
      navigate(`/projects/${result.source_id}`);
    } else if (result.source_type === 'task') {
      navigate(`/projects/${result.project_id}?task=${result.source_id}`);
    } else if (result.source_type === 'file') {
      navigate(`/projects/${result.project_id}?tab=files&file=${result.source_id}`);
    } else if (result.source_type === 'report') {
      navigate(`/projects/${result.project_id}?tab=reports&report=${result.source_id}`);
    } else if (result.source_type === 'insight') {
      navigate(`/knowledge`);
    }
  };

  const getIcon = (type: string) => {
    switch (type) {
      case 'project':
        return <FolderKanban className="h-4 w-4" />;
      case 'task':
        return <CheckSquare className="h-4 w-4" />;
      case 'file':
        return <FileIcon className="h-4 w-4" />;
      case 'report':
        return <FileText className="h-4 w-4" />;
      case 'insight':
        return <Brain className="h-4 w-4" />;
      default:
        return <FileText className="h-4 w-4" />;
    }
  };

  const getTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      project: 'Projeto',
      task: 'Tarefa',
      file: 'Arquivo',
      report: 'Relatório',
      insight: 'Insight',
    };
    return labels[type] || type;
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <div className="flex flex-col h-[70vh] max-h-[600px]">
        {/* Header with search input */}
        <div className="p-3 border-b">
          <CommandInput
            placeholder={mode === 'quick' ? 'Buscar projetos, tarefas, arquivos...' : 'Pergunte em linguagem natural...'}
            value={query}
            onValueChange={setQuery}
          />
          
          <Tabs value={mode} onValueChange={(v) => setMode(v as 'quick' | 'smart')} className="mt-2">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="quick" className="text-xs">
                <Search className="h-3 w-3 mr-1" />
                Busca Rápida
              </TabsTrigger>
              <TabsTrigger value="smart" className="text-xs">
                <Sparkles className="h-3 w-3 mr-1" />
                Busca Inteligente
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* Results area */}
        <CommandList className="flex-1 overflow-hidden">
          <div className="flex h-full">
            {/* Results list */}
            <ScrollArea className="flex-1 p-2">
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  <span className="ml-2 text-sm text-muted-foreground">Buscando...</span>
                </div>
              ) : query.length < (mode === 'quick' ? 2 : 3) ? (
                <div className="text-center py-8 text-sm text-muted-foreground">
                  {mode === 'quick' 
                    ? 'Digite pelo menos 2 caracteres' 
                    : 'Digite pelo menos 3 caracteres para busca semântica'}
                </div>
              ) : results.length === 0 ? (
                <div className="text-center py-8 text-sm text-muted-foreground">
                  Nenhum resultado encontrado
                </div>
              ) : (
                <div className="space-y-1">
                  {results.map((result) => (
                    <button
                      key={`${result.source_type}-${result.source_id}`}
                      onClick={() => handleSelect(result)}
                      className="w-full flex items-start gap-3 p-2 rounded-md hover:bg-accent text-left transition-colors"
                    >
                      <div className="mt-0.5 text-muted-foreground">
                        {getIcon(result.source_type)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium truncate">
                            {result.source_title || 'Sem título'}
                          </span>
                          <Badge variant="secondary" className="text-[10px] shrink-0">
                            {getTypeLabel(result.source_type)}
                          </Badge>
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          {result.project_name}
                        </div>
                        {mode === 'smart' && result.chunk_text && (
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                            {result.chunk_text.substring(0, 150)}...
                          </p>
                        )}
                        {mode === 'smart' && result.score_final > 0 && (
                          <div className="flex items-center gap-1 mt-1">
                            <div className="h-1 w-12 bg-muted rounded-full overflow-hidden">
                              <div 
                                className="h-full bg-primary" 
                                style={{ width: `${Math.min(result.score_final * 100, 100)}%` }}
                              />
                            </div>
                            <span className="text-[10px] text-muted-foreground">
                              {Math.round(result.score_final * 100)}%
                            </span>
                          </div>
                        )}
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                    </button>
                  ))}
                </div>
              )}
            </ScrollArea>

            {/* RAG Panel */}
            {mode === 'smart' && (
              <>
                <Separator orientation="vertical" />
                <div className="w-[300px] flex flex-col border-l">
                  <div className="p-3 border-b">
                    <Button
                      onClick={generateSummary}
                      disabled={ragLoading || query.length < 5 || results.length === 0}
                      className="w-full"
                      size="sm"
                    >
                      {ragLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <Sparkles className="h-4 w-4 mr-2" />
                      )}
                      Gerar resumo do que sabemos
                    </Button>
                  </div>
                  
                  <ScrollArea className="flex-1 p-3">
                    {ragResponse ? (
                      <div className="space-y-4">
                        <div className="prose prose-sm dark:prose-invert max-w-none">
                          {ragResponse.response.split('\n').map((line, i) => {
                            if (line.startsWith('## ')) {
                              return <h3 key={i} className="text-sm font-semibold mt-3 mb-1">{line.replace('## ', '')}</h3>;
                            }
                            if (line.startsWith('- ')) {
                              return <p key={i} className="text-xs ml-2">{line}</p>;
                            }
                            return <p key={i} className="text-xs">{line}</p>;
                          })}
                        </div>
                        
                        <Separator />
                        
                        <div>
                          <h4 className="text-xs font-semibold mb-2 text-muted-foreground">
                            Fontes ({ragResponse.sources.length})
                          </h4>
                          <div className="space-y-1">
                            {ragResponse.sources.map((source) => (
                              <button
                                key={source.id}
                                onClick={() => {
                                  onOpenChange(false);
                                  if (source.type === 'report') {
                                    navigate(`/projects/${source.id}?tab=reports`);
                                  } else if (source.type === 'task') {
                                    navigate(`/tasks?task=${source.id}`);
                                  }
                                }}
                                className="w-full flex items-center gap-2 p-1.5 rounded text-left hover:bg-accent text-xs"
                              >
                                <Badge variant="outline" className="text-[10px]">
                                  {source.citation}
                                </Badge>
                                <span className="truncate">{source.title}</span>
                                <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
                              </button>
                            ))}
                          </div>
                        </div>
                        
                        <div className="text-[10px] text-muted-foreground">
                          {ragResponse.chunks_used} chunks • {ragResponse.latency_ms}ms
                        </div>
                      </div>
                    ) : (
                      <div className="text-center py-8 text-xs text-muted-foreground">
                        {results.length > 0 
                          ? 'Clique no botão acima para gerar um resumo consolidado das fontes encontradas'
                          : 'Faça uma busca primeiro para habilitar o resumo'}
                      </div>
                    )}
                  </ScrollArea>
                </div>
              </>
            )}
          </div>
        </CommandList>
      </div>
    </CommandDialog>
  );
}
