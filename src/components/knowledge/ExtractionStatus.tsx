import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Loader2, CheckCircle2, XCircle, Clock, AlertTriangle, FileSpreadsheet } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface ExtractionJob {
  id: string;
  status: string;
  items_extracted: number | null;
  created_at: string;
  sheets_found: number | null;
  content_truncated: boolean | null;
  project_files: { name: string } | null;
}

export function ExtractionStatus() {
  const { user } = useAuth();

  const { data: pendingJobs } = useQuery({
    queryKey: ['pending-extractions', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('extraction_jobs')
        .select('id, status, items_extracted, created_at, sheets_found, content_truncated, project_files(name)')
        .in('status', ['pending', 'processing'])
        .order('created_at', { ascending: false })
        .limit(5);

      if (error) throw error;
      return data as ExtractionJob[];
    },
    enabled: !!user,
    refetchInterval: 5000, // Poll every 5 seconds for status updates
  });

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
          {pendingJobs.map((job) => (
            <div key={job.id} className="flex items-center gap-2 text-sm">
              {job.status === 'pending' && (
                <Clock className="h-3 w-3 text-muted-foreground" />
              )}
              {job.status === 'processing' && (
                <Loader2 className="h-3 w-3 animate-spin text-primary" />
              )}
              <span className="truncate flex-1 text-muted-foreground">
                {job.project_files?.name || 'Arquivo'}
              </span>
              <Badge variant="outline" className="text-xs">
                {job.status === 'pending' ? 'Na fila' : 'Processando'}
              </Badge>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

interface ExtractionBadgeProps {
  fileId: string;
}

interface ExtendedJob {
  id: string;
  status: string;
  items_extracted: number | null;
  sheets_found: number | null;
  content_truncated: boolean | null;
}

export function ExtractionBadge({ fileId }: ExtractionBadgeProps) {
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
      // Only poll if job is pending or processing
      const data = query.state.data;
      if (data?.status === 'pending' || data?.status === 'processing') {
        return 3000;
      }
      return false;
    },
  });

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

  if (job.status === 'failed') {
    return (
      <Badge variant="destructive" className="text-xs gap-1">
        <XCircle className="h-3 w-3" />
        Erro
      </Badge>
    );
  }

  return null;
}
