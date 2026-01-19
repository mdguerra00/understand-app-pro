import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  FolderOpen, 
  FileIcon, 
  Search, 
  ExternalLink,
  FileText,
  FileImage,
  FileSpreadsheet,
  File
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface ProjectFile {
  id: string;
  name: string;
  description: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  current_version: number;
  created_at: string;
  project_id: string;
  project_name: string;
}

export default function Files() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (user) {
      fetchAllFiles();
    }
  }, [user]);

  const fetchAllFiles = async () => {
    try {
      // Fetch files from all projects the user is a member of
      const { data, error } = await supabase
        .from('project_files')
        .select(`
          id,
          name,
          description,
          mime_type,
          size_bytes,
          current_version,
          created_at,
          project_id,
          projects!inner(name)
        `)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const formattedFiles = (data || []).map(file => ({
        ...file,
        project_name: (file.projects as any)?.name || 'Projeto'
      }));

      setFiles(formattedFiles);
    } catch (error) {
      console.error('Error fetching files:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatFileSize = (bytes: number | null) => {
    if (!bytes) return '-';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getFileIcon = (mimeType: string | null) => {
    if (!mimeType) return <File className="h-8 w-8 text-muted-foreground" />;
    if (mimeType.startsWith('image/')) return <FileImage className="h-8 w-8 text-blue-500" />;
    if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) 
      return <FileSpreadsheet className="h-8 w-8 text-green-500" />;
    if (mimeType.includes('pdf') || mimeType.includes('document') || mimeType.includes('text'))
      return <FileText className="h-8 w-8 text-red-500" />;
    return <FileIcon className="h-8 w-8 text-muted-foreground" />;
  };

  const filteredFiles = files.filter(file =>
    file.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    file.project_name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleFileClick = (file: ProjectFile) => {
    navigate(`/projects/${file.project_id}?tab=files&file=${file.id}`);
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-72 mt-2" />
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map(i => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Arquivos</h1>
          <p className="text-muted-foreground">
            Todos os arquivos dos seus projetos
          </p>
        </div>
      </div>

      {/* Search */}
      {files.length > 0 && (
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome ou projeto..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      )}

      {/* Files Grid or Empty State */}
      {files.length === 0 ? (
        <Card className="border-dashed">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <FolderOpen className="h-6 w-6 text-muted-foreground" />
            </div>
            <CardTitle>Nenhum arquivo encontrado</CardTitle>
            <CardDescription>
              Os arquivos são gerenciados dentro de cada projeto. Acesse um projeto para fazer upload de arquivos.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <Button onClick={() => navigate('/projects')}>
              <ExternalLink className="mr-2 h-4 w-4" />
              Ver Projetos
            </Button>
          </CardContent>
        </Card>
      ) : filteredFiles.length === 0 ? (
        <Card className="border-dashed">
          <CardHeader className="text-center">
            <CardTitle>Nenhum resultado</CardTitle>
            <CardDescription>
              Nenhum arquivo corresponde à sua busca "{searchQuery}"
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredFiles.map((file) => (
            <Card 
              key={file.id} 
              className="cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() => handleFileClick(file)}
            >
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className="shrink-0">
                    {getFileIcon(file.mime_type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium truncate">{file.name}</h3>
                    <p className="text-sm text-muted-foreground truncate">
                      {file.project_name}
                    </p>
                    <div className="flex items-center gap-2 mt-2">
                      <Badge variant="secondary" className="text-xs">
                        v{file.current_version}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {formatFileSize(file.size_bytes)}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {format(new Date(file.created_at), "dd MMM yyyy", { locale: ptBR })}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
