import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface ProductEditModalProps {
  product: {
    id: string;
    name: string;
    family: string | null;
    intended_use: string | null;
    current_version: string | null;
    lifecycle_status: string;
    regulatory_status: string | null;
  } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated: () => void;
}

const lifecycleLabels: Record<string, string> = {
  development: 'Em Desenvolvimento',
  active: 'Ativo',
  discontinued: 'Descontinuado',
  obsolete: 'Obsoleto',
};

export function ProductEditModal({ product, open, onOpenChange, onUpdated }: ProductEditModalProps) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '',
    family: '',
    intended_use: '',
    current_version: '',
    lifecycle_status: 'development',
    regulatory_status: '',
  });

  useEffect(() => {
    if (product && open) {
      setForm({
        name: product.name || '',
        family: product.family || '',
        intended_use: product.intended_use || '',
        current_version: product.current_version || '',
        lifecycle_status: product.lifecycle_status || 'development',
        regulatory_status: product.regulatory_status || '',
      });
    }
  }, [product, open]);

  const handleSave = async () => {
    if (!product || !form.name.trim()) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('products')
        .update({
          name: form.name.trim(),
          family: form.family.trim() || null,
          intended_use: form.intended_use.trim() || null,
          current_version: form.current_version.trim() || null,
          lifecycle_status: form.lifecycle_status as any,
          regulatory_status: form.regulatory_status.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', product.id);

      if (error) throw error;
      toast.success('Produto atualizado com sucesso');
      onOpenChange(false);
      onUpdated();
    } catch (err: any) {
      toast.error(err.message || 'Erro ao atualizar produto');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar Produto</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Nome *</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>Família</Label>
            <Input value={form.family} onChange={(e) => setForm({ ...form, family: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>Uso Pretendido</Label>
            <Textarea value={form.intended_use} onChange={(e) => setForm({ ...form, intended_use: e.target.value })} rows={3} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Versão</Label>
              <Input value={form.current_version} onChange={(e) => setForm({ ...form, current_version: e.target.value })} placeholder="1.0" />
            </div>
            <div className="space-y-2">
              <Label>Ciclo de Vida</Label>
              <Select value={form.lifecycle_status} onValueChange={(v) => setForm({ ...form, lifecycle_status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(lifecycleLabels).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Status Regulatório</Label>
            <Input value={form.regulatory_status} onChange={(e) => setForm({ ...form, regulatory_status: e.target.value })} placeholder="Ex: Aprovado pela ANVISA" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSave} disabled={!form.name.trim() || saving}>
            {saving ? 'Salvando...' : 'Salvar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
