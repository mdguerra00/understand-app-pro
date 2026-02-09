import { useQuery } from '@tanstack/react-query';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { FlaskConical, BarChart3, FileText, Settings2, Link2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import type { ExperimentItem } from './ExperimentCard';

interface ExperimentDetailModalProps {
  item: ExperimentItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ExperimentDetailModal({ item, open, onOpenChange }: ExperimentDetailModalProps) {
  const { data: measurements, isLoading: loadingM } = useQuery({
    queryKey: ['experiment-measurements', item?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('measurements')
        .select('*')
        .eq('experiment_id', item!.id)
        .order('metric');
      if (error) throw error;
      return data;
    },
    enabled: !!item?.id && open,
  });

  const { data: conditions } = useQuery({
    queryKey: ['experiment-conditions', item?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('experiment_conditions')
        .select('*')
        .eq('experiment_id', item!.id);
      if (error) throw error;
      return data;
    },
    enabled: !!item?.id && open,
  });

  const { data: citations } = useQuery({
    queryKey: ['experiment-citations', item?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('experiment_citations')
        .select('*, project_files(name)')
        .eq('experiment_id', item!.id);
      if (error) throw error;
      return data;
    },
    enabled: !!item?.id && open,
  });

  if (!item) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <FlaskConical className="h-5 w-5 text-primary" />
            <DialogTitle className="text-lg">{item.title}</DialogTitle>
          </div>
          <DialogDescription>
            {item.projects?.name} • {item.project_files?.name}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Summary */}
          <div className="flex flex-wrap gap-2">
            <Badge variant={item.is_qualitative ? 'secondary' : 'default'}>
              {item.is_qualitative ? 'Qualitativo' : 'Quantitativo'}
            </Badge>
            <Badge variant="outline">{item.source_type.toUpperCase()}</Badge>
            {measurements && (
              <Badge variant="outline" className="gap-1">
                <BarChart3 className="h-3 w-3" />
                {measurements.length} medições
              </Badge>
            )}
          </div>

          {item.objective && (
            <div>
              <h4 className="text-sm font-medium mb-1">Objetivo</h4>
              <p className="text-sm text-muted-foreground">{item.objective}</p>
            </div>
          )}

          {item.summary && (
            <div>
              <h4 className="text-sm font-medium mb-1">Resumo</h4>
              <p className="text-sm text-muted-foreground">{item.summary}</p>
            </div>
          )}

          {/* Measurements Table */}
          {loadingM ? (
            <Skeleton className="h-32 w-full" />
          ) : measurements && measurements.length > 0 ? (
            <>
              <Separator />
              <div>
                <h4 className="text-sm font-medium mb-2 flex items-center gap-1">
                  <BarChart3 className="h-4 w-4" />
                  Medições
                </h4>
                <div className="rounded-md border overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Métrica</TableHead>
                        <TableHead className="text-right">Valor</TableHead>
                        <TableHead>Unidade</TableHead>
                        <TableHead>Método</TableHead>
                        <TableHead>Confiança</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {measurements.map((m: any) => (
                        <TableRow key={m.id}>
                          <TableCell className="font-medium text-xs">{m.metric}</TableCell>
                          <TableCell className="text-right tabular-nums text-xs">{m.value}</TableCell>
                          <TableCell className="text-xs">{m.unit}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{m.method || '-'}</TableCell>
                          <TableCell>
                            <Badge variant={m.confidence === 'high' ? 'default' : 'secondary'} className="text-xs">
                              {m.confidence}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </>
          ) : null}

          {/* Conditions */}
          {conditions && conditions.length > 0 && (
            <>
              <Separator />
              <div>
                <h4 className="text-sm font-medium mb-2 flex items-center gap-1">
                  <Settings2 className="h-4 w-4" />
                  Condições Experimentais
                </h4>
                <div className="flex flex-wrap gap-2">
                  {conditions.map((c: any) => (
                    <Badge key={c.id} variant="outline" className="text-xs">
                      {c.key}: {c.value}
                    </Badge>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Citations */}
          {citations && citations.length > 0 && (
            <>
              <Separator />
              <div>
                <h4 className="text-sm font-medium mb-2 flex items-center gap-1">
                  <Link2 className="h-4 w-4" />
                  Citações
                </h4>
                <div className="space-y-2">
                  {citations.map((cit: any) => (
                    <div key={cit.id} className="text-xs p-2 bg-muted/50 rounded border">
                      <div className="flex items-center gap-2 mb-1">
                        <FileText className="h-3 w-3" />
                        <span className="font-medium">{cit.project_files?.name || 'Arquivo'}</span>
                        {cit.page && <Badge variant="outline" className="text-xs">p. {cit.page}</Badge>}
                        {cit.sheet_name && <Badge variant="outline" className="text-xs">{cit.sheet_name}</Badge>}
                        {cit.cell_range && <Badge variant="outline" className="text-xs">{cit.cell_range}</Badge>}
                      </div>
                      <p className="text-muted-foreground italic">"{cit.excerpt}"</p>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
