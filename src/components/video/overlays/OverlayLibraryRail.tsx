import { useMemo, useState } from 'react';

import type { VividOverlayCategory } from '@neumar/video-ir';
import { Search } from 'lucide-react';

import { useLanguage } from '@/shared/providers/language-provider';
import { VIDEO_OVERLAY_REGISTRY } from '@/shared/video/overlays/registry';

import { ImportedOverlaySection } from './ImportedOverlaySection';
import {
  CATEGORY_ORDER,
  importedOverlayMatches,
  matchesSearchTokens,
  overlayLabel,
  SOURCE_ORDER,
  type OverlaySourceFilter,
  userPresetMatches,
  userStyleMatches,
} from './overlayLibraryFilters';
import { OverlayPresetTile } from './OverlayPresetTile';
import { useImportedOverlays } from './useImportedOverlays';
import { UserOverlaySection } from './UserOverlaySection';
import { UserOverlayStyleSection } from './UserOverlayStyleSection';
import { useUserOverlayPresets } from './useUserOverlayPresets';
import { useUserOverlayStyles } from './useUserOverlayStyles';

// Preset library for the vivid overlay layer. Tiles show the preset's real
// overlay document as a paused poster frame (OverlayCardPreview) and animate
// it on hover/focus; prefers-reduced-motion keeps them poster-only.

