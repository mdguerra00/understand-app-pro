import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { 
  FlaskConical, 
  Gauge, 
  Target, 
  BookOpen, 
  Lightbulb,
  FileText,
  CheckCircle2,
  ExternalLink,
  TrendingUp,
  Link2,
  AlertTriangle,
  Scale,
  Zap,
  ShieldCheck,
  ShieldAlert
} from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export type KnowledgeCategory = 
  | 'compound' 
  | 'parameter' 
  | 'result' 
  | 'method' 
  | 'observation'
  | 'finding'
  | 'correlation'
  | 'anomaly'
  | 'benchmark'
  | 'recommendation'
  | 'cross_reference'
  | 'pattern'
  | 'contradiction'
  | 'gap';

export interface KnowledgeItem {
  id: string;
  project_id: string;
  source_file_id: string | null;
  category: KnowledgeCategory;
  title: string;
  content: string;
  evidence: string | null;
  confidence: number;
  evidence_verified?: boolean;
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

export const categoryConfig: Record<KnowledgeCategory, {
  label: string;
  icon: typeof FlaskConical;
  color: string;
  description: string;
}> = {
  // New analytical categories (prioritized)
  finding: {
    label: 'Descoberta',
    icon: TrendingUp,
    color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200',
    description: 'Descoberta quantitativa com valores numéricos específicos',
  },
  correlation: {
    label: 'Correlação',
    icon: Link2,
    color: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200',
    description: 'Relação identificada entre duas ou mais variáveis',
  },
  anomaly: {
    label: 'Anomalia',
    icon: AlertTriangle,
    color: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
    description: 'Dados fora do padrão que requerem atenção',
  },
  benchmark: {
    label: 'Benchmark',
    icon: Scale,
    color: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200',
    description: 'Comparativo com referência (norma, controle, literatura)',
  },
  recommendation: {
    label: 'Recomendação',
    icon: Zap,
    color: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
    description: 'Sugestão de ação baseada na análise dos dados',
  },
  // Legacy categories (still supported)
  compound: {
    label: 'Composto',
    icon: FlaskConical,
    color: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
    description: 'Ingrediente ou formulação química identificada',
  },
  parameter: {
    label: 'Parâmetro',
    icon: Gauge,
    color: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    description: 'Medição ou especificação técnica',
  },
  result: {
    label: 'Resultado',
    icon: Target,
    color: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    description: 'Conclusão ou resultado de teste',
  },
  method: {
    label: 'Metodologia',
    icon: BookOpen,
    color: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
    description: 'Procedimento ou método utilizado',
  },
  observation: {
    label: 'Observação',
    icon: Lightbulb,
    color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
    description: 'Nota ou observação importante',
  },
  cross_reference: {
    label: 'Ref. Cruzada',
    icon: Link2,
    color: 'bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200',
    description: 'Relação identificada entre documentos diferentes',
  },
  pattern: {
    label: 'Padrão',
    icon: TrendingUp,
    color: 'bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-200',
    description: 'Padrão recorrente identificado em múltiplos documentos',
  },
  contradiction: {
    label: 'Contradição',
    icon: AlertTriangle,
    color: 'bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-200',
    description: 'Informações conflitantes entre documentos',
  },
  gap: {
    label: 'Lacuna',
    icon: Target,
    color: 'bg-stone-100 text-stone-800 dark:bg-stone-900 dark:text-stone-200',
    description: 'Área de conhecimento não coberta pelos documentos',
  },
};

export function KnowledgeCard({ item, onClick, onViewFile }: KnowledgeCardProps) {
  const config = categoryConfig[item.category] || categoryConfig.observation;
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
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className={config.color}>
              {config.label}
            </Badge>
            <Badge 
              variant="secondary" 
              className={`text-xs ${confidencePercent >= 70 ? '' : 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200'}`}
            >
              {confidencePercent}% confiança
            </Badge>
            {item.evidence_verified !== undefined && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center">
                    {item.evidence_verified ? (
                      <ShieldCheck className="h-4 w-4 text-green-600" />
                    ) : (
                      <ShieldAlert className="h-4 w-4 text-amber-500" />
                    )}
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  {item.evidence_verified 
                    ? 'Evidência verificada no documento original' 
                    : 'Evidência não confirmada - verificar manualmente'}
                </TooltipContent>
              </Tooltip>
            )}
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
