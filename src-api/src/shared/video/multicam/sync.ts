import {
  durationMsToFrames,
  normalizeFrameRate,
  type FrameRate,
  type FrameRateLike,
} from '@neumar/video-ir';

import {
  referenceCamera,
  type MulticamManifest,
  type MulticamSyncMode,
} from './manifest';

export const MULTICAM_SYNC_SCHEMA_ID = 'neuma.video.multicam-sync.v1';

/**
 * One measurement of how far a camera sits from the reference, at a known
 * moment. Several of these are what let `fitDrift` tell a fixed offset apart
 * from a clock that is running slow.
 */
export interface SyncObservation {
  /** Where in the reference camera's timeline this was measured. */
  atReferenceMs: number;
  /** Positive means this camera is behind the reference at that moment. */
  offsetMs: number;
  /** 0..1. Cross-correlation supplies this; manual and timecode are certain. */
  confidence?: number;
}

export interface CameraSync {
  cameraId: string;
  /** Offset at the start of the reference timeline. */
  offsetMs: number;
  /**
   * Parts per million of clock drift. Positive means this camera's clock runs
   * slow and falls further behind as the recording goes on.
   */
  driftPpm: number;
  /** Rounded to the project timebase, which is what the timeline can express. */
  offsetFrames: number;
  confidence: number;
  observations: SyncObservation[];
  /** How this camera's numbers were arrived at. */
  method: MulticamSyncMode | 'reference';
}

export interface SyncMap {
  schema: typeof MULTICAM_SYNC_SCHEMA_ID;
  manifestId: string;
  referenceCameraId: string;
  frameRate: FrameRate;
  cameras: CameraSync[];
  /** sha256 of the sources this map was derived from; see fingerprint.ts. */
  sourceFingerprint: string;
}

/**
 * A straight-line fit of offset against reference time.
 *
 * One observation can only ever be a fixed offset. Assuming that for a long
 * recording is the classic multicamera failure: two cameras start in sync,
 * their clocks differ by a few parts per million, and by the end of an hour the
 * cut lands a frame or two late. With two or more observations the slope is
 * recoverable, so that is what this returns.
 */
export function fitDrift(observations: SyncObservation[]): {
  offsetMs: number;
  driftPpm: number;
  confidence: number;
} {
  if (observations.length === 0) {
    return { offsetMs: 0, driftPpm: 0, confidence: 0 };
  }
  const meanConfidence =
    observations.reduce(
      (total, observation) => total + (observation.confidence ?? 1),
      0,
    ) / observations.length;

  if (observations.length === 1) {
    return {
      offsetMs: observations[0]!.offsetMs,
      driftPpm: 0,
      confidence: meanConfidence,
    };
  }

  const n = observations.length;
  const meanX =
    observations.reduce((total, entry) => total + entry.atReferenceMs, 0) / n;
  const meanY =
    observations.reduce((total, entry) => total + entry.offsetMs, 0) / n;

  let numerator = 0;
  let denominator = 0;
  for (const observation of observations) {
    const dx = observation.atReferenceMs - meanX;
    numerator += dx * (observation.offsetMs - meanY);
    denominator += dx * dx;
  }

  // Every observation at the same instant: no slope is recoverable, so this is
  // a fixed offset measured several times rather than a drift measurement.
  if (denominator === 0) {
    return { offsetMs: meanY, driftPpm: 0, confidence: meanConfidence };
  }

  const slope = numerator / denominator;
  return {
    offsetMs: meanY - slope * meanX,
    // Slope is ms of drift per ms elapsed; parts per million is that times 1e6.
    driftPpm: slope * 1_000_000,
    confidence: meanConfidence,
  };
}

/** Where a reference-time instant lands on one camera's own clock. */
export function referenceMsToCameraMs(
  sync: Pick<CameraSync, 'offsetMs' | 'driftPpm'>,
  referenceMs: number,
): number {
  return (
    referenceMs + sync.offsetMs + (referenceMs * sync.driftPpm) / 1_000_000
  );
}

export interface BuildSyncMapInput {
  manifest: MulticamManifest;
  frameRate: FrameRateLike;
  /** Observations per camera id. Manual mode supplies none. */
  observations?: Record<string, SyncObservation[]>;
  sourceFingerprint: string;
}

/**
 * Resolve every camera's offset against the reference.
 *
 * Manual offsets are the base case and always available. Observations — from
 * timecode or, behind its flag, audio correlation — refine them when present.
 * The reference camera is always zero by definition; recording an offset for it
 * would mean the map disagreed with its own reference.
 */
export function buildSyncMap(input: BuildSyncMapInput): SyncMap {
  const rate = normalizeFrameRate(input.frameRate);
  const reference = referenceCamera(input.manifest);

  const cameras = input.manifest.cameras.map<CameraSync>((camera) => {
    if (camera.id === reference.id) {
      return {
        cameraId: camera.id,
        offsetMs: 0,
        driftPpm: 0,
        offsetFrames: 0,
        confidence: 1,
        observations: [],
        method: 'reference',
      };
    }

    const observations = input.observations?.[camera.id] ?? [];
    if (observations.length > 0) {
      const fit = fitDrift(observations);
      return {
        cameraId: camera.id,
        offsetMs: fit.offsetMs,
        driftPpm: fit.driftPpm,
        offsetFrames: offsetToFrames(fit.offsetMs, rate),
        confidence: fit.confidence,
        observations,
        method: input.manifest.syncMode,
      };
    }

    const manualOffset = camera.offsetMs ?? 0;
    return {
      cameraId: camera.id,
      offsetMs: manualOffset,
      driftPpm: 0,
      offsetFrames: offsetToFrames(manualOffset, rate),
      // A manual offset is exactly as certain as the person who typed it, which
      // for our purposes is certain: it is a stated intent, not a measurement.
      confidence: 1,
      observations: [],
      method: 'manual',
    };
  });

  return {
    schema: MULTICAM_SYNC_SCHEMA_ID,
    manifestId: input.manifest.id,
    referenceCameraId: reference.id,
    frameRate: rate,
    cameras,
    sourceFingerprint: input.sourceFingerprint,
  };
}

/** Signed offsets need signed rounding; durationMsToFrames rejects negatives. */
function offsetToFrames(offsetMs: number, rate: FrameRate): number {
  const magnitude = durationMsToFrames(Math.abs(offsetMs), rate, 'nearest');
  return offsetMs < 0 ? -magnitude : magnitude;
}

export function cameraSync(
  map: SyncMap,
  cameraId: string,
): CameraSync | undefined {
  return map.cameras.find((camera) => camera.cameraId === cameraId);
}
