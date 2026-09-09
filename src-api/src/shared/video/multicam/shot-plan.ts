import type { SpeechRange } from './activity';
import type { MulticamManifest, MulticamPolicy } from './manifest';

export const MULTICAM_SHOT_PLAN_SCHEMA_ID = 'neuma.video.multicam-shot-plan.v1';

export type ShotReason =
  /** One participant is speaking and has a close angle. */
  | 'speaker'
  /** Nobody is speaking for long enough; hold the wide. */
  | 'silence'
  /** Two or more speakers overlap and the policy says hold the wide. */
  | 'overlap-wide'
  /** Two or more overlap and the policy says follow the loudest. */
  | 'overlap-loudest'
  /** The shot was extended to reach the policy minimum. */
  | 'min-shot'
  /** The shot was split because it reached the policy maximum. */
  | 'max-shot'
  /** A cut would have been a jump cut, so the previous angle was held. */
  | 'jump-cut-avoided';

export interface PlannedShot {
  startMs: number;
  endMs: number;
  cameraId: string;
  participantId?: string;
  reason: ShotReason;
  /** 0..1, from the speech that drove the choice. */
  confidence: number;
}

export interface ShotPlan {
  schema: typeof MULTICAM_SHOT_PLAN_SCHEMA_ID;
  manifestId: string;
  shots: PlannedShot[];
  policy: MulticamPolicy;
  sourceFingerprint: string;
}

export interface BuildShotPlanInput {
  manifest: MulticamManifest;
  speechRanges: SpeechRange[];
  durationMs: number;
  sourceFingerprint: string;
}

/**
 * Turn speech ranges into a cut list.
 *
 * Deterministic by construction: the same inputs produce the same shots, with
 * no clock, no randomness, and every tie broken by participant id. That is what
 * makes the artifact fingerprintable and lets a reviewer's corrections survive
 * a re-run.
 *
 * The plan is a proposal. It is never applied to the timeline here.
 */
export function buildShotPlan(input: BuildShotPlanInput): ShotPlan {
  const { manifest, durationMs } = input;
  const policy = manifest.policy;
  const wide = manifest.cameras.find((camera) => camera.type === 'wide');
  const closeByParticipant = new Map(
    manifest.cameras
      .filter((camera) => camera.type === 'close' && camera.participantId)
      .map((camera) => [camera.participantId!, camera]),
  );

  const boundaries = collectBoundaries(input.speechRanges, durationMs, policy);
  const segments: PlannedShot[] = [];

  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const startMs = boundaries[index]!;
    const endMs = boundaries[index + 1]!;
    if (endMs <= startMs) continue;

    const active = input.speechRanges
      .filter((range) => range.startMs < endMs && range.endMs > startMs)
      // Ties break by participant id so the plan does not depend on input order.
      .sort(
        (left, right) =>
          right.meanProbability - left.meanProbability ||
          left.participantId.localeCompare(right.participantId),
      );

    segments.push(
      chooseShot({
        startMs,
        endMs,
        active,
        closeByParticipant,
        wideId: wide?.id,
        policy,
      }),
    );
  }

  const merged = mergeAdjacent(segments);
  const withoutJumpCuts = policy.forbidJumpCuts
    ? avoidJumpCuts(merged, closeByParticipant)
    : merged;
  const shots = enforceShotLengths(withoutJumpCuts, policy);

  return {
    schema: MULTICAM_SHOT_PLAN_SCHEMA_ID,
    manifestId: manifest.id,
    shots,
    policy,
    sourceFingerprint: input.sourceFingerprint,
  };
}

/**
 * Every instant where the set of active speakers can change, plus the ends.
 * `cutLeadMs` shifts the boundaries, so a cut can land slightly before a
 * speaker starts — which is how a cut reads as intentional rather than late.
 */
function collectBoundaries(
  ranges: SpeechRange[],
  durationMs: number,
  policy: MulticamPolicy,
): number[] {
  const points = new Set<number>([0, durationMs]);
  for (const range of ranges) {
    points.add(clamp(range.startMs + policy.cutLeadMs, 0, durationMs));
    points.add(clamp(range.endMs + policy.cutLeadMs, 0, durationMs));
  }
  return [...points].sort((left, right) => left - right);
}

