import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  ArrowLeft,
  Calendar,
  Users,
  CheckSquare,
  FileText,
  FolderOpen,
  Settings,
  Plus,
  Bot,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Tables } from '@/integrations/supabase/types';
import { TaskFormModal } from '@/components/tasks/TaskFormModal';
import { TaskDetailModal } from '@/components/tasks/TaskDetailModal';
import { InviteMemberModal } from '@/components/projects/InviteMemberModal';
import { ProjectFilesList } from '@/components/files/ProjectFilesList';
import { ReportsList } from '@/components/reports/ReportsList';
import { ReindexProjectButton } from '@/components/projects/ReindexProjectButton';
import { IndexingStatus } from '@/components/projects/IndexingStatus';
import { ProjectAssistant } from '@/components/projects/ProjectAssistant';

type Project = Tables<'projects'>;
type Task = Tables<'tasks'>;

interface MemberWithProfile {
  id: string;
  user_id: string;
  role_in_project: string;
  full_name: string | null;
  email: string;
  avatar_url: string | null;
}

const statusColors: Record<string, string> = {
  planning: 'bg-muted text-muted-foreground',
  in_progress: 'bg-primary/10 text-primary',
  review: 'bg-warning/10 text-warning',
  completed: 'bg-success/10 text-success',
  archived: 'bg-muted text-muted-foreground',
};

const statusLabels: Record<string, string> = {
  planning: 'Planejamento',
  in_progress: 'Em Andamento',
  review: 'Revisão',
  completed: 'Concluído',
  archived: 'Arquivado',
};

const roleLabels: Record<string, string> = {
  owner: 'Proprietário',
  manager: 'Gerente',
  researcher: 'Pesquisador',
  viewer: 'Visualizador',
};

