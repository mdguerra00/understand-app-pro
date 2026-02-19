import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  FolderKanban,
  CheckSquare,
  FileText,
  Clock,
  Plus,
  ArrowRight,
  TrendingUp,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

interface DashboardStats {
  totalProjects: number;
  activeProjects: number;
  totalTasks: number;
  pendingTasks: number;
  myTasks: number;
}

const isActiveProjectStatus = (status: string) => !['completed', 'archived'].includes(status);

export default function Dashboard() {
  const { user } = useAuth();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchStats() {
      if (!user) return;

      try {
        // Buscar projetos do usuário
        const { data: projects } = await supabase
          .from('projects')
          .select('id, status')
          .is('deleted_at', null);

        // Buscar tarefas
        const { data: tasks } = await supabase
          .from('tasks')
          .select('id, status, assigned_to, project_id')
          .is('deleted_at', null);

        const totalProjects = projects?.length || 0;
        const activeProjectsByStatus = projects?.filter((project) => isActiveProjectStatus(project.status)).length || 0;
        const activeProjectsFromMyTasks = new Set(
          (tasks || [])
            .filter((task) => task.assigned_to === user.id && task.project_id)
            .map((task) => task.project_id)
        ).size;
        const activeProjects = Math.max(activeProjectsByStatus, activeProjectsFromMyTasks);
        const totalTasks = tasks?.length || 0;
        const pendingTasks = tasks?.filter(t => t.status === 'todo' || t.status === 'in_progress').length || 0;
        const myTasks = tasks?.filter(t => t.assigned_to === user.id && (t.status === 'todo' || t.status === 'in_progress')).length || 0;

        setStats({
          totalProjects,
          activeProjects,
          totalTasks,
          pendingTasks,
          myTasks,
        });
      } catch (error) {
        console.error('Error fetching dashboard stats:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchStats();
  }, [user]);

  const userName = user?.user_metadata?.full_name?.split(' ')[0] || 'Usuário';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Olá, {userName}! 👋
          </h1>
          <p className="text-muted-foreground">
            Aqui está um resumo do seu dia na Smart Dent.
          </p>
        </div>
        <Button asChild>
          <Link to="/projects/new">
            <Plus className="mr-2 h-4 w-4" />
            Novo Projeto
          </Link>
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Projetos Ativos</CardTitle>
            <FolderKanban className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <>
                <div className="text-2xl font-bold">{stats?.activeProjects}</div>
                <p className="text-xs text-muted-foreground">
                  de {stats?.totalProjects} projetos
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Minhas Tarefas</CardTitle>
            <CheckSquare className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <>
                <div className="text-2xl font-bold">{stats?.myTasks}</div>
                <p className="text-xs text-muted-foreground">pendentes para você</p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Tarefas Pendentes</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <>
                <div className="text-2xl font-bold">{stats?.pendingTasks}</div>
                <p className="text-xs text-muted-foreground">
                  de {stats?.totalTasks} tarefas
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Progresso</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <>
                <div className="text-2xl font-bold">
                  {stats?.totalTasks
                    ? Math.round(((stats.totalTasks - stats.pendingTasks) / stats.totalTasks) * 100)
                    : 0}%
                </div>
                <p className="text-xs text-muted-foreground">tarefas concluídas</p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card className="hover:border-primary/50 transition-colors">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FolderKanban className="h-5 w-5 text-primary" />
              Projetos
            </CardTitle>
            <CardDescription>
              Gerencie seus projetos de P&D
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" className="w-full" asChild>
              <Link to="/projects">
                Ver Projetos
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card className="hover:border-primary/50 transition-colors">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckSquare className="h-5 w-5 text-primary" />
              Tarefas
            </CardTitle>
            <CardDescription>
              Acompanhe suas atividades
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" className="w-full" asChild>
              <Link to="/tasks">
                Ver Tarefas
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card className="hover:border-primary/50 transition-colors">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" />
              Relatórios
            </CardTitle>
            <CardDescription>
              Documente seus resultados
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" className="w-full" asChild>
              <Link to="/reports">
                Ver Relatórios
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Welcome Card for new users */}
      {stats && stats.totalProjects === 0 && (
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle>Comece sua jornada! 🚀</CardTitle>
            <CardDescription>
              Você ainda não tem projetos. Crie seu primeiro projeto de P&D para começar a gerenciar suas pesquisas.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link to="/projects/new">
                <Plus className="mr-2 h-4 w-4" />
                Criar Primeiro Projeto
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
