import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useAdminRole } from '@/hooks/useAdminRole';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, Shield, ShieldAlert, Users, ScrollText, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { CreateUserModal } from '@/components/admin/CreateUserModal';

interface UserWithRole {
  id: string;
  email: string;
  full_name: string | null;
  created_at: string;
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

  useEffect(() => {
    if (isAdmin) {
      fetchUsers();
      fetchAuditLogs();
    }
  }, [isAdmin]);

  const fetchUsers = async () => {
    setLoadingUsers(true);
    const [profilesRes, rolesRes] = await Promise.all([
      supabase.from('profiles').select('id, email, full_name, created_at'),
      supabase.from('user_roles').select('user_id, role'),
    ]);

    if (profilesRes.data) {
      const rolesMap = new Map(
        (rolesRes.data || []).map((r) => [r.user_id, r.role as 'admin' | 'user'])
      );
      const merged: UserWithRole[] = profilesRes.data.map((p) => ({
        ...p,
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
      .limit(100);
    setAuditLogs(data || []);
    setLoadingAudit(false);
  };

  const handleRoleChange = async (userId: string, newRole: 'admin' | 'user') => {
    if (userId === user?.id) {
      toast.error('Você não pode alterar sua própria role.');
      return;
    }
    setUpdatingRole(userId);

    const currentUser = users.find((u) => u.id === userId);
    const currentRole = currentUser?.role;

    if (currentRole === newRole) {
      setUpdatingRole(null);
      return;
    }

    if (currentRole === 'user' && newRole === 'admin') {
      // Insert new admin role
      const { error } = await supabase
        .from('user_roles')
        .insert({ user_id: userId, role: 'admin' });
      if (error) {
        toast.error('Erro ao atribuir role admin.');
      } else {
        toast.success('Usuário promovido a admin.');
        fetchUsers();
      }
    } else if (currentRole === 'admin' && newRole === 'user') {
      // Delete admin role row
      const { error } = await supabase
        .from('user_roles')
        .delete()
        .eq('user_id', userId)
        .eq('role', 'admin');
      if (error) {
        toast.error('Erro ao remover role admin.');
      } else {
        toast.success('Usuário rebaixado para user.');
        fetchUsers();
      }
    }

    setUpdatingRole(null);
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

  const actionLabel: Record<string, string> = {
    INSERT: 'Criação',
    UPDATE: 'Atualização',
    DELETE: 'Exclusão',
  };

  const tableLabel: Record<string, string> = {
    projects: 'Projetos',
    tasks: 'Tarefas',
    reports: 'Relatórios',
    project_files: 'Arquivos',
    knowledge_items: 'Conhecimento',
    project_members: 'Membros',
    user_roles: 'Roles',
    profiles: 'Perfis',
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Shield className="h-8 w-8 text-primary" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Administração</h1>
          <p className="text-muted-foreground">Gerencie usuários e acompanhe atividades do sistema.</p>
        </div>
      </div>

      <Tabs defaultValue="users">
        <TabsList>
          <TabsTrigger value="users" className="gap-2">
            <Users className="h-4 w-4" />
            Usuários
          </TabsTrigger>
          <TabsTrigger value="audit" className="gap-2">
            <ScrollText className="h-4 w-4" />
            Auditoria
          </TabsTrigger>
        </TabsList>

        <TabsContent value="users">
          <div className="mb-4 flex justify-end">
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
                    <TableHead>Role Global</TableHead>
                    <TableHead>Cadastro</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell className="font-medium">{u.full_name || '—'}</TableCell>
                      <TableCell>{u.email}</TableCell>
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
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="audit">
          {loadingAudit ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : auditLogs.length === 0 ? (
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
                  {auditLogs.map((log) => (
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
      </Tabs>

      <CreateUserModal
        open={createUserOpen}
        onOpenChange={setCreateUserOpen}
        onUserCreated={fetchUsers}
      />
    </div>
  );
}
