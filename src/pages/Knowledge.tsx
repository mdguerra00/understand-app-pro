import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Brain, Search, Sparkles, Filter, LayoutGrid, List } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { KnowledgeCard, KnowledgeItem } from '@/components/knowledge/KnowledgeCard';
import { KnowledgeFilters, KnowledgeCategory } from '@/components/knowledge/KnowledgeFilters';
import { KnowledgeDetailModal } from '@/components/knowledge/KnowledgeDetailModal';
import { ExtractionStatus } from '@/components/knowledge/ExtractionStatus';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';

export default function Knowledge() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [selectedCategories, setSelectedCategories] = useState<KnowledgeCategory[]>([]);
  const [minConfidence, setMinConfidence] = useState(0);
  const [selectedItem, setSelectedItem] = useState<KnowledgeItem | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

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

  // Fetch knowledge items
  const { data: knowledgeItems, isLoading, refetch } = useQuery({
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

  // Filter items
  const filteredItems = useMemo(() => {
    if (!knowledgeItems) return [];

    return knowledgeItems.filter((item) => {
      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesSearch =
          item.title.toLowerCase().includes(query) ||
          item.content.toLowerCase().includes(query) ||
          item.evidence?.toLowerCase().includes(query);
        if (!matchesSearch) return false;
      }

      // Project filter
      if (selectedProject && item.project_id !== selectedProject) {
        return false;
      }

      // Category filter
      if (selectedCategories.length > 0 && !selectedCategories.includes(item.category)) {
        return false;
      }

      // Confidence filter
      if (item.confidence < minConfidence) {
        return false;
      }

      return true;
    });
  }, [knowledgeItems, searchQuery, selectedProject, selectedCategories, minConfidence]);

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
  };

  const handleItemClick = (item: KnowledgeItem) => {
    setSelectedItem(item);
    setDetailOpen(true);
  };

  const handleViewFile = (item: KnowledgeItem) => {
    if (item.source_file_id && item.project_id) {
      navigate(`/projects/${item.project_id}?tab=files&file=${item.source_file_id}`);
    }
  };

  // Stats
  const stats = useMemo(() => {
    if (!knowledgeItems) return { total: 0, validated: 0, byCategory: {} };
    
    const byCategory: Record<string, number> = {};
    let validated = 0;

    knowledgeItems.forEach((item) => {
      byCategory[item.category] = (byCategory[item.category] || 0) + 1;
      if (item.validated_by) validated++;
    });

    return { total: knowledgeItems.length, validated, byCategory };
  }, [knowledgeItems]);

  const hasActiveFilters = selectedProject || selectedCategories.length > 0 || minConfidence > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Base de Conhecimento</h1>
          <p className="text-muted-foreground">
            {stats.total > 0
              ? `${stats.total} insights extraídos • ${stats.validated} validados`
              : 'Insights extraídos automaticamente dos seus documentos via IA'}
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
            placeholder="Buscar conhecimento (ex: formulação com flúor, testes de abrasão...)"
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
              <KnowledgeFilters
                projects={projects || []}
                selectedProject={selectedProject}
                onProjectChange={setSelectedProject}
                selectedCategories={selectedCategories}
                onCategoryToggle={handleCategoryToggle}
                minConfidence={minConfidence}
                onConfidenceChange={setMinConfidence}
                onClearFilters={handleClearFilters}
              />
            </div>
          </SheetContent>
        </Sheet>
      </div>

      {/* Main Content */}
      <div className="flex gap-6">
        {/* Desktop Filters Sidebar */}
        <div className="hidden lg:block w-64 flex-shrink-0">
          <KnowledgeFilters
            projects={projects || []}
            selectedProject={selectedProject}
            onProjectChange={setSelectedProject}
            selectedCategories={selectedCategories}
            onCategoryToggle={handleCategoryToggle}
            minConfidence={minConfidence}
            onConfidenceChange={setMinConfidence}
            onClearFilters={handleClearFilters}
          />
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
          ) : filteredItems.length === 0 ? (
            <Card className="border-dashed">
              <CardHeader className="text-center">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                  <Brain className="h-6 w-6 text-primary" />
                </div>
                <CardTitle>
                  {knowledgeItems && knowledgeItems.length > 0
                    ? 'Nenhum resultado encontrado'
                    : 'Base de conhecimento vazia'}
                </CardTitle>
                <CardDescription className="max-w-md mx-auto">
                  {knowledgeItems && knowledgeItems.length > 0
                    ? 'Tente ajustar os filtros ou termo de busca.'
                    : 'Quando você fizer upload de documentos nos projetos, a IA irá extrair automaticamente informações importantes como compostos químicos, parâmetros de teste e resultados.'}
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
              {filteredItems.map((item) => (
                <KnowledgeCard
                  key={item.id}
                  item={item}
                  onClick={() => handleItemClick(item)}
                  onViewFile={() => handleViewFile(item)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Detail Modal */}
      <KnowledgeDetailModal
        item={selectedItem}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onUpdate={refetch}
      />
    </div>
  );
}
