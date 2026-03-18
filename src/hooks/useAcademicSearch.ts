import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import type { AcademicPaper, AcademicPaperLink, AcademicSearchResult } from '@/types/academic';

export function useAcademicSearch(projectId?: string) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [results, setResults] = useState<(AcademicPaper & { id: string | null })[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const searchPapers = async (
    query: string,
    source: 'crossref' | 'semantic_scholar' | 'openalex' = 'crossref',
    limit: number = 10
  ) => {
    if (!query.trim()) return;

    setIsSearching(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Não autenticado');

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/search-academic`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            query,
            source,
            limit,
            project_id: projectId,
          }),
        }
      );

      const data: AcademicSearchResult = await response.json();

      if (!response.ok) {
        throw new Error((data as any).error || 'Erro ao buscar artigos');
      }

      setResults(data.results as any);
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro ao buscar artigos acadêmicos';
      toast.error(message);
      throw err;
    } finally {
      setIsSearching(false);
    }
  };

  const { data: savedPapers, isLoading: loadingSaved, refetch: refetchSaved } = useQuery({
    queryKey: ['academic-paper-links', projectId, user?.id],
    queryFn: async () => {
      if (!projectId) return [];

      const { data, error } = await supabase
        .from('academic_paper_links' as any)
        .select('*, academic_papers(*)')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data || []) as unknown as AcademicPaperLink[];
    },
    enabled: !!user && !!projectId,
  });

  const { data: allSavedPapersCount } = useQuery({
    queryKey: ['academic-papers-count', user?.id],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('academic_paper_links' as any)
        .select('*', { count: 'exact', head: true });
      if (error) throw error;
      return count || 0;
    },
    enabled: !!user,
  });

  const linkPaper = async (paperId: string, targetProjectId: string) => {
    if (!user) {
      toast.error('Não autenticado');
      return;
    }

    try {
      const { error } = await supabase
        .from('academic_paper_links' as any)
        .insert({
          paper_id: paperId,
          project_id: targetProjectId,
          linked_by: user.id,
        } as any);

      if (error) {
        if (error.code === '23505') {
          toast.info('Artigo já vinculado a este projeto');
          return;
        }
        throw error;
      }

      toast.success('Artigo salvo no projeto');
      queryClient.invalidateQueries({ queryKey: ['academic-paper-links'] });
      queryClient.invalidateQueries({ queryKey: ['academic-papers-count'] });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro ao salvar artigo';
      toast.error(message);
    }
  };

  const unlinkPaper = async (linkId: string) => {
    try {
      const { error } = await supabase
        .from('academic_paper_links' as any)
        .delete()
        .eq('id', linkId);

      if (error) throw error;

      toast.success('Artigo removido do projeto');
      queryClient.invalidateQueries({ queryKey: ['academic-paper-links'] });
      queryClient.invalidateQueries({ queryKey: ['academic-papers-count'] });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro ao remover artigo';
      toast.error(message);
    }
  };

  return {
    searchPapers,
    results,
    isSearching,
    savedPapers: savedPapers || [],
    loadingSaved,
    linkPaper,
    unlinkPaper,
    refetchSaved,
    allSavedPapersCount: allSavedPapersCount || 0,
  };
}
