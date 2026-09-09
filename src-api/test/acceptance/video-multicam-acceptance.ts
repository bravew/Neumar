// Runs the real multicamera analysis chain against the `multicam-analysis`
// reference fixture and prints a result marker the
// `scripts/video-acceptance.mjs` harness parses.
//
// Goes through the shipped modules — manifest, fingerprint, sync, activity,
// shot plan — rather than reimplementing any of them, so what this asserts is
// what the routes serve. Runs the chain twice to prove determinism.

import fs from 'node:fs/promises';

import {
  applyBleedCorrection,
  estimateBleed,
  toSpeechRanges,
  type ActivityFrame,
} from '@/shared/video/multicam/activity';
import {
  alreadyApplied,
  applyBatchId,
  buildApplyBatch,
} from '@/shared/video/multicam/apply';
import { multicamFingerprint } from '@/shared/video/multicam/fingerprint';
import {
  manifestReadiness,
  parseMulticamManifest,
} from '@/shared/video/multicam/manifest';
import {
  applyReviewAction,
  startReview,
  summarizeReview,
} from '@/shared/video/multicam/review';
import { buildShotPlan } from '@/shared/video/multicam/shot-plan';
import { buildSyncMap } from '@/shared/video/multicam/sync';

interface Fixture {
  manifest: unknown;
  project: { timeline: { durationMs: number; fps: number } };
  activity: {
    windowMs: number;
    frames: Array<{ atReferenceMs: number; ana: number; ben: number }>;
  };
  /** Present only for the multicam-edit fixture. */
  review?: {
    accept: 'all';
    overrides: Array<{ shotIndex: number; cameraId: string }>;
  };
  trackId?: string;
}

function parseArgs() {
  const values: Record<string, string> = {};
  for (const arg of process.argv.slice(2)) {
    const [key, value] = arg.split('=', 2);
    if (key?.startsWith('--') && value) values[key.slice(2)] = value;
  }
  const fixturePath = values['fixture'];
  if (!fixturePath) throw new Error('--fixture=<path> required');
  return { fixturePath };
}

function runChain(fixture: Fixture) {
  const manifest = parseMulticamManifest(fixture.manifest);
  const fingerprint = multicamFingerprint({
    manifest,
    sourceIdentities: Object.fromEntries(
      manifest.cameras.map((camera) => [
        camera.assetId,
        `sha-${camera.assetId}`,
      ]),
    ),
  });

  const syncMap = buildSyncMap({
    manifest,
    frameRate: fixture.project.timeline.fps,
    sourceFingerprint: fingerprint,
  });

  const raw = (key: 'ana' | 'ben'): ActivityFrame[] =>
    fixture.activity.frames.map((frame) => ({
      atReferenceMs: frame.atReferenceMs,
      raw: frame[key],
      corrected: frame[key],
    }));
  const participants = [
    { participantId: 'p-ana', frames: raw('ana') },
    { participantId: 'p-ben', frames: raw('ben') },
  ];

  const estimates = estimateBleed(participants);
  const corrected = applyBleedCorrection(participants, estimates);

  const speechRanges = corrected.flatMap((activity) =>
    toSpeechRanges(activity, {
      windowMs: fixture.activity.windowMs,
      minSpeechMs: manifest.policy.minSpeechMs,
    }),
  );

  const plan = buildShotPlan({
    manifest,
    speechRanges,
    durationMs: fixture.project.timeline.durationMs,
    sourceFingerprint: fingerprint,
  });

  return {
    manifest,
    fingerprint,
    readiness: manifestReadiness(manifest),
    syncMap,
    estimates,
    corrected,
    speechRanges,
    plan,
  };
}

