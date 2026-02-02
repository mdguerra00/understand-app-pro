import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useReportFreshness } from '@/hooks/useReportFreshness';

interface OutdatedReportBannerProps {
  projectId: string;
  reportCreatedAt: string;
  onRegenerateClick: () => void;
}

export function OutdatedReportBanner({
  projectId,
  reportCreatedAt,
  onRegenerateClick,
}: OutdatedReportBannerProps) {
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
    <div className="rounded-lg border bg-muted/50 p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground">
            Relatório potencialmente desatualizado
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            {parts.join(' e ')} foram adicionados após a criação deste relatório.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={onRegenerateClick}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Gerar Nova Versão com IA
          </Button>
        </div>
      </div>
    </div>
  );
}
