import { useEffect, useMemo, useState } from 'react';

import { Library } from 'lucide-react';

import { PromptLibraryFilters } from '@/components/design/PromptLibraryFilters';
import { PromptLibraryGrid } from '@/components/design/PromptLibraryGrid';
import { PromptSampleDetail } from '@/components/design/PromptSampleDetail';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { recordCreativeDebugCounter } from '@/shared/creative-workflow/debug-counters';
import { listPromptLibrarySamples } from '@/shared/design/prompt-library-client';
import type {
  PromptLibraryFilters as PromptLibraryFilterState,
  PromptLibrarySample,
  PromptLibrarySurface,
} from '@/shared/design/prompt-library-types';
import { useLanguage } from '@/shared/providers/language-provider';

export function PromptLibraryDrawer({
  initialSurface = 'image',
  onSampleSelected,
}: {
  initialSurface?: PromptLibrarySurface;
  onSampleSelected: (sample: PromptLibrarySample) => void;
}) {
  const { language, t } = useLanguage();
  const labels = t.design.promptLibrary;
  const [open, setOpen] = useState(false);
  const [filters, setFilters] = useState<
    Required<Pick<PromptLibraryFilterState, 'surface'>> &
      PromptLibraryFilterState
  >({ surface: initialSurface });
  const [samples, setSamples] = useState<PromptLibrarySample[]>([]);
  const [selected, setSelected] = useState<PromptLibrarySample | null>(null);
  const [offline, setOffline] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const query = useMemo(
    () => ({ ...filters, locale: language, limit: 50 }),
    [filters, language],
  );

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen && !open) {
      recordCreativeDebugCounter('prompt.library.opened');
    }
    setOpen(nextOpen);
  };

  useEffect(() => {
    if (!open) return;
    const ac = new AbortController();
    setLoading(true);
    setError('');

    listPromptLibrarySamples(query, { signal: ac.signal })
      .then((result) => {
        setSamples(result.items);
        setOffline(result.offline);
        setSelected(
          (current) =>
            result.items.find((sample) => sample.id === current?.id) ??
            result.items[0] ??
            null,
        );
      })
      .catch((err) => {
        if (ac.signal.aborted) return;
        setSamples([]);
        setSelected(null);
        setOffline(false);
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });

    return () => ac.abort();
  }, [open, query]);

  const updateFilters = (patch: PromptLibraryFilterState) => {
    setFilters((current) => ({ ...current, ...patch }));
  };

  const useSample = (sample: PromptLibrarySample) => {
    recordCreativeDebugCounter('prompt.library.sample.used');
    onSampleSelected(sample);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <Library className="size-4" />
          {labels.open}
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[86vh] max-w-6xl flex-col gap-4 overflow-hidden">
        <DialogHeader>
          <DialogTitle>{labels.title}</DialogTitle>
          <DialogDescription className="sr-only">
            {labels.description}
          </DialogDescription>
        </DialogHeader>
        <PromptLibraryFilters
          filters={filters}
          samples={samples}
          labels={{
            image: labels.filter.image,
            video: labels.filter.video,
            search: labels.search,
            surface: labels.filter.surface,
            model: labels.filter.model,
            tag: labels.filter.tags,
            allModels: labels.filter.allModels,
            allTags: labels.filter.allTags,
          }}
          onChange={updateFilters}
        />
        {offline && (
          <p className="bg-muted rounded-md px-3 py-2 text-sm">
            {labels.offlineBanner}
          </p>
        )}
        {error && (
          <p className="text-destructive border-destructive/30 rounded-md border px-3 py-2 text-sm">
            {labels.error}: {error}
          </p>
        )}
        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-h-0 overflow-auto pr-1">
            {loading ? (
              <p className="text-muted-foreground text-sm">{labels.loading}</p>
            ) : (
              <PromptLibraryGrid
                samples={samples}
                selectedId={selected?.id}
                labels={{
                  empty: labels.empty,
                  noPreview: labels.previewUnavailable,
                }}
                onSelect={setSelected}
              />
            )}
          </div>
          <PromptSampleDetail
            sample={selected}
            labels={{
              category: labels.category,
              parameters: labels.detail.params,
              source: labels.detail.source,
              useThis: labels.useThis,
            }}
            onUse={useSample}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
