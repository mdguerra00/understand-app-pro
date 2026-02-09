import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Loader2, CheckCircle2, AlertCircle, Clock } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface FileExtractionBadgeProps {
  fileId: string;
  compact?: boolean;
}

export function FileExtractionBadge({ fileId, compact = false }: FileExtractionBadgeProps) {
  const { data: job } = useQuery({
    queryKey: ['file-extraction-status', fileId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('extraction_jobs')
        .select('id, status, items_extracted, error_message, parsing_quality, completed_at')
        .eq('file_id', fileId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (error) return null;
      return data;
    },
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === 'pending' || status === 'processing') return 3000;
      return false;
    },
  });

  if (!job) return null;

  const statusConfig = {
    pending: {
      label: 'Aguardando',
      icon: Clock,
      className: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800',
    },
    processing: {
      label: 'Extraindo...',
      icon: Loader2,
      className: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 border-blue-200 dark:border-blue-800',
    },
    completed: {
      label: `${job.items_extracted || 0} insights`,
      icon: CheckCircle2,
      className: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 border-green-200 dark:border-green-800',
    },
    failed: {
      label: 'Erro',
      icon: AlertCircle,
      className: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800',
    },
  };

  const config = statusConfig[job.status as keyof typeof statusConfig] || statusConfig.pending;
  const Icon = config.icon;
  const isAnimated = job.status === 'processing';

  const badge = (
    <Badge variant="outline" className={`text-xs gap-1 ${config.className}`}>
      <Icon className={`h-3 w-3 ${isAnimated ? 'animate-spin' : ''}`} />
      {!compact && config.label}
    </Badge>
  );

  if (job.status === 'failed' && job.error_message) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{badge}</TooltipTrigger>
        <TooltipContent className="max-w-xs">
          <p className="text-xs">{job.error_message}</p>
        </TooltipContent>
      </Tooltip>
    );
  }

  return badge;
}