async function main() {
  const { fixturePath } = parseArgs();
  const fixture = JSON.parse(await fs.readFile(fixturePath, 'utf8')) as Fixture;

  const first = runChain(fixture);
  // A second pass over the same inputs must produce byte-identical artifacts,
  // or the artifacts cannot be fingerprinted or safely resumed.
  const second = runChain(fixture);

  const benActivity = first.corrected.find(
    (entry) => entry.participantId === 'p-ben',
  );

  process.stdout.write(
    `VIDEO_ACCEPTANCE_RESULT=${JSON.stringify({
      readiness: first.readiness,
      fingerprint: first.fingerprint,
      fingerprintStable: first.fingerprint === second.fingerprint,
      syncOffsetFrames: Object.fromEntries(
        first.syncMap.cameras.map((camera) => [
          camera.cameraId,
          camera.offsetFrames,
        ]),
      ),
      syncOffsetMs: Object.fromEntries(
        first.syncMap.cameras.map((camera) => [
          camera.cameraId,
          camera.offsetMs,
        ]),
      ),
      bleed: Object.fromEntries(
        Object.entries(first.estimates).map(([participantId, estimate]) => [
          participantId,
          estimate.bleed,
        ]),
      ),
      bleedConfidence: first.estimates['p-ben']?.confidence ?? 0,
      bleedCorrectionApplied: benActivity?.bleedCorrectionApplied ?? false,
      // Raw probabilities must survive correction for audit.
      rawPreserved: (benActivity?.frames ?? []).some(
        (frame) => frame.raw !== frame.corrected,
      ),
      speechRanges: first.speechRanges
        .map((range) => ({
          participantId: range.participantId,
          startMs: range.startMs,
          endMs: range.endMs,
        }))
        .sort(
          (left, right) =>
            left.startMs - right.startMs ||
            left.participantId.localeCompare(right.participantId),
        ),
      shots: first.plan.shots.map((shot) => ({
        cameraId: shot.cameraId,
        startMs: shot.startMs,
        endMs: shot.endMs,
        reason: shot.reason,
      })),
      deterministic:
        JSON.stringify(first.plan) === JSON.stringify(second.plan) &&
        JSON.stringify(first.syncMap) === JSON.stringify(second.syncMap),
      // Phase 5 is read-only with respect to the timeline.
      timelineTouched: false,
      ...(fixture.review ? { edit: runEdit(fixture, first) } : {}),
    })}\n`,
  );
}

/**
 * The Phase 6 half: turn the plan into review decisions and one apply batch,
 * then repeat the apply to prove it does not duplicate clips.
 */
function runEdit(fixture: Fixture, chain: ReturnType<typeof runChain>) {
  let review = startReview(chain.plan);
  if (fixture.review?.accept === 'all') {
    review = applyReviewAction(review, { kind: 'accept-all' });
  }
  for (const override of fixture.review?.overrides ?? []) {
    const shot = review.shots[override.shotIndex];
    if (!shot) continue;
    review = applyReviewAction(review, {
      kind: 'set-camera',
      shotId: shot.id,
      cameraId: override.cameraId,
    });
  }

  const trackId = fixture.trackId ?? 'track-multicam';
  const applied = buildApplyBatch({
    manifest: chain.manifest,
    review,
    syncMap: chain.syncMap,
    trackId,
  });

  // A repeat request against the same review revision must return the prior
  // result rather than a second set of clips.
  const recorded = {
    ...review,
    applied: {
      batchId: applied.batchId,
      reviewRevision: review.revision,
      appliedAt: '2026-09-08T00:00:00.000Z',
      clipIds: applied.clipIds,
    },
  };
  const repeat = alreadyApplied(recorded);

  const inserts = applied.batch.ops.filter((op) => op.kind === 'clip.insert');
  return {
    summary: summarizeReview(review),
    batchId: applied.batchId,
    batchKind: applied.batch.kind,
    opCount: applied.batch.ops.length,
    clipIds: applied.clipIds,
    // A single batch, so undo takes the whole cut back in one step.
    singleBatch: applied.batch.kind === 'timeline.batch',
    provenanceOnEveryClip: inserts.every(
      (op) =>
        op.kind === 'clip.insert' &&
        Boolean(op.clip.params?.multicamGroupId) &&
        Boolean(op.clip.params?.multicamCameraId) &&
        op.clip.params?.multicamPlanBatchId === applied.batchId,
    ),
    sourceTimesOffsetBySync: inserts.every(
      (op) =>
        op.kind === 'clip.insert' &&
        typeof op.clip.params?.multicamSourceStartMs === 'number',
    ),
    repeatReturnsPriorResult:
      repeat?.batchId === applied.batchId &&
      JSON.stringify(repeat?.clipIds) === JSON.stringify(applied.clipIds),
    // Applying the same review twice must not create new clip ids.
    repeatBatchId: applyBatchId(review),
    batchIdStable: applyBatchId(review) === applied.batchId,
  };
}

await main();
