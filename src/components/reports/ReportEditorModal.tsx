import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Save,
  Send,
  CheckCircle,
  Clock,
  Archive,
  MoreHorizontal,
  FileText,
  Edit,
  Download,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type { Database } from '@/integrations/supabase/types';
import { OutdatedReportBanner } from './OutdatedReportBanner';
import { GenerateReportButton } from './GenerateReportButton';

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
}

interface ReportEditorModalProps {
  projectId: string;
  report: Report | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

const statusConfig: Record<ReportStatus, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive'; icon: React.ReactNode }> = {
  draft: { label: 'Rascunho', variant: 'secondary', icon: <Edit className="h-3 w-3" /> },
  submitted: { label: 'Enviado', variant: 'default', icon: <Send className="h-3 w-3" /> },
  under_review: { label: 'Em Revisão', variant: 'outline', icon: <Clock className="h-3 w-3" /> },
  approved: { label: 'Aprovado', variant: 'default', icon: <CheckCircle className="h-3 w-3" /> },
  archived: { label: 'Arquivado', variant: 'secondary', icon: <Archive className="h-3 w-3" /> },
};

export function ReportEditorModal({
  projectId,
  report,
  open,
  onOpenChange,
  onSuccess,
}: ReportEditorModalProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [content, setContent] = useState('');
  const [status, setStatus] = useState<ReportStatus>('draft');
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [reportId, setReportId] = useState<string | null>(null);
  const [regenerateDialogOpen, setRegenerateDialogOpen] = useState(false);
  const autosaveTimer = useRef<NodeJS.Timeout | null>(null);

  const isReadOnly = status !== 'draft';
  const isNewReport = !report;

  // Initialize form with report data
  useEffect(() => {
    if (report) {
      setTitle(report.title);
      setSummary(report.summary || '');
      setContent(report.content || '');
      setStatus(report.status);
      setReportId(report.id);
      setLastSaved(new Date(report.updated_at));
    } else {
      setTitle('');
      setSummary('');
      setContent('');
      setStatus('draft');
      setReportId(null);
      setLastSaved(null);
    }
    setHasChanges(false);
  }, [report, open]);

  // Autosave every 30 seconds
  const saveVersion = useCallback(async (isAutosave = false) => {
    if (!reportId || !hasChanges || isReadOnly) return;

    try {
      // Save version
      await supabase.from('report_versions').insert({
        report_id: reportId,
        title,
        content,
        summary,
        saved_by: user!.id,
        is_autosave: isAutosave,
      });

      // Update report
      await supabase
        .from('reports')
        .update({ title, content, summary })
        .eq('id', reportId);

      setLastSaved(new Date());
      setHasChanges(false);

      if (!isAutosave) {
        toast({
          title: 'Salvo',
          description: 'Relatório salvo com sucesso',
        });
      }
    } catch (error) {
      console.error('Error saving:', error);
    }
  }, [reportId, title, content, summary, hasChanges, isReadOnly, user, toast]);

  useEffect(() => {
    if (hasChanges && reportId && !isReadOnly) {
      autosaveTimer.current = setTimeout(() => {
        saveVersion(true);
      }, 30000); // 30 seconds
    }

    return () => {
      if (autosaveTimer.current) {
        clearTimeout(autosaveTimer.current);
      }
    };
  }, [hasChanges, reportId, isReadOnly, saveVersion]);

  const handleChange = () => {
    setHasChanges(true);
  };

  const handleCreate = async () => {
    if (!title.trim() || !user) return;

    setSaving(true);
    try {
      const { data, error } = await supabase
        .from('reports')
        .insert({
          project_id: projectId,
          title: title.trim(),
          summary: summary.trim() || null,
          content: content || null,
          created_by: user.id,
        })
        .select()
        .single();

      if (error) throw error;

      setReportId(data.id);
      setLastSaved(new Date());
      setHasChanges(false);

      // Create initial version
      await supabase.from('report_versions').insert({
        report_id: data.id,
        title: data.title,
        content: data.content,
        summary: data.summary,
        saved_by: user.id,
        is_autosave: false,
      });

      toast({
        title: 'Relatório criado',
        description: 'O relatório foi criado com sucesso',
      });

      onSuccess?.();
    } catch (error: any) {
      toast({
        title: 'Erro ao criar',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async () => {
    if (!reportId || !user) return;

    setSaving(true);
    try {
      // Save current state first
      if (hasChanges) {
        await saveVersion(false);
      }

      const { error } = await supabase
        .from('reports')
        .update({
          status: 'submitted',
          submitted_at: new Date().toISOString(),
          submitted_by: user.id,
        })
        .eq('id', reportId);

      if (error) throw error;

      setStatus('submitted');
      toast({
        title: 'Relatório enviado',
        description: 'O relatório foi enviado para revisão',
      });

      onSuccess?.();
    } catch (error: any) {
      toast({
        title: 'Erro ao enviar',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleStatusChange = async (newStatus: ReportStatus) => {
    if (!reportId || !user) return;

    setSaving(true);
    try {
      const updates: Record<string, any> = { status: newStatus };

      if (newStatus === 'approved') {
        updates.approved_at = new Date().toISOString();
        updates.approved_by = user.id;
      } else if (newStatus === 'archived') {
        updates.archived_at = new Date().toISOString();
        updates.archived_by = user.id;
      } else if (newStatus === 'under_review') {
        updates.reviewed_at = new Date().toISOString();
        updates.reviewed_by = user.id;
      }

      const { error } = await supabase
        .from('reports')
        .update(updates)
        .eq('id', reportId);

      if (error) throw error;

      setStatus(newStatus);
      toast({
        title: 'Status atualizado',
        description: `Relatório marcado como ${statusConfig[newStatus].label}`,
      });

      onSuccess?.();
    } catch (error: any) {
      toast({
        title: 'Erro ao atualizar',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleExportPDF = () => {
    // Simple PDF export using print
    const printContent = `
      <html>
        <head>
          <title>${title}</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 40px; max-width: 800px; margin: 0 auto; }
            h1 { color: #333; border-bottom: 2px solid #0f766e; padding-bottom: 10px; }
            .summary { background: #f5f5f5; padding: 15px; border-radius: 8px; margin-bottom: 20px; }
            .content { line-height: 1.6; white-space: pre-wrap; }
            .meta { color: #666; font-size: 12px; margin-top: 30px; border-top: 1px solid #ddd; padding-top: 10px; }
          </style>
        </head>
        <body>
          <h1>${title}</h1>
          ${summary ? `<div class="summary"><strong>Resumo:</strong> ${summary}</div>` : ''}
          <div class="content">${content}</div>
          <div class="meta">
            Gerado em ${format(new Date(), "dd 'de' MMMM 'de' yyyy 'às' HH:mm", { locale: ptBR })}
          </div>
        </body>
      </html>
    `;

    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(printContent);
      printWindow.document.close();
      printWindow.print();
    }
  };

  const statusInfo = statusConfig[status];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader className="shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <FileText className="h-5 w-5 text-primary" />
              <DialogTitle>
                {isNewReport ? 'Novo Relatório' : 'Editar Relatório'}
              </DialogTitle>
              <Badge variant={statusInfo.variant} className="gap-1">
                {statusInfo.icon}
                {statusInfo.label}
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              {lastSaved && (
                <span className="text-xs text-muted-foreground">
                  Salvo às {format(lastSaved, 'HH:mm')}
                </span>
              )}
              {hasChanges && (
                <Badge variant="outline" className="text-xs">
                  Alterações não salvas
                </Badge>
              )}
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-4">
          {/* Outdated Banner - only show for existing reports */}
          {!isNewReport && report && (
            <OutdatedReportBanner
              projectId={projectId}
              reportCreatedAt={report.created_at}
              onRegenerateClick={() => setRegenerateDialogOpen(true)}
            />
          )}

          {/* Title */}
          <div>
            <Input
              placeholder="Título do relatório"
              value={title}
              onChange={(e) => { setTitle(e.target.value); handleChange(); }}
              disabled={isReadOnly}
              className="text-lg font-medium"
            />
          </div>

          {/* Summary */}
          <div>
            <Textarea
              placeholder="Resumo executivo (opcional)"
              value={summary}
              onChange={(e) => { setSummary(e.target.value); handleChange(); }}
              disabled={isReadOnly}
              className="resize-none"
              rows={2}
            />
          </div>

          <Separator />

          {/* Content */}
          <div className="flex-1">
            <Textarea
              placeholder="Conteúdo do relatório..."
              value={content}
              onChange={(e) => { setContent(e.target.value); handleChange(); }}
              disabled={isReadOnly}
              className="min-h-[300px] resize-none"
            />
          </div>
        </div>

        {/* Footer Actions */}
        <div className="shrink-0 flex items-center justify-between border-t pt-4">
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={handleExportPDF}>
              <Download className="mr-2 h-4 w-4" />
              Exportar PDF
            </Button>
          </div>

          <div className="flex items-center gap-2">
            {isNewReport ? (
              <Button onClick={handleCreate} disabled={!title.trim() || saving}>
                <Save className="mr-2 h-4 w-4" />
                Criar Relatório
              </Button>
            ) : status === 'draft' ? (
              <>
                <Button variant="outline" onClick={() => saveVersion(false)} disabled={!hasChanges || saving}>
                  <Save className="mr-2 h-4 w-4" />
                  Salvar
                </Button>
                <Button onClick={handleSubmit} disabled={saving}>
                  <Send className="mr-2 h-4 w-4" />
                  Enviar para Revisão
                </Button>
              </>
            ) : (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline">
                    <MoreHorizontal className="mr-2 h-4 w-4" />
                    Ações
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="bg-background">
                  {status === 'submitted' && (
                    <DropdownMenuItem onClick={() => handleStatusChange('under_review')}>
                      <Clock className="mr-2 h-4 w-4" />
                      Iniciar Revisão
                    </DropdownMenuItem>
                  )}
                  {status === 'under_review' && (
                    <>
                      <DropdownMenuItem onClick={() => handleStatusChange('approved')}>
                        <CheckCircle className="mr-2 h-4 w-4" />
                        Aprovar
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleStatusChange('draft')}>
                        <Edit className="mr-2 h-4 w-4" />
                        Retornar para Rascunho
                      </DropdownMenuItem>
                    </>
                  )}
                  {status === 'approved' && (
                    <DropdownMenuItem onClick={() => handleStatusChange('archived')}>
                      <Archive className="mr-2 h-4 w-4" />
                      Arquivar
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      </DialogContent>

      {/* Regenerate Report Dialog */}
      <GenerateReportButton
        projectId={projectId}
        onReportGenerated={(newReportId) => {
          setRegenerateDialogOpen(false);
          onOpenChange(false);
          onSuccess?.();
        }}
        externalOpen={regenerateDialogOpen}
        onExternalOpenChange={setRegenerateDialogOpen}
        triggerButton={null}
      />
    </Dialog>
  );
}
