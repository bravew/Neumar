import { describe, expect, it } from 'vitest';

import {
  alreadyApplied,
  applyBatchId,
  buildApplyBatch,
} from '@/shared/video/multicam/apply';
import {
  parseMulticamManifest,
  type MulticamManifest,
} from '@/shared/video/multicam/manifest';
import {
  applyReviewAction,
  ReviewActionError,
  startReview,
  summarizeReview,
  type ReviewArtifact,
} from '@/shared/video/multicam/review';
import { buildShotPlan } from '@/shared/video/multicam/shot-plan';
import { buildSyncMap } from '@/shared/video/multicam/sync';

function manifest(): MulticamManifest {
  return parseMulticamManifest({
    schema: 'neuma.video.multicam-manifest.v1',
    id: 'group-1',
    label: 'Panel',
    referenceCameraId: 'cam-wide',
    participants: [
      { id: 'p-ana', name: 'Ana' },
      { id: 'p-ben', name: 'Ben' },
    ],
    cameras: [
      { id: 'cam-wide', label: 'Wide', type: 'wide', assetId: 'asset-wide' },
      {
        id: 'cam-ana',
        label: 'Ana',
        type: 'close',
        assetId: 'asset-ana',
        participantId: 'p-ana',
        isolatedAudioAssetId: 'mic-ana',
        offsetMs: 500,
      },
      {
        id: 'cam-ben',
        label: 'Ben',
        type: 'close',
        assetId: 'asset-ben',
        participantId: 'p-ben',
        isolatedAudioAssetId: 'mic-ben',
      },
    ],
    policy: { cutLeadMs: 0, minShotMs: 1000, maxShotMs: 30_000 },
  });
}

function planFixture() {
  return buildShotPlan({
    manifest: manifest(),
    speechRanges: [
      {
        participantId: 'p-ana',
        startMs: 2000,
        endMs: 6000,
        meanProbability: 0.9,
      },
      {
        participantId: 'p-ben',
        startMs: 8000,
        endMs: 12_000,
        meanProbability: 0.9,
      },
    ],
    durationMs: 14_000,
    sourceFingerprint: 'plan-fp',
  });
}

function reviewFixture(): ReviewArtifact {
  return startReview(planFixture());
}

describe('review artifact', () => {
  it('starts every shot pending', () => {
    const review = reviewFixture();

    expect(review.revision).toBe(0);
    expect(review.shots.every((shot) => shot.decision === 'pending')).toBe(
      true,
    );
    expect(summarizeReview(review)).toMatchObject({
      accepted: 0,
      pending: review.shots.length,
      applied: false,
    });
  });

  it('bumps the revision on every decision', () => {
    const review = reviewFixture();
    const first = applyReviewAction(review, {
      kind: 'accept',
      shotId: review.shots[1]!.id,
    });
    const second = applyReviewAction(first, {
      kind: 'reject',
      shotId: review.shots[0]!.id,
    });

    expect(first.revision).toBe(1);
    expect(second.revision).toBe(2);
    expect(summarizeReview(second)).toMatchObject({ accepted: 1, rejected: 1 });
  });

  it('treats choosing a camera as accepting the shot', () => {
    const review = reviewFixture();
    const next = applyReviewAction(review, {
      kind: 'set-camera',
      shotId: review.shots[0]!.id,
      cameraId: 'cam-ben',
    });

    // Nobody picks an angle for a shot they intend to drop.
    expect(next.shots[0]).toMatchObject({
      decision: 'accepted',
      overriddenCameraId: 'cam-ben',
    });
  });

  it('moves a cut boundary and takes the time from the neighbour', () => {
    const review = reviewFixture();
    const next = applyReviewAction(review, {
      kind: 'nudge',
      shotId: review.shots[1]!.id,
      deltaMs: -500,
    });

    expect(next.shots[0]?.endMs).toBe(review.shots[0]!.endMs - 500);
    expect(next.shots[1]?.startMs).toBe(review.shots[1]!.startMs - 500);
    // No gap opened between them.
    expect(next.shots[0]?.endMs).toBe(next.shots[1]?.startMs);
  });

  it('refuses a nudge that would collapse a shot', () => {
    const review = reviewFixture();

    expect(() =>
      applyReviewAction(review, {
        kind: 'nudge',
        shotId: review.shots[1]!.id,
        deltaMs: 999_999,
      }),
    ).toThrow(ReviewActionError);
  });

  it('refuses to nudge the first shot, which has no preceding cut', () => {
    const review = reviewFixture();

    expect(() =>
      applyReviewAction(review, {
        kind: 'nudge',
        shotId: review.shots[0]!.id,
        deltaMs: 100,
      }),
    ).toThrow('no preceding cut');
  });

  it('rejects an action against a shot that is not in the review', () => {
    expect(() =>
      applyReviewAction(reviewFixture(), {
        kind: 'accept',
        shotId: 'cam-nope@0',
      }),
    ).toThrow('No shot');
  });

  it('accepts every shot at once', () => {
    const next = applyReviewAction(reviewFixture(), { kind: 'accept-all' });

    expect(summarizeReview(next).pending).toBe(0);
  });

  it('refuses further edits once the review has been applied', () => {
    const review = {
      ...reviewFixture(),
      applied: {
        batchId: 'multicam-x',
        reviewRevision: 0,
        appliedAt: '2026-09-08T00:00:00.000Z',
        clipIds: [],
      },
    };

    expect(() => applyReviewAction(review, { kind: 'accept-all' })).toThrow(
      'already been applied',
    );
  });
});

