import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, CheckCircle2, AlertCircle, Clock } from 'lucide-react';

interface IndexingStatusProps {
  projectId: string;
}

interface StatusCounts {
  queued: number;
  running: number;
  done: number;
  error: number;
}

export function IndexingStatus({ projectId }: IndexingStatusProps) {
  const [status, setStatus] = useState<StatusCounts | null>(null);
  const [chunksCount, setChunksCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        // Fetch job counts by status (exclude expected errors)
        const { data: jobs } = await supabase
          .from('indexing_jobs')
          .select('status, error_message')
          .eq('project_id', projectId);

        if (jobs) {
          // Filter out expected errors (cancelled, not found, deleted)
          const realErrors = jobs.filter(j => 
            j.status === 'error' && 
            j.error_message &&
            !j.error_message.includes('Cancelled') &&
            !j.error_message.includes('not found') &&
            !j.error_message.includes('deleted')
          );
          
          const counts: StatusCounts = {
            queued: jobs.filter(j => j.status === 'queued').length,
            running: jobs.filter(j => j.status === 'running').length,
            done: jobs.filter(j => j.status === 'done').length,
            error: realErrors.length,
          };
          setStatus(counts);
        }

        // Fetch chunks count
        const { count } = await supabase
          .from('search_chunks')
          .select('*', { count: 'exact', head: true })
          .eq('project_id', projectId);

        setChunksCount(count || 0);
      } catch (error) {
        console.error('Error fetching indexing status:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchStatus();

    // Poll every 10 seconds if there are pending jobs
    const interval = setInterval(fetchStatus, 10000);
    return () => clearInterval(interval);
  }, [projectId]);

  if (loading) {
    return (
      <Badge variant="outline" className="gap-1">
        <Loader2 className="h-3 w-3 animate-spin" />
        Carregando...
      </Badge>
    );
  }

  if (!status) return null;

  const pendingCount = status.queued + status.running;
  const hasErrors = status.error > 0;
  const isProcessing = status.running > 0;
  const hasPending = pendingCount > 0;

  // Determine badge variant and icon
  let variant: 'default' | 'secondary' | 'destructive' | 'outline' = 'outline';
  let icon = <CheckCircle2 className="h-3 w-3 text-success" />;
  let label = `${chunksCount} chunks indexados`;

  if (hasErrors) {
    variant = 'destructive';
    icon = <AlertCircle className="h-3 w-3" />;
    label = `${status.error} erro${status.error > 1 ? 's' : ''}`;
  } else if (isProcessing) {
    variant = 'secondary';
    icon = <Loader2 className="h-3 w-3 animate-spin" />;
    label = 'Indexando...';
  } else if (hasPending) {
    variant = 'secondary';
    icon = <Clock className="h-3 w-3" />;
    label = `${pendingCount} pendente${pendingCount > 1 ? 's' : ''}`;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant={variant} className="gap-1 cursor-help">
          {icon}
          {label}
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-sm">
        <div className="space-y-1">
          <p className="font-medium">Status da Indexação</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs">
            <span className="text-muted-foreground">Chunks indexados:</span>
            <span className="font-medium">{chunksCount}</span>
            <span className="text-muted-foreground">Jobs concluídos:</span>
            <span className="font-medium text-success">{status.done}</span>
            <span className="text-muted-foreground">Na fila:</span>
            <span className="font-medium">{status.queued}</span>
            <span className="text-muted-foreground">Processando:</span>
            <span className="font-medium text-primary">{status.running}</span>
            {status.error > 0 && (
              <>
                <span className="text-muted-foreground">Erros:</span>
                <span className="font-medium text-destructive">{status.error}</span>
              </>
            )}
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