const taskStatusLabels: Record<string, string> = {
  todo: 'A Fazer',
  in_progress: 'Em Andamento',
  review: 'Revisão',
  done: 'Concluído',
};

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [members, setMembers] = useState<MemberWithProfile[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [isTaskDetailOpen, setIsTaskDetailOpen] = useState(false);
  
  // Tab control for URL navigation
  const [activeTab, setActiveTab] = useState('tasks');
  const [initialFileId, setInitialFileId] = useState<string | null>(null);

  // Handle URL params for task and file navigation (from global search)
  useEffect(() => {
    const tab = searchParams.get('tab');
    const taskId = searchParams.get('task');
    const fileId = searchParams.get('file');

    if (tab === 'files') {
      setActiveTab('files');
      if (fileId) {
        setInitialFileId(fileId);
      }
    }

    if (taskId && tasks.length > 0) {
      const task = tasks.find(t => t.id === taskId);
      if (task) {
        setSelectedTask(task);
        setIsTaskDetailOpen(true);
      }
    }

    // Clear params after processing
    if (taskId || fileId || tab) {
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, tasks, setSearchParams]);

  const fetchProject = async () => {
    if (!id) return;

    try {
      // Fetch project
      const { data: projectData, error: projectError } = await supabase
        .from('projects')
        .select('*')
        .eq('id', id)
        .single();

      if (projectError) throw projectError;
      setProject(projectData);

      // Fetch members with their profiles
      const { data: membersData } = await supabase
        .from('project_members')
        .select('id, user_id, role_in_project')
        .eq('project_id', id);

      if (membersData && membersData.length > 0) {
        const userIds = membersData.map((m) => m.user_id);
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, full_name, email, avatar_url')
          .in('id', userIds);

        const membersWithProfiles: MemberWithProfile[] = membersData.map((member) => {
          const profile = profiles?.find((p) => p.id === member.user_id);
          return {
            id: member.id,
            user_id: member.user_id,
            role_in_project: member.role_in_project,
            full_name: profile?.full_name || null,
            email: profile?.email || '',
            avatar_url: profile?.avatar_url || null,
          };
        });

        setMembers(membersWithProfiles);
      } else {
        setMembers([]);
      }

      // Fetch tasks
      const { data: tasksData } = await supabase
        .from('tasks')
        .select('*')
        .eq('project_id', id)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });

      setTasks(tasksData || []);
    } catch (error) {
      console.error('Error fetching project:', error);
      navigate('/projects');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProject();
  }, [id]);

  const refreshTasks = async () => {
    if (!id) return;
    const { data: tasksData } = await supabase
      .from('tasks')
      .select('*')
      .eq('project_id', id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });
    setTasks(tasksData || []);
  };

  const refreshMembers = async () => {
    if (!id) return;
    const { data: membersData } = await supabase
      .from('project_members')
      .select('id, user_id, role_in_project')
      .eq('project_id', id);

    if (membersData && membersData.length > 0) {
      const userIds = membersData.map((m) => m.user_id);
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name, email, avatar_url')
        .in('id', userIds);

      const membersWithProfiles: MemberWithProfile[] = membersData.map((member) => {
        const profile = profiles?.find((p) => p.id === member.user_id);
        return {
          id: member.id,
          user_id: member.user_id,
          role_in_project: member.role_in_project,
          full_name: profile?.full_name || null,
          email: profile?.email || '',
          avatar_url: profile?.avatar_url || null,
        };
      });

      setMembers(membersWithProfiles);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-10 w-10" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Projeto não encontrado</p>
        <Button asChild className="mt-4">
          <Link to="/projects">Voltar para Projetos</Link>
        </Button>
      </div>
    );
  }

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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex items-start gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link to="/projects">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight">{project.name}</h1>
              <Badge className={statusColors[project.status]} variant="secondary">
                {statusLabels[project.status]}
              </Badge>
            </div>
            {project.category && (
              <Badge variant="outline" className="mt-2">
                {project.category}
              </Badge>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <IndexingStatus projectId={project.id} />
          <ReindexProjectButton projectId={project.id} projectName={project.name} />
          <Button variant="outline" size="sm">
            <Settings className="mr-2 h-4 w-4" />
            Configurações
          </Button>
        </div>
      </div>

      {/* Project Info */}
      <div className="grid gap-6 md:grid-cols-3">
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Sobre o Projeto</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {project.description && (
              <div>
                <h4 className="text-sm font-medium text-muted-foreground mb-1">Descrição</h4>
                <p className="text-sm">{project.description}</p>
              </div>
            )}
            {project.objectives && (
              <div>
                <h4 className="text-sm font-medium text-muted-foreground mb-1">Objetivos</h4>
                <p className="text-sm">{project.objectives}</p>
              </div>
            )}
            <div className="flex flex-wrap gap-4 pt-2">
              {project.start_date && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Calendar className="h-4 w-4" />
                  Início: {new Date(project.start_date).toLocaleDateString('pt-BR')}
                </div>
              )}
              {project.end_date && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Calendar className="h-4 w-4" />
                  Término: {new Date(project.end_date).toLocaleDateString('pt-BR')}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Users className="h-4 w-4" />
                Equipe
              </span>
              <Button variant="ghost" size="sm" onClick={() => setIsInviteModalOpen(true)}>
                <Plus className="h-4 w-4" />
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {members.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-2">
                  Nenhum membro ainda
                </p>
              ) : (
                members.map((member) => (
                  <div key={member.id} className="flex items-center gap-3">
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={member.avatar_url || undefined} />
                      <AvatarFallback className="text-xs">
                        {getInitials(member.full_name, member.email)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {member.full_name || member.email}
                      </p>
                      <p className="text-xs text-muted-foreground capitalize">
                        {roleLabels[member.role_in_project] || member.role_in_project}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="tasks" className="gap-2">
            <CheckSquare className="h-4 w-4" />
            Tarefas
          </TabsTrigger>
          <TabsTrigger value="files" className="gap-2">
            <FolderOpen className="h-4 w-4" />
            Arquivos
          </TabsTrigger>
          <TabsTrigger value="reports" className="gap-2">
            <FileText className="h-4 w-4" />
            Relatórios
          </TabsTrigger>
          <TabsTrigger value="assistant" className="gap-2">
            <Bot className="h-4 w-4" />
            Assistente IA
          </TabsTrigger>
        </TabsList>

        <TabsContent value="tasks" className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {tasks.length} tarefa{tasks.length !== 1 ? 's' : ''}
            </p>
            <Button size="sm" onClick={() => setIsTaskModalOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Nova Tarefa
            </Button>
          </div>

          {tasks.length === 0 ? (
            <Card className="border-dashed">
              <CardHeader className="text-center">
                <CardTitle className="text-base">Nenhuma tarefa</CardTitle>
                <CardDescription>
                  Crie a primeira tarefa para este projeto
                </CardDescription>
              </CardHeader>
            </Card>
          ) : (
            <div className="space-y-2">
              {tasks.map((task) => (
                <Card 
                  key={task.id} 
                  className="hover:border-primary/50 transition-colors cursor-pointer"
                  onClick={() => {
                    setSelectedTask(task);
                    setIsTaskDetailOpen(true);
                  }}
                >
                  <CardContent className="flex items-center justify-between py-4">
                    <div className="flex items-center gap-3">
                      <CheckSquare className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="font-medium">{task.title}</p>
                        {task.description && (
                          <p className="text-sm text-muted-foreground line-clamp-1">
                            {task.description}
                          </p>
                        )}
                      </div>
                    </div>
                    <Badge variant="outline">{taskStatusLabels[task.status]}</Badge>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="files">
          <ProjectFilesList 
            projectId={id!} 
            initialFileId={initialFileId}
            onFileOpened={() => setInitialFileId(null)}
          />
        </TabsContent>

        <TabsContent value="reports">
          <ReportsList projectId={id!} />
        </TabsContent>

        <TabsContent value="assistant">
          <ProjectAssistant projectId={id!} projectName={project.name} />
        </TabsContent>
      </Tabs>

      {/* Modals */}
      <TaskFormModal
        projectId={id!}
        open={isTaskModalOpen}
        onOpenChange={setIsTaskModalOpen}
        onSuccess={refreshTasks}
      />
      <TaskDetailModal
        task={selectedTask}
        projectId={id!}
        open={isTaskDetailOpen}
        onOpenChange={setIsTaskDetailOpen}
        onUpdate={refreshTasks}
      />
      <InviteMemberModal
        projectId={id!}
        open={isInviteModalOpen}
        onOpenChange={setIsInviteModalOpen}
        onSuccess={refreshMembers}
      />
    </div>
  );
}
