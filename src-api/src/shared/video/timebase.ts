import {
  frameRatePresetFor,
  frameRatesEqual,
  frameRateToNumber,
  normalizeFrameRate,
  snapObservedFrameRate,
  type FrameRate,
} from '@neumar/video-ir';

import type { MediaItem, VideoTimeline } from './types';

export const DEFAULT_PROJECT_FRAME_RATE: FrameRate = { num: 30, den: 1 };

export type TimebaseSource = 'user' | 'derived';

export interface ProjectTimebase {
  rate: FrameRate;
  source: TimebaseSource;
  locked: boolean;
}

export type TimebaseDerivationReason =
  | 'no-sources'
  | 'single-rate'
  | 'majority-rate'
  | 'conflicting-rates';

export interface TimebaseSourceObservation {
  assetId: string;
  path: string;
  observedFrameRate: number;
  rate: FrameRate;
}

export interface DerivedTimebase {
  rate: FrameRate;
  reason: TimebaseDerivationReason;
  /** Every asset that carried a usable frame rate, in project order. */
  observations: TimebaseSourceObservation[];
  /**
   * The rates that lost. Empty unless `reason` is `conflicting-rates`; the
   * setting UI shows these so a user locking a timebase can see what will be
   * re-snapped against it.
   */
  conflicts: Array<{ rate: FrameRate; assetIds: string[] }>;
}

/**
 * Survey every asset's frame rate and propose a project timebase.
 *
 * This replaces the old `deriveTimelineFps()`, which returned
 * `Math.round(firstAssetFrameRate)` — turning 23.976 into 24 and 29.97 into 30
 * with nothing recorded about the rounding or about the other assets it never
 * looked at. Here the rate stays rational, every source is surveyed, and the
 * caller gets the reason and the losing rates so it can ask before locking.
 */
export function deriveProjectTimebase(assets: MediaItem[]): DerivedTimebase {
  const observations: TimebaseSourceObservation[] = [];
  for (const asset of assets) {
    const observed = asset.metadata.frameRate;
    if (typeof observed !== 'number' || !Number.isFinite(observed)) continue;
    if (observed <= 0) continue;
    observations.push({
      assetId: asset.id,
      path: asset.path,
      observedFrameRate: observed,
      rate: snapObservedFrameRate(observed),
    });
  }

  if (observations.length === 0) {
    return {
      rate: { ...DEFAULT_PROJECT_FRAME_RATE },
      reason: 'no-sources',
      observations,
      conflicts: [],
    };
  }

  // Group by reduced rate so 30000/1001 and 60000/2002 count as one rate.
  const groups: Array<{ rate: FrameRate; assetIds: string[] }> = [];
  for (const observation of observations) {
    const group = groups.find((entry) =>
      frameRatesEqual(entry.rate, observation.rate),
    );
    if (group) group.assetIds.push(observation.assetId);
    else
      groups.push({ rate: observation.rate, assetIds: [observation.assetId] });
  }

  if (groups.length === 1) {
    return {
      rate: { ...groups[0]!.rate },
      reason: 'single-rate',
      observations,
      conflicts: [],
    };
  }

  // Most-used rate wins. Ties break toward the higher rate, because
  // conforming down loses frames that conforming up does not.
  const ranked = [...groups].sort((left, right) => {
    if (right.assetIds.length !== left.assetIds.length) {
      return right.assetIds.length - left.assetIds.length;
    }
    return frameRateToNumber(right.rate) - frameRateToNumber(left.rate);
  });
  const winner = ranked[0]!;
  const contested = ranked.some(
    (group) =>
      group !== winner && group.assetIds.length === winner.assetIds.length,
  );

  return {
    rate: { ...winner.rate },
    reason: contested ? 'conflicting-rates' : 'majority-rate',
    observations,
    conflicts: ranked
      .filter((group) => group !== winner)
      .map((group) => ({
        rate: { ...group.rate },
        assetIds: [...group.assetIds],
      })),
  };
}

/**
 * The timebase a project is actually on right now. A stored `timebase` wins; a
 * legacy timeline is read through its optional `frameRate`, then its numeric
 * `fps`. Nothing here writes to the document — old projects keep whatever they
 * have until a user chooses a rate.
 */
export function resolveTimebase(input: {
  stored?: ProjectTimebase;
  timeline?: Pick<VideoTimeline, 'fps' | 'frameRate'>;
  assets?: MediaItem[];
}): ProjectTimebase {
  if (input.stored) {
    return {
      rate: normalizeFrameRate(input.stored.rate),
      source: input.stored.source,
      locked: input.stored.locked,
    };
  }
  const timelineRate = input.timeline?.frameRate ?? input.timeline?.fps;
  if (timelineRate !== undefined) {
    return {
      rate: normalizeFrameRate(timelineRate),
      source: 'derived',
      locked: false,
    };
  }
  return {
    rate: deriveProjectTimebase(input.assets ?? []).rate,
    source: 'derived',
    locked: false,
  };
}

/**
 * The numeric `fps` older builds and older documents read. Derived, never the
 * source of truth: a 30000/1001 project stores 29.97 here and still cuts on
 * exact NTSC frame boundaries.
 */
export function compatibilityFps(rate: FrameRate): number {
  const value = frameRateToNumber(rate);
  return Number.isInteger(value) ? value : Number(value.toFixed(3));
}

export function describeFrameRate(rate: FrameRate): string {
  const preset = frameRatePresetFor(rate);
  if (preset) return preset.label;
  return `${rate.num}/${rate.den}`;
}
