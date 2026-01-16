import { useState } from 'react';
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
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Loader2 } from 'lucide-react';

const inviteSchema = z.object({
  email: z.string().email('Email inválido'),
  role: z.enum(['manager', 'researcher', 'viewer']),
});

type InviteFormData = z.infer<typeof inviteSchema>;

interface InviteMemberModalProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

// Generate a secure random token
function generateToken(length: number = 32): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  const values = new Uint32Array(length);
  crypto.getRandomValues(values);
  for (let i = 0; i < length; i++) {
    result += chars[values[i] % chars.length];
  }
  return result;
}

// Simple hash function for token storage
async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function InviteMemberModal({ projectId, open, onOpenChange, onSuccess }: InviteMemberModalProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);

  const form = useForm<InviteFormData>({
    resolver: zodResolver(inviteSchema),
    defaultValues: {
      email: '',
      role: 'researcher',
    },
  });

  const onSubmit = async (data: InviteFormData) => {
    if (!user) return;

    setIsLoading(true);
    try {
      const token = generateToken();
      const tokenHash = await hashToken(token);
      
      // Expires in 7 days
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      const { error } = await supabase.from('project_invites').insert({
        project_id: projectId,
        email: data.email.toLowerCase(),
        role_in_project: data.role,
        invited_by: user.id,
        token_hash: tokenHash,
        expires_at: expiresAt.toISOString(),
      });

      if (error) {
        if (error.code === '23505') {
          throw new Error('Este email já foi convidado para este projeto.');
        }
        throw error;
      }

      // Build the invite URL
      const inviteUrl = `${window.location.origin}/invites/${token}`;

      toast({
        title: 'Convite criado',
        description: (
          <div className="mt-2 space-y-2">
            <p>Compartilhe este link com {data.email}:</p>
            <code className="block p-2 bg-muted rounded text-xs break-all">
              {inviteUrl}
            </code>
          </div>
        ),
      });

      form.reset();
      onOpenChange(false);
      onSuccess?.();
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Erro ao convidar',
        description: error.message || 'Tente novamente.',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const roleLabels: Record<string, string> = {
    manager: 'Gerente',
    researcher: 'Pesquisador',
    viewer: 'Visualizador',
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Convidar Membro</DialogTitle>
          <DialogDescription>
            Envie um convite para adicionar alguém ao projeto
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email *</FormLabel>
                  <FormControl>
                    <Input type="email" placeholder="email@exemplo.com" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="role"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Papel no projeto</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="manager">{roleLabels.manager}</SelectItem>
                      <SelectItem value="researcher">{roleLabels.researcher}</SelectItem>
                      <SelectItem value="viewer">{roleLabels.viewer}</SelectItem>
                    </SelectContent>
                  </Select>
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
                Enviar Convite
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
