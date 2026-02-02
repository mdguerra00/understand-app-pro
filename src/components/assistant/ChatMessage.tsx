import ReactMarkdown from 'react-markdown';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Bot, User, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ChatMessage as ChatMessageType } from '@/hooks/useAssistantChat';

interface ChatMessageProps {
  message: ChatMessageType;
  onSourceClick?: (citation: string) => void;
}

export function ChatMessage({ message, onSourceClick }: ChatMessageProps) {
  const isUser = message.role === 'user';
  const isError = message.isError;

  return (
    <div
      className={cn(
        'flex gap-3 p-4 rounded-lg',
        isUser 
          ? 'bg-muted/50' 
          : isError 
            ? 'bg-destructive/10 border border-destructive/20'
            : 'bg-background'
      )}
    >
      <Avatar className="h-8 w-8 shrink-0">
        <AvatarFallback 
          className={cn(
            isUser 
              ? 'bg-primary text-primary-foreground' 
              : isError
                ? 'bg-destructive text-destructive-foreground'
                : 'bg-secondary text-secondary-foreground'
          )}
        >
          {isUser ? (
            <User className="h-4 w-4" />
          ) : isError ? (
            <AlertCircle className="h-4 w-4" />
          ) : (
            <Bot className="h-4 w-4" />
          )}
        </AvatarFallback>
      </Avatar>

      <div className="flex-1 min-w-0 space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">
            {isUser ? 'Você' : 'Assistente IA'}
          </span>
          <span className="text-xs text-muted-foreground">
            {message.timestamp.toLocaleTimeString('pt-BR', { 
              hour: '2-digit', 
              minute: '2-digit' 
            })}
          </span>
        </div>

        <div className="prose prose-sm dark:prose-invert max-w-none">
          <ReactMarkdown
            components={{
              // Style citations as clickable badges
              a: ({ href, children }) => {
                const citationMatch = String(children).match(/^\[(\d+)\]$/);
                if (citationMatch && onSourceClick) {
                  return (
                    <Badge
                      variant="secondary"
                      className="cursor-pointer hover:bg-primary hover:text-primary-foreground mx-0.5 text-xs"
                      onClick={() => onSourceClick(citationMatch[1])}
                    >
                      {children}
                    </Badge>
                  );
                }
                return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
              },
              // Handle inline citation patterns like [1]
              p: ({ children }) => {
                if (typeof children === 'string') {
                  const parts = children.split(/(\[\d+\])/g);
                  return (
                    <p>
                      {parts.map((part, i) => {
                        const match = part.match(/^\[(\d+)\]$/);
                        if (match && onSourceClick) {
                          return (
                            <Badge
                              key={i}
                              variant="secondary"
                              className="cursor-pointer hover:bg-primary hover:text-primary-foreground mx-0.5 text-xs inline-flex"
                              onClick={() => onSourceClick(match[1])}
                            >
                              {part}
                            </Badge>
                          );
                        }
                        return part;
                      })}
                    </p>
                  );
                }
                return <p>{children}</p>;
              },
              ul: ({ children }) => <ul className="list-disc pl-4 space-y-1">{children}</ul>,
              ol: ({ children }) => <ol className="list-decimal pl-4 space-y-1">{children}</ol>,
              li: ({ children }) => <li className="text-foreground">{children}</li>,
              strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
              h1: ({ children }) => <h1 className="text-lg font-bold mt-4 mb-2">{children}</h1>,
              h2: ({ children }) => <h2 className="text-base font-bold mt-3 mb-2">{children}</h2>,
              h3: ({ children }) => <h3 className="text-sm font-bold mt-2 mb-1">{children}</h3>,
              code: ({ children }) => (
                <code className="bg-muted px-1 py-0.5 rounded text-sm">{children}</code>
              ),
              blockquote: ({ children }) => (
                <blockquote className="border-l-2 border-primary pl-4 italic text-muted-foreground">
                  {children}
                </blockquote>
              ),
            }}
          >
            {message.content}
          </ReactMarkdown>
        </div>

        {/* Inline source indicators */}
        {message.sources && message.sources.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-2">
            <span className="text-xs text-muted-foreground">Fontes:</span>
            {message.sources.map((source) => (
              <Badge
                key={source.citation}
                variant="outline"
                className="text-xs cursor-pointer hover:bg-accent"
                onClick={() => onSourceClick?.(source.citation)}
              >
                [{source.citation}] {source.title}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
