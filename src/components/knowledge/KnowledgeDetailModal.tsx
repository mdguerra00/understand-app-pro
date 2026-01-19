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
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  FileText,
  CheckCircle2,
  ExternalLink,
  Calendar,
  User,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  Trash2
} from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { KnowledgeItem, categoryConfig } from './KnowledgeCard';
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
  const [deleting, setDeleting] = useState(false);

  if (!item) return null;

  const config = categoryConfig[item.category] || categoryConfig.observation;
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

  const handleDelete = async () => {
    if (!user) return;
    
    setDeleting(true);
    try {
      const { error } = await supabase
        .from('knowledge_items')
        .update({
          deleted_at: new Date().toISOString(),
          deleted_by: user.id,
        })
        .eq('id', item.id);

      if (error) throw error;

      toast({
        title: 'Insight descartado',
        description: 'O insight foi removido da base de conhecimento.',
      });

      onUpdate?.();
      onOpenChange(false);
    } catch (error) {
      console.error('Delete error:', error);
      toast({
        title: 'Erro ao descartar',
        description: 'Não foi possível descartar o insight.',
        variant: 'destructive',
      });
    } finally {
      setDeleting(false);
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
            <Badge 
              variant="secondary"
              className={confidencePercent >= 70 ? '' : 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200'}
            >
              {confidencePercent}% confiança
            </Badge>
            {item.evidence_verified !== undefined && (
              <Badge 
                variant={item.evidence_verified ? "default" : "secondary"}
                className={item.evidence_verified 
                  ? "bg-green-600" 
                  : "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200"
                }
              >
                {item.evidence_verified ? (
                  <>
                    <ShieldCheck className="h-3 w-3 mr-1" />
                    Verificado
                  </>
                ) : (
                  <>
                    <ShieldAlert className="h-3 w-3 mr-1" />
                    Não verificado
                  </>
                )}
              </Badge>
            )}
            {item.validated_by && (
              <Badge variant="default" className="bg-blue-600">
                <CheckCircle2 className="h-3 w-3 mr-1" />
                Validado manualmente
              </Badge>
            )}
          </div>

          {/* Warning for unverified evidence */}
          {item.evidence_verified === false && (
            <Alert variant="default" className="border-amber-300 bg-amber-50 dark:bg-amber-950">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <AlertDescription className="text-amber-800 dark:text-amber-200">
                A evidência citada não foi encontrada no documento original. Verifique manualmente antes de confiar neste insight.
              </AlertDescription>
            </Alert>
          )}

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
          <Button 
            variant="destructive" 
            onClick={handleDelete}
            disabled={deleting}
            className="sm:mr-auto"
          >
            <Trash2 className="h-4 w-4 mr-2" />
            {deleting ? 'Descartando...' : 'Descartar insight'}
          </Button>
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
