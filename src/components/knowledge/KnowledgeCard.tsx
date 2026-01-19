import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { 
  FlaskConical, 
  Gauge, 
  Target, 
  BookOpen, 
  Lightbulb,
  FileText,
  CheckCircle2,
  ExternalLink
} from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export interface KnowledgeItem {
  id: string;
  project_id: string;
  source_file_id: string | null;
  category: 'compound' | 'parameter' | 'result' | 'method' | 'observation';
  title: string;
  content: string;
  evidence: string | null;
  confidence: number;
  extracted_at: string;
  validated_by: string | null;
  validated_at: string | null;
  projects?: { name: string };
  project_files?: { name: string } | null;
}

interface KnowledgeCardProps {
  item: KnowledgeItem;
  onClick?: () => void;
  onViewFile?: () => void;
}

const categoryConfig = {
  compound: {
    label: 'Composto',
    icon: FlaskConical,
    color: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  },
  parameter: {
    label: 'Parâmetro',
    icon: Gauge,
    color: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  },
  result: {
    label: 'Resultado',
    icon: Target,
    color: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  },
  method: {
    label: 'Metodologia',
    icon: BookOpen,
    color: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
  },
  observation: {
    label: 'Observação',
    icon: Lightbulb,
    color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  },
};

export function KnowledgeCard({ item, onClick, onViewFile }: KnowledgeCardProps) {
  const config = categoryConfig[item.category];
  const Icon = config.icon;
  const confidencePercent = Math.round((item.confidence || 0) * 100);

  return (
    <Card 
      className="hover:shadow-md transition-shadow cursor-pointer group"
      onClick={onClick}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className={`p-1.5 rounded ${config.color}`}>
              <Icon className="h-4 w-4" />
            </div>
            <h3 className="font-medium text-sm line-clamp-2 flex-1">{item.title}</h3>
          </div>
          {item.validated_by && (
            <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground line-clamp-3">{item.content}</p>
        
        {item.evidence && (
          <div className="bg-muted/50 rounded p-2 border-l-2 border-primary/30">
            <p className="text-xs text-muted-foreground italic line-clamp-2">
              "{item.evidence}"
            </p>
          </div>
        )}

        <div className="flex items-center justify-between pt-2">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={config.color}>
              {config.label}
            </Badge>
            <Badge variant="secondary" className="text-xs">
              {confidencePercent}% confiança
            </Badge>
          </div>
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground pt-1 border-t">
          <div className="flex items-center gap-1">
            {item.project_files?.name && (
              <>
                <FileText className="h-3 w-3" />
                <span className="truncate max-w-[120px]">{item.project_files.name}</span>
              </>
            )}
          </div>
          <span>{format(new Date(item.extracted_at), "dd MMM yyyy", { locale: ptBR })}</span>
        </div>

        {item.source_file_id && onViewFile && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full mt-2 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={(e) => {
              e.stopPropagation();
              onViewFile();
            }}
          >
            <ExternalLink className="h-3 w-3 mr-1" />
            Ver arquivo fonte
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
