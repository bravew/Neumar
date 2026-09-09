import { createHash } from 'node:crypto';

import type { TimelineOp, TimelineOpBatch } from '@neumar/video-ir';

import type { MulticamManifest } from './manifest';
import {
  acceptedShots,
  effectiveCameraId,
  type ReviewArtifact,
  type ReviewedShot,
} from './review';
import { referenceMsToCameraMs, type SyncMap } from './sync';

export interface ApplyPlanInput {
  manifest: MulticamManifest;
  review: ReviewArtifact;
  syncMap: SyncMap;
  /** Track the multicamera cut is laid onto. */
  trackId: string;
}

export interface ApplyPlanResult {
  batch: TimelineOpBatch;
  batchId: string;
  clipIds: string[];
  summary: string;
}

/**
 * Turn accepted review decisions into one named timeline batch.
 *
 * One batch, not one op per shot: undo has to take the whole cut back in a
 * single step, or a user who dislikes the result has to press undo forty times.
 *
 * The batch id is derived from the plan fingerprint and the review revision, so
 * the same review applied twice produces the same id — that is what makes a
 * repeat request recognisable as a repeat rather than a second set of clips.
 */
export function buildApplyBatch(input: ApplyPlanInput): ApplyPlanResult {
  const shots = acceptedShots(input.review);
  const batchId = applyBatchId(input.review);

  const ops: TimelineOp[] = [];
  const clipIds: string[] = [];

  for (const shot of shots) {
    const cameraId = effectiveCameraId(shot);
    const camera = input.manifest.cameras.find(
      (candidate) => candidate.id === cameraId,
    );
    if (!camera) continue;

    const sync = input.syncMap.cameras.find(
      (candidate) => candidate.cameraId === cameraId,
    );
    // Where this shot's start lands on the camera's own clock. Without this the
    // clip would play from the wrong frames on every non-reference angle.
    const sourceStartMs = sync
      ? Math.max(0, Math.round(referenceMsToCameraMs(sync, shot.startMs)))
      : shot.startMs;
    const durationMs = shot.endMs - shot.startMs;
    const clipId = `${batchId}-${shot.id}`.replace(/[^a-zA-Z0-9_@-]/g, '-');
    clipIds.push(clipId);

    ops.push({
      kind: 'clip.insert',
      trackId: input.trackId,
      at: shot.startMs,
      clip: {
        id: clipId,
        kind: 'video',
        sourceRef: { kind: 'asset', assetId: camera.assetId },
        startMs: shot.startMs,
        durationMs,
        trimStartMs: sourceStartMs,
        trimEndMs: sourceStartMs + durationMs,
        // Provenance travels with the clip, so a later export or a reviewer
        // opening the project cold can still say which angle this came from and
        // why the planner chose it.
        params: {
          multicamGroupId: input.manifest.id,
          multicamCameraId: cameraId,
          multicamPlanBatchId: batchId,
          multicamReviewRevision: input.review.revision,
          multicamReason: shot.reason,
          multicamSourceStartMs: sourceStartMs,
          ...(shot.participantId
            ? { multicamParticipantId: shot.participantId }
            : {}),
          ...(shot.overriddenCameraId ? { multicamOverridden: true } : {}),
          ...(sync
            ? {
                multicamSyncOffsetMs: sync.offsetMs,
                multicamSyncDriftPpm: sync.driftPpm,
              }
            : {}),
        },
      },
    } as TimelineOp);
  }

  return {
    batch: { kind: 'timeline.batch', ops },
    batchId,
    clipIds,
    summary: summarize(input.manifest, shots),
  };
}

/**
 * Stable for a given plan and review revision. Deriving it rather than
 * generating a UUID is what lets `alreadyApplied()` recognise a repeat.
 */
export function applyBatchId(review: ReviewArtifact): string {
  const digest = createHash('sha256')
    .update(`${review.manifestId}:${review.planFingerprint}:${review.revision}`)
    .digest('hex')
    .slice(0, 16);
  return `multicam-${digest}`;
}

/**
 * Whether this exact review revision has already been applied.
 *
 * The plan's requirement is that reapplying the same plan id and review revision
 * returns the prior result instead of duplicating clips. A review that has moved
 * on since it was applied is a different revision and is not a repeat.
 */
export function alreadyApplied(
  review: ReviewArtifact,
): ReviewArtifact['applied'] | null {
  if (!review.applied) return null;
  return review.applied.reviewRevision === review.revision
    ? review.applied
    : null;
}

function summarize(manifest: MulticamManifest, shots: ReviewedShot[]): string {
  if (shots.length === 0) return `No accepted shots in ${manifest.label}`;
  const overridden = shots.filter((shot) => shot.overriddenCameraId).length;
  const spanMs = (shots.at(-1)?.endMs ?? 0) - (shots[0]?.startMs ?? 0);
  const seconds = Math.round(spanMs / 1000);
  const base = `Apply ${shots.length} multicamera shot${shots.length === 1 ? '' : 's'} across ${seconds}s of ${manifest.label}`;
  return overridden > 0 ? `${base} (${overridden} manually re-angled)` : base;
}
