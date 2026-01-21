import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { RefreshCw, Loader2, CheckCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface ReindexProjectButtonProps {
  projectId: string;
  projectName: string;
}

export function ReindexProjectButton({ projectId, projectName }: ReindexProjectButtonProps) {
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleReindex = async () => {
    setLoading(true);
    setSuccess(false);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error('Você precisa estar logado');
        return;
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/reindex-project`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ project_id: projectId }),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Erro ao reindexar');
      }

      const result = await response.json();
      setSuccess(true);
      toast.success(
        `${result.jobs_created} itens enviados para indexação`,
        {
          description: `${result.breakdown.reports} relatórios, ${result.breakdown.tasks} tarefas, ${result.breakdown.insights} insights`,
        }
      );

      // Reset success state after 3 seconds
      setTimeout(() => setSuccess(false), 3000);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro desconhecido';
      toast.error('Erro ao reindexar projeto', { description: message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={loading}>
          {loading ? (
          <Loader2 className="h-4 w-4 animate-spin mr-2" />
        ) : success ? (
          <CheckCircle className="h-4 w-4 mr-2 text-emerald-600 dark:text-emerald-400" />
        ) : (
          <RefreshCw className="h-4 w-4 mr-2" />
          )}
          {loading ? 'Reindexando...' : success ? 'Indexado!' : 'Reindexar'}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Reindexar Projeto</AlertDialogTitle>
          <AlertDialogDescription>
            Isso irá reprocessar todo o conteúdo do projeto "{projectName}" para a busca semântica.
            <br /><br />
            <strong>O que será reindexado:</strong>
            <ul className="list-disc list-inside mt-2 space-y-1">
              <li>Todos os relatórios</li>
              <li>Todas as tarefas e comentários</li>
              <li>Todos os insights extraídos</li>
            </ul>
            <br />
            Este processo pode levar alguns minutos dependendo do volume de conteúdo.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={handleReindex}>
            Reindexar Projeto
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
