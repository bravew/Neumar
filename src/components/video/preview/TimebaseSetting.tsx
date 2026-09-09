import { useState } from 'react';

import { frameRatePresets, frameRatesEqual } from '@neumar/video-ir';

import { Button } from '@/components/ui/button';
import {
  countResnappedBoundaries,
  timelineFrameRate,
} from '@/components/video/timeline/outputRange';
import { useLanguage } from '@/shared/providers/language-provider';
import type { VideoTimeline } from '@/shared/types/video';

interface TimebaseSettingProps {
  timeline: VideoTimeline | null;
  locked: boolean;
  source: 'user' | 'derived';
  /** How many distinct rates the project's footage carries, when known. */
  sourceRateCount?: number;
  onChangeRate: (presetId: string) => void;
  onToggleLocked: (locked: boolean) => void;
}

/**
 * Project frame-rate control.
 *
 * Changing a rate re-snaps every clip boundary that does not already land on
 * the new grid, and that is invisible until it has happened — so the confirm
 * step names the count before the change is applied rather than after.
 */
export function TimebaseSetting({
  timeline,
  locked,
  source,
  sourceRateCount,
  onChangeRate,
  onToggleLocked,
}: TimebaseSettingProps) {
  const { t } = useLanguage();
  const labels = t.video.editor.timeline.timebase;
  const [pendingPresetId, setPendingPresetId] = useState<string | null>(null);

  const presets = frameRatePresets();
  const currentRate = timelineFrameRate(timeline ?? undefined);
  const currentPreset = presets.find((preset) =>
    frameRatesEqual(preset.rate, currentRate),
  );
  const pendingPreset = presets.find((preset) => preset.id === pendingPresetId);
  const resnapCount =
    pendingPreset && timeline
      ? countResnappedBoundaries(timeline, currentRate, pendingPreset.rate)
      : 0;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <label className="text-sm font-medium" htmlFor="video-timebase-rate">
          {labels.label}
        </label>
        <span className="text-muted-foreground text-xs">
          {source === 'user' ? labels.chosen : labels.derived}
          {locked ? ` · ${labels.locked}` : ''}
        </span>
      </div>
      <p className="text-muted-foreground text-xs">{labels.description}</p>
      <select
        id="video-timebase-rate"
        className="border-input bg-background w-full rounded-md border px-2 py-1 text-sm"
        value={currentPreset?.id ?? ''}
        disabled={locked}
        onChange={(event) => setPendingPresetId(event.target.value)}
      >
        {currentPreset ? null : (
          // A project on a rate outside the preset list keeps showing it until
          // the user picks a replacement.
          <option value="">{formatUnknown(currentRate)}</option>
        )}
        {presets.map((preset) => (
          <option key={preset.id} value={preset.id}>
            {preset.label}
          </option>
        ))}
      </select>
      {sourceRateCount !== undefined && sourceRateCount > 1 ? (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          {labels.conflict.replace('{count}', String(sourceRateCount))}
        </p>
      ) : null}
      {pendingPreset ? (
        <div className="border-border space-y-2 rounded-md border p-2">
          <p className="text-xs">
            {labels.resnapWarning.replace('{count}', String(resnapCount))}
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => {
                onChangeRate(pendingPreset.id);
                setPendingPresetId(null);
              }}
            >
              {labels.confirmChange}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setPendingPresetId(null)}
            >
              {labels.cancelChange.replace(
                '{rate}',
                currentPreset?.label ?? formatUnknown(currentRate),
              )}
            </Button>
          </div>
        </div>
      ) : null}
      <Button
        size="sm"
        variant="outline"
        onClick={() => onToggleLocked(!locked)}
      >
        {locked ? labels.unlock : labels.lock}
      </Button>
    </div>
  );
}

function formatUnknown(rate: ReturnType<typeof timelineFrameRate>): string {
  return typeof rate === 'number' ? String(rate) : `${rate.num}/${rate.den}`;
}
