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
import { Input } from '@/components/ui/input';
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
  description: z.string().optional(),
});

type FormData = z.infer<typeof formSchema>;

interface FileUploadModalProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function FileUploadModal({
  projectId,
  open,
  onOpenChange,
  onSuccess,
}: FileUploadModalProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      description: '',
    },
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      // 50MB limit
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
      // Generate unique path: project_id/timestamp_filename
      const timestamp = Date.now();
      const sanitizedName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
      const storagePath = `${projectId}/${timestamp}_${sanitizedName}`;

      // Debug: Log file info
      console.log('Upload debug:', {
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
        storagePath,
        isBlob: file instanceof Blob,
      });

      // Simulate progress for better UX
      const progressInterval = setInterval(() => {
        setProgress((prev) => Math.min(prev + 10, 90));
      }, 200);

      // Read file as ArrayBuffer to ensure content is properly sent
      const arrayBuffer = await file.arrayBuffer();
      const fileBlob = new Blob([arrayBuffer], { type: file.type });

      console.log('Blob created:', {
        blobSize: fileBlob.size,
        blobType: fileBlob.type,
      });

      // Upload to storage
      const { error: storageError } = await supabase.storage
        .from('project-files')
        .upload(storagePath, fileBlob, {
          contentType: file.type,
          upsert: false,
        });

      clearInterval(progressInterval);

      if (storageError) {
        throw storageError;
      }

      setProgress(95);

      // Create metadata record
      const { data: fileRecord, error: dbError } = await supabase
        .from('project_files')
        .insert({
          project_id: projectId,
          name: file.name,
          description: data.description || null,
          storage_path: storagePath,
          mime_type: file.type,
          size_bytes: file.size,
          uploaded_by: user.id,
        })
        .select()
        .single();

      if (dbError) {
        // Rollback storage upload
        await supabase.storage.from('project-files').remove([storagePath]);
        throw dbError;
      }

      // Create first version record
      await supabase.from('project_file_versions').insert({
        file_id: fileRecord.id,
        version_number: 1,
        storage_path: storagePath,
        size_bytes: file.size,
        upload_comment: 'Versão inicial',
        uploaded_by: user.id,
      });

      // Create extraction job and trigger AI extraction
      const fileHash = `${file.name}-${file.size}-${Date.now()}`;
      const { data: jobData } = await supabase
        .from('extraction_jobs')
        .insert({
          file_id: fileRecord.id,
          project_id: projectId,
          file_hash: fileHash,
          created_by: user.id,
        })
        .select()
        .single();

      // Trigger extraction asynchronously (don't wait)
      if (jobData) {
        supabase.functions.invoke('extract-knowledge', {
          body: { file_id: fileRecord.id, job_id: jobData.id },
        }).catch(console.error);
      }

      setProgress(100);

      toast({
        title: 'Arquivo enviado',
        description: `${file.name} foi enviado com sucesso`,
      });

      form.reset();
      setFile(null);
      onOpenChange(false);
      onSuccess?.();
    } catch (error: any) {
      console.error('Upload error:', error);
      toast({
        title: 'Erro ao enviar arquivo',
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
          <DialogTitle>Upload de Arquivo</DialogTitle>
          <DialogDescription>
            Envie um arquivo para o projeto. Máximo 50MB.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {/* File Drop Zone */}
            {!file ? (
              <div className="border-2 border-dashed rounded-lg p-8 text-center hover:border-primary/50 transition-colors">
                <input
                  type="file"
                  id="file-upload"
                  className="hidden"
                  onChange={handleFileChange}
                  disabled={uploading}
                />
                <label
                  htmlFor="file-upload"
                  className="cursor-pointer flex flex-col items-center gap-2"
                >
                  <Upload className="h-10 w-10 text-muted-foreground" />
                  <p className="text-sm font-medium">
                    Clique para selecionar um arquivo
                  </p>
                  <p className="text-xs text-muted-foreground">
                    ou arraste e solte aqui
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
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Descrição (opcional)</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Descreva o conteúdo do arquivo..."
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
                {uploading ? 'Enviando...' : 'Enviar Arquivo'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
