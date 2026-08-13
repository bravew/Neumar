import { useState } from 'react';
import type { ComponentType } from 'react';

import type {
  VividOverlayCategory,
  VividOverlayPresetDef,
} from '@neumar/video-ir';
import {
  BadgeCheck,
  Captions,
  Frame,
  Gauge,
  GripVertical,
  MessageSquareQuote,
  MonitorPlay,
  Share2,
  SmilePlus,
  Sparkles,
  Sticker,
  Timer,
  Type,
} from 'lucide-react';

import type { useLanguage } from '@/shared/providers/language-provider';

import {
  OverlayCardPreview,
  overlayPresetPreviewSrcdoc,
} from './OverlayCardPreview';
import {
  defaultOverlayClipDurationMs,
  writeOverlayPresetDrag,
} from './overlayDragPayload';

export const CATEGORY_ICONS: Record<
  VividOverlayCategory,
  ComponentType<{ className?: string }>
> = {
  title: Type,
  callout: MessageSquareQuote,
  social: Share2,
  badge: BadgeCheck,
  reaction: SmilePlus,
  progress: Timer,
  widget: Gauge,
  frame: Frame,
  screen: MonitorPlay,
  sticker: Sticker,
  ambient: Sparkles,
  caption: Captions,
};

const CATEGORY_TILE_CLASS: Record<VividOverlayCategory, string> = {
  title: 'from-indigo-500/70 to-purple-500/60',
  callout: 'from-amber-400/70 to-orange-500/60',
  social: 'from-cyan-400/70 to-sky-500/60',
  badge: 'from-yellow-400/70 to-amber-500/60',
  reaction: 'from-fuchsia-400/70 to-pink-500/60',
  progress: 'from-lime-400/70 to-green-500/60',
  widget: 'from-slate-400/70 to-zinc-500/60',
  frame: 'from-violet-400/70 to-indigo-500/60',
  screen: 'from-red-400/70 to-rose-500/60',
  sticker: 'from-emerald-400/70 to-teal-500/60',
  ambient: 'from-pink-500/70 to-rose-500/60',
  caption: 'from-sky-400/70 to-blue-500/60',
};

type OverlayRailLabels = ReturnType<
  typeof useLanguage
>['t']['video']['editor']['overlayRail'];

export function OverlayPresetTile({
  description,
  label,
  preset,
  railLabels,
}: {
  description: string;
  label: string;
  preset: VividOverlayPresetDef;
  railLabels: OverlayRailLabels;
}) {
  const Icon = CATEGORY_ICONS[preset.category];
  const [engaged, setEngaged] = useState(false);
  const hasPreview = overlayPresetPreviewSrcdoc(preset) !== null;
  return (
    <button
      type="button"
      draggable
      data-overlay-preset={preset.id}
      className="border-border bg-background hover:border-primary/60 focus-visible:ring-ring grid min-w-0 gap-2 rounded-md border p-2 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none"
      aria-label={railLabels.dragLabel.replace('{name}', label)}
      onMouseEnter={() => setEngaged(true)}
      onMouseLeave={() => setEngaged(false)}
      onFocus={() => setEngaged(true)}
      onBlur={() => setEngaged(false)}
      onDragStart={(event) =>
        writeOverlayPresetDrag(event.dataTransfer, {
          type: 'vivid-overlay-preset',
          presetId: preset.id,
          clipDurationMs: defaultOverlayClipDurationMs(preset.id),
        })
      }
    >
      <span className="relative block aspect-video overflow-hidden rounded">
        <span
          aria-hidden="true"
          className={`absolute inset-0 flex items-center justify-center bg-gradient-to-br ${CATEGORY_TILE_CLASS[preset.category]}`}
        >
          <Icon className="size-5 text-white/90" />
        </span>
        {hasPreview ? (
          <OverlayCardPreview preset={preset} animate={engaged} />
        ) : null}
      </span>
      <span className="flex min-w-0 items-start gap-1.5">
        <GripVertical className="text-muted-foreground mt-0.5 size-3 shrink-0" />
        <span className="grid min-w-0 gap-1">
          <span className="text-foreground truncate text-xs font-semibold">
            {label}
          </span>
          <span className="text-muted-foreground line-clamp-2 text-[11px] leading-snug">
            {description}
          </span>
          {preset.requiresSourceAsset ? (
            <span className="bg-muted text-muted-foreground rounded-sm px-1.5 py-0.5 text-[10px] leading-none">
              {railLabels.needsAsset}
            </span>
          ) : null}
        </span>
      </span>
    </button>
  );
}
