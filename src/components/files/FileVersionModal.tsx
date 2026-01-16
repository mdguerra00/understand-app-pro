import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Progress } from '@/components/ui/progress';
import { Upload, FileIcon, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';

const formSchema = z.object({
  upload_comment: z.string().min(1, 'Descreva as alterações desta versão'),
});

type FormData = z.infer<typeof formSchema>;

interface FileVersionModalProps {
  fileId: string;
  fileName: string;
  projectId: string;
  currentVersion: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function FileVersionModal({
  fileId,
  fileName,
  projectId,
  currentVersion,
  open,
  onOpenChange,
  onSuccess,
}: FileVersionModalProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      upload_comment: '',
    },
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      if (selectedFile.size > 50 * 1024 * 1024) {
        toast({
          title: 'Arquivo muito grande',
          description: 'O tamanho máximo permitido é 50MB',
          variant: 'destructive',
        });
        return;
      }
      setFile(selectedFile);
    }
  };

  const removeFile = () => {
    setFile(null);
  };

  const onSubmit = async (data: FormData) => {
    if (!file || !user) return;

    setUploading(true);
    setProgress(0);

    try {
      const newVersion = currentVersion + 1;
      const timestamp = Date.now();
      const sanitizedName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
      const storagePath = `${projectId}/v${newVersion}_${timestamp}_${sanitizedName}`;

      const progressInterval = setInterval(() => {
        setProgress((prev) => Math.min(prev + 10, 90));
      }, 200);

      // Upload new version to storage
      const { error: storageError } = await supabase.storage
        .from('project-files')
        .upload(storagePath, file);

      clearInterval(progressInterval);

      if (storageError) {
        throw storageError;
      }

      setProgress(95);

      // Create version record (trigger will update file's current_version)
      const { error: versionError } = await supabase
        .from('project_file_versions')
        .insert({
          file_id: fileId,
          version_number: newVersion,
          storage_path: storagePath,
          size_bytes: file.size,
          upload_comment: data.upload_comment,
          uploaded_by: user.id,
        });

      if (versionError) {
        await supabase.storage.from('project-files').remove([storagePath]);
        throw versionError;
      }

      // Update main file record with new storage path and size
      await supabase
        .from('project_files')
        .update({
          storage_path: storagePath,
          size_bytes: file.size,
          mime_type: file.type,
        })
        .eq('id', fileId);

      setProgress(100);

      toast({
        title: 'Nova versão enviada',
        description: `Versão ${newVersion} de ${fileName} salva com sucesso`,
      });

      form.reset();
      setFile(null);
      onOpenChange(false);
      onSuccess?.();
    } catch (error: any) {
      console.error('Version upload error:', error);
      toast({
        title: 'Erro ao enviar versão',
        description: error.message || 'Tente novamente mais tarde',
        variant: 'destructive',
      });
    } finally {
      setUploading(false);
      setProgress(0);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Nova Versão</DialogTitle>
          <DialogDescription>
            Envie uma nova versão de "{fileName}" (atual: v{currentVersion})
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {!file ? (
              <div className="border-2 border-dashed rounded-lg p-8 text-center hover:border-primary/50 transition-colors">
                <input
                  type="file"
                  id="version-file-upload"
                  className="hidden"
                  onChange={handleFileChange}
                  disabled={uploading}
                />
                <label
                  htmlFor="version-file-upload"
                  className="cursor-pointer flex flex-col items-center gap-2"
                >
                  <Upload className="h-10 w-10 text-muted-foreground" />
                  <p className="text-sm font-medium">
                    Selecione a nova versão do arquivo
                  </p>
                </label>
              </div>
            ) : (
              <div className="border rounded-lg p-4">
                <div className="flex items-center gap-3">
                  <FileIcon className="h-10 w-10 text-primary" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{file.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {formatFileSize(file.size)}
                    </p>
                  </div>
                  {!uploading && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={removeFile}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                {uploading && (
                  <div className="mt-3">
                    <Progress value={progress} className="h-2" />
                    <p className="text-xs text-muted-foreground mt-1 text-center">
                      Enviando... {progress}%
                    </p>
                  </div>
                )}
              </div>
            )}

            <FormField
              control={form.control}
              name="upload_comment"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Descrição das alterações</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Descreva o que mudou nesta versão..."
                      className="resize-none"
                      {...field}
                      disabled={uploading}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={uploading}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={!file || uploading}>
                {uploading ? 'Enviando...' : `Salvar v${currentVersion + 1}`}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
