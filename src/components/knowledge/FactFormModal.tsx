import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export interface KnowledgeFact {
  id: string;
  project_id: string | null;
  category: string;
  key: string;
  title: string;
  value: Record<string, any>;
  description: string | null;
  tags: string[];
  authoritative: boolean;
  priority: number;
  status: string;
  created_by: string;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  version: number;
  projects?: { name: string } | null;
}

const CATEGORIES = [
  { value: 'price', label: 'Preço', schema: '{"valor": number, "unidade": string, "moeda": string}' },
  { value: 'specification', label: 'Especificação', schema: '{"spec": string, "valor": any}' },
  { value: 'rule', label: 'Regra', schema: '{"regra": string}' },
  { value: 'reference', label: 'Referência', schema: '{"valor": any}' },
  { value: 'threshold', label: 'Limiar', schema: '{"min": number, "max": number, "unidade": string}' },
  { value: 'formula', label: 'Fórmula', schema: '{"formula": string}' },
  { value: 'other', label: 'Outro', schema: '{}' },
];

const VALUE_TEMPLATES: Record<string, Record<string, any>> = {
  price: { valor: 0, unidade: 'kg', moeda: 'BRL' },
  specification: { spec: '', valor: '' },
  rule: { regra: '' },
  reference: { valor: '' },
  threshold: { min: 0, max: 0, unidade: '' },
  formula: { formula: '' },
  other: {},
};

interface FactFormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  projects: { id: string; name: string }[];
  editFact?: KnowledgeFact | null;
  duplicateFact?: KnowledgeFact | null;
}

