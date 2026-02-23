import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useAdminRole } from '@/hooks/useAdminRole';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
import { Loader2, Shield, ShieldAlert, Users, ScrollText, UserPlus, MoreHorizontal, KeyRound, FolderKanban, UserX, UserCheck, Search, BookText } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { CreateUserModal } from '@/components/admin/CreateUserModal';
import { UserProjectAccessModal } from '@/components/admin/UserProjectAccessModal';
import { AliasApprovalTab } from '@/components/admin/AliasApprovalTab';

interface UserWithRole {
  id: string;
  email: string;
  full_name: string | null;
  job_title: string | null;
  department: string | null;
  phone: string | null;
  created_at: string;
  status: string;
  role: 'admin' | 'user';
}

interface AuditEntry {
  id: string;
  table_name: string;
  action: string;
  record_id: string;
  user_id: string | null;
  created_at: string;
  changed_fields: string[] | null;
}

export default function Admin() {
  const { user } = useAuth();
  const { isAdmin, loading: adminLoading } = useAdminRole();
  const [users, setUsers] = useState<UserWithRole[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditEntry[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [loadingAudit, setLoadingAudit] = useState(true);
  const [updatingRole, setUpdatingRole] = useState<string | null>(null);
  const [createUserOpen, setCreateUserOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [auditSearch, setAuditSearch] = useState('');

  // Project access modal
  const [accessModalOpen, setAccessModalOpen] = useState(false);
  const [accessUserId, setAccessUserId] = useState('');
  const [accessUserName, setAccessUserName] = useState('');

  // Status toggle confirmation
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const [statusToggleUser, setStatusToggleUser] = useState<UserWithRole | null>(null);
  const [togglingStatus, setTogglingStatus] = useState(false);

  // Reset password
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [resetUser, setResetUser] = useState<UserWithRole | null>(null);
  const [resettingPassword, setResettingPassword] = useState(false);

  // Edit user
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserWithRole | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editForm, setEditForm] = useState({
    email: '',
    full_name: '',
    job_title: '',
    department: '',
    phone: '',
  });

  // Delete user
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteUser, setDeleteUser] = useState<UserWithRole | null>(null);
  const [deletingUser, setDeletingUser] = useState(false);

  useEffect(() => {
    if (isAdmin) {
      fetchUsers();
      fetchAuditLogs();
    }
  }, [isAdmin]);

  const fetchUsers = async () => {
    setLoadingUsers(true);
    const [profilesRes, rolesRes] = await Promise.all([
      supabase.from('profiles').select('id, email, full_name, job_title, department, phone, created_at, status'),
      supabase.from('user_roles').select('user_id, role'),
    ]);

    if (profilesRes.data) {
      const rolesMap = new Map(
        (rolesRes.data || []).map((r) => [r.user_id, r.role as 'admin' | 'user'])
      );
      const merged: UserWithRole[] = profilesRes.data.map((p) => ({
        ...p,
        status: (p as any).status || 'active',
        role: rolesMap.get(p.id) || 'user',
      }));
      setUsers(merged);
    }
    setLoadingUsers(false);
  };

  const fetchAuditLogs = async () => {
    setLoadingAudit(true);
    const { data } = await supabase
      .from('audit_log')
      .select('id, table_name, action, record_id, user_id, created_at, changed_fields')
      .order('created_at', { ascending: false })
      .limit(200);
    setAuditLogs(data || []);
    setLoadingAudit(false);
  };


  const isEdgeFunctionRequestError = (message?: string) => {
    if (!message) return false;
    const normalized = message.toLowerCase();
    return normalized.includes('failed to send a request to the edge function');
  };

  const handleRoleChange = async (userId: string, newRole: 'admin' | 'user') => {
    if (userId === user?.id) {
      toast.error('Você não pode alterar sua própria role.');
      return;
    }
    setUpdatingRole(userId);
    const currentUser = users.find((u) => u.id === userId);
    const currentRole = currentUser?.role;

    if (currentRole === newRole) { setUpdatingRole(null); return; }

    if (currentRole === 'user' && newRole === 'admin') {
      const { error } = await supabase.from('user_roles').insert({ user_id: userId, role: 'admin' });
      if (error) toast.error('Erro ao atribuir role admin.');
      else { toast.success('Usuário promovido a admin.'); fetchUsers(); }
    } else if (currentRole === 'admin' && newRole === 'user') {
      const { error } = await supabase.from('user_roles').delete().eq('user_id', userId).eq('role', 'admin');
      if (error) toast.error('Erro ao remover role admin.');
      else { toast.success('Usuário rebaixado para user.'); fetchUsers(); }
    }
    setUpdatingRole(null);
  };

  const handleStatusToggle = async () => {
    if (!statusToggleUser) return;
    setTogglingStatus(true);

    const targetUserId = statusToggleUser.id;
    const newStatus = statusToggleUser.status === 'active' ? 'disabled' : 'active';

    const { data, error } = await supabase.functions.invoke('toggle-user-status', {
      body: { user_id: targetUserId, status: newStatus },
    });

    await fetchUsers();

    if (error || (data as any)?.error) {
      toast.error((data as any)?.error || error?.message || 'Erro ao alterar status do usuário.');
    } else {
      toast.success(newStatus === 'active' ? 'Usuário reativado.' : 'Usuário desativado.');
    }

    setTogglingStatus(false);
    setStatusDialogOpen(false);
    setStatusToggleUser(null);
  };

  const handleResetPassword = async () => {
    if (!resetUser) return;
    setResettingPassword(true);
    const { error } = await supabase.auth.resetPasswordForEmail(resetUser.email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) {
      toast.error('Erro ao enviar email de recuperação.');
    } else {
      toast.success(`Email de recuperação enviado para ${resetUser.email}`);
    }
    setResettingPassword(false);
    setResetDialogOpen(false);
    setResetUser(null);
  };

  const openProjectAccess = (u: UserWithRole) => {
    setAccessUserId(u.id);
    setAccessUserName(u.full_name || u.email);
    setAccessModalOpen(true);
  };


  const openEditUser = (u: UserWithRole) => {
    setEditingUser(u);
    setEditForm({
      email: u.email,
      full_name: u.full_name || '',
      job_title: u.job_title || '',
      department: u.department || '',
      phone: u.phone || '',
    });
    setEditDialogOpen(true);
  };

  const handleSaveUserEdit = async () => {
    if (!editingUser) return;
    setSavingEdit(true);

    const { data, error } = await supabase.functions.invoke('manage-user', {
      body: {
        action: 'update',
        user_id: editingUser.id,
        updates: {
          email: editForm.email.trim(),
          full_name: editForm.full_name.trim() || null,
          job_title: editForm.job_title.trim() || null,
          department: editForm.department.trim() || null,
          phone: editForm.phone.trim() || null,
        },
      },
    });

    if (error || (data as any)?.error) {
      toast.error((data as any)?.error || error?.message || 'Erro ao atualizar usuário.');
      setSavingEdit(false);
      return;
    }

    toast.success('Usuário atualizado com sucesso.');
    await fetchUsers();
    setSavingEdit(false);
    setEditDialogOpen(false);
    setEditingUser(null);
  };

  const handleDeleteUser = async () => {
    if (!deleteUser) return;
    setDeletingUser(true);

    const { data, error } = await supabase.functions.invoke('manage-user', {
      body: { action: 'delete', user_id: deleteUser.id },
    });

    if (error || (data as any)?.error) {
      toast.error((data as any)?.error || error?.message || 'Erro ao deletar usuário.');
      setDeletingUser(false);
      return;
    }

    toast.success('Usuário deletado com sucesso.');
    await fetchUsers();
    setDeletingUser(false);
    setDeleteDialogOpen(false);
    setDeleteUser(null);
  };

  if (adminLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-muted-foreground">
        <ShieldAlert className="h-16 w-16" />
        <h2 className="text-xl font-semibold">Acesso negado</h2>
        <p>Você não tem permissão para acessar o painel de administração.</p>
      </div>
    );
  }

  const filteredUsers = users.filter(u =>
    !searchQuery ||
    u.full_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    u.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredAuditLogs = auditLogs.filter(log =>
    !auditSearch ||
    log.table_name.toLowerCase().includes(auditSearch.toLowerCase()) ||
    log.action.toLowerCase().includes(auditSearch.toLowerCase()) ||
    log.changed_fields?.some(f => f.toLowerCase().includes(auditSearch.toLowerCase()))
  );

  const actionLabel: Record<string, string> = { INSERT: 'Criação', UPDATE: 'Atualização', DELETE: 'Exclusão' };
  const tableLabel: Record<string, string> = {
    projects: 'Projetos', tasks: 'Tarefas', reports: 'Relatórios',
    project_files: 'Arquivos', knowledge_items: 'Conhecimento',
    project_members: 'Membros', user_roles: 'Roles', profiles: 'Perfis',
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Shield className="h-8 w-8 text-primary" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Administração</h1>
          <p className="text-muted-foreground">Gerencie usuários, permissões e acompanhe atividades.</p>
        </div>
      </div>

      <Tabs defaultValue="users">
        <TabsList>
          <TabsTrigger value="users" className="gap-2"><Users className="h-4 w-4" />Usuários</TabsTrigger>
          <TabsTrigger value="audit" className="gap-2"><ScrollText className="h-4 w-4" />Auditoria</TabsTrigger>
          <TabsTrigger value="aliases" className="gap-2"><BookText className="h-4 w-4" />Aliases</TabsTrigger>
        </TabsList>

        <TabsContent value="users">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar por nome ou email..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <Button onClick={() => setCreateUserOpen(true)} className="gap-2">
              <UserPlus className="h-4 w-4" />
              Novo Usuário
            </Button>
          </div>
          {loadingUsers ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Role Global</TableHead>
                    <TableHead>Cadastro</TableHead>
                    <TableHead className="w-[60px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredUsers.map((u) => (
                    <TableRow key={u.id} className={u.status === 'disabled' ? 'opacity-60' : ''}>
                      <TableCell className="font-medium">{u.full_name || '—'}</TableCell>
                      <TableCell>{u.email}</TableCell>
                      <TableCell>
                        <Badge variant={u.status === 'active' ? 'default' : 'destructive'}>
                          {u.status === 'active' ? 'Ativo' : 'Desativado'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {u.id === user?.id ? (
                          <Badge>admin</Badge>
                        ) : (
                          <Select
                            value={u.role}
                            onValueChange={(val) => handleRoleChange(u.id, val as 'admin' | 'user')}
                            disabled={updatingRole === u.id}
                          >
                            <SelectTrigger className="w-[120px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="user">user</SelectItem>
                              <SelectItem value="admin">admin</SelectItem>
                            </SelectContent>
                          </Select>
                        )}
                      </TableCell>
                      <TableCell>
                        {format(new Date(u.created_at), "dd/MM/yyyy", { locale: ptBR })}
                      </TableCell>
                      <TableCell>
                        {u.id !== user?.id && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => openProjectAccess(u)}>
                                <FolderKanban className="mr-2 h-4 w-4" />
                                Gerenciar Projetos
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => openEditUser(u)}>
                                Editar usuário
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => { setResetUser(u); setResetDialogOpen(true); }}>
                                <KeyRound className="mr-2 h-4 w-4" />
                                Resetar Senha
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => { setStatusToggleUser(u); setStatusDialogOpen(true); }}
                                className={u.status === 'active' ? 'text-destructive focus:text-destructive' : ''}
                              >
                                {u.status === 'active' ? (
                                  <><UserX className="mr-2 h-4 w-4" />Desativar</>
                                ) : (
                                  <><UserCheck className="mr-2 h-4 w-4" />Reativar</>
                                )}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => { setDeleteUser(u); setDeleteDialogOpen(true); }}
                                className="text-destructive focus:text-destructive"
                              >
                                Deletar usuário
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="audit">
          <div className="mb-4">
            <div className="relative max-w-sm">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar na auditoria..."
                value={auditSearch}
                onChange={(e) => setAuditSearch(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>
          {loadingAudit ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filteredAuditLogs.length === 0 ? (
            <p className="py-12 text-center text-muted-foreground">Nenhum registro de auditoria encontrado.</p>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Tabela</TableHead>
                    <TableHead>Ação</TableHead>
                    <TableHead>Campos alterados</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAuditLogs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="whitespace-nowrap">
                        {format(new Date(log.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                      </TableCell>
                      <TableCell>{tableLabel[log.table_name] || log.table_name}</TableCell>
                      <TableCell>
                        <Badge variant={log.action === 'DELETE' ? 'destructive' : 'secondary'}>
                          {actionLabel[log.action] || log.action}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs">
                        {log.changed_fields?.join(', ') || '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="aliases">
          <AliasApprovalTab />
        </TabsContent>
      </Tabs>

      <CreateUserModal open={createUserOpen} onOpenChange={setCreateUserOpen} onUserCreated={fetchUsers} />

      <UserProjectAccessModal
        open={accessModalOpen}
        onOpenChange={setAccessModalOpen}
        userId={accessUserId}
        userName={accessUserName}
        onUpdated={fetchUsers}
      />

      {/* Status Toggle Dialog */}
      <AlertDialog open={statusDialogOpen} onOpenChange={setStatusDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {statusToggleUser?.status === 'active' ? 'Desativar usuário' : 'Reativar usuário'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {statusToggleUser?.status === 'active'
                ? `Tem certeza que deseja desativar "${statusToggleUser?.full_name || statusToggleUser?.email}"? O usuário não poderá mais acessar o sistema.`
                : `Tem certeza que deseja reativar "${statusToggleUser?.full_name || statusToggleUser?.email}"?`
              }
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={togglingStatus}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleStatusToggle}
              disabled={togglingStatus}
              className={statusToggleUser?.status === 'active' ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : ''}
            >
              {togglingStatus && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {statusToggleUser?.status === 'active' ? 'Desativar' : 'Reativar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reset Password Dialog */}
      <AlertDialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Resetar senha</AlertDialogTitle>
            <AlertDialogDescription>
              Um email de recuperação de senha será enviado para {resetUser?.email}. O usuário poderá criar uma nova senha através do link recebido.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resettingPassword}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleResetPassword} disabled={resettingPassword}>
              {resettingPassword && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Enviar Email
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>


      <AlertDialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Editar usuário</AlertDialogTitle>
            <AlertDialogDescription>
              Atualize as informações do usuário selecionado.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid gap-1.5">
              <Label htmlFor="edit-email">Email</Label>
              <Input id="edit-email" value={editForm.email} onChange={(e) => setEditForm((prev) => ({ ...prev, email: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="edit-full-name">Nome completo</Label>
              <Input id="edit-full-name" value={editForm.full_name} onChange={(e) => setEditForm((prev) => ({ ...prev, full_name: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="edit-job-title">Cargo</Label>
              <Input id="edit-job-title" value={editForm.job_title} onChange={(e) => setEditForm((prev) => ({ ...prev, job_title: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="edit-department">Departamento</Label>
              <Input id="edit-department" value={editForm.department} onChange={(e) => setEditForm((prev) => ({ ...prev, department: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="edit-phone">Telefone</Label>
              <Input id="edit-phone" value={editForm.phone} onChange={(e) => setEditForm((prev) => ({ ...prev, phone: e.target.value }))} />
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={savingEdit}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleSaveUserEdit} disabled={savingEdit || !editForm.email.trim()}>
              {savingEdit && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Salvar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deletar usuário</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja deletar "{deleteUser?.full_name || deleteUser?.email}"? Esta ação remove permanentemente a conta e não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingUser}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteUser}
              disabled={deletingUser}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletingUser && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Deletar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}
