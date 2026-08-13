import { useState } from 'react';

import { GripVertical, X } from 'lucide-react';

import type { useLanguage } from '@/shared/providers/language-provider';
import { findVividOverlayPreset } from '@/shared/video/overlays/registry';

import { OverlayCardPreview } from './OverlayCardPreview';
import {
  defaultOverlayClipDurationMs,
  writeOverlayPresetDrag,
} from './overlayDragPayload';
import type { UserOverlayPreset } from './useUserOverlayPresets';

type OverlayRailLabels = ReturnType<
  typeof useLanguage
>['t']['video']['editor']['overlayRail'];

/** "My overlays" — saved presets rendered above the built-in catalog. */
export function UserOverlaySection({
  onDelete,
  presets,
  railLabels,
}: {
  onDelete: (id: string) => void;
  presets: UserOverlayPreset[];
  railLabels: OverlayRailLabels;
}) {
  if (presets.length === 0) return null;
  return (
    <section className="grid gap-2">
      <h3 className="text-muted-foreground text-[11px] font-semibold tracking-normal uppercase">
        {railLabels.myOverlays}
      </h3>
      <div className="grid grid-cols-2 gap-2">
        {presets.map((preset) => (
          <UserOverlayTile
            key={preset.id}
            preset={preset}
            onDelete={onDelete}
            railLabels={railLabels}
          />
        ))}
      </div>
    </section>
  );
}

function UserOverlayTile({
  onDelete,
  preset,
  railLabels,
}: {
  onDelete: (id: string) => void;
  preset: UserOverlayPreset;
  railLabels: OverlayRailLabels;
}) {
  const base = findVividOverlayPreset(preset.basePresetId);
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
        data-user-overlay-preset={preset.id}
        className="grid min-w-0 gap-2 text-left focus-visible:outline-none"
        aria-label={railLabels.dragLabel.replace('{name}', preset.name)}
        onFocus={() => setEngaged(true)}
        onBlur={() => setEngaged(false)}
        onDragStart={(event) =>
          writeOverlayPresetDrag(event.dataTransfer, {
            type: 'vivid-overlay-preset',
            presetId: base.id,
            clipDurationMs: defaultOverlayClipDurationMs(base.id),
            controls: preset.controls,
            ...(preset.loop ? { loop: preset.loop } : {}),
            name: preset.name,
          })
        }
      >
        <span className="relative block aspect-video overflow-hidden rounded">
          <OverlayCardPreview
            preset={{ ...base, controls: base.controls }}
            animate={engaged}
            controlsOverride={preset.controls}
          />
        </span>
        <span className="flex min-w-0 items-start gap-1.5">
          <GripVertical className="text-muted-foreground mt-0.5 size-3 shrink-0" />
          <span className="text-foreground truncate text-xs font-semibold">
            {preset.name}
          </span>
        </span>
      </button>
      <button
        type="button"
        className="text-muted-foreground hover:text-foreground bg-background/80 absolute top-1 right-1 rounded p-0.5"
        aria-label={railLabels.deleteSaved.replace('{name}', preset.name)}
        onClick={() => onDelete(preset.id)}
      >
        <X className="size-3" />
      </button>
    </div>
  );
}
