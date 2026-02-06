import { useState, useRef, useEffect } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Send,
  Loader2,
  Bot,
  Sparkles,
  MessageSquare,
  PanelRightOpen,
  PanelRightClose,
  PanelLeftOpen,
  PanelLeftClose,
} from 'lucide-react';
import { useAssistantChat } from '@/hooks/useAssistantChat';
import { ChatMessage } from '@/components/assistant/ChatMessage';
import { SourcesPanel } from '@/components/assistant/SourcesPanel';
import { ConversationList } from '@/components/assistant/ConversationList';
import { cn } from '@/lib/utils';

const suggestedQuestions = [
  'Qual a resistência média dos materiais testados?',
  'Quais foram os principais resultados obtidos?',
  'Resuma os insights mais importantes dos projetos',
  'Quais materiais apresentaram melhor desempenho?',
];

export default function Assistant() {
  const {
    messages,
    isLoading,
    sendMessage,
    startNewConversation,
    conversationId,
    conversations,
    loadingConversations,
    loadConversation,
    renameConversation,
    deleteConversation,
  } = useAssistantChat();

  const [input, setInput] = useState('');
  const [showSources, setShowSources] = useState(true);
  const [showConversations, setShowConversations] = useState(true);
  const [highlightedCitation, setHighlightedCitation] = useState<string>();
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const allSources = messages
    .filter(m => m.role === 'assistant' && m.sources)
    .flatMap(m => m.sources || [])
    .filter((source, index, self) =>
      index === self.findIndex(s => s.citation === source.citation)
    );

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && !isLoading) {
      sendMessage(input);
      setInput('');
    }
  };

  const handleSuggestionClick = (question: string) => {
    sendMessage(question);
  };

  const handleSourceClick = (citation: string) => {
    setHighlightedCitation(citation);
    setShowSources(true);
    setTimeout(() => setHighlightedCitation(undefined), 2000);
  };

  // Find preceding user question for each assistant message
  const getUserQuestionBefore = (index: number): string | undefined => {
    for (let i = index - 1; i >= 0; i--) {
      if (messages[i].role === 'user') return messages[i].content;
    }
    return undefined;
  };

  const hasMessages = messages.length > 0;
  const currentConversation = conversations.find(c => c.id === conversationId);

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden">
      {/* Conversation Sidebar */}
      {showConversations && (
        <div className="w-64 border-r hidden md:block">
          <ConversationList
            conversations={conversations}
            activeConversationId={conversationId}
            loading={loadingConversations}
            onSelect={loadConversation}
            onNew={startNewConversation}
            onRename={renameConversation}
            onDelete={deleteConversation}
          />
        </div>
      )}

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="hidden md:inline-flex h-8 w-8"
              onClick={() => setShowConversations(!showConversations)}
            >
              {showConversations ? (
                <PanelLeftClose className="h-4 w-4" />
              ) : (
                <PanelLeftOpen className="h-4 w-4" />
              )}
            </Button>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary">
              <Bot className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-lg font-semibold">
                {currentConversation?.title || 'Assistente IA'}
              </h1>
              <p className="text-xs text-muted-foreground">
                Pergunte sobre seus documentos e projetos
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowSources(!showSources)}
              className="gap-2"
            >
              {showSources ? (
                <PanelRightClose className="h-4 w-4" />
              ) : (
                <PanelRightOpen className="h-4 w-4" />
              )}
              Fontes
            </Button>
          </div>
        </div>

        {/* Messages Area */}
        <ScrollArea className="flex-1" ref={scrollRef}>
          <div className="max-w-3xl mx-auto p-4 space-y-4">
            {!hasMessages ? (
              <div className="flex flex-col items-center justify-center py-16 px-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 mb-6">
                  <Sparkles className="h-8 w-8 text-primary" />
                </div>
                <h2 className="text-xl font-semibold text-center mb-2">
                  Olá! Como posso ajudar?
                </h2>
                <p className="text-muted-foreground text-center max-w-md mb-8">
                  Faça perguntas em linguagem natural sobre todos os seus documentos,
                  insights e projetos. Eu buscarei as informações relevantes para responder.
                </p>

                <div className="w-full max-w-lg space-y-3">
                  <p className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <MessageSquare className="h-4 w-4" />
                    Sugestões de perguntas:
                  </p>
                  <div className="grid gap-2">
                    {suggestedQuestions.map((question, i) => (
                      <Card
                        key={i}
                        className="p-3 cursor-pointer hover:bg-accent transition-colors"
                        onClick={() => handleSuggestionClick(question)}
                      >
                        <p className="text-sm">{question}</p>
                      </Card>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <>
                {messages.map((message, index) => (
                  <ChatMessage
                    key={message.id}
                    message={message}
                    onSourceClick={handleSourceClick}
                    userQuestion={
                      message.role === 'assistant'
                        ? getUserQuestionBefore(index)
                        : undefined
                    }
                  />
                ))}
                {isLoading && (
                  <div className="flex gap-3 p-4 rounded-lg bg-background">
                    <div className="h-8 w-8 rounded-full bg-secondary flex items-center justify-center shrink-0">
                      <Loader2 className="h-4 w-4 animate-spin" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-sm font-medium">Assistente IA</span>
                        <Badge variant="secondary" className="text-xs">
                          Analisando...
                        </Badge>
                      </div>
                      <div className="flex gap-1">
                        <div className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:-0.3s]" />
                        <div className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:-0.15s]" />
                        <div className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce" />
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </ScrollArea>

        {/* Input Area */}
        <div className="border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 p-4">
          <form onSubmit={handleSubmit} className="max-w-3xl mx-auto">
            <div className="flex gap-2">
              <Input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Digite sua pergunta..."
                disabled={isLoading}
                className="flex-1"
              />
              <Button type="submit" disabled={isLoading || !input.trim()}>
                {isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-2 text-center">
              As respostas são baseadas nos documentos e insights dos seus projetos.
            </p>
          </form>
        </div>
      </div>

      {/* Sources Panel */}
      {showSources && (
        <div className="w-80 border-l hidden lg:block">
          <SourcesPanel
            sources={allSources}
            highlightedCitation={highlightedCitation}
            onClose={() => setShowSources(false)}
          />
        </div>
      )}
    </div>
  );
}
