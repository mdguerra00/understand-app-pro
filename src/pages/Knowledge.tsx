import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Brain, Search, Sparkles, Filter, LayoutGrid, List, FileText } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { KnowledgeCard, KnowledgeItem, KnowledgeCategory } from '@/components/knowledge/KnowledgeCard';
import { DocumentCard, DocumentItem } from '@/components/knowledge/DocumentCard';
import { KnowledgeFilters, EntryTypeFilter } from '@/components/knowledge/KnowledgeFilters';
import { KnowledgeDetailModal } from '@/components/knowledge/KnowledgeDetailModal';
import { DocumentDetailModal } from '@/components/knowledge/DocumentDetailModal';
import { ExtractionStatus } from '@/components/knowledge/ExtractionStatus';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';

// Unified entry type for documents and insights
type UnifiedEntry = 
  | { entry_type: 'document'; data: DocumentItem }
  | { entry_type: 'insight'; data: KnowledgeItem };

export default function Knowledge() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [selectedCategories, setSelectedCategories] = useState<KnowledgeCategory[]>([]);
  const [minConfidence, setMinConfidence] = useState(0);
  const [selectedInsight, setSelectedInsight] = useState<KnowledgeItem | null>(null);
  const [selectedDocument, setSelectedDocument] = useState<DocumentItem | null>(null);
  const [insightDetailOpen, setInsightDetailOpen] = useState(false);
  const [documentDetailOpen, setDocumentDetailOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [entryType, setEntryType] = useState<EntryTypeFilter>('all');

  // Fetch user's projects
  const { data: projects } = useQuery({
    queryKey: ['user-projects', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_members')
        .select('project_id, projects(id, name)')
        .eq('user_id', user!.id);

      if (error) throw error;
      return data
        .map((m) => m.projects)
        .filter(Boolean) as { id: string; name: string }[];
    },
    enabled: !!user,
  });

  // Fetch knowledge items (insights)
  const { data: knowledgeItems, isLoading: loadingInsights, refetch: refetchInsights } = useQuery({
    queryKey: ['knowledge-items', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('knowledge_items')
        .select(`
          *,
          projects(name),
          project_files(name)
        `)
        .is('deleted_at', null)
        .order('extracted_at', { ascending: false });

      if (error) throw error;
      return data as KnowledgeItem[];
    },
    enabled: !!user,
  });

  // Fetch all documents
  const { data: documents, isLoading: loadingDocuments } = useQuery({
    queryKey: ['all-documents', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_files')
        .select(`
          id,
          name,
          mime_type,
          size_bytes,
          project_id,
          created_at,
          storage_path,
          projects(name)
        `)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });

      if (error) throw error;
      
      // Count insights per document
      const docsWithInsights = await Promise.all(
        (data || []).map(async (doc) => {
          const { count } = await supabase
            .from('knowledge_items')
            .select('*', { count: 'exact', head: true })
            .eq('source_file_id', doc.id)
            .is('deleted_at', null);
          
          return {
            ...doc,
            insights_count: count || 0,
          } as DocumentItem;
        })
      );
      
      return docsWithInsights;
    },
    enabled: !!user,
  });

  const isLoading = loadingInsights || loadingDocuments;

  // Create unified entries and filter
  const filteredEntries = useMemo(() => {
    const entries: UnifiedEntry[] = [];

    // Add documents if filter allows
    if (entryType === 'all' || entryType === 'documents') {
      (documents || []).forEach((doc) => {
        // Search filter for documents
        if (searchQuery) {
          const query = searchQuery.toLowerCase();
          const matchesSearch =
            doc.name.toLowerCase().includes(query) ||
            doc.projects?.name?.toLowerCase().includes(query);
          if (!matchesSearch) return;
        }
        // Project filter
        if (selectedProject && doc.project_id !== selectedProject) {
          return;
        }
        entries.push({ entry_type: 'document', data: doc });
      });
    }

    // Add insights if filter allows
    if (entryType === 'all' || entryType === 'insights') {
      (knowledgeItems || []).forEach((item) => {
        // Search filter
        if (searchQuery) {
          const query = searchQuery.toLowerCase();
          const matchesSearch =
            item.title.toLowerCase().includes(query) ||
            item.content.toLowerCase().includes(query) ||
            item.evidence?.toLowerCase().includes(query);
          if (!matchesSearch) return;
        }
        // Project filter
        if (selectedProject && item.project_id !== selectedProject) {
          return;
        }
        // Category filter
        if (selectedCategories.length > 0 && !selectedCategories.includes(item.category)) {
          return;
        }
        // Confidence filter
        if (item.confidence < minConfidence) {
          return;
        }
        entries.push({ entry_type: 'insight', data: item });
      });
    }

    // Sort by date (newest first)
    return entries.sort((a, b) => {
      const dateA = a.entry_type === 'document' ? a.data.created_at : a.data.extracted_at;
      const dateB = b.entry_type === 'document' ? b.data.created_at : b.data.extracted_at;
      return new Date(dateB).getTime() - new Date(dateA).getTime();
    });
  }, [documents, knowledgeItems, searchQuery, selectedProject, selectedCategories, minConfidence, entryType]);

  const handleCategoryToggle = (category: KnowledgeCategory) => {
    setSelectedCategories((prev) =>
      prev.includes(category)
        ? prev.filter((c) => c !== category)
        : [...prev, category]
    );
  };

  const handleClearFilters = () => {
    setSelectedProject(null);
    setSelectedCategories([]);
    setMinConfidence(0);
    setEntryType('all');
  };

  const handleInsightClick = (item: KnowledgeItem) => {
    setSelectedInsight(item);
    setInsightDetailOpen(true);
  };

  const handleDocumentClick = (doc: DocumentItem) => {
    setSelectedDocument(doc);
    setDocumentDetailOpen(true);
  };

  const handleViewFile = (item: KnowledgeItem) => {
    if (item.source_file_id && item.project_id) {
      navigate(`/projects/${item.project_id}?tab=files&file=${item.source_file_id}`);
    }
  };

  const handleViewProject = (doc: DocumentItem) => {
    navigate(`/projects/${doc.project_id}?tab=files&file=${doc.id}`);
  };

  // Stats
  const stats = useMemo(() => {
    const totalDocuments = documents?.length || 0;
    const totalInsights = knowledgeItems?.length || 0;
    const validated = knowledgeItems?.filter(i => i.validated_by).length || 0;

    return { totalDocuments, totalInsights, validated };
  }, [documents, knowledgeItems]);

  const hasActiveFilters = selectedProject || selectedCategories.length > 0 || minConfidence > 0 || entryType !== 'all';

  const filterProps = {
    projects: projects || [],
    selectedProject,
    onProjectChange: setSelectedProject,
    selectedCategories,
    onCategoryToggle: handleCategoryToggle,
    minConfidence,
    onConfidenceChange: setMinConfidence,
    onClearFilters: handleClearFilters,
    entryType,
    onEntryTypeChange: setEntryType,
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Base de Conhecimento</h1>
          <p className="text-muted-foreground">
            {stats.totalDocuments + stats.totalInsights > 0
              ? `${stats.totalDocuments} documentos • ${stats.totalInsights} insights • ${stats.validated} validados`
              : 'Documentos e insights extraídos automaticamente via IA'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
            size="icon"
            onClick={() => setViewMode('grid')}
          >
            <LayoutGrid className="h-4 w-4" />
          </Button>
          <Button
            variant={viewMode === 'list' ? 'secondary' : 'ghost'}
            size="icon"
            onClick={() => setViewMode('list')}
          >
            <List className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Extraction Status */}
      <ExtractionStatus />

      {/* Search and Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar documentos e insights..."
            className="pl-9"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        
        {/* Mobile Filter Sheet */}
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="outline" className="sm:hidden">
              <Filter className="h-4 w-4 mr-2" />
              Filtros
              {hasActiveFilters && (
                <span className="ml-2 h-2 w-2 rounded-full bg-primary" />
              )}
            </Button>
          </SheetTrigger>
          <SheetContent>
            <SheetHeader>
              <SheetTitle>Filtros</SheetTitle>
              <SheetDescription>
                Refine sua busca na base de conhecimento
              </SheetDescription>
            </SheetHeader>
            <div className="mt-4">
              <KnowledgeFilters {...filterProps} />
            </div>
          </SheetContent>
        </Sheet>
      </div>

      {/* Main Content */}
      <div className="flex gap-6">
        {/* Desktop Filters Sidebar */}
        <div className="hidden lg:block w-64 flex-shrink-0">
          <KnowledgeFilters {...filterProps} />
        </div>

        {/* Content */}
        <div className="flex-1">
          {isLoading ? (
            <div className={viewMode === 'grid' 
              ? 'grid gap-4 md:grid-cols-2 xl:grid-cols-3' 
              : 'space-y-4'
            }>
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <Card key={i}>
                  <CardHeader className="pb-2">
                    <Skeleton className="h-5 w-3/4" />
                  </CardHeader>
                  <CardContent>
                    <Skeleton className="h-16 w-full" />
                    <div className="flex gap-2 mt-3">
                      <Skeleton className="h-5 w-20" />
                      <Skeleton className="h-5 w-16" />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : filteredEntries.length === 0 ? (
            <Card className="border-dashed">
              <CardHeader className="text-center">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                  {entryType === 'documents' ? (
                    <FileText className="h-6 w-6 text-primary" />
                  ) : (
                    <Brain className="h-6 w-6 text-primary" />
                  )}
                </div>
                <CardTitle>
                  {(documents?.length || 0) + (knowledgeItems?.length || 0) > 0
                    ? 'Nenhum resultado encontrado'
                    : 'Base de conhecimento vazia'}
                </CardTitle>
                <CardDescription className="max-w-md mx-auto">
                  {(documents?.length || 0) + (knowledgeItems?.length || 0) > 0
                    ? 'Tente ajustar os filtros ou termo de busca.'
                    : 'Quando você fizer upload de documentos nos projetos, eles aparecerão aqui junto com os insights extraídos pela IA.'}
                </CardDescription>
              </CardHeader>
              <CardContent className="text-center">
                <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Sparkles className="h-4 w-4" />
                  <span>Powered by Lovable AI</span>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className={viewMode === 'grid' 
              ? 'grid gap-4 md:grid-cols-2 xl:grid-cols-3' 
              : 'space-y-4'
            }>
              {filteredEntries.map((entry) => {
                if (entry.entry_type === 'document') {
                  return (
                    <DocumentCard
                      key={`doc-${entry.data.id}`}
                      item={entry.data}
                      onClick={() => handleDocumentClick(entry.data)}
                      onViewProject={() => handleViewProject(entry.data)}
                    />
                  );
                } else {
                  return (
                    <KnowledgeCard
                      key={`insight-${entry.data.id}`}
                      item={entry.data}
                      onClick={() => handleInsightClick(entry.data)}
                      onViewFile={() => handleViewFile(entry.data)}
                    />
                  );
                }
              })}
            </div>
          )}
        </div>
      </div>

      {/* Detail Modals */}
      <KnowledgeDetailModal
        item={selectedInsight}
        open={insightDetailOpen}
        onOpenChange={setInsightDetailOpen}
        onUpdate={refetchInsights}
      />

      <DocumentDetailModal
        item={selectedDocument}
        open={documentDetailOpen}
        onOpenChange={setDocumentDetailOpen}
      />
    </div>
  );
}
