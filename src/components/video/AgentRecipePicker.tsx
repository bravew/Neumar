import { Sparkles } from 'lucide-react';

import { useVideoRecipes } from '@/shared/hooks/useVideoRecipes';

export interface AgentRecipePickerLabels {
  title: string;
  loading: string;
  empty: string;
  prompt: string;
}

interface AgentRecipePickerProps {
  labels: AgentRecipePickerLabels;
  disabled: boolean;
  onSelect: (prompt: string) => void;
}

export function AgentRecipePicker({
  labels,
  disabled,
  onSelect,
}: AgentRecipePickerProps) {
  const { recipes, loading, error } = useVideoRecipes();

  if (loading) {
    return (
      <div className="border-border text-muted-foreground rounded-md border px-3 py-2 text-xs">
        {labels.loading}
      </div>
    );
  }

  if (error || recipes.length === 0) {
    return (
      <div className="border-border text-muted-foreground rounded-md border px-3 py-2 text-xs">
        {labels.empty}
      </div>
    );
  }

  return (
    <section className="space-y-2" aria-label={labels.title}>
      <div className="text-muted-foreground flex items-center gap-1.5 text-[11px] font-medium uppercase">
        <Sparkles className="size-3" />
        {labels.title}
      </div>
      <div className="grid gap-2">
        {recipes.map((recipe) => (
          <button
            key={`${recipe.id}:${recipe.version}`}
            type="button"
            disabled={disabled}
            onClick={() => {
              const localized = labels.prompt.replace('{recipe}', recipe.name);
              const includesToken = labels.prompt.includes('{recipeId}');
              const finalized = includesToken
                ? localized.replace('{recipeId}', recipe.id)
                : `${localized}\n\nrecipeId: ${recipe.id}`;
              onSelect(finalized);
            }}
            className="border-border hover:bg-accent disabled:text-muted-foreground block min-w-0 rounded-md border px-3 py-2 text-left disabled:opacity-50"
          >
            <div className="text-foreground truncate text-xs font-medium">
              {recipe.name}
            </div>
            <div className="text-muted-foreground mt-0.5 truncate text-[11px]">
              {recipe.outputPreset}
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}
