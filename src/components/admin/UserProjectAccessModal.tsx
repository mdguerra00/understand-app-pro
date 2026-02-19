import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

interface Project {
  id: string;
  name: string;
  status: string;
}

interface Membership {
  project_id: string;
  role_in_project: string;
}

interface UserProjectAccessModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  userName: string;
  onUpdated: () => void;
}

export function UserProjectAccessModal({ open, onOpenChange, userId, userName, onUpdated }: UserProjectAccessModalProps) {
  const { user } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [changes, setChanges] = useState<Map<string, string | null>>(new Map());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      fetchData();
      setChanges(new Map());
    }
  }, [open, userId]);

  const fetchData = async () => {
    setLoading(true);
    const [projectsRes, membershipsRes] = await Promise.all([
      supabase.from('projects').select('id, name, status').is('deleted_at', null).order('name'),
      supabase.from('project_members').select('project_id, role_in_project').eq('user_id', userId),
    ]);
    setProjects(projectsRes.data || []);
    setMemberships(membershipsRes.data || []);
    setLoading(false);
  };

  const getCurrentRole = (projectId: string): string | null => {
    if (changes.has(projectId)) return changes.get(projectId)!;
    const membership = memberships.find(m => m.project_id === projectId);
    return membership?.role_in_project || null;
  };

  const handleToggle = (projectId: string, currentRole: string | null) => {
    const newChanges = new Map(changes);
    if (currentRole) {
      newChanges.set(projectId, null); // remove
    } else {
      newChanges.set(projectId, 'researcher'); // add with default role
    }
    setChanges(newChanges);
  };

  const handleRoleChange = (projectId: string, role: string) => {
    const newChanges = new Map(changes);
    newChanges.set(projectId, role);
    setChanges(newChanges);
  };

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);

    try {
      for (const [projectId, role] of changes) {
        const existingMembership = memberships.find(m => m.project_id === projectId);

        if (role === null && existingMembership) {
          // Remove membership
          await supabase
            .from('project_members')
            .delete()
            .eq('project_id', projectId)
            .eq('user_id', userId);
        } else if (role && existingMembership) {
          // Update role
          await supabase
            .from('project_members')
            .update({ role_in_project: role as any })
            .eq('project_id', projectId)
            .eq('user_id', userId);
        } else if (role && !existingMembership) {
          // Add membership
          await supabase
            .from('project_members')
            .insert({
              project_id: projectId,
              user_id: userId,
              role_in_project: role as any,
              invited_by: user.id,
            });
        }
      }

      toast.success('Acessos atualizados com sucesso!');
      onUpdated();
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message || 'Erro ao atualizar acessos');
    } finally {
      setSaving(false);
    }
  };

  const roleLabels: Record<string, string> = {
    owner: 'Proprietário',
    manager: 'Gerente',
    researcher: 'Pesquisador',
    viewer: 'Visualizador',
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Acessos de {userName}</DialogTitle>
          <DialogDescription>
            Gerencie os projetos que este usuário pode acessar e seus papéis.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : projects.length === 0 ? (
          <p className="text-center text-muted-foreground py-4">Nenhum projeto encontrado.</p>
        ) : (
          <div className="space-y-3">
            {projects.map(project => {
              const currentRole = getCurrentRole(project.id);
              const isMember = currentRole !== null;

              return (
                <div key={project.id} className="flex items-center gap-3 p-3 border rounded-lg">
                  <Checkbox
                    checked={isMember}
                    onCheckedChange={() => handleToggle(project.id, currentRole)}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{project.name}</p>
                    <Badge variant="outline" className="text-xs mt-0.5">{project.status}</Badge>
                  </div>
                  {isMember && (
                    <Select
                      value={currentRole || 'researcher'}
                      onValueChange={(v) => handleRoleChange(project.id, v)}
                    >
                      <SelectTrigger className="w-[140px] h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="owner">Proprietário</SelectItem>
                        <SelectItem value="manager">Gerente</SelectItem>
                        <SelectItem value="researcher">Pesquisador</SelectItem>
                        <SelectItem value="viewer">Visualizador</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving || changes.size === 0}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Salvar Acessos
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
