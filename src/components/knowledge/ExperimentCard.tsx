import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FlaskConical, BarChart3, FileText, Eye } from 'lucide-react';

export interface ExperimentItem {
  id: string;
  project_id: string;
  source_file_id: string;
  title: string;
  objective: string | null;
  summary: string | null;
  source_type: string;
  is_qualitative: boolean;
  created_at: string;
  projects?: { name: string } | null;
  project_files?: { name: string } | null;
  measurements_count?: number;
  conditions_count?: number;
}

interface ExperimentCardProps {
  item: ExperimentItem;
  onClick?: () => void;
  onViewFile?: () => void;
}

export function ExperimentCard({ item, onClick, onViewFile }: ExperimentCardProps) {
  return (
    <Card
      className="hover:border-primary/50 transition-colors cursor-pointer group"
      onClick={onClick}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-primary shrink-0" />
            <CardTitle className="text-sm font-medium line-clamp-2">
              {item.title}
            </CardTitle>
          </div>
          <Badge
            variant={item.is_qualitative ? 'secondary' : 'default'}
            className="text-xs shrink-0"
          >
            {item.is_qualitative ? 'Qualitativo' : 'Quantitativo'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {item.objective && (
          <p className="text-xs text-muted-foreground line-clamp-2">{item.objective}</p>
        )}
        {item.summary && (
          <p className="text-xs text-foreground/80 line-clamp-2">{item.summary}</p>
        )}

        <div className="flex flex-wrap gap-1.5">
          {(item.measurements_count ?? 0) > 0 && (
            <Badge variant="outline" className="text-xs gap-1">
              <BarChart3 className="h-3 w-3" />
              {item.measurements_count} medições
            </Badge>
          )}
          <Badge variant="outline" className="text-xs">
            {item.source_type.toUpperCase()}
          </Badge>
        </div>

        <div className="flex items-center justify-between pt-1">
          <span className="text-xs text-muted-foreground truncate max-w-[60%]">
            {item.project_files?.name || 'Arquivo'} • {item.projects?.name || 'Projeto'}
          </span>
          {onViewFile && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={(e) => { e.stopPropagation(); onViewFile(); }}
            >
              <Eye className="h-3 w-3 mr-1" />
              Fonte
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
