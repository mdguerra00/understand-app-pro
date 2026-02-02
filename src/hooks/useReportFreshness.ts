import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface ReportFreshnessResult {
  isOutdated: boolean;
  newFilesCount: number;
  newInsightsCount: number;
  isLoading: boolean;
}

export function useReportFreshness(
  projectId: string | undefined,
  reportCreatedAt: string | undefined
): ReportFreshnessResult {
  const { data, isLoading } = useQuery({
    queryKey: ['report-freshness', projectId, reportCreatedAt],
    queryFn: async () => {
      if (!projectId || !reportCreatedAt) {
        return { newFiles: 0, newInsights: 0 };
      }

      const reportDate = new Date(reportCreatedAt).toISOString();

      const [filesResult, insightsResult] = await Promise.all([
        supabase
          .from('project_files')
          .select('id', { count: 'exact', head: true })
          .eq('project_id', projectId)
          .gt('created_at', reportDate)
          .is('deleted_at', null),
        supabase
          .from('knowledge_items')
          .select('id', { count: 'exact', head: true })
          .eq('project_id', projectId)
          .gt('extracted_at', reportDate)
          .is('deleted_at', null),
      ]);

      return {
        newFiles: filesResult.count || 0,
        newInsights: insightsResult.count || 0,
      };
    },
    enabled: !!projectId && !!reportCreatedAt,
    staleTime: 30000, // Cache for 30 seconds
  });

  return {
    isOutdated: (data?.newFiles || 0) > 0 || (data?.newInsights || 0) > 0,
    newFilesCount: data?.newFiles || 0,
    newInsightsCount: data?.newInsights || 0,
    isLoading,
  };
}
