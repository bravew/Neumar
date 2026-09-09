import { z } from 'zod';

import { getVideoFeatureFlag } from '@/shared/video/flags';
import { alreadyApplied, buildApplyBatch } from '@/shared/video/multicam/apply';
import { manifestReadiness } from '@/shared/video/multicam/manifest';
import {
  applyReviewAction,
  ReviewActionError,
  startReview,
  summarizeReview,
  type ReviewAction,
} from '@/shared/video/multicam/review';
import {
  listMulticamGroups,
  loadActivityMap,
  loadManifest,
  loadReview,
  loadShotPlan,
  loadSyncMap,
  saveReview,
} from '@/shared/video/multicam/store';

/**
 * The nine multicamera agent tools.
 *
 * Withheld entirely from a project with no camera group, rather than registered
 * and returning "not applicable". `video-edit-server.ts` already names 121
 * `video_*` tools; nine more in every turn's context is a real cost to pay for
 * a capability most projects never use.
 *
 * Every handler still checks the flag, because a group can exist while the
 * feature is switched off, and the honest answer then is a typed unavailable
 * reason rather than data.
 */
export const MULTICAM_TOOL_NAMES = [
  'video_multicam_get_manifest',
  'video_multicam_get_activity',
  'video_multicam_get_transcript',
  'video_multicam_set_policy',
  'video_multicam_annotate_range',
  'video_multicam_get_edit_summary',
  'video_multicam_override_cut',
  'video_multicam_preview_frame',
  'video_multicam_apply_reviewed_plan',
] as const;

export type MulticamToolName = (typeof MULTICAM_TOOL_NAMES)[number];

export interface MulticamUnavailable {
  available: false;
  reason:
    | 'feature-disabled'
    | 'no-camera-group'
    | 'no-analysis'
    | 'invalid-action';
  detail: string;
}

function unavailable(
  reason: MulticamUnavailable['reason'],
  detail: string,
): MulticamUnavailable {
  return { available: false, reason, detail };
}

/**
 * Whether the domain should be registered for this project at all.
 *
 * Mirrors how the host gates its own multicamera surface: the tools appear once
 * a camera group exists, and not before.
 */
export async function shouldRegisterMulticamTools(
  projectId: string | undefined,
): Promise<boolean> {
  if (!projectId) return false;
  if (!getVideoFeatureFlag('video.multicam')) return false;
  const groups = await listMulticamGroups(projectId);
  return groups.length > 0;
}

function guard(): MulticamUnavailable | null {
  if (!getVideoFeatureFlag('video.multicam')) {
    return unavailable(
      'feature-disabled',
      'Multicamera is not enabled for this workspace (video.multicam)',
    );
  }
  return null;
}

export async function multicamGetManifest(projectId: string, groupId: string) {
  const blocked = guard();
  if (blocked) return blocked;
  const manifest = await loadManifest(projectId, groupId);
  if (!manifest) {
    return unavailable('no-camera-group', `No camera group "${groupId}"`);
  }
  const sync = await loadSyncMap(projectId, groupId);
  return {
    available: true as const,
    manifest,
    readiness: manifestReadiness(manifest),
    sync: sync?.data.cameras.map((camera) => ({
      cameraId: camera.cameraId,
      offsetMs: camera.offsetMs,
      offsetFrames: camera.offsetFrames,
      driftPpm: camera.driftPpm,
      method: camera.method,
    })),
  };
}

export async function multicamGetActivity(
  projectId: string,
  groupId: string,
  range?: { startMs: number; endMs: number },
) {
  const blocked = guard();
  if (blocked) return blocked;
  const envelope = await loadActivityMap(projectId, groupId);
  if (!envelope) {
    return unavailable('no-analysis', `No activity map for "${groupId}"`);
  }
  const participants = envelope.data.participants.map((participant) => ({
    participantId: participant.participantId,
    bleedCorrectionApplied: participant.bleedCorrectionApplied,
    bleedConfidence: participant.bleedConfidence,
    // Windowed rather than whole: an hour of 200ms windows is 18,000 numbers
    // per participant, which is not something to put in a model's context.
    frames: participant.frames.filter(
      (frame) =>
        !range ||
        (frame.atReferenceMs >= range.startMs &&
          frame.atReferenceMs < range.endMs),
    ),
  }));
  return {
    available: true as const,
    windowMs: envelope.data.windowMs,
    participants,
  };
}

export async function multicamGetTranscript(
  projectId: string,
  groupId: string,
) {
  const blocked = guard();
  if (blocked) return blocked;
  const manifest = await loadManifest(projectId, groupId);
  if (!manifest) {
    return unavailable('no-camera-group', `No camera group "${groupId}"`);
  }
  // Participant-scoped transcript ranges are not wired to the local
  // transcription path yet; saying so is better than returning an empty list
  // that reads as "nobody said anything".
  return unavailable(
    'no-analysis',
    'Participant-scoped transcripts are not available yet for this camera group',
  );
}

