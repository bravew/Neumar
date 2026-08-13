import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

export type SearchMode = 'context' | 'filename' | 'description' | 'ocr';

export interface CloudSearchFilters {
  searchMode: SearchMode;
  query: string;
  country: string;
  state: string;
  city: string;
  make: string;
  model: string;
  lensModel: string;
  startDate: string;
  endDate: string;
  mediaKind: 'all' | 'image' | 'video';
  notInAlbum: boolean;
  archive: boolean;
  favorites: boolean;
}

export const EMPTY_FILTERS: CloudSearchFilters = {
  searchMode: 'context',
  query: '',
  country: '',
  state: '',
  city: '',
  make: '',
  model: '',
  lensModel: '',
  startDate: '',
  endDate: '',
  mediaKind: 'all',
  notInAlbum: false,
  archive: false,
  favorites: false,
};

interface CloudStorageSearchOptionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: CloudSearchFilters;
  onApply: (filters: CloudSearchFilters) => void;
}

export function CloudStorageSearchOptionsDialog({
  open,
  onOpenChange,
  initial,
  onApply,
}: CloudStorageSearchOptionsDialogProps) {
  const { t } = useLanguage();
  const s = t.cloudStorage;
  const [draft, setDraft] = useState<CloudSearchFilters>(initial);

  useEffect(() => {
    if (open) setDraft(initial);
  }, [open, initial]);

  const update = <K extends keyof CloudSearchFilters>(
    key: K,
    value: CloudSearchFilters[K],
  ) => setDraft((prev) => ({ ...prev, [key]: value }));

  const placeholderForMode = (mode: SearchMode) => {
    if (mode === 'filename') return 'IMG_1234.jpg';
    if (mode === 'description') return 'family vacation';
    if (mode === 'ocr') return 'receipt';
    return s.searchPlaceholderContext;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] w-[min(100vw,920px)] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-border border-b px-5 py-4">
          <DialogTitle className="text-base font-semibold">
            {s.searchOptionsTitle}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5 text-sm">
          <Section title={s.searchTypeLabel}>
            <div className="flex flex-wrap gap-4">
              {(
                [
                  ['context', s.searchTypeContext],
                  ['filename', s.searchTypeFilename],
                  ['description', s.searchTypeDescription],
                  ['ocr', s.searchTypeOcr],
                ] as const
              ).map(([value, label]) => (
                <label
                  key={value}
                  className="text-foreground flex items-center gap-2"
                >
                  <input
                    type="radio"
                    name="searchMode"
                    checked={draft.searchMode === value}
                    onChange={() => update('searchMode', value)}
                    className="accent-primary size-4"
                  />
                  {label}
                </label>
              ))}
            </div>
            <input
              type="text"
              value={draft.query}
              onChange={(event) => update('query', event.target.value)}
              placeholder={placeholderForMode(draft.searchMode)}
              className="border-input bg-muted/30 mt-3 h-10 w-full rounded-md border px-3"
            />
          </Section>

          <Section title={s.searchPlaceLabel}>
            <div className="grid gap-3 md:grid-cols-3">
              <Field
                label={s.searchPlaceCountry}
                value={draft.country}
                onChange={(value) => update('country', value)}
              />
              <Field
                label={s.searchPlaceState}
                value={draft.state}
                onChange={(value) => update('state', value)}
              />
              <Field
                label={s.searchPlaceCity}
                value={draft.city}
                onChange={(value) => update('city', value)}
              />
            </div>
          </Section>

          <Section title={s.searchCameraLabel}>
            <div className="grid gap-3 md:grid-cols-3">
              <Field
                label={s.searchCameraMake}
                value={draft.make}
                onChange={(value) => update('make', value)}
              />
              <Field
                label={s.searchCameraModel}
                value={draft.model}
                onChange={(value) => update('model', value)}
              />
              <Field
                label={s.searchCameraLens}
                value={draft.lensModel}
                onChange={(value) => update('lensModel', value)}
              />
            </div>
          </Section>

          <div className="grid gap-3 md:grid-cols-2">
            <Field
              label={s.searchStartDate}
              value={draft.startDate}
              onChange={(value) => update('startDate', value)}
              type="date"
            />
            <Field
              label={s.searchEndDate}
              value={draft.endDate}
              onChange={(value) => update('endDate', value)}
              type="date"
            />
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <Section title={s.mediaKindAll || 'Media type'} compact>
              <div className="flex gap-4">
                {(
                  [
                    ['all', s.searchMediaTypeAll],
                    ['image', s.searchMediaTypeImage],
                    ['video', s.searchMediaTypeVideo],
                  ] as const
                ).map(([value, label]) => (
                  <label
                    key={value}
                    className="text-foreground flex items-center gap-2"
                  >
                    <input
                      type="radio"
                      name="mediaKind"
                      checked={draft.mediaKind === value}
                      onChange={() => update('mediaKind', value)}
                      className="accent-primary size-4"
                    />
                    {label}
                  </label>
                ))}
              </div>
            </Section>

            <Section title={s.searchDisplayOptions} compact>
              <div className="flex flex-wrap gap-4">
                <Toggle
                  label={s.searchNotInAlbum}
                  checked={draft.notInAlbum}
                  onChange={(checked) => update('notInAlbum', checked)}
                />
                <Toggle
                  label={s.searchArchive}
                  checked={draft.archive}
                  onChange={(checked) => update('archive', checked)}
                />
                <Toggle
                  label={s.searchFavorites}
                  checked={draft.favorites}
                  onChange={(checked) => update('favorites', checked)}
                />
              </div>
            </Section>
          </div>
        </div>

        <DialogFooter className="border-border flex-row justify-between gap-2 border-t px-5 py-3 sm:justify-between">
          <Button
            type="button"
            variant="outline"
            onClick={() => setDraft(EMPTY_FILTERS)}
          >
            {s.searchClearAll}
          </Button>
          <Button
            type="button"
            onClick={() => {
              onApply(draft);
              onOpenChange(false);
            }}
          >
            {s.searchApply}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Section({
  title,
  children,
  compact,
}: {
  title: string;
  children: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={cn('space-y-2', compact && 'space-y-2')}>
      <h3 className="text-foreground text-base font-semibold">{title}</h3>
      {children}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <label className="space-y-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="border-input bg-muted/30 block h-10 w-full rounded-md border px-3 text-sm"
      />
    </label>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="text-foreground flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="accent-primary size-4 rounded"
      />
      {label}
    </label>
  );
}

export function buildSearchUrlParams(
  filters: CloudSearchFilters,
): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.query.trim()) params.set('q', filters.query.trim());
  params.set('searchMode', filters.searchMode);
  if (filters.country) params.set('country', filters.country);
  if (filters.state) params.set('state', filters.state);
  if (filters.city) params.set('city', filters.city);
  if (filters.make) params.set('make', filters.make);
  if (filters.model) params.set('model', filters.model);
  if (filters.lensModel) params.set('lensModel', filters.lensModel);
  if (filters.startDate)
    params.set('takenAfter', new Date(filters.startDate).toISOString());
  if (filters.endDate)
    params.set('takenBefore', new Date(filters.endDate).toISOString());
  if (filters.mediaKind !== 'all') params.set('media_kind', filters.mediaKind);
  if (filters.favorites) params.set('isFavorite', 'true');
  if (filters.archive) params.set('isArchived', 'true');
  if (filters.notInAlbum) params.set('isInAlbum', 'false');
  return params;
}

export function isFiltersActive(filters: CloudSearchFilters): boolean {
  return (
    filters.query.trim() !== '' ||
    filters.searchMode !== 'context' ||
    !!filters.country ||
    !!filters.state ||
    !!filters.city ||
    !!filters.make ||
    !!filters.model ||
    !!filters.lensModel ||
    !!filters.startDate ||
    !!filters.endDate ||
    filters.mediaKind !== 'all' ||
    filters.notInAlbum ||
    filters.archive ||
    filters.favorites
  );
}
