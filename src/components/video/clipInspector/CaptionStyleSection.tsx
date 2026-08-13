import { useEffect } from 'react';

import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Italic,
  Underline,
} from 'lucide-react';

import type {
  VideoCaptionTimelineClip,
  VideoSubtitleStyle,
} from '@/shared/types/video';

import { CaptionShadowSubsection } from './CaptionShadowSubsection';
import {
  DEFAULT_CAPTION_FONT_FAMILY,
  FONT_CATEGORIES,
  loadGoogleFontIfNeeded,
} from './fonts';
import type { ClipInspectorLabels } from './types';

interface CaptionStyleSectionProps {
  clip: VideoCaptionTimelineClip;
  labels: ClipInspectorLabels;
  updateClip: (patch: Partial<VideoCaptionTimelineClip>) => void;
}

const POSITION_GRID: ReadonlyArray<{
  positionX: number;
  positionY: number;
  label: string;
}> = [
  { positionX: 0.1, positionY: 0.1, label: '↖' },
  { positionX: 0.5, positionY: 0.1, label: '↑' },
  { positionX: 0.9, positionY: 0.1, label: '↗' },
  { positionX: 0.1, positionY: 0.5, label: '←' },
  { positionX: 0.5, positionY: 0.5, label: '·' },
  { positionX: 0.9, positionY: 0.5, label: '→' },
  { positionX: 0.1, positionY: 0.85, label: '↙' },
  { positionX: 0.5, positionY: 0.85, label: '↓' },
  { positionX: 0.9, positionY: 0.85, label: '↘' },
];