export function FactFormModal({ open, onOpenChange, onSaved, projects, editFact, duplicateFact }: FactFormModalProps) {
  const { user } = useAuth();
  const [saving, setSaving] = useState(false);
  const [category, setCategory] = useState('price');
  const [key, setKey] = useState('');
  const [title, setTitle] = useState('');
  const [valueJson, setValueJson] = useState('{}');
  const [description, setDescription] = useState('');
  const [tagsStr, setTagsStr] = useState('');
  const [authoritative, setAuthoritative] = useState(true);
  const [priority, setPriority] = useState(100);
  const [projectId, setProjectId] = useState<string>('global');
  const [changeReason, setChangeReason] = useState('');

  const isEditing = !!editFact;
  const source = editFact || duplicateFact;

  useEffect(() => {
    if (source) {
      setCategory(source.category);
      setKey(duplicateFact ? `${source.key}_copy` : source.key);
      setTitle(duplicateFact ? `${source.title} (cópia)` : source.title);
      setValueJson(JSON.stringify(source.value, null, 2));
      setDescription(source.description || '');
      setTagsStr((source.tags || []).join(', '));
      setAuthoritative(source.authoritative);
      setPriority(source.priority);
      setProjectId(source.project_id || 'global');
    } else {
      setCategory('price');
      setKey('');
      setTitle('');
      setValueJson(JSON.stringify(VALUE_TEMPLATES.price, null, 2));
      setDescription('');
      setTagsStr('');
      setAuthoritative(true);
      setPriority(100);
      setProjectId('global');
      setChangeReason('');
    }
  }, [source, open]);

  const handleCategoryChange = (cat: string) => {
    setCategory(cat);
    if (!isEditing) {
      setValueJson(JSON.stringify(VALUE_TEMPLATES[cat] || {}, null, 2));
    }
  };

  const handleSave = async () => {
    if (!user) return;
    if (!key.trim() || !title.trim()) {
      toast.error('Key e título são obrigatórios');
      return;
    }
    if (isEditing && !changeReason.trim()) {
      toast.error('Motivo da alteração é obrigatório');
      return;
    }

    let parsedValue: Record<string, any>;
    try {
      parsedValue = JSON.parse(valueJson);
    } catch {
      toast.error('JSON do valor inválido');
      return;
    }

    setSaving(true);
    try {
      const tags = tagsStr.split(',').map(t => t.trim()).filter(Boolean);
      const pid = projectId === 'global' ? null : projectId;

      if (isEditing && editFact) {
        // Update — trigger handles versioning
        const { error } = await supabase
          .from('knowledge_facts')
          .update({
            category,
            key: key.trim(),
            title: title.trim(),
            value: parsedValue,
            description: description.trim() || null,
            tags,
            authoritative,
            priority,
            updated_by: user.id,
          })
          .eq('id', editFact.id);

        if (error) throw error;

        // Log the change with reason
        await supabase.from('knowledge_facts_logs').insert({
          fact_id: editFact.id,
          action: 'update',
          user_id: user.id,
          details: { change_reason: changeReason, old_version: editFact.version },
        });

        // Update the version record with change_reason
        await supabase
          .from('knowledge_facts_versions')
          .update({ change_reason: changeReason })
          .eq('fact_id', editFact.id)
          .eq('version', editFact.version);

        // Trigger reindex
        await triggerFactIndex(editFact.id, pid);
        toast.success('Fato atualizado com sucesso');
      } else {
        // Insert
        const { data, error } = await supabase
          .from('knowledge_facts')
          .insert({
            project_id: pid,
            category,
            key: key.trim(),
            title: title.trim(),
            value: parsedValue,
            description: description.trim() || null,
            tags,
            authoritative,
            priority,
            created_by: user.id,
          })
          .select('id')
          .single();

        if (error) throw error;

        await supabase.from('knowledge_facts_logs').insert({
          fact_id: data.id,
          action: 'create',
          user_id: user.id,
          details: { category, key: key.trim() },
        });

        await triggerFactIndex(data.id, pid);
        toast.success('Fato criado com sucesso');
      }

      onSaved();
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message || 'Erro ao salvar fato');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Editar Fato' : duplicateFact ? 'Duplicar Fato' : 'Novo Fato Manual'}</DialogTitle>
          <DialogDescription>
            {isEditing ? 'Edite o fato. Motivo da alteração é obrigatório.' : 'Adicione um conhecimento canônico com prioridade máxima no RAG.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Escopo</Label>
              <Select value={projectId} onValueChange={setProjectId} disabled={isEditing}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="global">🌐 Global</SelectItem>
                  {projects.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Categoria</Label>
              <Select value={category} onValueChange={handleCategoryChange}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map(c => (
                    <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Key (identificador único)</Label>
              <Input value={key} onChange={e => setKey(e.target.value)} placeholder="ex: preco_resina_x" disabled={isEditing} />
            </div>
            <div className="space-y-2">
              <Label>Título</Label>
              <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="ex: Preço da Resina X" />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Valor (JSON) — Schema: {CATEGORIES.find(c => c.value === category)?.schema}</Label>
            <Textarea
              value={valueJson}
              onChange={e => setValueJson(e.target.value)}
              className="font-mono text-sm min-h-[100px]"
              placeholder='{"valor": 150, "unidade": "kg", "moeda": "BRL"}'
            />
          </div>

          <div className="space-y-2">
            <Label>Descrição (opcional, markdown, ≤ 2000 chars)</Label>
            <Textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Contexto adicional sobre este fato..."
              maxLength={2000}
            />
            <p className="text-xs text-muted-foreground">{description.length}/2000</p>
          </div>

          <div className="space-y-2">
            <Label>Tags (separadas por vírgula)</Label>
            <Input value={tagsStr} onChange={e => setTagsStr(e.target.value)} placeholder="ex: preço, material, 2024" />
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Switch checked={authoritative} onCheckedChange={setAuthoritative} />
              <Label>Authoritativo (fonte de verdade)</Label>
            </div>
            <div className="flex items-center gap-4 w-48">
              <Label className="text-xs shrink-0">Prioridade: {priority}</Label>
              <Slider value={[priority]} onValueChange={([v]) => setPriority(v)} min={0} max={100} step={1} />
            </div>
          </div>

          {isEditing && (
            <div className="space-y-2 border-t pt-4">
              <Label className="text-destructive">Motivo da alteração *</Label>
              <Textarea
                value={changeReason}
                onChange={e => setChangeReason(e.target.value)}
                placeholder="Explique por que está alterando este fato..."
                className="border-destructive/50"
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {isEditing ? 'Salvar Alterações' : 'Criar Fato'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

async function triggerFactIndex(factId: string, projectId: string | null) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return;

    await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/index-content`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          source_type: 'manual_knowledge',
          source_id: factId,
          project_id: projectId || '00000000-0000-0000-0000-000000000000',
        }),
      }
    );
  } catch (err) {
    console.warn('Fact indexing trigger failed:', err);
  }
}