export function OverlayLibraryRail() {
  const { t } = useLanguage();
  const railLabels = t.video.editor.overlayRail;
  const overlayText = t.video.editor.overlays as Record<string, string>;
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] =
    useState<VividOverlayCategory | null>(null);
  const [activeSource, setActiveSource] = useState<OverlaySourceFilter>('all');
  const { presets: userPresets, remove: removeUserPreset } =
    useUserOverlayPresets();
  const { remove: removeUserStyle, styles: userStyles } =
    useUserOverlayStyles();
  const {
    importLocal: importLocalOverlay,
    imports: importedOverlays,
    remove: removeImportedOverlay,
  } = useImportedOverlays();

  const tokens = useMemo(
    () => query.trim().toLowerCase().split(/\s+/).filter(Boolean),
    [query],
  );

  const populatedCategories = useMemo(
    () =>
      CATEGORY_ORDER.filter((category) =>
        VIDEO_OVERLAY_REGISTRY.some((preset) => preset.category === category),
      ),
    [],
  );

  const filteredBuiltIns = useMemo(() => {
    const scoped = activeCategory
      ? VIDEO_OVERLAY_REGISTRY.filter(
          (preset) => preset.category === activeCategory,
        )
      : [...VIDEO_OVERLAY_REGISTRY];
    if (tokens.length === 0) return scoped;
    return scoped.filter((preset) => {
      return matchesSearchTokens(
        [
          preset.id,
          preset.backend,
          preset.category,
          ...(preset.tags ?? []),
          overlayLabel(preset.labelKey, overlayText),
          overlayLabel(preset.descriptionKey, overlayText),
        ],
        tokens,
      );
    });
  }, [activeCategory, overlayText, tokens]);

  const filteredUserPresets = useMemo(
    () =>
      userPresets.filter((preset) =>
        userPresetMatches(preset, activeCategory, overlayText, tokens),
      ),
    [activeCategory, overlayText, tokens, userPresets],
  );

  const filteredUserStyles = useMemo(
    () =>
      userStyles.filter((style) =>
        userStyleMatches(style, activeCategory, overlayText, tokens),
      ),
    [activeCategory, overlayText, tokens, userStyles],
  );

  const filteredImports = useMemo(
    () =>
      importedOverlays.filter((item) =>
        importedOverlayMatches(item, activeCategory, tokens),
      ),
    [activeCategory, importedOverlays, tokens],
  );

  const showBuiltIns = activeSource === 'all' || activeSource === 'builtIn';
  const showUserPresets =
    activeSource === 'all' || activeSource === 'myOverlays';
  const showUserStyles = activeSource === 'all' || activeSource === 'styles';
  const showImports = activeSource === 'all' || activeSource === 'imported';
  const visibleCount =
    (showBuiltIns ? filteredBuiltIns.length : 0) +
    (showUserPresets ? filteredUserPresets.length : 0) +
    (showUserStyles ? filteredUserStyles.length : 0) +
    (showImports ? filteredImports.length : 0);

  return (
    <section className="flex min-h-0 flex-col gap-4">
      <div className="space-y-2">
        <div>
          <h2 className="text-foreground text-sm font-semibold">
            {railLabels.title}
          </h2>
          <p className="text-muted-foreground text-xs">
            {railLabels.description}
          </p>
        </div>
        <div className="border-input bg-background flex items-center gap-2 rounded-md border px-2">
          <Search className="text-muted-foreground size-3.5" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="min-w-0 flex-1 bg-transparent py-2 text-xs outline-none"
            placeholder={railLabels.searchPlaceholder}
            aria-label={railLabels.searchPlaceholder}
          />
        </div>
        <div
          className="flex flex-wrap gap-1"
          role="group"
          aria-label={railLabels.sourceFilter}
        >
          {SOURCE_ORDER.map((source) => (
            <CategoryChip
              key={source}
              label={railLabels.sources[source]}
              active={activeSource === source}
              onClick={() => setActiveSource(source)}
            />
          ))}
        </div>
        <div
          className="flex flex-wrap gap-1"
          role="group"
          aria-label={railLabels.categoryFilter}
        >
          <CategoryChip
            label={railLabels.allCategories}
            active={activeCategory === null}
            onClick={() => setActiveCategory(null)}
          />
          {populatedCategories.map((category) => (
            <CategoryChip
              key={category}
              label={railLabels.categories[category]}
              active={activeCategory === category}
              onClick={() =>
                setActiveCategory((current) =>
                  current === category ? null : category,
                )
              }
            />
          ))}
        </div>
      </div>

      <div className="grid gap-4">
        {showImports ? (
          <ImportedOverlaySection
            imports={filteredImports}
            onDelete={removeImportedOverlay}
            onImportLocal={importLocalOverlay}
            railLabels={railLabels}
          />
        ) : null}
        {showUserStyles ? (
          <UserOverlayStyleSection
            styles={filteredUserStyles}
            onDelete={removeUserStyle}
            railLabels={railLabels}
          />
        ) : null}
        {showUserPresets ? (
          <UserOverlaySection
            presets={filteredUserPresets}
            onDelete={removeUserPreset}
            railLabels={railLabels}
          />
        ) : null}
        {showBuiltIns
          ? CATEGORY_ORDER.map((category) => {
              const entries = filteredBuiltIns.filter(
                (preset) => preset.category === category,
              );
              if (entries.length === 0) return null;
              return (
                <section key={category} className="grid gap-2">
                  <h3 className="text-muted-foreground text-[11px] font-semibold tracking-normal uppercase">
                    {railLabels.categories[category]}
                  </h3>
                  <div className="grid grid-cols-2 gap-2">
                    {entries.map((preset) => (
                      <OverlayPresetTile
                        key={preset.id}
                        preset={preset}
                        label={overlayLabel(preset.labelKey, overlayText)}
                        description={overlayLabel(
                          preset.descriptionKey,
                          overlayText,
                        )}
                        railLabels={railLabels}
                      />
                    ))}
                  </div>
                </section>
              );
            })
          : null}
        {visibleCount === 0 ? (
          <p className="text-muted-foreground text-xs">{railLabels.empty}</p>
        ) : null}
      </div>
    </section>
  );
}

function CategoryChip({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        active
          ? 'bg-primary text-primary-foreground rounded-full px-2.5 py-1 text-[11px] font-medium'
          : 'bg-muted text-muted-foreground hover:text-foreground rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors'
      }
    >
      {label}
    </button>
  );
}
