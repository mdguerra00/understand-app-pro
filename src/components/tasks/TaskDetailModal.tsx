import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { Calendar, User, MessageSquare, Info, CheckSquare } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Tables } from '@/integrations/supabase/types';
import { useToast } from '@/hooks/use-toast';
import { TaskComments } from './TaskComments';

type Task = Tables<'tasks'>;

interface Member {
  user_id: string;
  full_name: string | null;
  email: string;
  avatar_url: string | null;
}

interface TaskDetailModalProps {
  task: Task | null;
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdate?: () => void;
}

const statusLabels: Record<string, string> = {
  todo: 'A Fazer',
  in_progress: 'Em Andamento',
  review: 'Revisão',
  done: 'Concluído',
};

const statusColors: Record<string, string> = {
  todo: 'bg-muted text-muted-foreground',
  in_progress: 'bg-primary/10 text-primary',
  review: 'bg-warning/10 text-warning',
  done: 'bg-success/10 text-success',
};

const priorityLabels: Record<string, string> = {
  low: 'Baixa',
  medium: 'Média',
  high: 'Alta',
  urgent: 'Urgente',
};

const priorityColors: Record<string, string> = {
  low: 'bg-muted text-muted-foreground',
  medium: 'bg-primary/10 text-primary',
  high: 'bg-warning/10 text-warning',
  urgent: 'bg-destructive/10 text-destructive',
};

const TASK_STATUSES = ['todo', 'in_progress', 'review', 'done'] as const;

