import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, CheckCircle2, XCircle, Clock, AlertTriangle, FileSpreadsheet, X, RotateCcw } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from 'sonner';
import { useReprocessFile } from '@/hooks/useReprocessFile';

interface ExtractionJob {
  id: string;
  status: string;
  items_extracted: number | null;
  created_at: string;
  started_at: string | null;
  sheets_found: number | null;
  content_truncated: boolean | null;
  project_files: { name: string } | null;
}

export function ExtractionStatus() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: pendingJobs } = useQuery({
    queryKey: ['pending-extractions', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('extraction_jobs')
        .select('id, status, items_extracted, created_at, started_at, sheets_found, content_truncated, project_files(name)')
        .in('status', ['pending', 'processing'])
        .order('created_at', { ascending: false })
        .limit(5);

      if (error) throw error;
      return data as ExtractionJob[];
    },
    enabled: !!user,
    refetchInterval: 5000, // Poll every 5 seconds for status updates
  });

  const cancelMutation = useMutation({
    mutationFn: async (jobId: string) => {
      const { error } = await supabase
        .from('extraction_jobs')
        .update({ 
          status: 'failed', 
          error_message: 'Cancelado pelo usuário',
          completed_at: new Date().toISOString()
        })
        .eq('id', jobId);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pending-extractions'] });
      queryClient.invalidateQueries({ queryKey: ['knowledge-items'] });
      toast.success('Extração cancelada');
    },
    onError: () => {
      toast.error('Erro ao cancelar extração');
    }
  });

  // Check for stuck jobs (processing for more than 5 minutes)
  const isJobStuck = (job: ExtractionJob) => {
    if (job.status !== 'processing' || !job.started_at) return false;
    const startedAt = new Date(job.started_at);
    const now = new Date();
    const diffMinutes = (now.getTime() - startedAt.getTime()) / 1000 / 60;
    return diffMinutes > 5;
  };

  if (!pendingJobs || pendingJobs.length === 0) {
    return null;
  }

  return (
    <Card className="border-dashed">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <span className="text-sm font-medium">Extraindo conhecimento...</span>
          <Badge variant="secondary" className="ml-auto">
            {pendingJobs.length} arquivo{pendingJobs.length > 1 ? 's' : ''}
          </Badge>
        </div>
        
        <div className="space-y-2">
          {pendingJobs.map((job) => {
            const stuck = isJobStuck(job);
            return (
              <div key={job.id} className="flex items-center gap-2 text-sm">
                {job.status === 'pending' && (
                  <Clock className="h-3 w-3 text-muted-foreground" />
                )}
                {job.status === 'processing' && !stuck && (
                  <Loader2 className="h-3 w-3 animate-spin text-primary" />
                )}
                {stuck && (
                  <AlertTriangle className="h-3 w-3 text-amber-500" />
                )}
                <span className="truncate flex-1 text-muted-foreground">
                  {job.project_files?.name || 'Arquivo'}
                </span>
                {stuck ? (
                  <Badge variant="outline" className="text-xs text-amber-500 border-amber-500">
                    Travado
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-xs">
                    {job.status === 'pending' ? 'Na fila' : 'Processando'}
                  </Badge>
                )}
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => cancelMutation.mutate(job.id)}
                        disabled={cancelMutation.isPending}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Cancelar extração</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

interface ExtractionBadgeProps {
  fileId: string;
  projectId?: string;
}

interface ExtendedJob {
  id: string;
  status: string;
  items_extracted: number | null;
  sheets_found: number | null;
  content_truncated: boolean | null;
}

export function ExtractionBadge({ fileId, projectId }: ExtractionBadgeProps) {
  const reprocessMutation = useReprocessFile();

  const { data: job } = useQuery({
    queryKey: ['file-extraction', fileId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('extraction_jobs')
        .select('id, status, items_extracted, sheets_found, content_truncated')
        .eq('file_id', fileId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      return data as ExtendedJob | null;
    },
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data?.status === 'pending' || data?.status === 'processing') {
        return 3000;
      }
      return false;
    },
  });

  const handleReprocess = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!projectId) return;
    reprocessMutation.mutate({ fileId, projectId });
  };

  if (!job) return null;

  if (job.status === 'pending') {
    return (
      <Badge variant="outline" className="text-xs gap-1">
        <Clock className="h-3 w-3" />
        Aguardando IA
      </Badge>
    );
  }

  if (job.status === 'processing') {
    return (
      <Badge variant="outline" className="text-xs gap-1 text-primary border-primary">
        <Loader2 className="h-3 w-3 animate-spin" />
        Processando
      </Badge>
    );
  }

  if (job.status === 'completed' && job.items_extracted && job.items_extracted > 0) {
    const hasSheetInfo = job.sheets_found && job.sheets_found > 1;
    const wasTruncated = job.content_truncated;
    
    const badgeContent = (
      <Badge variant="secondary" className="text-xs gap-1">
        <CheckCircle2 className="h-3 w-3 text-green-500" />
        {job.items_extracted} insight{job.items_extracted > 1 ? 's' : ''}
        {hasSheetInfo && (
          <FileSpreadsheet className="h-3 w-3 ml-1 text-muted-foreground" />
        )}
        {wasTruncated && (
          <AlertTriangle className="h-3 w-3 ml-1 text-amber-500" />
        )}
      </Badge>
    );

    if (hasSheetInfo || wasTruncated) {
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              {badgeContent}
            </TooltipTrigger>
            <TooltipContent>
              <div className="text-xs space-y-1">
                {hasSheetInfo && (
                  <p>{job.sheets_found} abas processadas</p>
                )}
                {wasTruncated && (
                  <p className="text-amber-500">⚠️ Conteúdo truncado (arquivo muito grande)</p>
                )}
              </div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }

    return badgeContent;
  }

  // Failed or completed with 0 insights — show reprocess button
  if (job.status === 'failed' || (job.status === 'completed' && (!job.items_extracted || job.items_extracted === 0))) {
    return (
      <div className="flex items-center gap-1">
        <Badge variant={job.status === 'failed' ? 'destructive' : 'outline'} className="text-xs gap-1">
          {job.status === 'failed' ? (
            <><XCircle className="h-3 w-3" /> Erro</>
          ) : (
            <><AlertTriangle className="h-3 w-3" /> 0 insights</>
          )}
        </Badge>
        {projectId && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={handleReprocess}
                  disabled={reprocessMutation.isPending}
                >
                  {reprocessMutation.isPending ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <RotateCcw className="h-3 w-3" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Reprocessar arquivo</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
    );
  }

  return null;
}
