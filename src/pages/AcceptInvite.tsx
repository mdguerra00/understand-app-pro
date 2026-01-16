import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';

// Hash function to compare tokens
async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

type InviteStatus = 'loading' | 'valid' | 'expired' | 'used' | 'email_mismatch' | 'error' | 'success';

interface InviteInfo {
  id: string;
  email: string;
  role_in_project: string;
  project_id: string;
  project_name?: string;
}

export default function AcceptInvite() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { toast } = useToast();
  
  const [status, setStatus] = useState<InviteStatus>('loading');
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [isAccepting, setIsAccepting] = useState(false);

  useEffect(() => {
    async function validateInvite() {
      if (!token || authLoading) return;
      
      if (!user) {
        // Redirect to auth with return URL
        navigate(`/auth?redirect=/invites/${token}`);
        return;
      }

      try {
        const tokenHash = await hashToken(token);
        
        const { data: inviteData, error } = await supabase
          .from('project_invites')
          .select('*, projects(name)')
          .eq('token_hash', tokenHash)
          .maybeSingle();

        if (error) throw error;
        
        if (!inviteData) {
          setStatus('error');
          return;
        }

        // Check if already used
        if (inviteData.used_at) {
          setStatus('used');
          return;
        }

        // Check if expired
        if (new Date(inviteData.expires_at) < new Date()) {
          setStatus('expired');
          return;
        }

        // Check if email matches
        if (inviteData.email.toLowerCase() !== user.email?.toLowerCase()) {
          setStatus('email_mismatch');
          setInvite({
            id: inviteData.id,
            email: inviteData.email,
            role_in_project: inviteData.role_in_project,
            project_id: inviteData.project_id,
            project_name: (inviteData.projects as any)?.name,
          });
          return;
        }

        setInvite({
          id: inviteData.id,
          email: inviteData.email,
          role_in_project: inviteData.role_in_project,
          project_id: inviteData.project_id,
          project_name: (inviteData.projects as any)?.name,
        });
        setStatus('valid');
      } catch (error) {
        console.error('Error validating invite:', error);
        setStatus('error');
      }
    }

    validateInvite();
  }, [token, user, authLoading, navigate]);

  const handleAccept = async () => {
    if (!invite || !user) return;

    setIsAccepting(true);
    try {
      // Add user to project members
      const { error: memberError } = await supabase.from('project_members').insert({
        project_id: invite.project_id,
        user_id: user.id,
        role_in_project: invite.role_in_project as 'owner' | 'manager' | 'researcher' | 'viewer',
        invited_by: user.id,
      });

      if (memberError) {
        if (memberError.code === '23505') {
          toast({
            title: 'Você já é membro',
            description: 'Você já faz parte deste projeto.',
          });
          navigate(`/projects/${invite.project_id}`);
          return;
        }
        throw memberError;
      }

      // Mark invite as used
      await supabase
        .from('project_invites')
        .update({ used_at: new Date().toISOString() })
        .eq('id', invite.id);

      setStatus('success');
      
      toast({
        title: 'Convite aceito!',
        description: 'Você agora faz parte do projeto.',
      });

      setTimeout(() => {
        navigate(`/projects/${invite.project_id}`);
      }, 2000);
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Erro ao aceitar convite',
        description: error.message || 'Tente novamente.',
      });
    } finally {
      setIsAccepting(false);
    }
  };

  const roleLabels: Record<string, string> = {
    owner: 'Proprietário',
    manager: 'Gerente',
    researcher: 'Pesquisador',
    viewer: 'Visualizador',
  };

  if (authLoading || status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="mt-4 text-muted-foreground">Validando convite...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        {status === 'valid' && invite && (
          <>
            <CardHeader className="text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <CheckCircle className="h-6 w-6 text-primary" />
              </div>
              <CardTitle>Convite para Projeto</CardTitle>
              <CardDescription>
                Você foi convidado para participar do projeto
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg bg-muted p-4 text-center">
                <p className="font-semibold text-lg">{invite.project_name || 'Projeto'}</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Papel: {roleLabels[invite.role_in_project]}
                </p>
              </div>
              <Button className="w-full" onClick={handleAccept} disabled={isAccepting}>
                {isAccepting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Aceitar Convite
              </Button>
              <Button variant="outline" className="w-full" asChild>
                <Link to="/dashboard">Cancelar</Link>
              </Button>
            </CardContent>
          </>
        )}

        {status === 'success' && (
          <CardContent className="flex flex-col items-center py-8">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-success/10">
              <CheckCircle className="h-6 w-6 text-success" />
            </div>
            <CardTitle className="text-center">Bem-vindo ao projeto!</CardTitle>
            <p className="mt-2 text-sm text-muted-foreground text-center">
              Redirecionando...
            </p>
          </CardContent>
        )}

        {status === 'expired' && (
          <CardContent className="flex flex-col items-center py-8">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
              <XCircle className="h-6 w-6 text-destructive" />
            </div>
            <CardTitle className="text-center">Convite Expirado</CardTitle>
            <p className="mt-2 text-sm text-muted-foreground text-center">
              Este convite não é mais válido. Solicite um novo convite.
            </p>
            <Button className="mt-4" asChild>
              <Link to="/dashboard">Ir para Dashboard</Link>
            </Button>
          </CardContent>
        )}

        {status === 'used' && (
          <CardContent className="flex flex-col items-center py-8">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <AlertCircle className="h-6 w-6 text-muted-foreground" />
            </div>
            <CardTitle className="text-center">Convite Já Utilizado</CardTitle>
            <p className="mt-2 text-sm text-muted-foreground text-center">
              Este convite já foi aceito anteriormente.
            </p>
            <Button className="mt-4" asChild>
              <Link to="/dashboard">Ir para Dashboard</Link>
            </Button>
          </CardContent>
        )}

        {status === 'email_mismatch' && invite && (
          <CardContent className="flex flex-col items-center py-8">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-warning/10">
              <AlertCircle className="h-6 w-6 text-warning" />
            </div>
            <CardTitle className="text-center">Email Diferente</CardTitle>
            <p className="mt-2 text-sm text-muted-foreground text-center">
              Este convite foi enviado para <strong>{invite.email}</strong>, mas você está logado com um email diferente.
            </p>
            <p className="mt-2 text-sm text-muted-foreground text-center">
              Faça login com o email correto para aceitar o convite.
            </p>
            <Button className="mt-4" asChild>
              <Link to="/auth">Trocar de Conta</Link>
            </Button>
          </CardContent>
        )}

        {status === 'error' && (
          <CardContent className="flex flex-col items-center py-8">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
              <XCircle className="h-6 w-6 text-destructive" />
            </div>
            <CardTitle className="text-center">Convite Inválido</CardTitle>
            <p className="mt-2 text-sm text-muted-foreground text-center">
              Este link de convite não é válido ou foi removido.
            </p>
            <Button className="mt-4" asChild>
              <Link to="/dashboard">Ir para Dashboard</Link>
            </Button>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
