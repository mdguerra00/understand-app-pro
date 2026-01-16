import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Brain, Search, Sparkles } from 'lucide-react';

export default function Knowledge() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Base de Conhecimento</h1>
        <p className="text-muted-foreground">
          Insights extraídos automaticamente dos seus documentos via IA
        </p>
      </div>

      {/* Search */}
      <div className="relative max-w-xl">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar conhecimento (ex: formulação com flúor, testes de abrasão...)"
          className="pl-9"
        />
      </div>

      {/* Empty State */}
      <Card className="border-dashed">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Brain className="h-6 w-6 text-primary" />
          </div>
          <CardTitle>Base de conhecimento vazia</CardTitle>
          <CardDescription className="max-w-md mx-auto">
            Quando você fizer upload de documentos nos projetos, a IA irá extrair automaticamente 
            informações importantes como compostos químicos, parâmetros de teste e resultados.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-center">
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Sparkles className="h-4 w-4" />
            <span>Powered by OpenAI GPT</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
