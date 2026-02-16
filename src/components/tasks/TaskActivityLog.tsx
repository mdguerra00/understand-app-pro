import { useState, useEffect } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { supabase } from '@/integrations/supabase/client';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ArrowRight } from 'lucide-react';

interface Activity {
  id: string;
  action: string;
  field_changed: string | null;
  old_value: string | null;
  new_value: string | null;
  created_at: string;
  user_id: string;
  author?: {
    full_name: string | null;
    email: string;
    avatar_url: string | null;
  };
}

interface TaskActivityLogProps {
  taskId: string;
}

export function TaskActivityLog({ taskId }: TaskActivityLogProps) {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetch = async () => {
      try {
        const { data, error } = await supabase
          .from('task_activity_log')
          .select('*')
          .eq('task_id', taskId)
          .order('created_at', { ascending: false })
          .limit(50);

        if (error) throw error;
        if (!data || data.length === 0) {
          setActivities([]);
          setLoading(false);
          return;
        }

        const userIds = [...new Set(data.map(a => a.user_id))];
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, full_name, email, avatar_url')
          .in('id', userIds);

        setActivities(data.map(a => ({
          ...a,
          author: profiles?.find(p => p.id === a.user_id) ? {
            full_name: profiles.find(p => p.id === a.user_id)!.full_name,
            email: profiles.find(p => p.id === a.user_id)!.email,
            avatar_url: profiles.find(p => p.id === a.user_id)!.avatar_url,
          } : undefined,
        })));
      } catch (err) {
        console.error('Error fetching activity:', err);
      } finally {
        setLoading(false);
      }
    };
    fetch();
  }, [taskId]);

  const getInitials = (name?: string | null, email?: string) => {
    if (name) return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
    return email?.charAt(0).toUpperCase() ?? '?';
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="flex gap-3">
            <Skeleton className="h-6 w-6 rounded-full" />
            <div className="flex-1 space-y-1">
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-3 w-48" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (activities.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-6">
        Nenhuma atividade registrada
      </p>
    );
  }

  return (
    <div className="space-y-3 max-h-[400px] overflow-y-auto scrollbar-thin">
      {activities.map(activity => (
        <div key={activity.id} className="flex gap-3 text-sm">
          <Avatar className="h-6 w-6 mt-0.5">
            <AvatarImage src={activity.author?.avatar_url || undefined} />
            <AvatarFallback className="text-[8px]">
              {getInitials(activity.author?.full_name, activity.author?.email)}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1 flex-wrap">
              <span className="font-medium text-xs">
                {activity.author?.full_name || activity.author?.email || 'Usuário'}
              </span>
              <span className="text-xs text-muted-foreground">
                alterou {activity.field_changed || activity.action}
              </span>
            </div>
            {activity.old_value && activity.new_value && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
                <span className="line-through">{activity.old_value}</span>
                <ArrowRight className="h-2.5 w-2.5" />
                <span className="font-medium text-foreground">{activity.new_value}</span>
              </div>
            )}
            <span className="text-[10px] text-muted-foreground">
              {formatDistanceToNow(new Date(activity.created_at), { addSuffix: true, locale: ptBR })}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
