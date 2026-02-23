import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Archive, Copy, Edit, RotateCcw, Shield, ShieldCheck, Clock, History } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { KnowledgeFact } from './FactFormModal';

interface FactDetailModalProps {
  fact: KnowledgeFact | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: (fact: KnowledgeFact) => void;
  onDuplicate: (fact: KnowledgeFact) => void;
  onRefresh: () => void;
}

export function FactDetailModal({ fact, open, onOpenChange, onEdit, onDuplicate, onRefresh }: FactDetailModalProps) {
  const { user } = useAuth();
  const [toggling, setToggling] = useState(false);

  const { data: versions } = useQuery({
    queryKey: ['fact-versions', fact?.id],
    queryFn: async () => {
      if (!fact) return [];
      const { data, error } = await supabase
        .from('knowledge_facts_versions')
        .select('*')
        .eq('fact_id', fact.id)
        .order('version', { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!fact && open,
  });

  const handleToggleStatus = async () => {
    if (!fact || !user) return;
    setToggling(true);
    try {
      const newStatus = fact.status === 'active' ? 'archived' : 'active';
      const { error } = await supabase
        .from('knowledge_facts')
        .update({ status: newStatus, updated_by: user.id })
        .eq('id', fact.id);
      if (error) throw error;

      await supabase.from('knowledge_facts_logs').insert({
        fact_id: fact.id,
        action: newStatus === 'archived' ? 'archive' : 'reactivate',
        user_id: user.id,
        details: { previous_status: fact.status },
      });

      toast.success(newStatus === 'archived' ? 'Fato arquivado' : 'Fato reativado');
      onRefresh();
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setToggling(false);
    }
  };

  if (!fact) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {fact.authoritative ? <ShieldCheck className="h-5 w-5 text-primary" /> : <Shield className="h-5 w-5 text-muted-foreground" />}
            {fact.title}
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh]">
          <div className="space-y-4 pr-4">
            <div className="flex flex-wrap gap-2">
              <Badge variant={fact.status === 'active' ? 'default' : 'secondary'}>{fact.status}</Badge>
              <Badge variant="outline">{fact.category}</Badge>
              <Badge variant="outline">v{fact.version}</Badge>
              <Badge variant="outline">P{fact.priority}</Badge>
              {fact.authoritative && <Badge className="bg-primary/20 text-primary">Authoritativo</Badge>}
              {fact.project_id ? (
                <Badge variant="outline">{fact.projects?.name || 'Projeto'}</Badge>
              ) : (
                <Badge variant="outline">🌐 Global</Badge>
              )}
            </div>

            <div className="space-y-1">
              <p className="text-sm font-medium text-muted-foreground">Key</p>
              <code className="text-sm bg-muted px-2 py-1 rounded">{fact.key}</code>
            </div>

            <div className="space-y-1">
              <p className="text-sm font-medium text-muted-foreground">Valor</p>
              <pre className="text-sm bg-muted p-3 rounded overflow-x-auto font-mono">
                {JSON.stringify(fact.value, null, 2)}
              </pre>
            </div>

            {fact.description && (
              <div className="space-y-1">
                <p className="text-sm font-medium text-muted-foreground">Descrição</p>
                <p className="text-sm whitespace-pre-wrap">{fact.description}</p>
              </div>
            )}

            {fact.tags && fact.tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {fact.tags.map(tag => (
                  <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
                ))}
              </div>
            )}

            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> Criado: {new Date(fact.created_at).toLocaleString('pt-BR')}</span>
              <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> Atualizado: {new Date(fact.updated_at).toLocaleString('pt-BR')}</span>
            </div>

            <Separator />

            {/* Version History */}
            <div className="space-y-2">
              <h4 className="text-sm font-medium flex items-center gap-1">
                <History className="h-4 w-4" /> Histórico de Versões ({versions?.length || 0})
              </h4>
              {versions && versions.length > 0 ? (
                <div className="space-y-2">
                  {versions.map(v => (
                    <div key={v.id} className="bg-muted/50 p-3 rounded text-sm space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">Versão {v.version}</span>
                        <span className="text-xs text-muted-foreground">{new Date(v.changed_at).toLocaleString('pt-BR')}</span>
                      </div>
                      <p className="text-xs"><strong>Título anterior:</strong> {v.old_title}</p>
                      <pre className="text-xs bg-muted p-2 rounded overflow-x-auto font-mono">
                        {JSON.stringify(v.old_value, null, 2)}
                      </pre>
                      {v.change_reason && (
                        <p className="text-xs text-muted-foreground"><strong>Motivo:</strong> {v.change_reason}</p>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Nenhuma versão anterior</p>
              )}
            </div>
          </div>
        </ScrollArea>

        <div className="flex items-center justify-between pt-2 border-t">
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => { onEdit(fact); onOpenChange(false); }}>
              <Edit className="h-4 w-4 mr-1" /> Editar
            </Button>
            <Button variant="outline" size="sm" onClick={() => { onDuplicate(fact); onOpenChange(false); }}>
              <Copy className="h-4 w-4 mr-1" /> Duplicar
            </Button>
          </div>
          <Button
            variant={fact.status === 'active' ? 'destructive' : 'default'}
            size="sm"
            onClick={handleToggleStatus}
            disabled={toggling}
          >
            {fact.status === 'active' ? (
              <><Archive className="h-4 w-4 mr-1" /> Arquivar</>
            ) : (
              <><RotateCcw className="h-4 w-4 mr-1" /> Reativar</>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