describe('apply batch', () => {
  const syncMap = buildSyncMap({
    manifest: manifest(),
    frameRate: 30,
    sourceFingerprint: 'plan-fp',
  });

  it('emits one batch, not one op per shot', () => {
    const review = applyReviewAction(reviewFixture(), { kind: 'accept-all' });
    const result = buildApplyBatch({
      manifest: manifest(),
      review,
      syncMap,
      trackId: 'track-multicam',
    });

    // Undo has to take the whole cut back in a single step.
    expect(result.batch.kind).toBe('timeline.batch');
    expect(result.batch.ops).toHaveLength(review.shots.length);
  });

  it('includes only accepted shots', () => {
    const review = applyReviewAction(reviewFixture(), {
      kind: 'accept',
      shotId: reviewFixture().shots[1]!.id,
    });
    const result = buildApplyBatch({
      manifest: manifest(),
      review,
      syncMap,
      trackId: 'track-multicam',
    });

    expect(result.batch.ops).toHaveLength(1);
  });

  it('offsets the source time by the camera sync', () => {
    const review = applyReviewAction(reviewFixture(), { kind: 'accept-all' });
    const result = buildApplyBatch({
      manifest: manifest(),
      review,
      syncMap,
      trackId: 'track-multicam',
    });

    const anaOp = result.batch.ops.find(
      (op) =>
        op.kind === 'clip.insert' &&
        op.clip.params?.multicamCameraId === 'cam-ana',
    );
    expect(anaOp).toBeDefined();
    if (anaOp?.kind !== 'clip.insert') return;
    // Ana's camera started 500ms later, so a shot at 2000ms reference time
    // reads from 2500ms of her own footage.
    expect(anaOp.clip.trimStartMs).toBe(2500);
  });

  it('carries provenance on every clip', () => {
    const review = applyReviewAction(reviewFixture(), { kind: 'accept-all' });
    const result = buildApplyBatch({
      manifest: manifest(),
      review,
      syncMap,
      trackId: 'track-multicam',
    });

    const [first] = result.batch.ops;
    if (first?.kind !== 'clip.insert') throw new Error('expected clip.insert');
    expect(first.clip.params).toMatchObject({
      multicamGroupId: 'group-1',
      multicamPlanBatchId: result.batchId,
      multicamReviewRevision: review.revision,
    });
    expect(first.clip.params?.multicamReason).toBeTruthy();
  });

  it('records a manual override in the clip provenance', () => {
    const base = reviewFixture();
    const review = applyReviewAction(base, {
      kind: 'set-camera',
      shotId: base.shots[0]!.id,
      cameraId: 'cam-ben',
    });
    const result = buildApplyBatch({
      manifest: manifest(),
      review,
      syncMap,
      trackId: 'track-multicam',
    });

    const [first] = result.batch.ops;
    if (first?.kind !== 'clip.insert') throw new Error('expected clip.insert');
    expect(first.clip.params).toMatchObject({
      multicamCameraId: 'cam-ben',
      multicamOverridden: true,
    });
  });

  it('derives a stable batch id from the plan and review revision', () => {
    const review = applyReviewAction(reviewFixture(), { kind: 'accept-all' });

    expect(applyBatchId(review)).toBe(applyBatchId({ ...review }));
    // A further decision is a different revision, so a different batch.
    const moved = applyReviewAction(review, {
      kind: 'reject',
      shotId: review.shots[0]!.id,
    });
    expect(applyBatchId(moved)).not.toBe(applyBatchId(review));
  });
});

describe('repeat apply', () => {
  it('recognises a repeat of the same review revision', () => {
    const review = applyReviewAction(reviewFixture(), { kind: 'accept-all' });
    const applied = {
      ...review,
      applied: {
        batchId: applyBatchId(review),
        reviewRevision: review.revision,
        appliedAt: '2026-09-08T00:00:00.000Z',
        clipIds: ['clip-a'],
      },
    };

    // The plan's requirement: a repeat returns the prior result rather than a
    // second set of clips.
    expect(alreadyApplied(applied)).toMatchObject({ clipIds: ['clip-a'] });
  });

  it('does not treat a moved-on review as a repeat', () => {
    const review = applyReviewAction(reviewFixture(), { kind: 'accept-all' });
    const applied = {
      ...review,
      revision: review.revision + 1,
      applied: {
        batchId: applyBatchId(review),
        reviewRevision: review.revision,
        appliedAt: '2026-09-08T00:00:00.000Z',
        clipIds: ['clip-a'],
      },
    };

    expect(alreadyApplied(applied)).toBeNull();
  });

  it('reports nothing applied for a fresh review', () => {
    expect(alreadyApplied(reviewFixture())).toBeNull();
  });
});
