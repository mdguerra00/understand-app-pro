import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { 
  FlaskConical, 
  Gauge, 
  Target, 
  BookOpen, 
  Lightbulb,
  FileText,
  CheckCircle2,
  ExternalLink,
  Calendar,
  User
} from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { KnowledgeItem } from './KnowledgeCard';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { useState } from 'react';

interface KnowledgeDetailModalProps {
  item: KnowledgeItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdate?: () => void;
}

const categoryConfig = {
  compound: {
    label: 'Composto Químico',
    icon: FlaskConical,
    color: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
    description: 'Ingrediente ou formulação química identificada',
  },
  parameter: {
    label: 'Parâmetro de Teste',
    icon: Gauge,
    color: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    description: 'Medição ou especificação técnica',
  },
  result: {
    label: 'Resultado de Ensaio',
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
};

export function KnowledgeDetailModal({ 
  item, 
  open, 
  onOpenChange,
  onUpdate 
}: KnowledgeDetailModalProps) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const [validating, setValidating] = useState(false);

  if (!item) return null;

  const config = categoryConfig[item.category];
  const Icon = config.icon;
  const confidencePercent = Math.round((item.confidence || 0) * 100);

  const handleViewFile = () => {
    if (item.source_file_id && item.project_id) {
      onOpenChange(false);
      navigate(`/projects/${item.project_id}?tab=files&file=${item.source_file_id}`);
    }
  };

  const handleValidate = async () => {
    if (!user) return;
    
    setValidating(true);
    try {
      const { error } = await supabase
        .from('knowledge_items')
        .update({
          validated_by: user.id,
          validated_at: new Date().toISOString(),
        })
        .eq('id', item.id);

      if (error) throw error;

      toast({
        title: 'Insight validado',
        description: 'O insight foi marcado como validado manualmente.',
      });

      onUpdate?.();
      onOpenChange(false);
    } catch (error) {
      console.error('Validation error:', error);
      toast({
        title: 'Erro ao validar',
        description: 'Não foi possível validar o insight.',
        variant: 'destructive',
      });
    } finally {
      setValidating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${config.color}`}>
              <Icon className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle className="text-left">{item.title}</DialogTitle>
              <DialogDescription className="text-left">
                {config.description}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4">
          {/* Status badges */}
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className={config.color}>
              {config.label}
            </Badge>
            <Badge variant="secondary">
              {confidencePercent}% confiança
            </Badge>
            {item.validated_by && (
              <Badge variant="default" className="bg-green-600">
                <CheckCircle2 className="h-3 w-3 mr-1" />
                Validado
              </Badge>
            )}
          </div>

          {/* Content */}
          <div className="space-y-2">
            <h4 className="text-sm font-medium">Conteúdo</h4>
            <p className="text-sm text-muted-foreground">{item.content}</p>
          </div>

          {/* Evidence */}
          {item.evidence && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium">Evidência do documento</h4>
              <blockquote className="bg-muted/50 rounded-lg p-3 border-l-4 border-primary/50 italic text-sm">
                "{item.evidence}"
              </blockquote>
            </div>
          )}

          <Separator />

          {/* Metadata */}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Calendar className="h-4 w-4" />
              <span>
                Extraído em {format(new Date(item.extracted_at), "dd 'de' MMMM 'de' yyyy", { locale: ptBR })}
              </span>
            </div>
            {item.projects?.name && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <User className="h-4 w-4" />
                <span>Projeto: {item.projects.name}</span>
              </div>
            )}
          </div>

          {/* Source file */}
          {item.project_files?.name && (
            <div className="flex items-center justify-between bg-muted/30 rounded-lg p-3">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">{item.project_files.name}</span>
              </div>
              <Button variant="ghost" size="sm" onClick={handleViewFile}>
                <ExternalLink className="h-4 w-4 mr-1" />
                Ver arquivo
              </Button>
            </div>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          {!item.validated_by && (
            <Button 
              variant="outline" 
              onClick={handleValidate}
              disabled={validating}
            >
              <CheckCircle2 className="h-4 w-4 mr-2" />
              {validating ? 'Validando...' : 'Validar insight'}
            </Button>
          )}
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
