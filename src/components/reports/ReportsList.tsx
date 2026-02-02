import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  FileText,
  Plus,
  Search,
  MoreHorizontal,
  Trash2,
  Edit,
  Eye,
  Send,
  CheckCircle,
  Clock,
  Archive,
  Sparkles,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { ReportEditorModal } from './ReportEditorModal';
import { GenerateReportButton } from './GenerateReportButton';
import { OutdatedReportBadge } from './OutdatedReportBadge';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type { Database } from '@/integrations/supabase/types';

type ReportStatus = Database['public']['Enums']['report_status'];

interface Report {
  id: string;
  project_id: string;
  title: string;
  content: string | null;
  summary: string | null;
  status: ReportStatus;
  created_by: string;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
  approved_at: string | null;
  review_notes: string | null;
  generated_by_ai?: boolean;
}

interface ReportsListProps {
  projectId: string;
  initialReportId?: string | null;
  onReportOpened?: () => void;
}

const statusConfig: Record<ReportStatus, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive'; icon: React.ReactNode }> = {
  draft: { label: 'Rascunho', variant: 'secondary', icon: <Edit className="h-3 w-3" /> },
  submitted: { label: 'Enviado', variant: 'default', icon: <Send className="h-3 w-3" /> },
  under_review: { label: 'Em Revisão', variant: 'outline', icon: <Clock className="h-3 w-3" /> },
  approved: { label: 'Aprovado', variant: 'default', icon: <CheckCircle className="h-3 w-3" /> },
  archived: { label: 'Arquivado', variant: 'secondary', icon: <Archive className="h-3 w-3" /> },
};

export function ReportsList({ projectId, initialReportId, onReportOpened }: ReportsListProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [selectedReport, setSelectedReport] = useState<Report | null>(null);
  const [deleteReport, setDeleteReport] = useState<Report | null>(null);

  const fetchReports = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('reports')
        .select('*')
        .eq('project_id', projectId)
        .is('deleted_at', null)
        .order('updated_at', { ascending: false });

      if (error) throw error;
      setReports(data || []);
    } catch (error) {
      console.error('Error fetching reports:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReports();
  }, [projectId]);

  // Handle opening report from URL param
  useEffect(() => {
    if (initialReportId && reports.length > 0) {
      const report = reports.find(r => r.id === initialReportId);
      if (report) {
        setSelectedReport(report);
        setIsEditorOpen(true);
        onReportOpened?.();
      }
    }
  }, [initialReportId, reports, onReportOpened]);

  const handleDelete = async () => {
    if (!deleteReport || !user) return;

    try {
      const { error } = await supabase
        .from('reports')
        .update({
          deleted_at: new Date().toISOString(),
          deleted_by: user.id,
        })
        .eq('id', deleteReport.id);

      if (error) throw error;

      toast({
        title: 'Relatório excluído',
        description: 'O relatório foi movido para a lixeira',
      });

      fetchReports();
    } catch (error: any) {
      toast({
        title: 'Erro ao excluir',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setDeleteReport(null);
    }
  };

  const handleCreateNew = () => {
    setSelectedReport(null);
    setIsEditorOpen(true);
  };

  const handleEdit = (report: Report) => {
    setSelectedReport(report);
    setIsEditorOpen(true);
  };

  const handleAIGenerated = (reportId: string) => {
    fetchReports().then(() => {
      const report = reports.find(r => r.id === reportId);
      if (report) {
        setSelectedReport(report);
        setIsEditorOpen(true);
      } else {
        // Report might not be in state yet, refetch and open
        supabase
          .from('reports')
          .select('*')
          .eq('id', reportId)
          .single()
          .then(({ data }) => {
            if (data) {
              setSelectedReport(data as Report);
              setIsEditorOpen(true);
            }
          });
      }
    });
  };

  const filteredReports = reports.filter(report =>
    report.title.toLowerCase().includes(search.toLowerCase()) ||
    report.summary?.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-16 bg-muted animate-pulse rounded" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Relatórios
              </CardTitle>
              <CardDescription>
                {reports.length} relatório{reports.length !== 1 ? 's' : ''} no projeto
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <GenerateReportButton 
                projectId={projectId} 
                onReportGenerated={handleAIGenerated} 
              />
              <Button onClick={handleCreateNew}>
                <Plus className="mr-2 h-4 w-4" />
                Novo Relatório
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {reports.length > 0 && (
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar relatórios..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
          )}

          {reports.length === 0 ? (
            <div className="text-center py-8">
              <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="font-medium mb-1">Nenhum relatório</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Crie relatórios para documentar o progresso do projeto
              </p>
              <Button onClick={handleCreateNew}>
                <Plus className="mr-2 h-4 w-4" />
                Criar Relatório
              </Button>
            </div>
          ) : filteredReports.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground">Nenhum resultado para "{search}"</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredReports.map((report) => {
                const status = statusConfig[report.status];
                return (
                  <div
                    key={report.id}
                    className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors cursor-pointer"
                    onClick={() => handleEdit(report)}
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <FileText className="h-5 w-5 text-muted-foreground shrink-0" />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="font-medium truncate">{report.title}</h4>
                          {report.generated_by_ai && (
                            <Badge variant="outline" className="gap-1 text-xs shrink-0">
                              <Sparkles className="h-3 w-3" />
                              IA
                            </Badge>
                          )}
                          <OutdatedReportBadge
                            projectId={projectId}
                            reportCreatedAt={report.created_at}
                          />
                        </div>
                        {report.summary && (
                          <p className="text-sm text-muted-foreground truncate">
                            {report.summary}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground mt-1">
                          Atualizado em {format(new Date(report.updated_at), "dd MMM yyyy 'às' HH:mm", { locale: ptBR })}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant={status.variant} className="gap-1">
                        {status.icon}
                        {status.label}
                      </Badge>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                          <Button variant="ghost" size="icon">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="bg-background">
                          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleEdit(report); }}>
                            <Eye className="mr-2 h-4 w-4" />
                            Abrir
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={(e) => { e.stopPropagation(); setDeleteReport(report); }}
                            className="text-destructive"
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Excluir
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <ReportEditorModal
        projectId={projectId}
        report={selectedReport}
        open={isEditorOpen}
        onOpenChange={setIsEditorOpen}
        onSuccess={fetchReports}
      />

      <AlertDialog open={!!deleteReport} onOpenChange={() => setDeleteReport(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir relatório?</AlertDialogTitle>
            <AlertDialogDescription>
              O relatório "{deleteReport?.title}" será movido para a lixeira.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
