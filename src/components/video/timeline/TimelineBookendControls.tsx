import * as Popover from '@radix-ui/react-popover';
import { Blend, X } from 'lucide-react';

import { useLanguage } from '@/shared/providers/language-provider';

import { TimelineIconButton } from './TimelineIconButton';
import { useTimelineEditorStore } from './useTimelineEditorStore';

const MIN_BOOKEND_FADE_MS = 33;
const MAX_BOOKEND_FADE_MS = 3000;
const BOOKEND_STEP_MS = 33;
const DEFAULT_INTRO_MS = 500;
const DEFAULT_OUTRO_MS = 800;

export function TimelineBookendControls() {
  const { t } = useLanguage();
  const timeline = useTimelineEditorStore((state) => state.timeline);
  const updateBookend = useTimelineEditorStore(
    (state) => state.updateTimelineBookend,
  );
  if (!timeline) return null;

  const labels = t.video.editor.timeline;
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <TimelineIconButton label={labels.bookends}>
          <Blend className="size-3.5" />
        </TimelineIconButton>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className="bg-popover text-popover-foreground border-border z-50 w-72 rounded-md border p-3 shadow-lg"
        >
          <div className="grid gap-3">
            <BookendRow
              title={labels.introFade}
              durationMs={timeline.intro?.durationMs}
              defaultDurationMs={DEFAULT_INTRO_MS}
              labels={labels}
              onChange={(durationMs) => updateBookend('intro', durationMs)}
              onClear={() => updateBookend('intro', null)}
            />
            <BookendRow
              title={labels.outroFade}
              durationMs={timeline.outro?.durationMs}
              defaultDurationMs={DEFAULT_OUTRO_MS}
              labels={labels}
              onChange={(durationMs) => updateBookend('outro', durationMs)}
              onClear={() => updateBookend('outro', null)}
            />
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function BookendRow({
  title,
  durationMs,
  defaultDurationMs,
  labels,
  onChange,
  onClear,
}: {
  title: string;
  durationMs?: number;
  defaultDurationMs: number;
  labels: {
    bookendDuration: string;
    bookendEnable: string;
    bookendRemove: string;
    bookendOff: string;
    bookendMs: string;
  };
  onChange: (durationMs: number) => void;
  onClear: () => void;
}) {
  const active = durationMs != null;
  const value = durationMs ?? defaultDurationMs;
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold">{title}</span>
        <span className="text-muted-foreground text-[11px] tabular-nums">
          {active
            ? labels.bookendMs.replace('{duration}', String(value))
            : labels.bookendOff}
        </span>
      </div>
      <label className="grid gap-1 text-[11px]">
        <span className="sr-only">{labels.bookendDuration}</span>
        <input
          type="range"
          min={MIN_BOOKEND_FADE_MS}
          max={MAX_BOOKEND_FADE_MS}
          step={BOOKEND_STEP_MS}
          value={value}
          className="accent-primary w-full"
          onChange={(event) => onChange(Number(event.currentTarget.value))}
        />
      </label>
      <div className="flex justify-end">
        {active ? (
          <button
            type="button"
            className="border-border text-muted-foreground hover:bg-accent hover:text-foreground inline-flex size-7 items-center justify-center rounded-md border"
            title={labels.bookendRemove}
            aria-label={labels.bookendRemove}
            onClick={onClear}
          >
            <X className="size-3.5" />
          </button>
        ) : (
          <button
            type="button"
            className="bg-secondary text-secondary-foreground hover:bg-secondary/80 h-7 rounded-md px-2 text-[11px] font-medium"
            onClick={() => onChange(defaultDurationMs)}
          >
            {labels.bookendEnable}
          </button>
        )}
      </div>
    </div>
  );
}