export function TaskDetailModal({
  task,
  projectId,
  open,
  onOpenChange,
  onUpdate,
}: TaskDetailModalProps) {
  const { toast } = useToast();
  const [members, setMembers] = useState<Member[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [updating, setUpdating] = useState(false);

  const fetchMembers = async () => {
    if (!projectId) return;

    try {
      const { data: memberData } = await supabase
        .from('project_members')
        .select('user_id')
        .eq('project_id', projectId);

      if (memberData && memberData.length > 0) {
        const userIds = memberData.map((m) => m.user_id);
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, full_name, email, avatar_url')
          .in('id', userIds);

        if (profiles) {
          setMembers(
            profiles.map((p) => ({
              user_id: p.id,
              full_name: p.full_name,
              email: p.email,
              avatar_url: p.avatar_url,
            }))
          );
        }
      }
    } catch (error) {
      console.error('Error fetching members:', error);
    } finally {
      setLoadingMembers(false);
    }
  };

  useEffect(() => {
    if (open) {
      fetchMembers();
    }
  }, [open, projectId]);

  const handleStatusChange = async (newStatus: string) => {
    if (!task) return;

    setUpdating(true);
    try {
      const { error } = await supabase
        .from('tasks')
        .update({ status: newStatus as Task['status'] })
        .eq('id', task.id);

      if (error) throw error;

      toast({
        title: 'Status atualizado',
        description: `A tarefa agora está "${statusLabels[newStatus]}".`,
      });

      onUpdate?.();
    } catch (error) {
      console.error('Error updating status:', error);
      toast({
        title: 'Erro',
        description: 'Não foi possível atualizar o status.',
        variant: 'destructive',
      });
    } finally {
      setUpdating(false);
    }
  };

  const handleAssigneeChange = async (userId: string) => {
    if (!task) return;

    setUpdating(true);
    try {
      const { error } = await supabase
        .from('tasks')
        .update({ assigned_to: userId === 'unassigned' ? null : userId })
        .eq('id', task.id);

      if (error) throw error;

      toast({
        title: 'Responsável atualizado',
        description: userId === 'unassigned' 
          ? 'A tarefa foi desatribuída.' 
          : 'O responsável foi atualizado.',
      });

      onUpdate?.();
    } catch (error) {
      console.error('Error updating assignee:', error);
      toast({
        title: 'Erro',
        description: 'Não foi possível atualizar o responsável.',
        variant: 'destructive',
      });
    } finally {
      setUpdating(false);
    }
  };

  const getInitials = (name?: string | null, email?: string) => {
    if (name) {
      return name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);
    }
    return email?.charAt(0).toUpperCase() ?? '?';
  };

  const assignedMember = members.find((m) => m.user_id === task?.assigned_to);

  if (!task) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <CheckSquare className="h-5 w-5 text-muted-foreground" />
              <DialogTitle className="text-xl">{task.title}</DialogTitle>
            </div>
            <Badge className={priorityColors[task.priority]} variant="secondary">
              {priorityLabels[task.priority]}
            </Badge>
          </div>
        </DialogHeader>

        <Tabs defaultValue="details" className="mt-4">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="details" className="gap-2">
              <Info className="h-4 w-4" />
              Detalhes
            </TabsTrigger>
            <TabsTrigger value="comments" className="gap-2">
              <MessageSquare className="h-4 w-4" />
              Comentários
            </TabsTrigger>
          </TabsList>

          <TabsContent value="details" className="mt-4 space-y-6">
            {/* Description */}
            {task.description && (
              <div>
                <h4 className="text-sm font-medium text-muted-foreground mb-2">
                  Descrição
                </h4>
                <p className="text-sm whitespace-pre-wrap">{task.description}</p>
              </div>
            )}

            {/* Status & Assignment */}
            <div className="grid gap-4 sm:grid-cols-2">
              {/* Status */}
              <div>
                <h4 className="text-sm font-medium text-muted-foreground mb-2">
                  Status
                </h4>
                <Select
                  value={task.status}
                  onValueChange={handleStatusChange}
                  disabled={updating}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TASK_STATUSES.map((status) => (
                      <SelectItem key={status} value={status}>
                        <div className="flex items-center gap-2">
                          <div
                            className={`w-2 h-2 rounded-full ${statusColors[status]}`}
                            style={{ backgroundColor: 'currentColor' }}
                          />
                          {statusLabels[status]}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Assignee */}
              <div>
                <h4 className="text-sm font-medium text-muted-foreground mb-2">
                  Responsável
                </h4>
                {loadingMembers ? (
                  <Skeleton className="h-10 w-full" />
                ) : (
                  <Select
                    value={task.assigned_to || 'unassigned'}
                    onValueChange={handleAssigneeChange}
                    disabled={updating}
                  >
                    <SelectTrigger>
                      <SelectValue>
                        {assignedMember ? (
                          <div className="flex items-center gap-2">
                            <Avatar className="h-5 w-5">
                              <AvatarImage src={assignedMember.avatar_url || undefined} />
                              <AvatarFallback className="text-[10px]">
                                {getInitials(assignedMember.full_name, assignedMember.email)}
                              </AvatarFallback>
                            </Avatar>
                            <span>
                              {assignedMember.full_name || assignedMember.email}
                            </span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">Não atribuído</span>
                        )}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unassigned">
                        <div className="flex items-center gap-2">
                          <User className="h-4 w-4 text-muted-foreground" />
                          <span>Não atribuído</span>
                        </div>
                      </SelectItem>
                      {members.map((member) => (
                        <SelectItem key={member.user_id} value={member.user_id}>
                          <div className="flex items-center gap-2">
                            <Avatar className="h-5 w-5">
                              <AvatarImage src={member.avatar_url || undefined} />
                              <AvatarFallback className="text-[10px]">
                                {getInitials(member.full_name, member.email)}
                              </AvatarFallback>
                            </Avatar>
                            <span>{member.full_name || member.email}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>

            {/* Due Date */}
            {task.due_date && (
              <div>
                <h4 className="text-sm font-medium text-muted-foreground mb-2">
                  Data de Entrega
                </h4>
                <div className="flex items-center gap-2 text-sm">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  {new Date(task.due_date).toLocaleDateString('pt-BR', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </div>
              </div>
            )}

            {/* Metadata */}
            <div className="pt-4 border-t text-xs text-muted-foreground">
              <p>
                Criada em{' '}
                {new Date(task.created_at).toLocaleDateString('pt-BR', {
                  dateStyle: 'long',
                })}
              </p>
              {task.updated_at !== task.created_at && (
                <p>
                  Atualizada em{' '}
                  {new Date(task.updated_at).toLocaleDateString('pt-BR', {
                    dateStyle: 'long',
                  })}
                </p>
              )}
            </div>
          </TabsContent>

          <TabsContent value="comments" className="mt-4">
            <TaskComments taskId={task.id} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
