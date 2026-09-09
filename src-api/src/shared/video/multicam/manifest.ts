import { z } from 'zod';

/**
 * The Neumar multicamera manifest.
 *
 * Deliberately not a port of OpenReel's validator. Two differences matter:
 *
 * - Errors are Zod issues, not an accumulated `errors: string[]`. A caller gets
 *   a path per problem instead of a prose list it has to re-parse to say which
 *   camera is wrong.
 * - There is no `fps` on the manifest. A camera group inherits the project
 *   timebase locked in Phase 2, so sync artifacts and the timeline cannot
 *   disagree about what a frame is. A per-manifest rate is exactly how those
 *   two drift apart.
 */
export const MULTICAM_MANIFEST_SCHEMA_ID = 'neuma.video.multicam-manifest.v1';

export const CameraTypeSchema = z.enum([
  /** Frames one participant. The planner's default choice when they speak. */
  'close',
  /** Frames everyone. The fallback when nobody is speaking. */
  'wide',
  /** Screen share, slides, or a document camera. */
  'screen',
]);

export const MulticamCameraSchema = z
  .object({
    id: z.string().min(1).max(64),
    label: z.string().min(1).max(120),
    type: CameraTypeSchema,
    /** Project asset supplying this angle's picture. */
    assetId: z.string().min(1),
    /** Participant this camera frames. Omitted for wide and screen angles. */
    participantId: z.string().min(1).optional(),
    /**
     * Asset carrying this participant's isolated microphone. Optional: a
     * manual-only group can be cut without per-participant audio.
     */
    isolatedAudioAssetId: z.string().min(1).optional(),
    /**
     * Manual offset, in milliseconds, from the reference camera's start. A
     * positive value means this camera started later.
     */
    offsetMs: z.number().int().min(-86_400_000).max(86_400_000).optional(),
  })
  .strict();

export const MulticamParticipantSchema = z
  .object({
    id: z.string().min(1).max(64),
    name: z.string().min(1).max(120),
  })
  .strict();

export const MulticamPolicySchema = z
  .object({
    minShotMs: z.number().int().min(200).max(60_000).default(1200),
    maxShotMs: z.number().int().min(1000).max(600_000).default(12_000),
    /** How long before a speaker starts the cut lands. Negative leads. */
    cutLeadMs: z.number().int().min(-2000).max(2000).default(-120),
    /** Speech shorter than this does not earn its own shot. */
    minSpeechMs: z.number().int().min(100).max(10_000).default(600),
    /** Silence longer than this falls back to the wide angle. */
    silenceFallbackMs: z.number().int().min(200).max(30_000).default(1500),
    /** Overlapping speech: follow the loudest, or hold on the wide angle. */
    overlapPolicy: z.enum(['loudest', 'wide']).default('wide'),
    /** Forbid cutting between two close angles of the same participant. */
    forbidJumpCuts: z.boolean().default(true),
  })
  .strict();

