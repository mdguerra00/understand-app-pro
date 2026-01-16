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
  FolderOpen,
  Plus,
  Search,
  FileIcon,
  Download,
  MoreHorizontal,
  Trash2,
  Upload,
  History,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { FileUploadModal } from './FileUploadModal';
import { FileDetailModal } from './FileDetailModal';
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

interface ProjectFilesListProps {
  projectId: string;
  initialFileId?: string | null;
  onFileOpened?: () => void;
}

export function ProjectFilesList({ projectId, initialFileId, onFileOpened }: ProjectFilesListProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<ProjectFile | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [deleteFile, setDeleteFile] = useState<ProjectFile | null>(null);

  const fetchFiles = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('project_files')
        .select('*')
        .eq('project_id', projectId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setFiles(data || []);
    } catch (error) {
      console.error('Error fetching files:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFiles();
  }, [projectId]);

  // Handle opening file from URL param (global search navigation)
  useEffect(() => {
    if (initialFileId && files.length > 0) {
      const file = files.find(f => f.id === initialFileId);
      if (file) {
        setSelectedFile(file);
        setIsDetailModalOpen(true);
        onFileOpened?.();
      }
    }
  }, [initialFileId, files, onFileOpened]);

  const handleDelete = async () => {
    if (!deleteFile || !user) return;

    try {
      // Soft delete
      const { error } = await supabase
        .from('project_files')
        .update({
          deleted_at: new Date().toISOString(),
          deleted_by: user.id,
        })
        .eq('id', deleteFile.id);

      if (error) throw error;

      toast({
        title: 'Arquivo excluído',
        description: `${deleteFile.name} foi movido para a lixeira`,
      });

      setDeleteFile(null);
      fetchFiles();
    } catch (error: any) {
      console.error('Delete error:', error);
      toast({
        title: 'Erro ao excluir',
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  const handleDownload = async (file: ProjectFile) => {
    try {
      const { data, error } = await supabase.storage
        .from('project-files')
        .download(file.storage_path);

      if (error) throw error;

      const url = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast({
        title: 'Download iniciado',
        description: file.name,
      });
    } catch (error: any) {
      toast({
        title: 'Erro ao baixar',
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

  const getFileIcon = (mimeType: string | null) => {
    // Could be expanded with specific icons per type
    return FileIcon;
  };

  const filteredFiles = files.filter((file) =>
    file.name.toLowerCase().includes(search.toLowerCase()) ||
    file.description?.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <Card key={i} className="animate-pulse">
            <CardContent className="flex items-center gap-4 py-4">
              <div className="h-10 w-10 rounded bg-muted" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-1/3 rounded bg-muted" />
                <div className="h-3 w-1/4 rounded bg-muted" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <>
        <Card className="border-dashed">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <FolderOpen className="h-6 w-6 text-muted-foreground" />
            </div>
            <CardTitle className="text-base">Nenhum arquivo</CardTitle>
            <CardDescription>
              Faça upload de arquivos relacionados ao projeto
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <Button onClick={() => setIsUploadModalOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Upload de Arquivo
            </Button>
          </CardContent>
        </Card>

        <FileUploadModal
          projectId={projectId}
          open={isUploadModalOpen}
          onOpenChange={setIsUploadModalOpen}
          onSuccess={fetchFiles}
        />
      </>
    );
  }

  return (
    <>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar arquivos..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Button onClick={() => setIsUploadModalOpen(true)}>
            <Upload className="mr-2 h-4 w-4" />
            Upload
          </Button>
        </div>

        {/* Files List */}
        <div className="space-y-2">
          {filteredFiles.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-8 text-center">
                <p className="text-sm text-muted-foreground">
                  Nenhum arquivo encontrado para "{search}"
                </p>
              </CardContent>
            </Card>
          ) : (
            filteredFiles.map((file) => {
              const Icon = getFileIcon(file.mime_type);
              return (
                <Card
                  key={file.id}
                  className="hover:border-primary/50 transition-colors cursor-pointer"
                  onClick={() => {
                    setSelectedFile(file);
                    setIsDetailModalOpen(true);
                  }}
                >
                  <CardContent className="flex items-center gap-4 py-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                      <Icon className="h-5 w-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium truncate">{file.name}</p>
                        {file.current_version > 1 && (
                          <Badge variant="secondary" className="text-xs">
                            v{file.current_version}
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {formatFileSize(file.size_bytes)} •{' '}
                        {format(new Date(file.updated_at), "d MMM yyyy", {
                          locale: ptBR,
                        })}
                      </p>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                        <Button variant="ghost" size="icon">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="bg-popover">
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDownload(file);
                          }}
                        >
                          <Download className="mr-2 h-4 w-4" />
                          Baixar
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedFile(file);
                            setIsDetailModalOpen(true);
                          }}
                        >
                          <History className="mr-2 h-4 w-4" />
                          Ver Histórico
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteFile(file);
                          }}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Excluir
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      </div>

      {/* Modals */}
      <FileUploadModal
        projectId={projectId}
        open={isUploadModalOpen}
        onOpenChange={setIsUploadModalOpen}
        onSuccess={fetchFiles}
      />

      <FileDetailModal
        file={selectedFile}
        open={isDetailModalOpen}
        onOpenChange={setIsDetailModalOpen}
        onUpdate={fetchFiles}
      />

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteFile} onOpenChange={() => setDeleteFile(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir arquivo?</AlertDialogTitle>
            <AlertDialogDescription>
              O arquivo "{deleteFile?.name}" será movido para a lixeira.
              Esta ação pode ser revertida por um administrador.
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
