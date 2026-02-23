import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Loader2, Search, Check, X, RotateCcw, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

type StatusFilter = 'all' | 'pending' | 'approved' | 'rejected';
type SortField = 'created_at' | 'confidence' | 'source';

interface AliasRow {
  id: string;
  entity_type: string;
  canonical_name: string;
  alias: string;
  alias_norm: string;
  confidence: number;
  approved: boolean;
  source: string;
  rejection_reason: string | null;
  created_at: string;
  approved_by: string | null;
  approved_at: string | null;
  deleted_at: string | null;
  rejected_at: string | null;
  rejected_by: string | null;
}

function getStatus(row: AliasRow): 'approved' | 'approved_hidden' | 'pending' | 'rejected' {
  if (row.approved && !row.deleted_at) return 'approved';
  if (row.approved && row.deleted_at) return 'approved_hidden';
  if (!row.approved && row.rejected_at) return 'rejected';
  return 'pending';
}

function statusBadge(status: ReturnType<typeof getStatus>) {
  switch (status) {
    case 'approved': return <Badge className="bg-green-600 text-white">Aprovado</Badge>;
    case 'approved_hidden': return <Badge variant="outline" className="border-green-600 text-green-600">Oculto</Badge>;
    case 'pending': return <Badge className="bg-yellow-500 text-white">Pendente</Badge>;
    case 'rejected': return <Badge variant="destructive">Rejeitado</Badge>;
  }
}

