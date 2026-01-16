import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { FileText, Plus } from 'lucide-react';

export default function Reports() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Relatórios</h1>
          <p className="text-muted-foreground">
            Documentação de resultados e conclusões
          </p>
        </div>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Novo Relatório
        </Button>
      </div>

      {/* Empty State */}
      <Card className="border-dashed">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <FileText className="h-6 w-6 text-muted-foreground" />
          </div>
          <CardTitle>Nenhum relatório ainda</CardTitle>
          <CardDescription>
            Documente os resultados dos seus projetos de P&D criando relatórios detalhados
          </CardDescription>
        </CardHeader>
        <CardContent className="text-center">
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Criar Primeiro Relatório
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
