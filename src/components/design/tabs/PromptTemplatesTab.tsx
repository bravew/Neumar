import { useEffect, useMemo, useRef, useState } from 'react';

import {
  ExternalLink,
  Image,
  LayoutGrid,
  Play,
  Rows3,
  Video,
} from 'lucide-react';

import { GalleryFilters } from '@/components/design/GalleryFilters';
import { aspectRatioStyle } from '@/components/design/promptTemplateAspect';
import { useLanguage } from '@/shared/providers/language-provider';
import type { PromptTemplateSnapshot } from '@/shared/types/design-mode';

type ViewMode = 'grid' | 'masonry';

export function PromptTemplatesTab({
  templates,
  surface,
  onPreview,
}: {
  templates: PromptTemplateSnapshot[];
  surface: 'image' | 'video';
  onPreview: (template: PromptTemplateSnapshot) => void;
}) {
  const { t } = useLanguage();
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [aspectFilter, setAspectFilter] = useState('all');
  const [modelFilter, setModelFilter] = useState('all');
  const [viewMode, setViewMode] = useState<ViewMode>('masonry');
  const Icon = surface === 'image' ? Image : Video;
  const categoryOptions = useMemo(
    () =>
      [
        ...new Set(
          templates
            .map((template) => template.category)
            .filter((category): category is string => Boolean(category)),
        ),
      ]
        .sort()
        .map((category) => ({ label: category, value: category })),
    [templates],
  );
  const modelOptions = useMemo(
    () =>
      [
        ...new Set(
          templates
            .map((template) => template.model)
            .filter((model): model is string => Boolean(model)),
        ),
      ]
        .sort()
        .map((model) => ({ label: model, value: model })),
    [templates],
  );
  const aspectOptions = useMemo(
    () =>
      [
        ...new Set(
          templates
            .map((template) => template.aspect)
            .filter(
              (
                aspect,
              ): aspect is NonNullable<PromptTemplateSnapshot['aspect']> =>
                Boolean(aspect),
            ),
        ),
      ]
        .sort()
        .map((aspect) => ({ label: aspect, value: aspect })),
    [templates],
  );
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return templates.filter((template) => {
      if (categoryFilter !== 'all' && template.category !== categoryFilter) {
        return false;
      }
      if (aspectFilter !== 'all' && template.aspect !== aspectFilter) {
        return false;
      }
      if (modelFilter !== 'all' && template.model !== modelFilter) {
        return false;
      }
      if (!q) return true;
      return [
        template.title,
        template.summary,
        template.category,
        template.model,
        template.aspect,
        template.prompt,
        ...(template.tags ?? []),
      ]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(q));
    });
  }, [templates, aspectFilter, categoryFilter, modelFilter, query]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <GalleryFilters
            query={query}
            onQueryChange={setQuery}
            queryPlaceholder={t.design.searchTemplates}
            searchTestId={`prompt-templates-${surface}-search`}
            filters={[
              {
                label: t.design.categoryFilter,
                value: categoryFilter,
                onChange: setCategoryFilter,
                allLabel: t.design.allCategories,
                options: categoryOptions,
                testId: `prompt-templates-${surface}-category-filter`,
              },
              {
                label: t.design.modelFilter,
                value: modelFilter,
                onChange: setModelFilter,
                allLabel: t.design.allModels,
                options: modelOptions,
                testId: `prompt-templates-${surface}-model-filter`,
              },
              {
                label: t.design.aspectFilter,
                value: aspectFilter,
                onChange: setAspectFilter,
                allLabel: t.design.allAspects,
                options: aspectOptions,
                testId: `prompt-templates-${surface}-aspect-filter`,
              },
            ]}
          />
        </div>
        <ViewModeToggle
          mode={viewMode}
          onChange={setViewMode}
          gridLabel={t.design.layoutGrid}
          masonryLabel={t.design.layoutMasonry}
          testId={`prompt-templates-${surface}-view-mode`}
        />
      </div>
      {filtered.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t.design.noMatches}</p>
      ) : viewMode === 'masonry' ? (
        <div className="columns-1 gap-3 sm:columns-2 lg:columns-3 xl:columns-4 [&>*]:mb-3 [&>*]:break-inside-avoid">
          {filtered.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              Icon={Icon}
              onPreview={onPreview}
              viewOriginalLabel={t.design.viewOriginal}
              noPreviewLabel={t.design.noPreview}
              preserveAspect
            />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              Icon={Icon}
              onPreview={onPreview}
              viewOriginalLabel={t.design.viewOriginal}
              noPreviewLabel={t.design.noPreview}
              preserveAspect={false}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ViewModeToggle({
  mode,
  onChange,
  gridLabel,
  masonryLabel,
  testId,
}: {
  mode: ViewMode;
  onChange: (mode: ViewMode) => void;
  gridLabel: string;
  masonryLabel: string;
  testId: string;
}) {
  const buttonClass = (active: boolean) =>
    `flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors ${
      active
        ? 'bg-background text-foreground shadow-sm'
        : 'text-muted-foreground hover:text-foreground'
    }`;
  return (
    <div
      className="border-border bg-muted inline-flex items-center gap-1 rounded-md border p-1"
      role="group"
      data-testid={testId}
    >
      <button
        type="button"
        className={buttonClass(mode === 'masonry')}
        onClick={() => onChange('masonry')}
        aria-pressed={mode === 'masonry'}
        title={masonryLabel}
      >
        <Rows3 className="size-3.5" />
        <span className="sr-only sm:not-sr-only">{masonryLabel}</span>
      </button>
      <button
        type="button"
        className={buttonClass(mode === 'grid')}
        onClick={() => onChange('grid')}
        aria-pressed={mode === 'grid'}
        title={gridLabel}
      >
        <LayoutGrid className="size-3.5" />
        <span className="sr-only sm:not-sr-only">{gridLabel}</span>
      </button>
    </div>
  );
}

function TemplateCard({
  template,
  Icon,
  onPreview,
  viewOriginalLabel,
  noPreviewLabel,
  preserveAspect,
}: {
  template: PromptTemplateSnapshot;
  Icon: typeof Image;
  onPreview: (template: PromptTemplateSnapshot) => void;
  viewOriginalLabel: string;
  noPreviewLabel: string;
  preserveAspect: boolean;
}) {
  const [loaded, setLoaded] = useState(false);
  const [hovered, setHovered] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const sourceUrl = template.source?.url;
  const hasPreview = Boolean(template.previewImageUrl);
  const isVideo = template.surface === 'video';
  const hasVideoPreview = isVideo && Boolean(template.previewVideoUrl);
  const fallbackAspect = isVideo ? '16 / 9' : '4 / 3';
  const thumbStyle = preserveAspect
    ? aspectRatioStyle(template)
    : { aspectRatio: fallbackAspect };

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (hovered) void video.play().catch(() => {});
    else {
      video.pause();
      video.currentTime = 0;
    }
  }, [hovered]);

  return (
    <div
      className="group relative"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type="button"
        className="border-border bg-card hover:border-primary/40 focus-visible:ring-ring/50 block w-full overflow-hidden rounded-md border text-left transition-colors outline-none focus-visible:ring-2"
        onClick={() => onPreview(template)}
        data-testid={`prompt-template-card-${template.surface}-${template.id}`}
      >
        <div
          className="bg-muted relative w-full overflow-hidden"
          style={thumbStyle}
        >
          {hasPreview ? (
            <>
              {!loaded && (
                <div
                  className="bg-muted/50 absolute inset-0 animate-pulse"
                  aria-hidden
                />
              )}
              <img
                src={template.previewImageUrl}
                alt=""
                loading="lazy"
                onLoad={() => setLoaded(true)}
                className={`absolute inset-0 h-full w-full object-contain transition-opacity duration-300 ${
                  loaded ? 'opacity-100' : 'opacity-0'
                }`}
              />
              {hasVideoPreview && (
                <video
                  ref={videoRef}
                  src={template.previewVideoUrl}
                  poster={template.previewImageUrl}
                  muted
                  loop
                  playsInline
                  preload="none"
                  className={`absolute inset-0 h-full w-full object-contain transition-opacity duration-200 ${
                    hovered ? 'opacity-100' : 'pointer-events-none opacity-0'
                  }`}
                />
              )}
              {isVideo && (
                <span
                  aria-hidden
                  className={`pointer-events-none absolute right-2 bottom-2 inline-flex items-center justify-center rounded-full bg-black/55 p-1.5 text-white shadow-sm transition-opacity duration-200 ${
                    hovered ? 'opacity-0' : 'opacity-100'
                  }`}
                >
                  <Play className="size-3.5 fill-white" />
                </span>
              )}
            </>
          ) : (
            <div className="text-muted-foreground absolute inset-0 flex flex-col items-center justify-center gap-1 p-4">
              <Icon className="size-8" />
              <span className="text-xs">{noPreviewLabel}</span>
            </div>
          )}
        </div>
        <div className="p-3">
          <h3 className="line-clamp-2 text-sm font-semibold">
            {template.title}
          </h3>
          <p className="text-muted-foreground mt-1 line-clamp-2 text-xs">
            {template.summary}
          </p>
          <div className="mt-3 flex flex-wrap gap-1 text-xs">
            {template.model && (
              <span className="bg-muted rounded px-1.5 py-0.5">
                {template.model}
              </span>
            )}
            {template.aspect && (
              <span className="bg-muted rounded px-1.5 py-0.5">
                {template.aspect}
              </span>
            )}
          </div>
        </div>
      </button>
      {sourceUrl && (
        <a
          href={sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(event) => event.stopPropagation()}
          title={viewOriginalLabel}
          className="bg-background/80 hover:bg-background text-muted-foreground hover:text-foreground absolute top-2 right-2 inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs opacity-0 backdrop-blur transition-opacity group-hover:opacity-100 focus:opacity-100"
          data-testid={`prompt-template-view-original-${template.id}`}
        >
          <ExternalLink className="size-3" />
        </a>
      )}
    </div>
  );
}
