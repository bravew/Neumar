import type { PlannedShot, ShotPlan } from './shot-plan';

export const MULTICAM_REVIEW_SCHEMA_ID = 'neuma.video.multicam-review.v1';

export type ShotDecision = 'pending' | 'accepted' | 'rejected';

export interface ReviewedShot {
  /** Stable across re-reviews: the shot's start frame in the plan. */
  id: string;
  startMs: number;
  endMs: number;
  cameraId: string;
  participantId?: string;
  reason: PlannedShot['reason'];
  confidence: number;
  decision: ShotDecision;
  /** Set when a human overrode the planner's camera choice. */
  overriddenCameraId?: string;
  /** Free-text note attached by a reviewer or the agent. */
  note?: string;
}

export interface ReviewArtifact {
  schema: typeof MULTICAM_REVIEW_SCHEMA_ID;
  manifestId: string;
  /** The plan this review is of. A new plan starts a new review. */
  planFingerprint: string;
  /**
   * Bumped on every decision. Applying quotes it, which is what makes a repeat
   * apply request recognisable rather than a second batch of clips.
   */
  revision: number;
  shots: ReviewedShot[];
  /** Set once the review has been applied to the timeline. */
  applied?: {
    batchId: string;
    reviewRevision: number;
    appliedAt: string;
    clipIds: string[];
  };
}

export function shotId(
  shot: Pick<PlannedShot, 'startMs' | 'cameraId'>,
): string {
  return `${shot.cameraId}@${shot.startMs}`;
}

/**
 * Start a review from a plan. Every shot begins `pending`: the planner proposes,
 * a human disposes, and nothing reaches the timeline until someone says so.
 */
export function startReview(plan: ShotPlan): ReviewArtifact {
  return {
    schema: MULTICAM_REVIEW_SCHEMA_ID,
    manifestId: plan.manifestId,
    planFingerprint: plan.sourceFingerprint,
    revision: 0,
    shots: plan.shots.map((shot) => ({
      id: shotId(shot),
      startMs: shot.startMs,
      endMs: shot.endMs,
      cameraId: shot.cameraId,
      ...(shot.participantId ? { participantId: shot.participantId } : {}),
      reason: shot.reason,
      confidence: shot.confidence,
      decision: 'pending' as const,
    })),
  };
}

export type ReviewAction =
  | { kind: 'accept'; shotId: string }
  | { kind: 'reject'; shotId: string }
  | { kind: 'accept-all' }
  /** Move a cut boundary. Positive moves it later. */
  | { kind: 'nudge'; shotId: string; deltaMs: number }
  | { kind: 'set-camera'; shotId: string; cameraId: string }
  | { kind: 'annotate'; shotId: string; note: string };

export class ReviewActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReviewActionError';
  }
}

/**
 * Apply one review action and bump the revision.
 *
 * Returns a new artifact rather than mutating: the caller writes it, and the
 * revision it carries is the token an apply request has to quote.
 */
export function applyReviewAction(
  review: ReviewArtifact,
  action: ReviewAction,
): ReviewArtifact {
  if (review.applied) {
    throw new ReviewActionError(
      'This review has already been applied. Start a new analysis run to change it.',
    );
  }

  if (action.kind === 'accept-all') {
    return bump(review, (shot) => ({ ...shot, decision: 'accepted' }));
  }

  const target = review.shots.find((shot) => shot.id === action.shotId);
  if (!target) {
    throw new ReviewActionError(`No shot "${action.shotId}" in this review`);
  }

  switch (action.kind) {
    case 'accept':
      return bumpOne(review, action.shotId, (shot) => ({
        ...shot,
        decision: 'accepted',
      }));
    case 'reject':
      return bumpOne(review, action.shotId, (shot) => ({
        ...shot,
        decision: 'rejected',
      }));
    case 'annotate':
      return bumpOne(review, action.shotId, (shot) => ({
        ...shot,
        note: action.note,
      }));
    case 'set-camera':
      return bumpOne(review, action.shotId, (shot) => ({
        ...shot,
        overriddenCameraId: action.cameraId,
        // Choosing a camera is an acceptance: nobody picks an angle for a shot
        // they intend to drop.
        decision: 'accepted',
      }));
    case 'nudge':
      return nudge(review, action.shotId, action.deltaMs);
    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}

/**
 * Move one cut boundary, taking the time from the neighbour rather than leaving
 * a gap. A nudge that would collapse either shot is refused: a zero-length shot
 * is not an edit a reviewer can see or undo.
 */
function nudge(
  review: ReviewArtifact,
  targetId: string,
  deltaMs: number,
): ReviewArtifact {
  const index = review.shots.findIndex((shot) => shot.id === targetId);
  if (index <= 0) {
    throw new ReviewActionError(
      'The first shot has no preceding cut to nudge; nudge the next shot instead',
    );
  }

  const previous = review.shots[index - 1]!;
  const target = review.shots[index]!;
  const newBoundary = target.startMs + deltaMs;
  if (newBoundary <= previous.startMs || newBoundary >= target.endMs) {
    throw new ReviewActionError(
      `Nudging by ${deltaMs}ms would collapse a shot`,
    );
  }

  const shots = review.shots.map((shot, position) => {
    if (position === index - 1) return { ...shot, endMs: newBoundary };
    if (position === index) return { ...shot, startMs: newBoundary };
    return shot;
  });
  return { ...review, revision: review.revision + 1, shots };
}

function bump(
  review: ReviewArtifact,
  update: (shot: ReviewedShot) => ReviewedShot,
): ReviewArtifact {
  return {
    ...review,
    revision: review.revision + 1,
    shots: review.shots.map(update),
  };
}

function bumpOne(
  review: ReviewArtifact,
  targetId: string,
  update: (shot: ReviewedShot) => ReviewedShot,
): ReviewArtifact {
  return bump(review, (shot) => (shot.id === targetId ? update(shot) : shot));
}

export interface ReviewSummary {
  total: number;
  accepted: number;
  rejected: number;
  pending: number;
  overridden: number;
  annotated: number;
  applied: boolean;
  revision: number;
}

export function summarizeReview(review: ReviewArtifact): ReviewSummary {
  return {
    total: review.shots.length,
    accepted: review.shots.filter((shot) => shot.decision === 'accepted')
      .length,
    rejected: review.shots.filter((shot) => shot.decision === 'rejected')
      .length,
    pending: review.shots.filter((shot) => shot.decision === 'pending').length,
    overridden: review.shots.filter((shot) => shot.overriddenCameraId).length,
    annotated: review.shots.filter((shot) => shot.note).length,
    applied: Boolean(review.applied),
    revision: review.revision,
  };
}

/** The camera a shot will actually use: a human override beats the planner. */
export function effectiveCameraId(shot: ReviewedShot): string {
  return shot.overriddenCameraId ?? shot.cameraId;
}

/** Only accepted shots reach the timeline. */
export function acceptedShots(review: ReviewArtifact): ReviewedShot[] {
  return review.shots.filter((shot) => shot.decision === 'accepted');
}