export function CaptionStyleSection({
  clip,
  labels,
  updateClip,
}: CaptionStyleSectionProps) {
  const style = clip.style ?? {};
  const patchStyle = (next: Partial<VideoSubtitleStyle>) =>
    updateClip({ style: { ...style, ...next } });
  const align = style.textAlign ?? 'center';
  const currentFont = style.fontFamily ?? DEFAULT_CAPTION_FONT_FAMILY;
  useEffect(() => loadGoogleFontIfNeeded(currentFont), [currentFont]);

  return (
    <div className="space-y-4">
      <label className="grid gap-1 text-[11px]">
        <span>{labels.text}</span>
        <textarea
          rows={3}
          defaultValue={clip.text}
          className="border-input bg-background text-foreground rounded-md border px-2 py-1.5 text-xs"
          onBlur={(event) => updateClip({ text: event.currentTarget.value })}
        />
      </label>

      <label className="grid gap-1 text-[11px]">
        <span>{labels.fontFamily}</span>
        <select
          className="border-input bg-background h-8 w-full rounded-md border px-2 text-xs"
          value={currentFont}
          style={{ fontFamily: currentFont }}
          onChange={(event) => {
            const next = event.currentTarget.value;
            loadGoogleFontIfNeeded(next);
            patchStyle({ fontFamily: next });
          }}
        >
          {FONT_CATEGORIES.map((group) => (
            <optgroup key={group.category} label={group.category}>
              {group.fonts.map((font) => (
                <option
                  key={font}
                  value={font}
                  style={{ fontFamily: font }}
                  onMouseEnter={() => loadGoogleFontIfNeeded(font)}
                >
                  {font}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>

      <div className="grid grid-cols-2 gap-2">
        <label className="grid gap-1 text-[11px]">
          <span>{labels.fontSize}</span>
          <input
            type="number"
            min={8}
            max={160}
            value={style.fontSize ?? 48}
            className="border-input bg-background rounded-md border px-2 py-1 text-xs"
            onChange={(event) =>
              patchStyle({ fontSize: Number(event.currentTarget.value) })
            }
          />
        </label>
        <label className="grid gap-1 text-[11px]">
          <span>{labels.color}</span>
          <input
            type="color"
            value={style.color ?? '#ffffff'}
            className="border-input bg-background h-7 w-full rounded-md border px-1"
            onChange={(event) => patchStyle({ color: event.target.value })}
          />
        </label>
      </div>

      <div className="grid gap-1 text-[11px]">
        <span>{labels.styleEmphasis}</span>
        <div className="border-input flex gap-1 rounded-md border p-1">
          <ToggleButton
            label={labels.bold}
            pressed={style.fontWeight === 'bold'}
            onClick={() =>
              patchStyle({
                fontWeight: style.fontWeight === 'bold' ? 'normal' : 'bold',
              })
            }
          >
            <Bold className="size-3.5" />
          </ToggleButton>
          <ToggleButton
            label={labels.italic}
            pressed={style.fontStyle === 'italic'}
            onClick={() =>
              patchStyle({
                fontStyle: style.fontStyle === 'italic' ? 'normal' : 'italic',
              })
            }
          >
            <Italic className="size-3.5" />
          </ToggleButton>
          <ToggleButton
            label={labels.underline}
            pressed={style.textDecoration === 'underline'}
            onClick={() =>
              patchStyle({
                textDecoration:
                  style.textDecoration === 'underline' ? 'none' : 'underline',
              })
            }
          >
            <Underline className="size-3.5" />
          </ToggleButton>
        </div>
      </div>

      <div className="grid gap-1 text-[11px]">
        <span>{labels.textAlign}</span>
        <div className="border-input flex gap-1 rounded-md border p-1">
          <ToggleButton
            label={labels.alignLeft}
            pressed={align === 'left'}
            onClick={() => patchStyle({ textAlign: 'left' })}
          >
            <AlignLeft className="size-3.5" />
          </ToggleButton>
          <ToggleButton
            label={labels.alignCenter}
            pressed={align === 'center'}
            onClick={() => patchStyle({ textAlign: 'center' })}
          >
            <AlignCenter className="size-3.5" />
          </ToggleButton>
          <ToggleButton
            label={labels.alignRight}
            pressed={align === 'right'}
            onClick={() => patchStyle({ textAlign: 'right' })}
          >
            <AlignRight className="size-3.5" />
          </ToggleButton>
        </div>
      </div>

      <div className="grid gap-1 text-[11px]">
        <span>{labels.positionOnCanvas}</span>
        <div className="border-input grid grid-cols-3 gap-1 rounded-md border p-1">
          {POSITION_GRID.map((cell) => {
            const active =
              (style.positionX ?? 0.5) === cell.positionX &&
              (style.positionY ?? 0.85) === cell.positionY;
            return (
              <button
                key={`${cell.positionX}-${cell.positionY}`}
                type="button"
                aria-pressed={active}
                onClick={() =>
                  patchStyle({
                    positionX: cell.positionX,
                    positionY: cell.positionY,
                  })
                }
                className={
                  active
                    ? 'bg-primary text-primary-foreground rounded-sm py-1 text-xs'
                    : 'text-muted-foreground hover:text-foreground rounded-sm py-1 text-xs'
                }
              >
                {cell.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="grid gap-1 text-[11px]">
          <span>{labels.background}</span>
          <input
            type="color"
            value={style.background ?? '#000000'}
            className="border-input bg-background h-7 w-full rounded-md border px-1"
            onChange={(event) => patchStyle({ background: event.target.value })}
          />
        </label>
        <label className="grid gap-1 text-[11px]">
          <span>{labels.maxWidth}</span>
          <input
            type="range"
            min={0.2}
            max={1}
            step={0.05}
            value={style.maxWidth ?? 0.8}
            className="accent-primary w-full"
            onChange={(event) =>
              patchStyle({ maxWidth: Number(event.currentTarget.value) })
            }
          />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="grid gap-1 text-[11px]">
          <span>{labels.strokeColor}</span>
          <input
            type="color"
            value={style.strokeColor ?? '#000000'}
            className="border-input bg-background h-7 w-full rounded-md border px-1"
            onChange={(event) =>
              patchStyle({ strokeColor: event.target.value })
            }
          />
        </label>
        <label className="grid gap-1 text-[11px]">
          <span className="flex items-center justify-between">
            <span>{labels.strokeWidth}</span>
            <span className="text-muted-foreground tabular-nums">
              {(style.strokeWidth ?? 0).toFixed(1)}
            </span>
          </span>
          <input
            type="range"
            min={0}
            max={16}
            step={0.5}
            value={style.strokeWidth ?? 0}
            className="accent-primary w-full"
            onChange={(event) =>
              patchStyle({ strokeWidth: Number(event.currentTarget.value) })
            }
          />
        </label>
      </div>

      <CaptionShadowSubsection
        style={style}
        labels={labels}
        patchStyle={patchStyle}
      />
    </div>
  );
}

function ToggleButton({
  label,
  pressed,
  onClick,
  children,
}: {
  label: string;
  pressed: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      onClick={onClick}
      className={
        pressed
          ? 'bg-primary text-primary-foreground flex h-7 flex-1 items-center justify-center rounded-sm'
          : 'text-muted-foreground hover:text-foreground flex h-7 flex-1 items-center justify-center rounded-sm'
      }
    >
      {children}
    </button>
  );
}
