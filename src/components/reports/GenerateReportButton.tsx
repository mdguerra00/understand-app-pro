import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Sparkles, Loader2, Brain, FileText, AlertCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useQuery } from '@tanstack/react-query';
import type { Database } from '@/integrations/supabase/types';

type KnowledgeCategory = Database['public']['Enums']['knowledge_category'];

interface GenerateReportButtonProps {
  projectId: string;
  onReportGenerated: (reportId: string) => void;
  externalOpen?: boolean;
  onExternalOpenChange?: (open: boolean) => void;
  defaultReportType?: 'progress' | 'final' | 'executive';
  triggerButton?: React.ReactNode;
}

const REPORT_TYPES = [
  { 
    value: 'progress', 
    label: 'Relatório de Progresso', 
    description: 'Atividades recentes e próximos passos' 
  },
  { 
    value: 'final', 
    label: 'Relatório Final', 
    description: 'Síntese completa com conclusões' 
  },
  { 
    value: 'executive', 
    label: 'Resumo Executivo', 
    description: 'Versão concisa para gestão' 
  },
];

const CATEGORY_LABELS: Record<KnowledgeCategory, string> = {
  compound: 'Compostos',
  parameter: 'Parâmetros',
  result: 'Resultados',
  method: 'Métodos',
  observation: 'Observações',
  finding: 'Descobertas',
  correlation: 'Correlações',
  anomaly: 'Anomalias',
  benchmark: 'Benchmarks',
  recommendation: 'Recomendações'
};

export function GenerateReportButton({ 
  projectId, 
  onReportGenerated,
  externalOpen,
  onExternalOpenChange,
  defaultReportType,
  triggerButton,
}: GenerateReportButtonProps) {
  const { toast } = useToast();
  const [internalOpen, setInternalOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [reportType, setReportType] = useState<string>(defaultReportType || 'progress');
  const [selectedCategories, setSelectedCategories] = useState<KnowledgeCategory[]>([]);

  // Support external control of the dialog
  const isControlled = externalOpen !== undefined;
  const open = isControlled ? externalOpen : internalOpen;
  const setOpen = isControlled ? (onExternalOpenChange || (() => {})) : setInternalOpen;

  // Fetch insights count by category
  const { data: insightStats } = useQuery({
    queryKey: ['insight-stats', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('knowledge_items')
        .select('category')
        .eq('project_id', projectId)
        .is('deleted_at', null);

      if (error) throw error;

      const counts: Partial<Record<KnowledgeCategory, number>> = {};
      for (const item of data || []) {
        const cat = item.category as KnowledgeCategory;
        counts[cat] = (counts[cat] || 0) + 1;
      }
      return {
        total: data?.length || 0,
        byCategory: counts
      };
    },
    enabled: open
  });

  const toggleCategory = (category: KnowledgeCategory) => {
    setSelectedCategories(prev => 
      prev.includes(category) 
        ? prev.filter(c => c !== category)
        : [...prev, category]
    );
  };

  const handleGenerate = async () => {
    setGenerating(true);

    try {
      const { data, error } = await supabase.functions.invoke('generate-report', {
        body: {
          project_id: projectId,
          report_type: reportType,
          category_filter: selectedCategories.length > 0 ? selectedCategories : undefined
        }
      });

      if (error) {
        throw new Error(error.message || 'Erro ao gerar relatório');
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      toast({
        title: 'Relatório gerado com sucesso!',
        description: `${data.insights_used} insights foram utilizados como base.`,
      });

      setOpen(false);
      onReportGenerated(data.report_id);

    } catch (error: any) {
      console.error('Error generating report:', error);
      toast({
        title: 'Erro ao gerar relatório',
        description: error.message || 'Tente novamente mais tarde',
        variant: 'destructive',
      });
    } finally {
      setGenerating(false);
    }
  };

  const filteredInsightCount = selectedCategories.length > 0
    ? selectedCategories.reduce((sum, cat) => sum + (insightStats?.byCategory[cat] || 0), 0)
    : insightStats?.total || 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {triggerButton !== undefined ? (
        triggerButton
      ) : (
        <DialogTrigger asChild>
          <Button variant="outline">
            <Sparkles className="mr-2 h-4 w-4" />
            Gerar com IA
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-primary" />
            Gerar Relatório com IA
          </DialogTitle>
          <DialogDescription>
            A IA analisará os insights extraídos do projeto para criar um relatório estruturado.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Report Type Selection */}
          <div className="space-y-2">
            <Label>Tipo de Relatório</Label>
            <Select value={reportType} onValueChange={setReportType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-background">
                {REPORT_TYPES.map(type => (
                  <SelectItem key={type.value} value={type.value}>
                    <div className="flex flex-col">
                      <span>{type.label}</span>
                      <span className="text-xs text-muted-foreground">{type.description}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Category Filters */}
          <div className="space-y-2">
            <Label>Filtrar por Categorias (opcional)</Label>
            <div className="grid grid-cols-2 gap-2 max-h-[200px] overflow-y-auto p-1">
              {(Object.entries(CATEGORY_LABELS) as [KnowledgeCategory, string][]).map(([category, label]) => {
                const count = insightStats?.byCategory[category] || 0;
                if (count === 0) return null;
                
                return (
                  <div key={category} className="flex items-center space-x-2">
                    <Checkbox
                      id={category}
                      checked={selectedCategories.includes(category)}
                      onCheckedChange={() => toggleCategory(category)}
                    />
                    <Label htmlFor={category} className="text-sm cursor-pointer flex items-center gap-1">
                      {label}
                      <Badge variant="secondary" className="ml-1 text-xs">
                        {count}
                      </Badge>
                    </Label>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Preview */}
          <div className="rounded-lg border bg-muted/50 p-4">
            <div className="flex items-center gap-2 text-sm">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">Serão utilizados:</span>
              <Badge variant="default">{filteredInsightCount} insights</Badge>
            </div>
            {filteredInsightCount === 0 && (
              <div className="flex items-center gap-2 mt-2 text-destructive text-sm">
                <AlertCircle className="h-4 w-4" />
                <span>Nenhum insight disponível. O relatório será preliminar.</span>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={generating}>
            Cancelar
          </Button>
          <Button onClick={handleGenerate} disabled={generating}>
            {generating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Gerando...
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-4 w-4" />
                Gerar Relatório
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
