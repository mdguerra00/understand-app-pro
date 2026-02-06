import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, Lightbulb } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from '@/hooks/use-toast';
import { Constants } from '@/integrations/supabase/types';

interface SaveInsightModalProps {
  open: boolean;
  onClose: () => void;
  messageContent: string;
  userQuestion?: string;
}

const categoryLabels: Record<string, string> = {
  finding: 'Descoberta',
  recommendation: 'Recomendação',
  observation: 'Observação',
  result: 'Resultado',
  method: 'Método',
  correlation: 'Correlação',
  anomaly: 'Anomalia',
  benchmark: 'Benchmark',
  compound: 'Composto',
  parameter: 'Parâmetro',
};

export function SaveInsightModal({
  open,
  onClose,
  messageContent,
  userQuestion,
}: SaveInsightModalProps) {
  const { user } = useAuth();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [category, setCategory] = useState<string>('finding');
  const [projectId, setProjectId] = useState<string>('');
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      // Pre-fill content
      setContent(messageContent);
      setTitle(messageContent.substring(0, 80).split('\n')[0]);

      // Load projects
      supabase
        .from('projects')
        .select('id, name')
        .is('deleted_at', null)
        .order('name')
        .then(({ data }) => {
          setProjects(data || []);
          if (data && data.length > 0 && !projectId) {
            setProjectId(data[0].id);
          }
        });
    }
  }, [open, messageContent]);

  const handleSave = async () => {
    if (!user || !projectId || !title.trim() || !content.trim()) return;

    setSaving(true);
    try {
      const { error } = await supabase.from('knowledge_items').insert({
        project_id: projectId,
        title: title.trim(),
        content: content.trim(),
        category: category as any,
        evidence: userQuestion || null,
        extracted_by: user.id,
        source_file_id: null,
        extraction_job_id: null,
      });

      if (error) throw error;

      toast({
        title: 'Insight salvo com sucesso!',
        description: 'O insight foi adicionado à Base de Conhecimento.',
      });
      onClose();
    } catch (err: any) {
      toast({
        title: 'Erro ao salvar insight',
        description: err.message,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const categories = Constants.public.Enums.knowledge_category;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lightbulb className="h-5 w-5 text-amber-500" />
            Salvar na Base de Conhecimento
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Projeto</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione o projeto" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Categoria</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {categories.map((cat) => (
                  <SelectItem key={cat} value={cat}>
                    {categoryLabels[cat] || cat}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Título</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Título do insight"
            />
          </div>

          <div className="space-y-2">
            <Label>Conteúdo</Label>
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={6}
              placeholder="Conteúdo do insight"
            />
          </div>

          {userQuestion && (
            <div className="space-y-2">
              <Label className="text-muted-foreground">Evidência (pergunta original)</Label>
              <p className="text-sm text-muted-foreground bg-muted/50 p-2 rounded">
                {userQuestion}
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving || !projectId || !title.trim()}>
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Salvar Insight
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
