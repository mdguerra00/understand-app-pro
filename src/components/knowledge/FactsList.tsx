import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Plus, Search, ShieldCheck, BookOpen, Filter } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { KnowledgeFact, FactFormModal } from './FactFormModal';
import { FactDetailModal } from './FactDetailModal';
import { FactCard } from './FactCard';

interface FactsListProps {
  projects: { id: string; name: string }[];
}

export function FactsList({ projects }: FactsListProps) {
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'archived'>('active');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [scopeFilter, setScopeFilter] = useState<string>('all');
  const [formOpen, setFormOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [editFact, setEditFact] = useState<KnowledgeFact | null>(null);
  const [duplicateFact, setDuplicateFact] = useState<KnowledgeFact | null>(null);
  const [selectedFact, setSelectedFact] = useState<KnowledgeFact | null>(null);

  const { data: facts, isLoading, refetch } = useQuery({
    queryKey: ['knowledge-facts', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('knowledge_facts')
        .select('*, projects(name)')
        .order('priority', { ascending: false });
      if (error) throw error;
      return data as unknown as KnowledgeFact[];
    },
    enabled: !!user,
  });

  const filteredFacts = useMemo(() => {
    if (!facts) return [];
    return facts.filter(f => {
      if (statusFilter !== 'all' && f.status !== statusFilter) return false;
      if (categoryFilter !== 'all' && f.category !== categoryFilter) return false;
      if (scopeFilter === 'global' && f.project_id !== null) return false;
      if (scopeFilter !== 'all' && scopeFilter !== 'global' && f.project_id !== scopeFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!f.title.toLowerCase().includes(q) && !f.key.toLowerCase().includes(q) && !JSON.stringify(f.value).toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [facts, statusFilter, categoryFilter, scopeFilter, search]);

  const categories = useMemo(() => {
    if (!facts) return [];
    return [...new Set(facts.map(f => f.category))];
  }, [facts]);

  const handleEdit = (fact: KnowledgeFact) => {
    setEditFact(fact);
    setDuplicateFact(null);
    setFormOpen(true);
  };

  const handleDuplicate = (fact: KnowledgeFact) => {
    setEditFact(null);
    setDuplicateFact(fact);
    setFormOpen(true);
  };

  const handleNew = () => {
    setEditFact(null);
    setDuplicateFact(null);
    setFormOpen(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <h3 className="font-semibold text-lg">Referências Manuais</h3>
          <span className="text-sm text-muted-foreground">({filteredFacts.length} fatos)</span>
        </div>
        <Button onClick={handleNew} size="sm">
          <Plus className="h-4 w-4 mr-1" /> Novo Fato
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Buscar por título, key ou valor..." className="pl-9" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={scopeFilter} onValueChange={setScopeFilter}>
          <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="global">🌐 Global</SelectItem>
            {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={(v: any) => setStatusFilter(v)}>
          <SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="active">Ativos</SelectItem>
            <SelectItem value="archived">Arquivados</SelectItem>
          </SelectContent>
        </Select>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Categorias</SelectItem>
            {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[1, 2, 3].map(i => (
            <Card key={i}><CardHeader><Skeleton className="h-5 w-3/4" /></CardHeader><CardContent><Skeleton className="h-12 w-full" /></CardContent></Card>
          ))}
        </div>
      ) : filteredFacts.length === 0 ? (
        <Card className="border-dashed">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <BookOpen className="h-6 w-6 text-primary" />
            </div>
            <CardTitle>{facts && facts.length > 0 ? 'Nenhum resultado' : 'Nenhum fato manual'}</CardTitle>
            <CardDescription>
              {facts && facts.length > 0
                ? 'Ajuste os filtros ou busca.'
                : 'Adicione conhecimentos canônicos (preços, specs, regras) que terão prioridade máxima nas respostas da IA.'}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredFacts.map(fact => (
            <FactCard
              key={fact.id}
              fact={fact}
              onClick={() => { setSelectedFact(fact); setDetailOpen(true); }}
            />
          ))}
        </div>
      )}

      <FactFormModal
        open={formOpen}
        onOpenChange={setFormOpen}
        onSaved={refetch}
        projects={projects}
        editFact={editFact}
        duplicateFact={duplicateFact}
      />

      <FactDetailModal
        fact={selectedFact}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onEdit={handleEdit}
        onDuplicate={handleDuplicate}
        onRefresh={refetch}
      />
    </div>
  );
}
