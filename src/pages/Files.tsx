import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { FolderOpen, Plus, Upload } from 'lucide-react';

export default function Files() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Arquivos</h1>
          <p className="text-muted-foreground">
            Biblioteca central de documentos e arquivos
          </p>
        </div>
        <Button>
          <Upload className="mr-2 h-4 w-4" />
          Upload
        </Button>
      </div>

      {/* Empty State */}
      <Card className="border-dashed">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <FolderOpen className="h-6 w-6 text-muted-foreground" />
          </div>
          <CardTitle>Biblioteca vazia</CardTitle>
          <CardDescription>
            Faça upload de documentos, planilhas, imagens e outros arquivos relacionados aos seus projetos
          </CardDescription>
        </CardHeader>
        <CardContent className="text-center">
          <Button>
            <Upload className="mr-2 h-4 w-4" />
            Fazer Upload
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
