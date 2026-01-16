import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Download,
  History,
  FileIcon,
  Upload,
  RotateCcw,
  Calendar,
  User,
  HardDrive,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { FileVersionModal } from './FileVersionModal';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface ProjectFile {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  current_version: number;
  uploaded_by: string;
  created_at: string;
  updated_at: string;
}

interface FileVersion {
  id: string;
  version_number: number;
  storage_path: string;
  size_bytes: number | null;
  upload_comment: string | null;
  uploaded_by: string;
  created_at: string;
  uploader_name?: string;
  uploader_email?: string;
}

interface FileDetailModalProps {
  file: ProjectFile | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdate?: () => void;
}

export function FileDetailModal({
  file,
  open,
  onOpenChange,
  onUpdate,
}: FileDetailModalProps) {
  const { toast } = useToast();
  const [versions, setVersions] = useState<FileVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [isVersionModalOpen, setIsVersionModalOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (file && open) {
      fetchVersions();
    }
  }, [file, open]);

  const fetchVersions = async () => {
    if (!file) return;

    setLoading(true);
    try {
      const { data: versionsData, error } = await supabase
        .from('project_file_versions')
        .select('*')
        .eq('file_id', file.id)
        .order('version_number', { ascending: false });

      if (error) throw error;

      // Fetch uploader profiles
      if (versionsData && versionsData.length > 0) {
        const uploaderIds = [...new Set(versionsData.map((v) => v.uploaded_by))];
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, full_name, email')
          .in('id', uploaderIds);

        const versionsWithProfiles = versionsData.map((version) => {
          const profile = profiles?.find((p) => p.id === version.uploaded_by);
          return {
            ...version,
            uploader_name: profile?.full_name || null,
            uploader_email: profile?.email || 'Usuário desconhecido',
          };
        });

        setVersions(versionsWithProfiles);
      } else {
        setVersions([]);
      }
    } catch (error) {
      console.error('Error fetching versions:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async (storagePath: string, fileName: string) => {
    setDownloading(true);
    try {
      const { data, error } = await supabase.storage
        .from('project-files')
        .download(storagePath);

      if (error) throw error;

      // Create download link
      const url = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast({
        title: 'Download iniciado',
        description: fileName,
      });
    } catch (error: any) {
      console.error('Download error:', error);
      toast({
        title: 'Erro ao baixar arquivo',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setDownloading(false);
    }
  };

  const handleRestoreVersion = async (version: FileVersion) => {
    if (!file) return;

    try {
      // Update main file to point to this version's storage path
      const { error } = await supabase
        .from('project_files')
        .update({
          storage_path: version.storage_path,
          size_bytes: version.size_bytes,
        })
        .eq('id', file.id);

      if (error) throw error;

      toast({
        title: 'Versão restaurada',
        description: `Arquivo revertido para a versão ${version.version_number}`,
      });

      onUpdate?.();
    } catch (error: any) {
      console.error('Restore error:', error);
      toast({
        title: 'Erro ao restaurar versão',
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  const formatFileSize = (bytes: number | null) => {
    if (!bytes) return 'N/A';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getInitials = (name?: string | null, email?: string) => {
    if (name) {
      return name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);
    }
    return email?.charAt(0).toUpperCase() ?? '?';
  };

  if (!file) return null;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[600px] max-h-[90vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              <FileIcon className="h-5 w-5 text-primary" />
              <span className="truncate">{file.name}</span>
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* File Info */}
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="flex items-center gap-2 text-muted-foreground">
                <HardDrive className="h-4 w-4" />
                <span>{formatFileSize(file.size_bytes)}</span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Calendar className="h-4 w-4" />
                <span>
                  {format(new Date(file.created_at), "d 'de' MMM, yyyy", {
                    locale: ptBR,
                  })}
                </span>
              </div>
            </div>

            {file.description && (
              <div>
                <p className="text-sm text-muted-foreground mb-1">Descrição</p>
                <p className="text-sm">{file.description}</p>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2">
              <Button
                onClick={() => handleDownload(file.storage_path, file.name)}
                disabled={downloading}
                className="flex-1"
              >
                <Download className="mr-2 h-4 w-4" />
                {downloading ? 'Baixando...' : 'Baixar'}
              </Button>
              <Button
                variant="outline"
                onClick={() => setIsVersionModalOpen(true)}
                className="flex-1"
              >
                <Upload className="mr-2 h-4 w-4" />
                Nova Versão
              </Button>
            </div>

            <Separator />

            {/* Version History */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <History className="h-4 w-4" />
                <h4 className="font-medium">Histórico de Versões</h4>
                <Badge variant="secondary">v{file.current_version}</Badge>
              </div>

              <ScrollArea className="h-[200px] pr-4">
                {loading ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    Carregando...
                  </p>
                ) : versions.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    Nenhuma versão encontrada
                  </p>
                ) : (
                  <div className="space-y-3">
                    {versions.map((version, index) => (
                      <div
                        key={version.id}
                        className="flex items-start gap-3 p-3 rounded-lg border bg-card"
                      >
                        <Avatar className="h-8 w-8">
                          <AvatarFallback className="text-xs">
                            {getInitials(
                              version.uploader_name,
                              version.uploader_email
                            )}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <Badge
                              variant={index === 0 ? 'default' : 'outline'}
                              className="text-xs"
                            >
                              v{version.version_number}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              {format(
                                new Date(version.created_at),
                                "d MMM yyyy 'às' HH:mm",
                                { locale: ptBR }
                              )}
                            </span>
                          </div>
                          <p className="text-sm mt-1">
                            {version.upload_comment || 'Sem comentário'}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {version.uploader_name || version.uploader_email} •{' '}
                            {formatFileSize(version.size_bytes)}
                          </p>
                        </div>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() =>
                              handleDownload(
                                version.storage_path,
                                `v${version.version_number}_${file.name}`
                              )
                            }
                          >
                            <Download className="h-4 w-4" />
                          </Button>
                          {index !== 0 && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleRestoreVersion(version)}
                              title="Restaurar esta versão"
                            >
                              <RotateCcw className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <FileVersionModal
        fileId={file.id}
        fileName={file.name}
        projectId={file.project_id}
        currentVersion={file.current_version}
        open={isVersionModalOpen}
        onOpenChange={setIsVersionModalOpen}
        onSuccess={() => {
          fetchVersions();
          onUpdate?.();
        }}
      />
    </>
  );
}
