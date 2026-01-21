import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  FileText,
  FileSpreadsheet,
  FileImage,
  File,
  ExternalLink,
  Brain,
  Calendar,
  FolderOpen,
} from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export interface DocumentItem {
  id: string;
  name: string;
  mime_type: string | null;
  size_bytes: number | null;
  project_id: string;
  created_at: string;
  storage_path: string;
  projects?: { name: string } | null;
  insights_count?: number;
}

interface DocumentCardProps {
  item: DocumentItem;
  onClick?: () => void;
  onViewProject?: () => void;
}

const mimeTypeConfig: Record<string, { icon: typeof FileText; label: string; color: string }> = {
  'application/pdf': { icon: FileText, label: 'PDF', color: 'text-red-500' },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { icon: FileSpreadsheet, label: 'Excel', color: 'text-green-600' },
  'application/vnd.ms-excel': { icon: FileSpreadsheet, label: 'Excel', color: 'text-green-600' },
  'text/csv': { icon: FileSpreadsheet, label: 'CSV', color: 'text-green-500' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { icon: FileText, label: 'Word', color: 'text-blue-600' },
  'application/msword': { icon: FileText, label: 'Word', color: 'text-blue-600' },
  'image/png': { icon: FileImage, label: 'Imagem', color: 'text-purple-500' },
  'image/jpeg': { icon: FileImage, label: 'Imagem', color: 'text-purple-500' },
  'image/jpg': { icon: FileImage, label: 'Imagem', color: 'text-purple-500' },
  'text/plain': { icon: FileText, label: 'Texto', color: 'text-gray-500' },
};

function getFileConfig(mimeType: string | null) {
  if (!mimeType) return { icon: File, label: 'Arquivo', color: 'text-muted-foreground' };
  return mimeTypeConfig[mimeType] || { icon: File, label: 'Arquivo', color: 'text-muted-foreground' };
}

function formatFileSize(bytes: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DocumentCard({ item, onClick, onViewProject }: DocumentCardProps) {
  const config = getFileConfig(item.mime_type);
  const Icon = config.icon;
  const projectName = item.projects?.name || 'Projeto';

  return (
    <Card
      className="group cursor-pointer transition-all hover:shadow-md hover:border-primary/30"
      onClick={onClick}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className={`p-2 rounded-lg bg-muted ${config.color}`}>
              <Icon className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <CardTitle className="text-sm font-medium truncate" title={item.name}>
                {item.name}
              </CardTitle>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <FolderOpen className="h-3 w-3" />
                <span className="truncate">{projectName}</span>
              </div>
            </div>
          </div>
          <Badge variant="outline" className="shrink-0 text-xs">
            {config.label}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-3">
            {item.size_bytes && (
              <span>{formatFileSize(item.size_bytes)}</span>
            )}
            <div className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {format(new Date(item.created_at), 'dd MMM yyyy', { locale: ptBR })}
            </div>
          </div>
          
          {item.insights_count !== undefined && item.insights_count > 0 && (
            <Badge variant="secondary" className="gap-1 text-xs">
              <Brain className="h-3 w-3" />
              {item.insights_count} insight{item.insights_count !== 1 ? 's' : ''}
            </Badge>
          )}
        </div>

        {onViewProject && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full mt-3 opacity-0 group-hover:opacity-100 transition-opacity text-xs"
            onClick={(e) => {
              e.stopPropagation();
              onViewProject();
            }}
          >
            <ExternalLink className="h-3 w-3 mr-1" />
            Ver no projeto
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