export async function multicamGetEditSummary(
  projectId: string,
  groupId: string,
) {
  const blocked = guard();
  if (blocked) return blocked;
  const plan = await loadShotPlan(projectId, groupId);
  if (!plan) {
    return unavailable('no-analysis', `No shot plan for "${groupId}"`);
  }
  const review = await loadReview(projectId, groupId);
  return {
    available: true as const,
    planFingerprint: plan.data.sourceFingerprint,
    policy: plan.data.policy,
    shotCount: plan.data.shots.length,
    shots: plan.data.shots.map((shot) => ({
      startMs: shot.startMs,
      endMs: shot.endMs,
      cameraId: shot.cameraId,
      reason: shot.reason,
    })),
    review: review ? summarizeReview(review.data) : null,
  };
}

export async function multicamSetPolicy(
  projectId: string,
  groupId: string,
  policy: Record<string, unknown>,
) {
  const blocked = guard();
  if (blocked) return blocked;
  const manifest = await loadManifest(projectId, groupId);
  if (!manifest) {
    return unavailable('no-camera-group', `No camera group "${groupId}"`);
  }
  // A policy change invalidates the plan derived from the old one. The caller
  // re-runs planning; nothing is silently re-planned underneath a reviewer.
  return {
    available: true as const,
    requestedPolicy: policy,
    note: 'Policy changes require re-running the shot planner before review.',
  };
}

async function mutateReview(
  projectId: string,
  groupId: string,
  action: ReviewAction,
) {
  const blocked = guard();
  if (blocked) return blocked;
  const plan = await loadShotPlan(projectId, groupId);
  if (!plan) {
    return unavailable('no-analysis', `No shot plan for "${groupId}"`);
  }
  const existing = await loadReview(projectId, groupId);
  const review = existing?.data ?? startReview(plan.data);
  // `applyReviewAction` rejects an unknown shot, a nudge that would collapse a
  // shot, and any action on an already-applied review. The HTTP route turns that
  // into a 409; here it would escape as an unhandled exception, which the agent
  // sees as a tool crash rather than a result it can act on. Every other failure
  // in this file answers with the same structured shape, so this one does too.
  let next;
  try {
    next = applyReviewAction(review, action);
  } catch (error) {
    if (error instanceof ReviewActionError) {
      return unavailable('invalid-action', error.message);
    }
    throw error;
  }
  await saveReview(projectId, next);
  return { available: true as const, review: summarizeReview(next) };
}

export function multicamAnnotateRange(
  projectId: string,
  groupId: string,
  shotId: string,
  note: string,
) {
  return mutateReview(projectId, groupId, { kind: 'annotate', shotId, note });
}

export function multicamOverrideCut(
  projectId: string,
  groupId: string,
  shotId: string,
  cameraId: string,
) {
  return mutateReview(projectId, groupId, {
    kind: 'set-camera',
    shotId,
    cameraId,
  });
}

export async function multicamPreviewFrame(
  projectId: string,
  groupId: string,
  atReferenceMs: number,
) {
  const blocked = guard();
  if (blocked) return blocked;
  const manifest = await loadManifest(projectId, groupId);
  const sync = await loadSyncMap(projectId, groupId);
  if (!manifest || !sync) {
    return unavailable('no-analysis', `No sync map for "${groupId}"`);
  }
  // Read-only, but metered: it names where this instant falls on every angle,
  // which is what a caller needs before asking for a decode.
  return {
    available: true as const,
    atReferenceMs,
    angles: manifest.cameras.map((camera) => {
      const cameraSync = sync.data.cameras.find(
        (candidate) => candidate.cameraId === camera.id,
      );
      return {
        cameraId: camera.id,
        assetId: camera.assetId,
        sourceMs: cameraSync
          ? Math.max(
              0,
              Math.round(
                atReferenceMs +
                  cameraSync.offsetMs +
                  (atReferenceMs * cameraSync.driftPpm) / 1_000_000,
              ),
            )
          : atReferenceMs,
      };
    }),
  };
}

export async function multicamApplyReviewedPlan(
  projectId: string,
  groupId: string,
  trackId: string,
) {
  const blocked = guard();
  if (blocked) return blocked;
  const [manifest, sync, reviewEnvelope] = await Promise.all([
    loadManifest(projectId, groupId),
    loadSyncMap(projectId, groupId),
    loadReview(projectId, groupId),
  ]);
  if (!manifest || !sync || !reviewEnvelope) {
    return unavailable('no-analysis', `No reviewed plan for "${groupId}"`);
  }

  const review = reviewEnvelope.data;
  const previous = alreadyApplied(review);
  if (previous) {
    // The plan's requirement: a repeat request returns the prior result rather
    // than a second set of clips.
    return {
      available: true as const,
      repeated: true,
      ...previous,
    };
  }

  const result = buildApplyBatch({
    manifest,
    review,
    syncMap: sync.data,
    trackId,
  });
  return { available: true as const, repeated: false, ...result };
}

export const multicamToolSchemas = {
  groupId: z.string().min(1).max(64),
  shotId: z.string().min(1).max(128),
  note: z.string().min(1).max(500),
  atReferenceMs: z.number().int().min(0),
  trackId: z.string().min(1).max(64),
  range: z
    .object({
      startMs: z.number().int().min(0),
      endMs: z.number().int().positive(),
    })
    .optional(),
};
