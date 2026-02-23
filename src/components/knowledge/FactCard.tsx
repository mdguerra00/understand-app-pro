import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ShieldCheck, Shield, Globe, FolderOpen, Tag } from 'lucide-react';
import { KnowledgeFact } from './FactFormModal';

interface FactCardProps {
  fact: KnowledgeFact;
  onClick: () => void;
}

export function FactCard({ fact, onClick }: FactCardProps) {
  const valuePreview = (() => {
    try {
      const entries = Object.entries(fact.value).slice(0, 3);
      return entries.map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join(' · ');
    } catch {
      return JSON.stringify(fact.value).substring(0, 80);
    }
  })();

  return (
    <Card
      className="cursor-pointer hover:shadow-md transition-shadow border-l-4"
      style={{ borderLeftColor: fact.authoritative ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))' }}
      onClick={onClick}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-sm font-medium line-clamp-1 flex items-center gap-1.5">
            {fact.authoritative ? (
              <ShieldCheck className="h-4 w-4 text-primary shrink-0" />
            ) : (
              <Shield className="h-4 w-4 text-muted-foreground shrink-0" />
            )}
            {fact.title}
          </CardTitle>
          <Badge variant={fact.status === 'active' ? 'default' : 'secondary'} className="text-[10px] shrink-0">
            {fact.status === 'active' ? 'Ativo' : 'Arquivado'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-muted-foreground font-mono line-clamp-2">{valuePreview}</p>
        <div className="flex flex-wrap gap-1">
          <Badge variant="outline" className="text-[10px]">{fact.category}</Badge>
          <Badge variant="outline" className="text-[10px]">P{fact.priority}</Badge>
          <Badge variant="outline" className="text-[10px]">v{fact.version}</Badge>
          {fact.project_id ? (
            <Badge variant="outline" className="text-[10px]">
              <FolderOpen className="h-2.5 w-2.5 mr-0.5" />
              {fact.projects?.name || 'Projeto'}
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[10px]">
              <Globe className="h-2.5 w-2.5 mr-0.5" /> Global
            </Badge>
          )}
        </div>
        {fact.tags && fact.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {fact.tags.slice(0, 3).map(tag => (
              <span key={tag} className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                <Tag className="h-2.5 w-2.5" />{tag}
              </span>
            ))}
            {fact.tags.length > 3 && <span className="text-[10px] text-muted-foreground">+{fact.tags.length - 3}</span>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
