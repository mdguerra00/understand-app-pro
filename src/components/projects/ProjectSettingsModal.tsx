import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { AlertTriangle, Trash2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';

interface ProjectSettingsModalProps {
  projectId: string;
  projectName: string;
  isOwner: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}

export function ProjectSettingsModal({
  projectId,
  projectName,
  isOwner,
  open,
  onOpenChange,
  onDeleted,
}: ProjectSettingsModalProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [confirmName, setConfirmName] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

  const canDelete = confirmName === projectName;

  const handleDelete = async () => {
    if (!canDelete || !user) return;

    setIsDeleting(true);
    try {
      const { error } = await supabase
        .from('projects')
        .update({
          deleted_at: new Date().toISOString(),
          deleted_by: user.id,
        })
        .eq('id', projectId);

      if (error) throw error;

      toast({
        title: 'Projeto excluído',
        description: 'O projeto foi movido para a lixeira',
      });

      setIsDeleteDialogOpen(false);
      onOpenChange(false);
      onDeleted();
    } catch (error: any) {
      toast({
        title: 'Erro ao excluir',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDeleteDialogChange = (open: boolean) => {
    setIsDeleteDialogOpen(open);
    if (!open) {
      setConfirmName('');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Configurações do Projeto</DialogTitle>
          <DialogDescription>
            Gerencie as configurações do projeto
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Future: Project info editing section */}
          <div className="space-y-2">
            <h4 className="text-sm font-medium">Informações do Projeto</h4>
            <p className="text-sm text-muted-foreground">
              A edição de nome e descrição estará disponível em breve.
            </p>
          </div>

          {isOwner && (
            <>
              <Separator />

              {/* Danger Zone */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <h4 className="text-sm font-medium">Zona de Perigo</h4>
                </div>

                <p className="text-sm text-muted-foreground">
                  Ações irreversíveis que afetam permanentemente o projeto.
                </p>

                <AlertDialog open={isDeleteDialogOpen} onOpenChange={handleDeleteDialogChange}>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" className="w-full">
                      <Trash2 className="mr-2 h-4 w-4" />
                      Excluir Projeto
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Excluir Projeto?</AlertDialogTitle>
                      <AlertDialogDescription className="space-y-3">
                        <span className="block">
                          Tem certeza que deseja excluir{' '}
                          <strong className="text-foreground">"{projectName}"</strong>?
                        </span>
                        <span className="block">
                          Esta ação moverá o projeto para a lixeira. Todos os arquivos,
                          tarefas e relatórios serão arquivados.
                        </span>
                      </AlertDialogDescription>
                    </AlertDialogHeader>

                    <div className="space-y-2 py-4">
                      <Label htmlFor="confirm-name">
                        Digite o nome do projeto para confirmar:
                      </Label>
                      <Input
                        id="confirm-name"
                        value={confirmName}
                        onChange={(e) => setConfirmName(e.target.value)}
                        placeholder={projectName}
                        autoComplete="off"
                      />
                    </div>

                    <AlertDialogFooter>
                      <AlertDialogCancel disabled={isDeleting}>
                        Cancelar
                      </AlertDialogCancel>
                      <AlertDialogAction
                        onClick={handleDelete}
                        disabled={!canDelete || isDeleting}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        {isDeleting ? 'Excluindo...' : 'Excluir Permanentemente'}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
