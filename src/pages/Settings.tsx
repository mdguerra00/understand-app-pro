import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, Save } from 'lucide-react';

export default function Settings() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [isFetching, setIsFetching] = useState(true);

  const [formData, setFormData] = useState({
    full_name: '',
    job_title: '',
    department: '',
    phone: '',
    avatar_url: '',
  });

  // Fetch profile data from database
  useEffect(() => {
    async function fetchProfile() {
      if (!user) return;

      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('full_name, job_title, department, phone, avatar_url')
          .eq('id', user.id)
          .single();

        if (error) throw error;

        if (data) {
          setFormData({
            full_name: data.full_name || '',
            job_title: data.job_title || '',
            department: data.department || '',
            phone: data.phone || '',
            avatar_url: data.avatar_url || '',
          });
        }
      } catch (error) {
        console.error('Error fetching profile:', error);
        // Fallback to user metadata if profile fetch fails
        setFormData((prev) => ({
          ...prev,
          full_name: user?.user_metadata?.full_name || '',
        }));
      } finally {
        setIsFetching(false);
      }
    }

    fetchProfile();
  }, [user]);

  const handleChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    if (!user) return;

    setIsLoading(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          full_name: formData.full_name,
          job_title: formData.job_title || null,
          department: formData.department || null,
          phone: formData.phone || null,
        })
        .eq('id', user.id);

      if (error) throw error;

      toast({
        title: 'Perfil atualizado',
        description: 'Suas informações foram salvas com sucesso.',
      });
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Erro ao salvar',
        description: error.message || 'Tente novamente mais tarde.',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const getInitials = (name?: string | null, email?: string) => {
    if (name) {
      return name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);
    }
    return email?.charAt(0).toUpperCase() ?? 'U';
  };

  if (isFetching) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-64 mt-2" />
        </div>
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-24" />
            <Skeleton className="h-4 w-48" />
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center gap-4">
              <Skeleton className="h-20 w-20 rounded-full" />
              <div>
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-4 w-48 mt-1" />
              </div>
            </div>
            <Separator />
            <div className="space-y-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <div className="grid gap-4 md:grid-cols-2">
                <Skeleton className="h-10" />
                <Skeleton className="h-10" />
              </div>
              <Skeleton className="h-10 w-full" />
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Configurações</h1>
        <p className="text-muted-foreground">
          Gerencie seu perfil e preferências
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Perfil</CardTitle>
          <CardDescription>
            Suas informações pessoais
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Avatar */}
          <div className="flex items-center gap-4">
            <Avatar className="h-20 w-20">
              <AvatarImage src={formData.avatar_url || user?.user_metadata?.avatar_url} />
              <AvatarFallback className="text-lg">
                {getInitials(formData.full_name, user?.email)}
              </AvatarFallback>
            </Avatar>
            <div>
              <p className="font-medium">{formData.full_name || 'Usuário'}</p>
              <p className="text-sm text-muted-foreground">{user?.email}</p>
            </div>
          </div>

          <Separator />

          <div className="grid gap-4">
            <div className="space-y-2">
              <Label htmlFor="full_name">Nome completo</Label>
              <Input
                id="full_name"
                value={formData.full_name}
                onChange={(e) => handleChange('full_name', e.target.value)}
                disabled={isLoading}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                value={user?.email || ''}
                disabled
                className="bg-muted"
              />
              <p className="text-xs text-muted-foreground">
                O email não pode ser alterado
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="job_title">Cargo</Label>
                <Input
                  id="job_title"
                  placeholder="Ex: Pesquisador"
                  value={formData.job_title}
                  onChange={(e) => handleChange('job_title', e.target.value)}
                  disabled={isLoading}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="department">Departamento</Label>
                <Input
                  id="department"
                  placeholder="Ex: P&D"
                  value={formData.department}
                  onChange={(e) => handleChange('department', e.target.value)}
                  disabled={isLoading}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone">Telefone</Label>
              <Input
                id="phone"
                placeholder="(00) 00000-0000"
                value={formData.phone}
                onChange={(e) => handleChange('phone', e.target.value)}
                disabled={isLoading}
              />
            </div>
          </div>

          <div className="flex justify-end">
            <Button onClick={handleSave} disabled={isLoading}>
              {isLoading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Salvar alterações
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
