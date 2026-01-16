import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Loader2 } from 'lucide-react';

const taskSchema = z.object({
  title: z.string().min(1, 'Título é obrigatório').max(100, 'Máximo 100 caracteres'),
  description: z.string().max(500, 'Máximo 500 caracteres').optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']),
  assigned_to: z.string().optional(),
  due_date: z.string().optional(),
});

type TaskFormData = z.infer<typeof taskSchema>;

interface Member {
  user_id: string;
  full_name: string | null;
  email: string;
}

interface TaskFormModalProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function TaskFormModal({ projectId, open, onOpenChange, onSuccess }: TaskFormModalProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);

  const form = useForm<TaskFormData>({
    resolver: zodResolver(taskSchema),
    defaultValues: {
      title: '',
      description: '',
      priority: 'medium',
      assigned_to: '',
      due_date: '',
    },
  });

  useEffect(() => {
    async function fetchMembers() {
      const { data } = await supabase
        .from('project_members')
        .select('user_id')
        .eq('project_id', projectId);

      if (data && data.length > 0) {
        const userIds = data.map((m) => m.user_id);
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, full_name, email')
          .in('id', userIds);

        if (profiles) {
          setMembers(profiles.map((p) => ({ user_id: p.id, full_name: p.full_name, email: p.email })));
        }
      }
    }

    if (open) {
      fetchMembers();
    }
  }, [projectId, open]);

  const onSubmit = async (data: TaskFormData) => {
    if (!user) return;

    setIsLoading(true);
    try {
      const { error } = await supabase.from('tasks').insert({
        title: data.title,
        description: data.description || null,
        priority: data.priority,
        assigned_to: data.assigned_to || null,
        due_date: data.due_date || null,
        project_id: projectId,
        created_by: user.id,
      });

      if (error) throw error;

      toast({
        title: 'Tarefa criada',
        description: 'A tarefa foi adicionada com sucesso.',
      });

      form.reset();
      onOpenChange(false);
      onSuccess?.();
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Erro ao criar tarefa',
        description: error.message || 'Tente novamente.',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Nova Tarefa</DialogTitle>
          <DialogDescription>
            Adicione uma nova tarefa ao projeto
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Título *</FormLabel>
                  <FormControl>
                    <Input placeholder="Nome da tarefa" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Descrição</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Detalhes da tarefa"
                      className="resize-none"
                      rows={3}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="priority"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Prioridade</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="low">Baixa</SelectItem>
                        <SelectItem value="medium">Média</SelectItem>
                        <SelectItem value="high">Alta</SelectItem>
                        <SelectItem value="urgent">Urgente</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="assigned_to"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Responsável</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecionar..." />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {members.map((member) => (
                          <SelectItem key={member.user_id} value={member.user_id}>
                            {member.full_name || member.email}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="due_date"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Data de entrega</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={isLoading}>
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Criar Tarefa
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
