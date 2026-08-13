import { useState } from 'react';

import { GripVertical, X } from 'lucide-react';

import type { useLanguage } from '@/shared/providers/language-provider';
import { findVividOverlayPreset } from '@/shared/video/overlays/registry';

import { OverlayCardPreview } from './OverlayCardPreview';
import {
  defaultOverlayClipDurationMs,
  writeOverlayPresetDrag,
} from './overlayDragPayload';
import type { UserOverlayStyle } from './useUserOverlayStyles';

type OverlayRailLabels = ReturnType<
  typeof useLanguage
>['t']['video']['editor']['overlayRail'];

/** Saved full overlay looks: preset controls plus transform/keyframe metadata. */
export function UserOverlayStyleSection({
  onDelete,
  railLabels,
  styles,
}: {
  onDelete: (id: string) => void;
  railLabels: OverlayRailLabels;
  styles: UserOverlayStyle[];
}) {
  if (styles.length === 0) return null;
  return (
    <section className="grid gap-2">
      <h3 className="text-muted-foreground text-[11px] font-semibold tracking-normal uppercase">
        {railLabels.overlayStyles}
      </h3>
      <div className="grid grid-cols-2 gap-2">
        {styles.map((style) => (
          <UserOverlayStyleTile
            key={style.id}
            onDelete={onDelete}
            railLabels={railLabels}
            style={style}
          />
        ))}
      </div>
    </section>
  );
}

function UserOverlayStyleTile({
  onDelete,
  railLabels,
  style,
}: {
  onDelete: (id: string) => void;
  railLabels: OverlayRailLabels;
  style: UserOverlayStyle;
}) {
  const base = findVividOverlayPreset(style.basePresetId);
  const [engaged, setEngaged] = useState(false);
  if (!base) return null;
  return (
    <div
      className="border-border bg-background hover:border-primary/60 relative grid min-w-0 gap-2 rounded-md border p-2 text-left transition-colors"
      onMouseEnter={() => setEngaged(true)}
      onMouseLeave={() => setEngaged(false)}
    >
      <button
        type="button"
        draggable
        data-overlay-preset={base.id}
        data-user-overlay-style={style.id}
        className="grid min-w-0 gap-2 text-left focus-visible:outline-none"
        aria-label={railLabels.dragLabel.replace('{name}', style.name)}
        onBlur={() => setEngaged(false)}
        onDragStart={(event) =>
          writeOverlayPresetDrag(event.dataTransfer, {
            type: 'vivid-overlay-preset',
            presetId: base.id,
            clipDurationMs: defaultOverlayClipDurationMs(base.id),
            controls: style.controls,
            ...(style.loop ? { loop: style.loop } : {}),
            ...(style.transform ? { transforms: style.transform } : {}),
            ...(style.keyframes ? { keyframes: style.keyframes } : {}),
            name: style.name,
            styleId: style.id,
          })
        }
        onFocus={() => setEngaged(true)}
      >
        <span className="relative block aspect-video overflow-hidden rounded">
          <OverlayCardPreview
            preset={{ ...base, controls: base.controls }}
            animate={engaged}
            controlsOverride={style.controls}
          />
        </span>
        <span className="flex min-w-0 items-start gap-1.5">
          <GripVertical className="text-muted-foreground mt-0.5 size-3 shrink-0" />
          <span className="text-foreground truncate text-xs font-semibold">
            {style.name}
          </span>
        </span>
      </button>
      <button
        type="button"
        className="text-muted-foreground hover:text-foreground bg-background/80 absolute top-1 right-1 rounded p-0.5"
        aria-label={railLabels.deleteStyle.replace('{name}', style.name)}
        onClick={() => onDelete(style.id)}
      >
        <X className="size-3" />
      </button>
    </div>
  );
}
