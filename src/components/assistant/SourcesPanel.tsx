import { useState } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  ChevronRight,
  FileText,
  Lightbulb,
  ClipboardList,
  FileCheck,
  ExternalLink,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ChatSource } from '@/hooks/useAssistantChat';

interface SourcesPanelProps {
  sources: ChatSource[];
  highlightedCitation?: string;
  onClose?: () => void;
  className?: string;
}

const sourceTypeConfig: Record<string, { icon: typeof FileText; label: string; color: string }> = {
  file: { icon: FileText, label: 'Documento', color: 'text-blue-500' },
  insight: { icon: Lightbulb, label: 'Insight', color: 'text-amber-500' },
  knowledge_items: { icon: Lightbulb, label: 'Insight', color: 'text-amber-500' },
  task: { icon: ClipboardList, label: 'Tarefa', color: 'text-green-500' },
  tasks: { icon: ClipboardList, label: 'Tarefa', color: 'text-green-500' },
  report: { icon: FileCheck, label: 'Relatório', color: 'text-purple-500' },
  reports: { icon: FileCheck, label: 'Relatório', color: 'text-purple-500' },
};

export function SourcesPanel({ 
  sources, 
  highlightedCitation, 
  onClose,
  className 
}: SourcesPanelProps) {
  const [expandedSources, setExpandedSources] = useState<Set<string>>(new Set());

  const toggleSource = (citation: string) => {
    setExpandedSources(prev => {
      const next = new Set(prev);
      if (next.has(citation)) {
        next.delete(citation);
      } else {
        next.add(citation);
      }
      return next;
    });
  };

  // Group sources by project
  const sourcesByProject = sources.reduce((acc, source) => {
    const project = source.project || 'Sem projeto';
    if (!acc[project]) {
      acc[project] = [];
    }
    acc[project].push(source);
    return acc;
  }, {} as Record<string, ChatSource[]>);

  if (sources.length === 0) {
    return (
      <div className={cn("flex flex-col h-full bg-muted/30", className)}>
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="font-semibold text-sm">Fontes Citadas</h3>
          {onClose && (
            <Button variant="ghost" size="icon" onClick={onClose} className="h-6 w-6">
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
        <div className="flex-1 flex items-center justify-center p-4">
          <p className="text-sm text-muted-foreground text-center">
            Faça uma pergunta para ver as fontes utilizadas na resposta.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col h-full bg-muted/30", className)}>
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-sm">Fontes Citadas</h3>
          <Badge variant="secondary" className="text-xs">
            {sources.length}
          </Badge>
        </div>
        {onClose && (
          <Button variant="ghost" size="icon" onClick={onClose} className="h-6 w-6">
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-3">
          {Object.entries(sourcesByProject).map(([project, projectSources]) => (
            <div key={project} className="space-y-1">
              <h4 className="text-xs font-medium text-muted-foreground px-2 py-1">
                {project}
              </h4>
              {projectSources.map((source) => {
                const config = sourceTypeConfig[source.type] || sourceTypeConfig.file;
                const Icon = config.icon;
                const isExpanded = expandedSources.has(source.citation);
                const isHighlighted = highlightedCitation === source.citation;

                return (
                  <Collapsible
                    key={source.citation}
                    open={isExpanded}
                    onOpenChange={() => toggleSource(source.citation)}
                  >
                    <CollapsibleTrigger asChild>
                      <Button
                        variant="ghost"
                        className={cn(
                          "w-full justify-start gap-2 h-auto py-2 px-2 text-left",
                          isHighlighted && "bg-primary/10 border border-primary/20"
                        )}
                      >
                        <ChevronRight 
                          className={cn(
                            "h-4 w-4 shrink-0 transition-transform",
                            isExpanded && "rotate-90"
                          )} 
                        />
                        <Badge variant="outline" className="shrink-0 text-xs">
                          [{source.citation}]
                        </Badge>
                        <Icon className={cn("h-4 w-4 shrink-0", config.color)} />
                        <span className="text-sm truncate flex-1">
                          {source.title}
                        </span>
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="ml-6 pl-4 border-l-2 border-muted py-2 space-y-2">
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary" className="text-xs">
                            {config.label}
                          </Badge>
                        </div>
                        {source.excerpt && (
                          <p className="text-xs text-muted-foreground line-clamp-4">
                            "{source.excerpt}"
                          </p>
                        )}
                        <Button
                          variant="link"
                          size="sm"
                          className="h-auto p-0 text-xs"
                          onClick={(e) => {
                            e.stopPropagation();
                            // TODO: Navigate to source
                          }}
                        >
                          <ExternalLink className="h-3 w-3 mr-1" />
                          Ver documento original
                        </Button>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                );
              })}
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
