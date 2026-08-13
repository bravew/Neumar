import { useState } from 'react';

import { HtmlFramePreview } from '@/components/artifacts/live/HtmlFramePreview';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import { resolveTemplatePosterUrl } from '@/shared/video/templatePreview';
import {
  type GalleryTemplateSummary,
  useHtmlGallery,
} from '@/shared/video/useHtmlGallery';
import { useTemplateSource } from '@/shared/video/useTemplateSource';

// Phase 6 M2 — HTML-video template picker.
//
// Lists gallery templates as preview cards. Calling `onSelect` is the caller's
// hook into Slice D's `video_select_template` (the picker is presentational,
// persistence flows through the parent).

interface TemplatePickerProps {
  /** Currently selected template id (echoed back to highlight the active row). */
  selectedId?: string | null;
  onSelect: (template: GalleryTemplateSummary) => void;
  /** Optional category filter — narrows the list client-side. */
  category?: string;
}

export function TemplatePicker({
  selectedId,
  onSelect,
  category,
}: TemplatePickerProps) {
  const { t } = useLanguage();
  const g = t.video.htmlGallery;
  const { templates, loading, error } = useHtmlGallery();
  const [query, setQuery] = useState('');

  const filtered = templates.filter((tmpl) => {
    if (category && tmpl.metadata.category !== category) return false;
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      tmpl.metadata.name.toLowerCase().includes(q) ||
      tmpl.id.toLowerCase().includes(q) ||
      tmpl.metadata.tags.some((tag) => tag.toLowerCase().includes(q))
    );
  });

  if (loading) {
    return (
      <div className="text-xs text-zinc-500" role="status">
        {g.loading}
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-xs text-rose-600" role="alert">
        {g.loadError.replace('{error}', error)}
      </div>
    );
  }

  if (templates.length === 0) {
    return <div className="text-xs text-zinc-500">{g.empty}</div>;
  }

  return (
    <div className="flex flex-col gap-2" data-testid="template-picker">
      <input
        type="search"
        className="w-full rounded border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        placeholder={g.searchPlaceholder}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label={g.searchLabel}
      />
      <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((tmpl) => (
          <li key={tmpl.id}>
            <TemplateCard
              template={tmpl}
              selected={selectedId === tmpl.id}
              labels={g}
              onSelect={() => onSelect(tmpl)}
            />
          </li>
        ))}
        {filtered.length === 0 ? (
          <li className="text-xs text-zinc-500">{g.noMatches}</li>
        ) : null}
      </ul>
    </div>
  );
}

function TemplateCard({
  template,
  selected,
  labels,
  onSelect,
}: {
  template: GalleryTemplateSummary;
  selected: boolean;
  labels: ReturnType<typeof useLanguage>['t']['video']['htmlGallery'];
  onSelect: () => void;
}) {
  const metadata = template.metadata;
  const posterUrl = resolveTemplatePosterUrl(template.preview?.posterUrl);
  const { html } = useTemplateSource(
    !posterUrl && template.metadata.engine === 'html' ? template.id : null,
  );
  const sourceLabel =
    template.rootKind === 'user' ? labels.customTemplate : labels.brandTemplate;

  return (
    <button
      type="button"
      className={cn(
        'bg-card text-card-foreground hover:border-primary/70 group flex h-full min-h-[220px] w-full flex-col overflow-hidden rounded-md border text-left text-xs shadow-sm transition',
        selected ? 'border-primary ring-primary/30 ring-2' : 'border-border',
      )}
      onClick={onSelect}
      data-testid={`template-row-${template.id}`}
      aria-pressed={selected}
    >
      <div className="bg-muted relative aspect-video w-full overflow-hidden">
        {posterUrl ? (
          <img
            src={posterUrl}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
            data-testid={`template-poster-${template.id}`}
          />
        ) : html ? (
          <div className="pointer-events-none absolute inset-0 origin-top scale-[0.48] overflow-hidden sm:scale-[0.42]">
            <HtmlFramePreview
              rawHtml={html}
              variables={{}}
              identity={`picker-${template.id}`}
              title={metadata.name}
              className="w-[240%]"
            />
          </div>
        ) : (
          <div className="text-muted-foreground flex h-full items-center justify-center text-[11px]">
            {metadata.engine}
          </div>
        )}
        <span className="bg-background/85 text-muted-foreground absolute top-2 left-2 rounded px-1.5 py-0.5 text-[10px] font-medium backdrop-blur">
          {sourceLabel}
        </span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
        <div>
          <div className="text-foreground line-clamp-1 text-sm font-medium">
            {metadata.name}
          </div>
          <div className="text-muted-foreground mt-0.5 line-clamp-2">
            {metadata.description || template.id}
          </div>
        </div>
        <div className="text-muted-foreground flex flex-wrap gap-1">
          <span className="bg-muted rounded px-1.5 py-0.5">
            {metadata.category}
          </span>
          <span className="bg-muted rounded px-1.5 py-0.5">
            {metadata.engine}
          </span>
          <span className="bg-muted rounded px-1.5 py-0.5">
            {metadata.license.spdx}
            {metadata.license.attribution_required
              ? ` · ${labels.attribution}`
              : ''}
          </span>
        </div>
        {metadata.tags.length > 0 ? (
          <div className="mt-auto flex flex-wrap gap-1">
            {metadata.tags.slice(0, 4).map((tag) => (
              <span
                key={tag}
                className="bg-secondary text-secondary-foreground rounded px-1.5 py-0.5 text-[10px]"
              >
                {tag}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </button>
  );
}