export const MulticamManifestSchema = z
  .object({
    schema: z.literal(MULTICAM_MANIFEST_SCHEMA_ID),
    id: z.string().min(1).max(64),
    label: z.string().min(1).max(120),
    /** The camera every offset and sync observation is measured against. */
    referenceCameraId: z.string().min(1),
    participants: z.array(MulticamParticipantSchema).min(1).max(32),
    cameras: z.array(MulticamCameraSchema).min(2).max(32),
    // Zod 4's `.default()` takes the *output* type, so an empty object is not a
    // valid policy here; parsing one is how we get every field's own default.
    policy: MulticamPolicySchema.default(() => MulticamPolicySchema.parse({})),
    /**
     * `manual` cuts from the offsets on each camera. `timecode` reads embedded
     * timecode. `audio-correlation` stays behind `video.multicamAudioSync`
     * until its accuracy is measured against real fixtures.
     */
    syncMode: z
      .enum(['manual', 'timecode', 'audio-correlation'])
      .default('manual'),
  })
  .strict()
  .superRefine((manifest, ctx) => {
    const cameraIds = new Set<string>();
    for (const [index, camera] of manifest.cameras.entries()) {
      if (cameraIds.has(camera.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['cameras', index, 'id'],
          message: `Duplicate camera id "${camera.id}"`,
        });
      }
      cameraIds.add(camera.id);
    }

    const participantIds = new Set(
      manifest.participants.map((participant) => participant.id),
    );
    for (const [index, camera] of manifest.cameras.entries()) {
      if (camera.participantId && !participantIds.has(camera.participantId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['cameras', index, 'participantId'],
          message: `Camera "${camera.id}" names participant "${camera.participantId}", which is not in this manifest`,
        });
      }
      // A close angle exists to frame someone. Without that link the planner
      // has no reason to ever cut to it.
      if (camera.type === 'close' && !camera.participantId) {
        ctx.addIssue({
          code: 'custom',
          path: ['cameras', index, 'participantId'],
          message: `Close camera "${camera.id}" must name the participant it frames`,
        });
      }
    }

    if (!cameraIds.has(manifest.referenceCameraId)) {
      ctx.addIssue({
        code: 'custom',
        path: ['referenceCameraId'],
        message: `Reference camera "${manifest.referenceCameraId}" is not one of this manifest's cameras`,
      });
    }

    if (manifest.policy.maxShotMs <= manifest.policy.minShotMs) {
      ctx.addIssue({
        code: 'custom',
        path: ['policy', 'maxShotMs'],
        message: 'maxShotMs must be greater than minShotMs',
      });
    }
  });

export type MulticamManifest = z.infer<typeof MulticamManifestSchema>;
export type MulticamCamera = z.infer<typeof MulticamCameraSchema>;
export type MulticamPolicy = z.infer<typeof MulticamPolicySchema>;
export type MulticamSyncMode = MulticamManifest['syncMode'];

export interface ManifestReadiness {
  /** True when the planner can run without human cut decisions. */
  automaticReady: boolean;
  /** Why automatic mode is unavailable. Empty when it is available. */
  blockers: string[];
}

/**
 * Whether a manifest supports automatic shot planning.
 *
 * Manual-only groups are legitimate and are not errors: a two-camera interview
 * with no isolated microphones can still be cut by hand, so these are readiness
 * blockers rather than schema failures.
 */
export function manifestReadiness(
  manifest: MulticamManifest,
): ManifestReadiness {
  const blockers: string[] = [];

  if (manifest.cameras.length < 2) {
    blockers.push('Automatic mode needs at least two cameras');
  }
  if (!manifest.cameras.some((camera) => camera.type === 'wide')) {
    blockers.push(
      'Automatic mode needs a wide camera to fall back to during silence',
    );
  }

  const speakers = manifest.participants.filter((participant) =>
    manifest.cameras.some(
      (camera) =>
        camera.participantId === participant.id && camera.type === 'close',
    ),
  );
  if (speakers.length < 1) {
    blockers.push('Automatic mode needs at least one participant close angle');
  }

  const withoutIsolatedAudio = manifest.cameras.filter(
    (camera) => camera.type === 'close' && !camera.isolatedAudioAssetId,
  );
  if (withoutIsolatedAudio.length > 0) {
    blockers.push(
      `Automatic mode needs an isolated microphone for each close angle; missing on ${withoutIsolatedAudio
        .map((camera) => camera.id)
        .join(', ')}`,
    );
  }

  return { automaticReady: blockers.length === 0, blockers };
}

export function parseMulticamManifest(input: unknown): MulticamManifest {
  return MulticamManifestSchema.parse(input);
}

export function safeParseMulticamManifest(input: unknown) {
  return MulticamManifestSchema.safeParse(input);
}

/** The camera every sync observation is measured against. */
export function referenceCamera(manifest: MulticamManifest): MulticamCamera {
  const camera = manifest.cameras.find(
    (candidate) => candidate.id === manifest.referenceCameraId,
  );
  if (!camera) {
    // Unreachable through the schema; kept so callers do not need a null check.
    throw new Error(
      `Manifest ${manifest.id} has no reference camera ${manifest.referenceCameraId}`,
    );
  }
  return camera;
}
