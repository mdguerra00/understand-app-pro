import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { FileText, Search, Loader2, FolderOpen } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface ProjectFile {
  id: string;
  name: string;
  mime_type: string | null;
  project_id: string;
  project_name: string;
}

interface AnalyzeFilePickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (fileId: string, fileName: string, projectId: string) => void;
  projectId?: string;
}

export function AnalyzeFilePicker({ open, onClose, onSelect, projectId }: AnalyzeFilePickerProps) {
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setSearch('');

    const fetchFiles = async () => {
      let query = supabase
        .from('project_files')
        .select('id, name, mime_type, project_id, projects!inner(name)')
        .is('deleted_at', null)
        .order('name');

      if (projectId) {
        query = query.eq('project_id', projectId);
      }

      const { data } = await query.limit(200);

      setFiles(
        (data || []).map((f: any) => ({
          id: f.id,
          name: f.name,
          mime_type: f.mime_type,
          project_id: f.project_id,
          project_name: f.projects?.name || 'Projeto',
        }))
      );
      setLoading(false);
    };

    fetchFiles();
  }, [open, projectId]);

  const filtered = search
    ? files.filter((f) =>
        f.name.toLowerCase().includes(search.toLowerCase()) ||
        f.project_name.toLowerCase().includes(search.toLowerCase())
      )
    : files;

  const handleSelect = (file: ProjectFile) => {
    onSelect(file.id, file.name, file.project_id);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Selecionar Documento para Análise
          </DialogTitle>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar arquivo..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <ScrollArea className="h-72">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              Nenhum arquivo encontrado
            </p>
          ) : (
            <div className="space-y-1">
              {filtered.map((file) => (
                <Button
                  key={file.id}
                  variant="ghost"
                  className="w-full justify-start gap-3 h-auto py-3 px-3"
                  onClick={() => handleSelect(file)}
                >
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="flex-1 text-left min-w-0">
                    <p className="text-sm font-medium truncate">{file.name}</p>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">
                        <FolderOpen className="h-3 w-3 mr-1" />
                        {file.project_name}
                      </Badge>
                      {file.mime_type && (
                        <span className="text-xs text-muted-foreground">
                          {file.mime_type.split('/').pop()}
                        </span>
                      )}
                    </div>
                  </div>
                </Button>
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