export function AliasApprovalTab() {
  const { user } = useAuth();
  const [aliases, setAliases] = useState<AliasRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortField, setSortField] = useState<SortField>('created_at');

  // Reject dialog
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<AliasRow | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [rejecting, setRejecting] = useState(false);

  // Edit dialog
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<AliasRow | null>(null);
  const [editCanonical, setEditCanonical] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchAliases = useCallback(async () => {
    setLoading(true);
    // Use type assertion to bypass generated types since entity_aliases is new
    const query = (supabase as any).from('entity_aliases')
      .select('*')
      .order('created_at', { ascending: false });

    const { data, error } = await query;
    if (error) {
      toast.error('Erro ao carregar aliases');
      console.error(error);
    }
    setAliases(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchAliases(); }, [fetchAliases]);

  const filtered = aliases.filter(a => {
    // Search filter
    if (search) {
      const q = search.toLowerCase();
      if (!a.alias_norm.includes(q) && !a.canonical_name.toLowerCase().includes(q)) return false;
    }
    // Status filter
    const status = getStatus(a);
    if (statusFilter === 'pending' && status !== 'pending') return false;
    if (statusFilter === 'approved' && status !== 'approved' && status !== 'approved_hidden') return false;
    if (statusFilter === 'rejected' && status !== 'rejected') return false;
    return true;
  });

  // Sort
  const sorted = [...filtered].sort((a, b) => {
    if (sortField === 'confidence') return b.confidence - a.confidence;
    if (sortField === 'source') return a.source.localeCompare(b.source);
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  const handleApprove = async (alias: AliasRow) => {
    const { error } = await (supabase as any).from('entity_aliases')
      .update({
        approved: true,
        approved_at: new Date().toISOString(),
        approved_by: user?.id,
        rejected_at: null,
        rejected_by: null,
        rejection_reason: null,
      })
      .eq('id', alias.id);

    if (error) toast.error('Erro ao aprovar alias');
    else { toast.success(`Alias "${alias.alias}" aprovado`); fetchAliases(); }
  };

  const handleReject = async () => {
    if (!rejectTarget || !rejectionReason.trim()) {
      toast.error('Motivo de rejeição é obrigatório');
      return;
    }
    setRejecting(true);
    const { error } = await (supabase as any).from('entity_aliases')
      .update({
        rejected_at: new Date().toISOString(),
        rejected_by: user?.id,
        rejection_reason: rejectionReason.trim(),
      })
      .eq('id', rejectTarget.id);

    if (error) toast.error('Erro ao rejeitar alias');
    else { toast.success(`Alias "${rejectTarget.alias}" rejeitado`); fetchAliases(); }
    setRejecting(false);
    setRejectDialogOpen(false);
    setRejectTarget(null);
    setRejectionReason('');
  };

  const handleRestore = async (alias: AliasRow) => {
    const { error } = await (supabase as any).from('entity_aliases')
      .update({
        rejected_at: null,
        rejected_by: null,
        rejection_reason: null,
      })
      .eq('id', alias.id);

    if (error) toast.error('Erro ao restaurar alias');
    else { toast.success(`Alias "${alias.alias}" restaurado`); fetchAliases(); }
  };

  const handleSaveEdit = async () => {
    if (!editTarget || !editCanonical.trim()) return;
    setSaving(true);
    const { error } = await (supabase as any).from('entity_aliases')
      .update({ canonical_name: editCanonical.trim() })
      .eq('id', editTarget.id);

    if (error) toast.error('Erro ao editar alias');
    else { toast.success('Nome canônico atualizado'); fetchAliases(); }
    setSaving(false);
    setEditDialogOpen(false);
    setEditTarget(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar alias ou nome canônico..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="pending">Pendentes</SelectItem>
            <SelectItem value="approved">Aprovados</SelectItem>
            <SelectItem value="rejected">Rejeitados</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sortField} onValueChange={(v) => setSortField(v as SortField)}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Ordenar por" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="created_at">Data</SelectItem>
            <SelectItem value="confidence">Confiança</SelectItem>
            <SelectItem value="source">Fonte</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Alias</TableHead>
                <TableHead>Nome Canônico</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Confiança</TableHead>
                <TableHead>Fonte</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Motivo Rejeição</TableHead>
                <TableHead>Criado em</TableHead>
                <TableHead className="w-[120px]">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                    Nenhum alias encontrado
                  </TableCell>
                </TableRow>
              ) : sorted.map((a) => {
                const status = getStatus(a);
                return (
                  <TableRow key={a.id} className={status === 'rejected' ? 'opacity-60' : ''}>
                    <TableCell className="font-mono text-sm">{a.alias}</TableCell>
                    <TableCell className="font-medium">{a.canonical_name}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{a.entity_type}</Badge>
                    </TableCell>
                    <TableCell>{(a.confidence * 100).toFixed(0)}%</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{a.source}</TableCell>
                    <TableCell>{statusBadge(status)}</TableCell>
                    <TableCell className="text-xs max-w-[200px] truncate" title={a.rejection_reason || ''}>
                      {a.rejection_reason || '—'}
                    </TableCell>
                    <TableCell className="text-sm">
                      {format(new Date(a.created_at), 'dd/MM/yy', { locale: ptBR })}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {status === 'pending' && (
                          <>
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-green-600" onClick={() => handleApprove(a)} title="Aprovar">
                              <Check className="h-4 w-4" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => { setRejectTarget(a); setRejectDialogOpen(true); }} title="Rejeitar">
                              <X className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                        {status === 'rejected' && (
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleRestore(a)} title="Restaurar">
                            <RotateCcw className="h-4 w-4" />
                          </Button>
                        )}
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditTarget(a); setEditCanonical(a.canonical_name); setEditDialogOpen(true); }} title="Editar canônico">
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Reject Dialog */}
      <AlertDialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rejeitar Alias</AlertDialogTitle>
            <AlertDialogDescription>
              Alias: <strong>{rejectTarget?.alias}</strong> → {rejectTarget?.canonical_name}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-2">
            <Textarea
              placeholder="Motivo da rejeição (obrigatório)..."
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              className="min-h-[80px]"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleReject}
              disabled={rejecting || !rejectionReason.trim()}
              className="bg-destructive text-destructive-foreground"
            >
              {rejecting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Rejeitar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit Dialog */}
      <AlertDialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Editar Nome Canônico</AlertDialogTitle>
            <AlertDialogDescription>
              Alias: <strong>{editTarget?.alias}</strong>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-2">
            <Input
              value={editCanonical}
              onChange={(e) => setEditCanonical(e.target.value)}
              placeholder="Nome canônico..."
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleSaveEdit} disabled={saving || !editCanonical.trim()}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Salvar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
