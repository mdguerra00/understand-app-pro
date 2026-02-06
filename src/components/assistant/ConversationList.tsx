import { useState } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Plus,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Trash2,
  Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type { Conversation } from '@/hooks/useAssistantChat';

interface ConversationListProps {
  conversations: Conversation[];
  activeConversationId: string | null;
  loading: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}

export function ConversationList({
  conversations,
  activeConversationId,
  loading,
  onSelect,
  onNew,
  onRename,
  onDelete,
}: ConversationListProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');

  const startEdit = (conv: Conversation) => {
    setEditingId(conv.id);
    setEditTitle(conv.title);
  };

  const saveEdit = () => {
    if (editingId && editTitle.trim()) {
      onRename(editingId, editTitle.trim());
    }
    setEditingId(null);
  };

  return (
    <div className="flex flex-col h-full bg-muted/30">
      <div className="p-3 border-b">
        <Button onClick={onNew} className="w-full gap-2" size="sm">
          <Plus className="h-4 w-4" />
          Nova Conversa
        </Button>
      </div>

      <ScrollArea className="flex-1">
        {loading ? (
          <div className="flex items-center justify-center p-4">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : conversations.length === 0 ? (
          <div className="p-4 text-center">
            <p className="text-xs text-muted-foreground">
              Nenhuma conversa ainda
            </p>
          </div>
        ) : (
          <div className="p-1 space-y-0.5">
            {conversations.map((conv) => (
              <div
                key={conv.id}
                className={cn(
                  'group flex items-center gap-1 rounded-md hover:bg-accent/50 transition-colors',
                  activeConversationId === conv.id && 'bg-accent'
                )}
              >
                {editingId === conv.id ? (
                  <Input
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onBlur={saveEdit}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveEdit();
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                    className="h-8 text-xs"
                    autoFocus
                  />
                ) : (
                  <>
                    <button
                      onClick={() => onSelect(conv.id)}
                      className="flex-1 flex items-start gap-2 p-2 text-left min-w-0"
                    >
                      <MessageSquare className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium truncate">
                          {conv.title}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {formatDistanceToNow(new Date(conv.updated_at), {
                            addSuffix: true,
                            locale: ptBR,
                          })}
                        </p>
                      </div>
                    </button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 opacity-0 group-hover:opacity-100 shrink-0 mr-1"
                        >
                          <MoreHorizontal className="h-3 w-3" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-36">
                        <DropdownMenuItem onClick={() => startEdit(conv)}>
                          <Pencil className="h-3 w-3 mr-2" />
                          Renomear
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => onDelete(conv.id)}
                          className="text-destructive"
                        >
                          <Trash2 className="h-3 w-3 mr-2" />
                          Excluir
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