function chooseShot(input: {
  startMs: number;
  endMs: number;
  active: SpeechRange[];
  closeByParticipant: Map<string, { id: string }>;
  wideId?: string;
  policy: MulticamPolicy;
}): PlannedShot {
  const { startMs, endMs, active, closeByParticipant, wideId, policy } = input;

  if (active.length === 0) {
    return {
      startMs,
      endMs,
      cameraId: wideId ?? firstCameraFallback(closeByParticipant),
      reason: 'silence',
      confidence: 1,
    };
  }

  if (active.length > 1 && policy.overlapPolicy === 'wide' && wideId) {
    return {
      startMs,
      endMs,
      cameraId: wideId,
      reason: 'overlap-wide',
      confidence: active[0]!.meanProbability,
    };
  }

  const winner = active[0]!;
  const close = closeByParticipant.get(winner.participantId);
  if (!close) {
    // A speaker with no close angle: the wide is the only honest answer.
    return {
      startMs,
      endMs,
      cameraId: wideId ?? firstCameraFallback(closeByParticipant),
      reason: 'silence',
      confidence: winner.meanProbability,
    };
  }

  return {
    startMs,
    endMs,
    cameraId: close.id,
    participantId: winner.participantId,
    reason: active.length > 1 ? 'overlap-loudest' : 'speaker',
    confidence: winner.meanProbability,
  };
}

function firstCameraFallback(closeByParticipant: Map<string, { id: string }>) {
  const first = [...closeByParticipant.values()][0];
  if (!first) throw new Error('Shot plan needs at least one camera');
  return first.id;
}

/**
 * How informative a reason is when two adjacent shots on the same camera merge.
 *
 * Higher wins. Holding the wide because two people are talking over each other
 * is a different editorial decision from holding it because nobody is, and a
 * reviewer needs to see which one happened — keeping whichever reason came
 * first would report a stretch of crosstalk as silence.
 */
const REASON_SPECIFICITY: Record<ShotReason, number> = {
  silence: 0,
  'min-shot': 1,
  'max-shot': 1,
  'jump-cut-avoided': 2,
  speaker: 3,
  'overlap-loudest': 4,
  'overlap-wide': 4,
};

function mergeAdjacent(shots: PlannedShot[]): PlannedShot[] {
  const merged: PlannedShot[] = [];
  for (const shot of shots) {
    const previous = merged.at(-1);
    if (previous && previous.cameraId === shot.cameraId) {
      previous.endMs = shot.endMs;
      previous.confidence = Math.max(previous.confidence, shot.confidence);
      if (
        REASON_SPECIFICITY[shot.reason] > REASON_SPECIFICITY[previous.reason]
      ) {
        previous.reason = shot.reason;
      }
      continue;
    }
    merged.push({ ...shot });
  }
  return merged;
}

/**
 * A cut between two close angles of the *same* participant is a jump cut: the
 * subject barely moves and the edit reads as a glitch. Hold the previous angle
 * instead.
 */
function avoidJumpCuts(
  shots: PlannedShot[],
  closeByParticipant: Map<string, { id: string }>,
): PlannedShot[] {
  void closeByParticipant;
  const result: PlannedShot[] = [];
  for (const shot of shots) {
    const previous = result.at(-1);
    if (
      previous &&
      previous.participantId &&
      previous.participantId === shot.participantId &&
      previous.cameraId !== shot.cameraId
    ) {
      previous.endMs = shot.endMs;
      previous.reason = 'jump-cut-avoided';
      continue;
    }
    result.push({ ...shot });
  }
  return result;
}

/**
 * Apply the minimum and maximum shot lengths.
 *
 * A shot below the minimum is absorbed into its neighbour rather than dropped,
 * so the timeline stays gapless. A shot above the maximum is split in place,
 * which keeps the angle but gives a long take an internal beat; both carry a
 * reason so a reviewer can see the policy acted.
 */
function enforceShotLengths(
  shots: PlannedShot[],
  policy: MulticamPolicy,
): PlannedShot[] {
  const absorbed: PlannedShot[] = [];
  for (const shot of shots) {
    const previous = absorbed.at(-1);
    if (shot.endMs - shot.startMs < policy.minShotMs && previous) {
      previous.endMs = shot.endMs;
      previous.reason = 'min-shot';
      continue;
    }
    absorbed.push({ ...shot });
  }

  const split: PlannedShot[] = [];
  for (const shot of absorbed) {
    let cursor = shot.startMs;
    while (shot.endMs - cursor > policy.maxShotMs) {
      split.push({
        ...shot,
        startMs: cursor,
        endMs: cursor + policy.maxShotMs,
        reason: 'max-shot',
      });
      cursor += policy.maxShotMs;
    }
    if (cursor < shot.endMs) split.push({ ...shot, startMs: cursor });
  }
  return split;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Every shot the policy could not satisfy, with the reason it carries. */
export function policyExceptions(plan: ShotPlan): PlannedShot[] {
  return plan.shots.filter(
    (shot) =>
      shot.endMs - shot.startMs < plan.policy.minShotMs ||
      shot.endMs - shot.startMs > plan.policy.maxShotMs,
  );
}
