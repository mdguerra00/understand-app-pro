import { AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useReportFreshness } from '@/hooks/useReportFreshness';

interface OutdatedReportBadgeProps {
  projectId: string;
  reportCreatedAt: string;
}

export function OutdatedReportBadge({
  projectId,
  reportCreatedAt,
}: OutdatedReportBadgeProps) {
  const { isOutdated, newFilesCount, newInsightsCount, isLoading } = useReportFreshness(
    projectId,
    reportCreatedAt
  );

  if (isLoading || !isOutdated) {
    return null;
  }

  const parts: string[] = [];
  if (newFilesCount > 0) {
    parts.push(`${newFilesCount} arquivo${newFilesCount > 1 ? 's' : ''}`);
  }
  if (newInsightsCount > 0) {
    parts.push(`${newInsightsCount} insight${newInsightsCount > 1 ? 's' : ''}`);
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className="gap-1 text-xs shrink-0">
            <AlertTriangle className="h-3 w-3 text-amber-500" />
            Desatualizado
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <p>{parts.join(' e ')} adicionados após a criação</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
