import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Badge } from '@/components/ui/badge';
import { FolderKanban, CheckSquare, FileIcon } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface SearchResult {
  result_type: string;
  result_id: string;
  title: string;
  subtitle: string | null;
  project_id: string;
  project_name: string;
  relevance: number;
}

interface GlobalSearchProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function GlobalSearch({ open, onOpenChange }: GlobalSearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  // Keyboard shortcut to open search
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

  // Debounced search
  const searchDebounced = useCallback(async (searchQuery: string) => {
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
      setResults(data || []);
    } catch (error) {
      console.error('Search error:', error);
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      searchDebounced(query);
    }, 300);

    return () => clearTimeout(timer);
  }, [query, searchDebounced]);

  const handleSelect = (result: SearchResult) => {
    onOpenChange(false);
    setQuery('');
    setResults([]);

    if (result.result_type === 'project') {
      navigate(`/projects/${result.result_id}`);
    } else if (result.result_type === 'task') {
      navigate(`/projects/${result.project_id}?task=${result.result_id}`);
    } else if (result.result_type === 'file') {
      navigate(`/projects/${result.project_id}?tab=files&file=${result.result_id}`);
    }
  };

  const getIcon = (type: string) => {
    switch (type) {
      case 'project':
        return <FolderKanban className="mr-2 h-4 w-4" />;
      case 'task':
        return <CheckSquare className="mr-2 h-4 w-4" />;
      case 'file':
        return <FileIcon className="mr-2 h-4 w-4" />;
      default:
        return null;
    }
  };

  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'project':
        return 'Projeto';
      case 'task':
        return 'Tarefa';
      case 'file':
        return 'Arquivo';
      default:
        return type;
    }
  };

  const projectResults = results.filter((r) => r.result_type === 'project');
  const taskResults = results.filter((r) => r.result_type === 'task');
  const fileResults = results.filter((r) => r.result_type === 'file');

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder="Buscar projetos, tarefas, arquivos..."
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>
          {loading ? 'Buscando...' : query.length < 2 ? 'Digite pelo menos 2 caracteres' : 'Nenhum resultado encontrado.'}
        </CommandEmpty>

        {projectResults.length > 0 && (
          <CommandGroup heading="Projetos">
            {projectResults.map((result) => (
              <CommandItem
                key={`project-${result.result_id}`}
                onSelect={() => handleSelect(result)}
                className="flex items-center justify-between"
              >
                <div className="flex items-center">
                  {getIcon(result.result_type)}
                  <div className="flex flex-col">
                    <span>{result.title}</span>
                    {result.subtitle && (
                      <span className="text-xs text-muted-foreground line-clamp-1">
                        {result.subtitle}
                      </span>
                    )}
                  </div>
                </div>
                <Badge variant="secondary" className="text-xs">
                  {getTypeLabel(result.result_type)}
                </Badge>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {taskResults.length > 0 && (
          <CommandGroup heading="Tarefas">
            {taskResults.map((result) => (
              <CommandItem
                key={`task-${result.result_id}`}
                onSelect={() => handleSelect(result)}
                className="flex items-center justify-between"
              >
                <div className="flex items-center">
                  {getIcon(result.result_type)}
                  <div className="flex flex-col">
                    <span>{result.title}</span>
                    <span className="text-xs text-muted-foreground">
                      {result.project_name}
                    </span>
                  </div>
                </div>
                <Badge variant="secondary" className="text-xs">
                  {getTypeLabel(result.result_type)}
                </Badge>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {fileResults.length > 0 && (
          <CommandGroup heading="Arquivos">
            {fileResults.map((result) => (
              <CommandItem
                key={`file-${result.result_id}`}
                onSelect={() => handleSelect(result)}
                className="flex items-center justify-between"
              >
                <div className="flex items-center">
                  {getIcon(result.result_type)}
                  <div className="flex flex-col">
                    <span>{result.title}</span>
                    <span className="text-xs text-muted-foreground">
                      {result.project_name}
                    </span>
                  </div>
                </div>
                <Badge variant="secondary" className="text-xs">
                  {getTypeLabel(result.result_type)}
                </Badge>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
