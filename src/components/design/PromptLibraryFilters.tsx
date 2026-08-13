import { Search } from 'lucide-react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type {
  PromptLibraryFilters as PromptLibraryFilterState,
  PromptLibrarySample,
  PromptLibrarySurface,
} from '@/shared/design/prompt-library-types';

const ALL_MODELS_VALUE = '__all_models__';
const ALL_TAGS_VALUE = '__all_tags__';

export function PromptLibraryFilters({
  filters,
  samples,
  labels,
  onChange,
}: {
  filters: Required<Pick<PromptLibraryFilterState, 'surface'>> &
    PromptLibraryFilterState;
  samples: PromptLibrarySample[];
  labels: {
    image: string;
    model: string;
    search: string;
    tag: string;
    video: string;
    allModels: string;
    allTags: string;
    surface: string;
  };
  onChange: (patch: PromptLibraryFilterState) => void;
}) {
  const modelOptions = uniqueOptions(samples.map((sample) => sample.model));
  const tagOptions = uniqueOptions(
    samples.flatMap((sample) => sample.tags ?? []),
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="border-input flex h-9 min-w-56 flex-1 items-center gap-2 rounded-md border px-3">
        <Search className="text-muted-foreground size-4" />
        <input
          value={filters.q ?? ''}
          onChange={(event) => onChange({ q: event.target.value })}
          placeholder={labels.search}
          aria-label={labels.search}
          data-testid="prompt-library-search"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none"
        />
      </label>
      <Select
        value={filters.surface}
        onValueChange={(value) =>
          onChange({ surface: value as PromptLibrarySurface })
        }
      >
        <SelectTrigger
          aria-label={labels.surface}
          data-testid="prompt-library-surface-filter"
          className="w-auto min-w-28"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="image">{labels.image}</SelectItem>
          <SelectItem value="video">{labels.video}</SelectItem>
        </SelectContent>
      </Select>
      <Select
        value={filters.model ?? ALL_MODELS_VALUE}
        onValueChange={(value) =>
          onChange({
            model: value === ALL_MODELS_VALUE ? undefined : value,
          })
        }
      >
        <SelectTrigger
          aria-label={labels.model}
          data-testid="prompt-library-model-filter"
          className="min-w-36"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_MODELS_VALUE}>{labels.allModels}</SelectItem>
          {modelOptions.map((model) => (
            <SelectItem key={model} value={model}>
              {model}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={filters.tag ?? ALL_TAGS_VALUE}
        onValueChange={(value) =>
          onChange({ tag: value === ALL_TAGS_VALUE ? undefined : value })
        }
      >
        <SelectTrigger
          aria-label={labels.tag}
          data-testid="prompt-library-tag-filter"
          className="min-w-32"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_TAGS_VALUE}>{labels.allTags}</SelectItem>
          {tagOptions.map((tag) => (
            <SelectItem key={tag} value={tag}>
              {tag}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function uniqueOptions(values: Array<string | undefined>) {
  return [
    ...new Set(values.filter((value): value is string => Boolean(value))),
  ].sort((a, b) => a.localeCompare(b));
}
