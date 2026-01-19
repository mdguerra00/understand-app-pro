import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { 
  FlaskConical, 
  Gauge, 
  Target, 
  BookOpen, 
  Lightbulb,
  TrendingUp,
  Link2,
  AlertTriangle,
  Scale,
  Zap,
  X
} from 'lucide-react';
import { KnowledgeCategory } from './KnowledgeCard';

interface Project {
  id: string;
  name: string;
}

interface KnowledgeFiltersProps {
  projects: Project[];
  selectedProject: string | null;
  onProjectChange: (projectId: string | null) => void;
  selectedCategories: KnowledgeCategory[];
  onCategoryToggle: (category: KnowledgeCategory) => void;
  minConfidence: number;
  onConfidenceChange: (value: number) => void;
  onClearFilters: () => void;
}

// Analytical categories (primary)
const analyticalCategories: { value: KnowledgeCategory; label: string; icon: typeof FlaskConical }[] = [
  { value: 'finding', label: 'Descoberta', icon: TrendingUp },
  { value: 'correlation', label: 'Correlação', icon: Link2 },
  { value: 'anomaly', label: 'Anomalia', icon: AlertTriangle },
  { value: 'benchmark', label: 'Benchmark', icon: Scale },
  { value: 'recommendation', label: 'Recomendação', icon: Zap },
];

// Legacy categories (secondary)
const legacyCategories: { value: KnowledgeCategory; label: string; icon: typeof FlaskConical }[] = [
  { value: 'compound', label: 'Composto', icon: FlaskConical },
  { value: 'parameter', label: 'Parâmetro', icon: Gauge },
  { value: 'result', label: 'Resultado', icon: Target },
  { value: 'method', label: 'Metodologia', icon: BookOpen },
  { value: 'observation', label: 'Observação', icon: Lightbulb },
];

export function KnowledgeFilters({
  projects,
  selectedProject,
  onProjectChange,
  selectedCategories,
  onCategoryToggle,
  minConfidence,
  onConfidenceChange,
  onClearFilters,
}: KnowledgeFiltersProps) {
  const hasActiveFilters = selectedProject || selectedCategories.length > 0 || minConfidence > 0;

  return (
    <div className="space-y-4 p-4 bg-muted/30 rounded-lg border">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-sm">Filtros</h3>
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={onClearFilters}>
            <X className="h-3 w-3 mr-1" />
            Limpar
          </Button>
        )}
      </div>

      {/* Project Filter */}
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Projeto</Label>
        <Select
          value={selectedProject || 'all'}
          onValueChange={(value) => onProjectChange(value === 'all' ? null : value)}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Todos os projetos" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os projetos</SelectItem>
            {projects.map((project) => (
              <SelectItem key={project.id} value={project.id}>
                {project.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Analytical Categories (Primary) */}
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Análises</Label>
        <div className="flex flex-wrap gap-2">
          {analyticalCategories.map((cat) => {
            const Icon = cat.icon;
            const isSelected = selectedCategories.includes(cat.value);
            return (
              <Button
                key={cat.value}
                variant={isSelected ? 'default' : 'outline'}
                size="sm"
                className="text-xs"
                onClick={() => onCategoryToggle(cat.value)}
              >
                <Icon className="h-3 w-3 mr-1" />
                {cat.label}
              </Button>
            );
          })}
        </div>
      </div>

      <Separator />

      {/* Legacy Categories (Secondary) */}
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Categorias Básicas</Label>
        <div className="flex flex-wrap gap-2">
          {legacyCategories.map((cat) => {
            const Icon = cat.icon;
            const isSelected = selectedCategories.includes(cat.value);
            return (
              <Button
                key={cat.value}
                variant={isSelected ? 'default' : 'outline'}
                size="sm"
                className="text-xs"
                onClick={() => onCategoryToggle(cat.value)}
              >
                <Icon className="h-3 w-3 mr-1" />
                {cat.label}
              </Button>
            );
          })}
        </div>
      </div>

      {/* Confidence Filter */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">Confiança mínima</Label>
          <span className="text-xs font-medium">{Math.round(minConfidence * 100)}%</span>
        </div>
        <Slider
          value={[minConfidence]}
          onValueChange={([value]) => onConfidenceChange(value)}
          min={0}
          max={1}
          step={0.1}
          className="w-full"
        />
      </div>
    </div>
  );
}
