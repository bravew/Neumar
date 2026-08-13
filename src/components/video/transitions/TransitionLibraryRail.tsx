import { useMemo, useState } from 'react';

import { GripVertical, Search } from 'lucide-react';

import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import {
  VIDEO_TRANSITION_REGISTRY,
  type VideoTransitionCapability,
  type VideoTransitionPresetGroup,
} from '@/shared/types/video';

import { writeTransitionDrag } from './transitionDragPayload';
import { TransitionTilePreview } from './TransitionTilePreview';

const GROUP_ORDER: VideoTransitionPresetGroup[] = [
  'subtle',
  'motion',
  'wipe',
  'stylized',
];

export function TransitionLibraryRail() {
  const { t } = useLanguage();
  const [query, setQuery] = useState('');
  const [activeKind, setActiveKind] = useState<string | null>(null);
  const transitionLabels = t.video.storyboard.transitions as Record<
    string,
    string
  >;
  const railLabels = t.video.editor.transitionRail;
  const filtered = useMemo(
    () =>
      filterTransitions(
        VIDEO_TRANSITION_REGISTRY,
        query,
        transitionLabels,
        railLabels.groups,
      ),
    [query, railLabels.groups, transitionLabels],
  );

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
      </div>

      <div className="grid gap-4">
        {GROUP_ORDER.map((group) => {
          const entries = filtered.filter((entry) => entry.group === group);
          if (entries.length === 0) return null;
          return (
            <section key={group} className="grid gap-2">
              <h3 className="text-muted-foreground text-[11px] font-semibold tracking-normal uppercase">
                {railLabels.groups[group]}
              </h3>
              <div className="grid grid-cols-2 gap-2">
                {entries.map((entry) => (
                  <TransitionTile
                    key={entry.kind}
                    entry={entry}
                    label={transitionText(entry.labelKey, transitionLabels)}
                    description={transitionText(
                      entry.descriptionKey,
                      transitionLabels,
                    )}
                    labels={railLabels}
                    active={activeKind === entry.kind}
                    onActiveChange={(active) =>
                      setActiveKind(active ? entry.kind : null)
                    }
                  />
                ))}
              </div>
            </section>
          );
        })}
        {filtered.length === 0 ? (
          <p className="text-muted-foreground text-xs">{railLabels.empty}</p>
        ) : null}
      </div>
    </section>
  );
}

function TransitionTile({
  active,
  description,
  entry,
  label,
  labels,
  onActiveChange,
}: {
  active: boolean;
  description: string;
  entry: VideoTransitionCapability;
  label: string;
  labels: ReturnType<
    typeof useLanguage
  >['t']['video']['editor']['transitionRail'];
  onActiveChange: (active: boolean) => void;
}) {
  return (
    <button
      type="button"
      draggable
      className="border-border bg-background hover:border-primary/60 focus-visible:ring-ring grid min-w-0 gap-2 rounded-md border p-2 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none"
      aria-label={labels.dragLabel.replace('{name}', label)}
      onDragStart={(event) =>
        writeTransitionDrag(event.dataTransfer, {
          type: 'video-transition',
          kind: entry.kind,
          durationMs: entry.defaultDurationMs,
          direction: entry.directions[0],
        })
      }
      onMouseEnter={() => onActiveChange(true)}
      onMouseLeave={() => onActiveChange(false)}
      onFocus={() => onActiveChange(true)}
      onBlur={() => onActiveChange(false)}
    >
      <TransitionTilePreview active={active} transition={entry} />
      <span className="flex min-w-0 items-start gap-1.5">
        <GripVertical className="text-muted-foreground mt-0.5 size-3 shrink-0" />
        <span className="grid min-w-0 gap-1">
          <span className="text-foreground truncate text-xs font-semibold">
            {label}
          </span>
          <span className="text-muted-foreground line-clamp-2 text-[11px] leading-snug">
            {description}
          </span>
          <span className="flex flex-wrap gap-1">
            <PreviewBadge entry={entry} labels={labels} />
          </span>
        </span>
      </span>
    </button>
  );
}

function PreviewBadge({
  entry,
  labels,
}: {
  entry: VideoTransitionCapability;
  labels: ReturnType<
    typeof useLanguage
  >['t']['video']['editor']['transitionRail'];
}) {
  if (entry.webglPreview === 'native') return null;
  return (
    <span
      className={cn(
        'rounded-sm px-1.5 py-0.5 text-[10px] leading-none',
        entry.webglPreview === 'fallback'
          ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
          : 'bg-muted text-muted-foreground',
      )}
    >
      {entry.webglPreview === 'fallback'
        ? labels.previewApproximate
        : labels.previewUnavailable}
    </span>
  );
}

function filterTransitions(
  entries: readonly VideoTransitionCapability[],
  query: string,
  labels: Record<string, string>,
  groups: Record<VideoTransitionPresetGroup, string>,
): VideoTransitionCapability[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [...entries];
  return entries.filter((entry) =>
    [
      entry.kind,
      transitionText(entry.labelKey, labels),
      transitionText(entry.descriptionKey, labels),
      groups[entry.group],
      entry.recommendedUse,
    ]
      .join(' ')
      .toLowerCase()
      .includes(normalized),
  );
}

function transitionText(
  labelKey: `transitions.${string}`,
  labels: Record<string, string>,
): string {
  const key = labelKey.replace('transitions.', '');
  return labels[key] ?? key;
}
