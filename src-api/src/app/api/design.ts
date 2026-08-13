import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { inflateRawSync } from 'node:zlib';

import { EventType, type BaseEvent } from '@ag-ui/core';
import { zValidator } from '@hono/zod-validator';
import { Hono, type Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import JSZip from 'jszip';
import { z } from 'zod';

import {
  resolveRunContext,
  RunContextEnvelopeInputSchema,
  RunContextError,
} from '@/core/agent/run-context';

import { AssetsError, renderAssetAttributionBlock } from '@/shared/assets';
import {
  AgentRunConflictError,
  finishAgentRun,
  reserveAgentRun,
} from '@/shared/db/operations';
import { startDetachedAGUIRun } from '@/shared/services/ag-ui/detached-run';
import { AGUIEmitter } from '@/shared/services/ag-ui/emitter';
import { journalAGUIEvent } from '@/shared/services/ag-ui/journal';
import { AGUIEventPersister } from '@/shared/services/ag-ui/persistence';
import { cancelActiveAGUIRun } from '@/shared/services/ag-ui/runtime';
import { subscribeSSEToBus } from '@/shared/services/ag-ui/transport';
import { validateHtmlArtifact } from '@/shared/services/design-mode/artifact-validate';
import { parseByteRange } from '@/shared/services/design-mode/byte-range';
import {
  attachCatalogAssetToDesign,
  resolveDesignInlineAsset,
} from '@/shared/services/design-mode/catalog-assets';
import {
  getCraft,
  getDesignSkill,
  getDesignLiveArtifactTemplate,
  getDesignSystem,
  getPromptTemplate,
  installDesignSkillPack,
  installDesignSystemPack,
  InvalidDesignSkillError,
  listCraft,
  listDesignLiveArtifactTemplates,
  listDesignSkills,
  listDesignSystems,
  patchDesignSystem,
  listPromptTemplates,
  readDesignSkillExample,
  uninstallDesignSkillPack,
  uninstallDesignSystemPack,
  DesignSystemNotFoundError,
  DesignSystemReadOnlyError,
} from '@/shared/services/design-mode/catalogs';
import {
  harvestDesignChatArtifact,
  runDesignChat,
} from '@/shared/services/design-mode/chat';
import {
  buildCritiqueArtifactResponse,
  CritiqueArtifactBadRequestError,
  CritiqueArtifactNotFoundError,
} from '@/shared/services/design-mode/critique/artifact-handler';
import {
  DesignJuryDisabledError,
  DesignJuryRunNotFoundError,
  DesignJuryRunProjectMismatchError,
  interruptDesignJuryRun,
  isDesignJuryRunId,
  isDesignJuryEnabled,
  listDesignJuryRuns,
  readPersistedDesignJuryRun,
  runDesignJury,
} from '@/shared/services/design-mode/critique/design-jury';
import {
  isTerminalPanelEvent,
  readDesignJuryPanelEvents,
  subscribeDesignJuryEvents,
  type PanelEvent,
} from '@/shared/services/design-mode/critique/events';
import { listDesignCritiqueMetrics } from '@/shared/services/design-mode/critique/observability/metrics';
import {
  getCritiqueConformanceStatus,
  getCritiqueRolloutState,
  promoteCritiqueRollout,
  rollbackCritiqueRollout,
  setCritiqueRolloutOverride,
} from '@/shared/services/design-mode/critique/rollout';
import { getDesignDependencies } from '@/shared/services/design-mode/dependencies';
import { packDesignPackage } from '@/shared/services/design-mode/design-package/pack';
import { renderDesignSystemShowcase } from '@/shared/services/design-mode/design-system-showcase';
import {
  designSystemTokensToDtcgDocument,
  DtcgTokenError,
  importDtcgDesignSystem,
} from '@/shared/services/design-mode/dtcg-tokens';
import {
  designProjectDir,
  detectDesignEditors,
  openDesignProjectInEditor,
} from '@/shared/services/design-mode/editors';
import { inlineRelativeAssets } from '@/shared/services/design-mode/export/inline-assets';
import {
  finalizeDesignProject,
  FinalizeDesignLockedError,
  getDesignMdState,
} from '@/shared/services/design-mode/finalize-design';
import {
  appendProjectHistory,
  deleteProjectFiles,
  getDesignWorkspaceRoot,
  getProjectDir,
  listProjectFiles,
  normalizeProjectRelativePath,
  ProjectFileConflictError,
  readJsonFile,
  readProjectTextFile,
  renameProjectFile,
  resolveProjectPath,
  withProjectLock,
  writeJsonAtomic,
  writeProjectTextFile,
} from '@/shared/services/design-mode/fs';
import { importDesignFolder } from '@/shared/services/design-mode/import-folder/link';
import { lintDesignArtifact } from '@/shared/services/design-mode/lint';
import {
  createDesignLiveArtifact,
  getDesignLiveArtifactDetail,
  listDesignConnectorCatalog,
  listDesignLiveArtifacts,
  refreshDesignLiveArtifact,
} from '@/shared/services/design-mode/live-artifacts';
import {
  cancelDesignMediaTask,
  getDesignBudgetStatus,
  getDesignCapabilities,
  listDesignMediaTasks,
  startDesignMediaTask,
  waitDesignMediaTask,
} from '@/shared/services/design-mode/media-dispatcher';
import {
  getDesignModeMetrics,
  getProjectMetrics,
} from '@/shared/services/design-mode/metrics';
import {
  ArtifactPdfInputUnavailableError,
  buildArtifactPdfInput,
} from '@/shared/services/design-mode/pdf-export/build-input';
import {
  addDesignProjectLocation,
  DesignProjectLocationError,
  listDesignProjectLocations,
  removeDesignProjectLocation,
} from '@/shared/services/design-mode/project-locations';
import {
  createDesignProject,
  deleteDesignProject,
  getDesignProject,
  listDesignProjects,
  patchDesignProject,
  touchDesignProject,
} from '@/shared/services/design-mode/projects';
import { resolveProjectPrompt } from '@/shared/services/design-mode/prompt-composer';
import {
  cancelDesignRoutineRun,
  createDesignRoutine,
  createDesignRoutineSchema,
  deleteDesignRoutine,
  getDesignRoutine,
  getDesignRoutineSchedulerStatus,
  listDesignRoutineRuns,
  listDesignRoutines,
  runDesignRoutineNow,
  runDesignRoutineSchema,
  tickDesignRoutineScheduler,
  updateDesignRoutine,
  updateDesignRoutineSchema,
} from '@/shared/services/design-mode/routines';
import {
  importShadcnRegistryDesignSystem,
  ShadcnRegistryImportError,
} from '@/shared/services/design-mode/shadcn-registry';
import {
  applyManualEditPatch,
  listManualEditPatches,
  revertManualEditPatch,
} from '@/shared/services/design-mode/source-rewriter/rewrite';
import { manualEditPatchSchema } from '@/shared/services/design-mode/source-rewriter/validate';
import { getDesignTelemetryStatus } from '@/shared/services/design-mode/telemetry';
import {
  createDesignProjectSchema,
  createDesignLiveArtifactSchema,
  designJuryRequestSchema,
  type DesignOutput,
  type DesignProject,
  type DesignFileEntry,
  type DesignLintFinding,
  designSurfaceSchema,
  patchDesignProjectSchema,
} from '@/shared/services/design-mode/types';
import {
  hasSpeechProvider,
  listVoices as listSpeechVoices,
} from '@/shared/services/speech';
import { hasImageMagicBytes } from '@/shared/utils/image-validator';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('DesignModeAPI');
const designSystemsLogger = createLogger('DesignSystems');
const designImportLogger = createLogger('DesignImport');

export const DESIGN_MODE_ENABLED = process.env.DESIGN_MODE_ENABLED !== 'false';

export const designRoutes = new Hono();
designRoutes.use('*', async (c, next) => {
  if (!DESIGN_MODE_ENABLED) {
    return c.json({ error: 'Design mode is disabled' }, 404);
  }
  await next();
});
const sseEncoder = new TextEncoder();
const execFileAsync = promisify(execFile);
const previewSubscribers = new Map<
  string,
  Set<ReadableStreamDefaultController<Uint8Array>>
>();
const mediaVoiceCache = new Map<
  string,
  { voices: Awaited<ReturnType<typeof listSpeechVoices>>; expiresAt: number }
>();
const MEDIA_VOICE_CACHE_TTL_MS = 5 * 60 * 1000;
const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_SIGNATURE = 0x04034b50;
const IMPORT_ARCHIVE_MAX_FILES = 5000;
const IMPORT_ARCHIVE_MAX_TOTAL_BYTES = 200 * 1024 * 1024;
const IMPORT_ARCHIVE_MAX_FILE_BYTES = 50 * 1024 * 1024;
const DESIGN_BLOB_MAX_BYTES = 250 * 1024 * 1024;
const DESIGN_BLOB_IMAGE_MAX_BYTES = 50 * 1024 * 1024;
const DESIGN_BLOB_ALLOWED_MIME_TYPES = new Set([
  'application/json',
  'application/pdf',
  'application/vnd.neuma.design-package+zip',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/zip',
  'audio/mp4',
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/svg+xml',
  'image/webp',
  'text/html',
  'text/markdown',
  'text/plain',
  'video/mp4',
  'video/quicktime',
  'video/webm',
]);

const fileWriteSchema = z.object({
  path: z.string().min(1).max(1000),
  content: z.string().max(2_000_000),
  source: z.enum(['manual', 'generated']).optional().default('manual'),
});
const filesDeleteSchema = z.object({
  paths: z.array(z.string().min(1).max(1000)).min(1).max(100),
});
const filesRenameSchema = z.object({
  from: z.string().min(1).max(1000),
  to: z.string().min(1).max(1000),
});
const projectLocationSchema = z.object({
  path: z.string().min(1).max(1000),
});
const manualEditRevertSchema = z.object({
  patchId: z.string().min(1).max(120),
});
const critiqueOverrideSchema = z.object({
  userOverride: z.enum(['auto', 'on', 'off']),
});

const mediaSchema = z.object({
  surface: z.enum(['image', 'video', 'audio', 'document']),
  model: z.string().optional(),
  output: z.string().optional(),
  prompt: z.string().min(1),
  aspect: z.string().optional(),
  lengthSeconds: z.number().int().positive().optional(),
  durationSeconds: z.number().int().positive().optional(),
  audioKind: z
    .enum(['speech', 'voiceover', 'music', 'sfx', 'ambience'])
    .optional(),
  voice: z.string().optional(),
  languageBoost: z.string().optional(),
  image: z.string().optional(),
  compositionDir: z.string().optional(),
});

const resolvePromptSchema = z.object({
  latestMessage: z.string().optional().default(''),
});

const drawStrokePointSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  pressure: z.number().min(0).max(1).optional(),
});

const drawStrokeSchema = z
  .object({
    id: z.string().min(1).max(120),
    pointerType: z.enum(['pen', 'touch', 'mouse']),
    color: z.string().min(1).max(40),
    width: z.number().positive().max(64),
    points: z.array(drawStrokePointSchema).min(1).max(800),
  })
  .superRefine((stroke, ctx) => {
    if (Buffer.byteLength(JSON.stringify(stroke), 'utf-8') > 4096) {
      ctx.addIssue({
        code: 'custom',
        message: 'Draw strokes cannot exceed 4 KB each.',
      });
    }
  });

const drawAttachmentSchema = z.object({
  kind: z.literal('draw'),
  strokes: z.array(drawStrokeSchema).min(1).max(32),
  viewport: z.object({
    width: z.number().positive().max(10000),
    height: z.number().positive().max(10000),
    scale: z.number().positive().max(10),
  }),
});

const COMMENT_ATTACHMENT_MAX_COUNT = 8;
const COMMENT_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
const COMMENT_NOTE_MAX_CHARS = 2000;
const COMMENT_IMAGE_NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,119}$/;
const COMMENT_IMAGE_EXT_BY_MIME = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
} as const;

const commentImageMimeSchema = z.enum([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);

const imageCommentAttachmentSchema = z.object({
  kind: z.literal('image'),
  name: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(COMMENT_IMAGE_NAME_RE, 'Invalid attachment filename.'),
  mime: commentImageMimeSchema,
  size: z.number().int().positive().max(COMMENT_IMAGE_MAX_BYTES),
  dataUrl: z.string().max(COMMENT_IMAGE_MAX_BYTES * 2 + 100),
  alt: z.string().trim().max(500).optional(),
});

const noteCommentAttachmentSchema = z.object({
  kind: z.literal('note'),
  text: z.string().trim().min(1).max(COMMENT_NOTE_MAX_CHARS),
});

const commentAttachmentSchema = z.discriminatedUnion('kind', [
  drawAttachmentSchema,
  imageCommentAttachmentSchema,
  noteCommentAttachmentSchema,
]);

const commentSchema = z.object({
  target: z
    .object({
      id: z.string().max(200).optional(),
      selector: z.string().max(500).optional(),
      role: z.string().max(200).optional(),
      label: z.string().max(500).optional(),
      file: z.string().max(500).optional(),
      screen: z.string().max(200).optional(),
      x: z.number().finite().optional(),
      y: z.number().finite().optional(),
    })
    .optional(),
  text: z.string().min(1).max(8000),
  attachToChat: z.boolean().optional(),
  attachments: z
    .array(commentAttachmentSchema)
    .max(COMMENT_ATTACHMENT_MAX_COUNT)
    .optional(),
});

type CommentAttachmentInput = z.infer<typeof commentAttachmentSchema>;

class CommentAttachmentError extends Error {}

const messageFeedbackSchema = z.object({
  rating: z.enum(['up', 'down']),
  comment: z.string().max(2000).optional(),
  submittedAt: z.string().datetime(),
  artifactRef: z.string().max(500).optional(),
  runId: z.string().max(200).optional(),
});

const importSchema = z.object({
  title: z.string().optional(),
  surface: designSurfaceSchema.default('prototype'),
  entrypoint: z.string().optional(),
  archiveBase64: z.string().optional(),
  archiveName: z.string().optional(),
  allowLintOverride: z.boolean().optional(),
  files: z
    .array(
      z
        .object({
          path: z.string(),
          content: z.string().optional(),
          dataBase64: z.string().optional(),
        })
        .refine(
          (file) => file.content !== undefined || file.dataBase64 !== undefined,
          {
            message: 'Import files require content or dataBase64',
          },
        ),
    )
    .max(5000)
    .default([]),
});

const importFolderSchema = z.object({
  path: z.string().min(1).max(4000),
  title: z.string().max(200).optional(),
  surface: designSurfaceSchema.optional(),
});

const editTargetSchema = z.object({
  target: z.record(z.string(), z.unknown()).optional(),
  instruction: z.string().max(4000).optional(),
  scope: z.literal('targeted').optional(),
  selector: z.string().max(500).optional(),
  neumaId: z.string().max(200).optional(),
  description: z.string().max(4000).optional(),
  file: z.string().max(500).optional(),
  surface: z.string().max(100).optional(),
});

const commentPatchSchema = z.object({
  status: z.enum(['open', 'resolved']).optional(),
  text: z.string().max(8000).optional(),
  attachToChat: z.boolean().optional(),
  target: z
    .object({
      id: z.string().max(200).optional(),
      selector: z.string().max(500).optional(),
      role: z.string().max(200).optional(),
      label: z.string().max(500).optional(),
      file: z.string().max(500).optional(),
      screen: z.string().max(200).optional(),
      x: z.number().finite().optional(),
      y: z.number().finite().optional(),
    })
    .optional(),
});

const sketchSchema = z.object({
  screenId: z.string().max(200).optional(),
  document: z.unknown().optional(),
});

const exportRequestSchema = z.object({
  format: z.string().max(50).optional(),
  allowLintOverride: z.boolean().optional(),
});

const pdfInputRequestSchema = z.object({
  artifactPath: z.string().min(1).max(1000).optional(),
  deck: z.boolean().optional(),
  fileName: z.string().max(200).optional(),
  title: z.string().max(200).optional(),
});

const designPackageRequestSchema = z.object({
  include: z
    .object({
      transcript: z.boolean().optional(),
      assets: z.boolean().optional(),
      providerKeys: z.literal(false).optional(),
    })
    .optional(),
});

const catalogAssetAttachSchema = z.object({
  role: z.enum(['reference', 'inline']).optional(),
  sessionId: z.string().min(1).optional(),
  clientRequestId: z.string().min(1).optional(),
});

const lintRequestSchema = z.object({
  path: z.string().max(500).optional(),
  content: z.string().max(2_000_000).optional(),
});

const designSystemCreateSchema = z.object({
  id: z.string().max(200).optional(),
  title: z.string().max(200).optional(),
  body: z.string().max(200_000).optional(),
});

const designSystemPatchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  body: z.string().min(1).max(200_000).optional(),
});

const dtcgDesignSystemImportSchema = z.object({
  id: z.string().max(200).optional(),
  title: z.string().trim().min(1).max(200).optional(),
  category: z.string().trim().min(1).max(100).optional(),
  summary: z.string().trim().min(1).max(500).optional(),
  tokens: z.record(z.string(), z.unknown()),
});

const shadcnRegistryDesignSystemImportSchema = z.object({
  url: z.string().url().max(2048),
  item: z.string().trim().min(1).max(120).optional(),
  id: z.string().max(200).optional(),
  title: z.string().trim().min(1).max(200).optional(),
  category: z.string().trim().min(1).max(100).optional(),
  summary: z.string().trim().min(1).max(500).optional(),
});

const promoteVersionSchema = z.object({
  path: z.string().min(1).max(1000),
});

function catalogMutationError(c: Context, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof AssetsError) {
    return c.json(
      { error: message, detail: error.detail },
      error.status as ContentfulStatusCode,
    );
  }
  if (message.startsWith('Invalid')) {
    return c.json({ error: message }, 400);
  }
  if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
    return c.json({ error: 'Catalog source not found' }, 404);
  }
  return c.json({ error: message }, 400);
}

function parseIsoQuery(value: string | undefined) {
  if (!value) return undefined;
  return Number.isNaN(Date.parse(value)) ? undefined : value;
}

function parseLimitQuery(value: string | undefined) {
  const parsed = Number(value ?? 50);
  return Number.isFinite(parsed) ? parsed : 50;
}

const CRITIQUE_CONFORMANCE_FIXTURES_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../test/fixtures/design-mode/critique/conformance',
);

function critiqueConformanceFixturesRoot() {
  return CRITIQUE_CONFORMANCE_FIXTURES_ROOT;
}

type ImportInput = z.infer<typeof importSchema>;

interface ImportFile {
  path: string;
  content?: string;
  data?: Uint8Array;
}

interface ImportReportItem {
  rule: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
}

// Project CRUD
designRoutes.get('/projects', async (c) =>
  c.json({ projects: await listDesignProjects() }),
);

designRoutes.get('/project-locations', (c) =>
  c.json({ locations: listDesignProjectLocations() }),
);

designRoutes.post(
  '/project-locations',
  zValidator('json', projectLocationSchema),
  async (c) => {
    try {
      const location = addDesignProjectLocation(c.req.valid('json').path);
      return c.json({ location, locations: listDesignProjectLocations() }, 201);
    } catch (error) {
      if (error instanceof DesignProjectLocationError) {
        return c.json({ error: error.message }, 400);
      }
      throw error;
    }
  },
);

designRoutes.get('/project-locations/scan', async (c) =>
  c.json({
    locations: listDesignProjectLocations(),
    projects: await listDesignProjects(),
  }),
);

designRoutes.delete(
  '/project-locations',
  zValidator('json', projectLocationSchema),
  async (c) => {
    try {
      removeDesignProjectLocation(c.req.valid('json').path);
      return c.json({ locations: listDesignProjectLocations() });
    } catch (error) {
      if (error instanceof DesignProjectLocationError) {
        return c.json({ error: error.message }, 400);
      }
      throw error;
    }
  },
);

designRoutes.get('/metrics', async (c) =>
  c.json({ metrics: await getDesignModeMetrics() }),
);

designRoutes.get('/dependencies', async (c) =>
  c.json({ dependencies: await getDesignDependencies() }),
);

designRoutes.get('/connectors', async (c) =>
  c.json({ connectors: await listDesignConnectorCatalog() }),
);

designRoutes.get('/telemetry/status', (c) =>
  c.json(getDesignTelemetryStatus()),
);

designRoutes.get('/critique/metrics', (c) =>
  c.json({
    metrics: listDesignCritiqueMetrics({
      since: parseIsoQuery(c.req.query('since')),
      limit: parseLimitQuery(c.req.query('limit')),
    }),
  }),
);

designRoutes.get('/critique/conformance', async (c) => {
  const fixturesRoot = critiqueConformanceFixturesRoot();
  try {
    await fs.access(fixturesRoot);
  } catch {
    return c.json(
      { error: 'Critique conformance fixtures unavailable in this build' },
      503,
    );
  }
  return c.json(await getCritiqueConformanceStatus(fixturesRoot));
});

designRoutes.get('/critique/rollout', (c) =>
  c.json({ rollout: getCritiqueRolloutState() }),
);

designRoutes.post('/critique/rollout/promote', async (c) => {
  const result = await promoteCritiqueRollout();
  if (!result.ok) {
    return c.json(
      {
        error: {
          code: 'critique_rollout_gate_unmet',
          message: result.state.reason ?? 'Critique rollout gate is unmet',
        },
        rollout: result.state,
      },
      409,
    );
  }
  return c.json({ rollout: result.state });
});

designRoutes.post('/critique/rollout/rollback', async (c) =>
  c.json({ rollout: (await rollbackCritiqueRollout()).state }),
);

designRoutes.post(
  '/critique/rollout/override',
  zValidator('json', critiqueOverrideSchema),
  (c) =>
    c.json({
      rollout: setCritiqueRolloutOverride(c.req.valid('json').userOverride),
    }),
);

designRoutes.get('/routines', (c) =>
  c.json({ routines: listDesignRoutines() }),
);

designRoutes.post(
  '/routines',
  zValidator('json', createDesignRoutineSchema),
  async (c) => {
    try {
      return c.json(
        { routine: await createDesignRoutine(c.req.valid('json')) },
        201,
      );
    } catch (error) {
      if (error instanceof InvalidDesignSkillError) {
        return c.json({ error: error.message }, 400);
      }
      throw error;
    }
  },
);

designRoutes.get('/routines/scheduler', (c) =>
  c.json(getDesignRoutineSchedulerStatus()),
);

designRoutes.post('/routines/scheduler/tick', async (c) =>
  c.json(await tickDesignRoutineScheduler()),
);

designRoutes.get('/routines/:routineId', (c) =>
  c.json({ routine: getDesignRoutine(c.req.param('routineId')) }),
);

designRoutes.patch(
  '/routines/:routineId',
  zValidator('json', updateDesignRoutineSchema),
  async (c) => {
    try {
      return c.json({
        routine: await updateDesignRoutine(
          c.req.param('routineId'),
          c.req.valid('json'),
        ),
      });
    } catch (error) {
      if (error instanceof InvalidDesignSkillError) {
        return c.json({ error: error.message }, 400);
      }
      throw error;
    }
  },
);

designRoutes.delete('/routines/:routineId', (c) => {
  deleteDesignRoutine(c.req.param('routineId'));
  return c.json({ ok: true });
});

designRoutes.get('/routines/:routineId/runs', (c) =>
  c.json({ runs: listDesignRoutineRuns(c.req.param('routineId')) }),
);

designRoutes.post(
  '/routines/:routineId/run',
  zValidator('json', runDesignRoutineSchema),
  async (c) =>
    c.json(
      {
        run: await runDesignRoutineNow(c.req.param('routineId'), {
          waitForCompletion: c.req.valid('json').waitForCompletion,
        }),
      },
      202,
    ),
);

designRoutes.post('/routines/runs/:runId/cancel', async (c) =>
  c.json({ run: await cancelDesignRoutineRun(c.req.param('runId')) }),
);

designRoutes.get('/design-jury/status', (c) =>
  c.json({ enabled: isDesignJuryEnabled() }),
);

designRoutes.post(
  '/projects',
  zValidator('json', createDesignProjectSchema),
  async (c) => {
    try {
      return c.json(
        { project: await createDesignProject(c.req.valid('json')) },
        201,
      );
    } catch (error) {
      if (
        error instanceof InvalidDesignSkillError ||
        error instanceof DesignProjectLocationError
      ) {
        return c.json({ error: error.message }, 400);
      }
      throw error;
    }
  },
);

designRoutes.post('/projects/import', async (c) => {
  const parsed = await parseImportRequest(c.req.raw);
  if (!parsed.success) {
    return c.json(
      { ok: false, error: 'Invalid import request', issues: parsed.error },
      400,
    );
  }
  const input = parsed.data;
  const archive = await loadImportFiles(input);
  if (archive.report.some((item) => item.status === 'error')) {
    return c.json({ ok: false, report: archive.report }, 400);
  }
  const files = archive.files;
  const entrypoint =
    input.entrypoint ??
    archive.entrypoint ??
    files.find((file) => file.path.endsWith('.html'))?.path;
  const hadEntry = Boolean(entrypoint);
  const validationReport = [
    ...archive.report,
    ...validateImportFiles(files, Boolean(input.archiveBase64)),
  ];
  if (validationReport.some((item) => item.status === 'error')) {
    return c.json({ ok: false, report: validationReport }, 400);
  }
  if (!hadEntry) {
    designImportLogger.info('folder_import_no_entry', {
      files: files.length,
    });
  }
  const lintFindings = lintImportFiles(files);
  const report = [...validationReport, ...importLintReport(lintFindings)];
  const p0Findings = lintFindings.filter(
    (finding) => finding.severity === 'p0',
  );
  if (p0Findings.length > 0 && !input.allowLintOverride) {
    return c.json(
      {
        ok: false,
        error: 'Import blocked by P0 DesignMode lint findings',
        report,
        findings: p0Findings,
      },
      409,
    );
  }
  const project = await createDesignProject({
    title: input.title,
    surface: input.surface,
    brief: {
      importEntrypoint: entrypoint,
      importArchiveName: input.archiveName,
      importedAt: new Date().toISOString(),
    },
  });
  for (const file of files) {
    await writeImportedProjectFile(project.id, file);
  }
  publishProjectPreviewEvent(project.id, 'reload', {
    reason: 'import',
    path: entrypoint,
  });
  await appendProjectHistory(project.id, {
    type: 'project.imported',
    at: new Date().toISOString(),
    report,
    lintFindings,
    lintOverrideUsed: p0Findings.length > 0 && Boolean(input.allowLintOverride),
  });
  return c.json({ ok: true, project, report }, 201);
});

designRoutes.post(
  '/projects/import-folder',
  zValidator('json', importFolderSchema),
  async (c) => {
    try {
      return c.json(await importDesignFolder(c.req.valid('json')), 201);
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : String(error) },
        400,
      );
    }
  },
);

designRoutes.get('/projects/:id', async (c) =>
  c.json({ project: await getDesignProject(c.req.param('id')) }),
);

designRoutes.patch(
  '/projects/:id',
  zValidator('json', patchDesignProjectSchema),
  async (c) => {
    try {
      return c.json({
        project: await patchDesignProject(
          c.req.param('id'),
          c.req.valid('json'),
        ),
      });
    } catch (error) {
      if (error instanceof InvalidDesignSkillError) {
        return c.json({ error: error.message }, 400);
      }
      throw error;
    }
  },
);

designRoutes.delete('/projects/:id', async (c) => {
  await deleteDesignProject(c.req.param('id'));
  return c.json({ ok: true });
});

designRoutes.post('/projects/:id/touch', async (c) =>
  c.json({ project: await touchDesignProject(c.req.param('id')) }),
);

designRoutes.post(
  '/projects/:id/catalog-assets/:assetId',
  zValidator('json', catalogAssetAttachSchema),
  async (c) => {
    try {
      return c.json(
        await attachCatalogAssetToDesign(
          c.req.param('id'),
          c.req.param('assetId'),
          c.req.valid('json'),
        ),
        201,
      );
    } catch (error) {
      return catalogMutationError(c, error);
    }
  },
);

designRoutes.get('/projects/:id/finalize/state', async (c) =>
  c.json({ state: await getDesignMdState(c.req.param('id')) }),
);

designRoutes.post('/projects/:id/finalize', async (c) => {
  try {
    return c.json(
      { result: await finalizeDesignProject(c.req.param('id')) },
      201,
    );
  } catch (error) {
    if (error instanceof FinalizeDesignLockedError) {
      return c.json(
        { error: error.message, holderRunId: error.holderRunId },
        409,
      );
    }
    throw error;
  }
});

// Live artifacts
designRoutes.get('/projects/:id/live-artifacts', async (c) =>
  c.json({
    liveArtifacts: await listDesignLiveArtifacts(c.req.param('id')),
  }),
);

designRoutes.post(
  '/projects/:id/live-artifacts',
  zValidator('json', createDesignLiveArtifactSchema),
  async (c) => {
    const projectId = c.req.param('id');
    const artifact = await createDesignLiveArtifact(
      projectId,
      c.req.valid('json'),
    );
    publishProjectPreviewEvent(projectId, 'reload', {
      reason: 'live-artifact.created',
      path: artifact.entrypointPath,
    });
    return c.json({ liveArtifact: artifact }, 201);
  },
);

designRoutes.get('/projects/:id/live-artifacts/:artifactId', async (c) =>
  c.json(
    await getDesignLiveArtifactDetail(
      c.req.param('id'),
      c.req.param('artifactId'),
    ),
  ),
);

designRoutes.post(
  '/projects/:id/live-artifacts/:artifactId/refresh',
  async (c) => {
    const projectId = c.req.param('id');
    const artifact = await refreshDesignLiveArtifact(
      projectId,
      c.req.param('artifactId'),
    );
    publishProjectPreviewEvent(projectId, 'reload', {
      reason: 'live-artifact.refreshed',
      path: artifact.entrypointPath,
      status: artifact.status,
    });
    return c.json({ liveArtifact: artifact });
  },
);

// Gated Design Jury
designRoutes.get('/projects/:id/design-jury', async (c) =>
  c.json({ runs: await listDesignJuryRuns(c.req.param('id')) }),
);

designRoutes.post(
  '/projects/:id/design-jury',
  zValidator('json', designJuryRequestSchema),
  async (c) => {
    try {
      return c.json(
        { run: await runDesignJury(c.req.param('id'), c.req.valid('json')) },
        201,
      );
    } catch (error) {
      if (error instanceof DesignJuryDisabledError) {
        return c.json({ error: error.message }, 404);
      }
      throw error;
    }
  },
);

designRoutes.post('/projects/:id/design-jury/:runId/interrupt', async (c) => {
  try {
    const result = await interruptDesignJuryRun(
      c.req.param('id'),
      c.req.param('runId'),
    );
    return c.json(result, 202);
  } catch (error) {
    if (error instanceof DesignJuryRunNotFoundError) {
      return c.json({ error: error.message }, 404);
    }
    if (error instanceof DesignJuryRunProjectMismatchError) {
      return c.json({ error: error.message }, 409);
    }
    throw error;
  }
});

designRoutes.get('/projects/:id/design-jury/:runId/events', async (c) => {
  const projectId = c.req.param('id');
  const runId = c.req.param('runId');
  if (!isDesignJuryRunId(runId)) {
    return c.json({ error: 'Design Jury run not found' }, 404);
  }

  const run = await readPersistedDesignJuryRun(projectId, runId);
  if (!run || run.projectId !== projectId) {
    return c.json({ error: 'Design Jury run not found' }, 404);
  }

  const replay = await readDesignJuryPanelEvents(projectId, runId).catch(
    () => [] as PanelEvent[],
  );
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let unsubscribe: (() => void) | null = null;
  let closed = false;

  const closeStream = (
    controller: ReadableStreamDefaultController<Uint8Array>,
  ) => {
    if (closed) return;
    closed = true;
    if (heartbeat) clearInterval(heartbeat);
    unsubscribe?.();
    try {
      controller.enqueue(sseEncoder.encode('event: done\ndata: {}\n\n'));
      controller.close();
    } catch {
      // Client already disconnected.
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: PanelEvent) => {
        try {
          controller.enqueue(encodeSseMessage(event));
          if (isTerminalPanelEvent(event)) closeStream(controller);
        } catch {
          closeStream(controller);
        }
      };

      for (const event of replay) {
        send(event);
        if (closed) return;
      }
      if (run.status !== 'running') {
        closeStream(controller);
        return;
      }

      unsubscribe = subscribeDesignJuryEvents(projectId, runId, send);
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(sseEncoder.encode(': ping\n\n'));
        } catch {
          closeStream(controller);
        }
      }, 15_000);
    },
    cancel() {
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      unsubscribe?.();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
});

designRoutes.get('/projects/:id/design-jury/:runId/artifact', async (c) => {
  try {
    return await buildCritiqueArtifactResponse(
      c.req.param('id'),
      c.req.param('runId'),
    );
  } catch (error) {
    if (error instanceof CritiqueArtifactNotFoundError) {
      return c.json({ error: error.message }, 404);
    }
    if (error instanceof CritiqueArtifactBadRequestError) {
      return c.json({ error: error.message }, 400);
    }
    throw error;
  }
});

// Project files
designRoutes.get('/projects/:id/files', async (c) => {
  const id = c.req.param('id');
  const root = c.req.query('path') || '.';
  const files = await listProjectFiles(id, root);
  return c.json({ files });
});

designRoutes.get('/projects/:id/file', async (c) => {
  const file = await readProjectTextFile(
    c.req.param('id'),
    c.req.query('path') || 'project.json',
  );
  return c.json(file);
});

designRoutes.get('/projects/:id/export/file', async (c) => {
  const projectId = c.req.param('id');
  const inline = c.req.query('inline');
  const requestedPath = c.req.query('path');
  if (!requestedPath || !inline || !isInlineExportRequested(inline)) {
    return c.json({ error: 'BAD_REQUEST' }, 400);
  }

  let resolved: ReturnType<typeof resolveProjectPath>;
  try {
    resolved = resolveProjectPath(projectId, requestedPath);
  } catch {
    return c.json({ error: 'BAD_REQUEST' }, 400);
  }

  if (mimeForPath(resolved.relativePath) !== 'text/html') {
    return c.json({ error: 'UNSUPPORTED_FILE_TYPE' }, 400);
  }

  let owner: Buffer;
  try {
    owner = await fs.readFile(resolved.absolutePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return c.json({ error: 'FILE_NOT_FOUND' }, 404);
    }
    return c.json({ error: 'BAD_REQUEST' }, 400);
  }

  const html = await inlineRelativeAssets(
    owner.toString('utf-8'),
    resolved.relativePath,
    async (relativePath, options) => {
      try {
        if (relativePath.startsWith('asset:')) {
          const materialized = resolveDesignInlineAsset(
            projectId,
            relativePath.slice('asset:'.length),
            { preferProxy: options?.preferProxy === true },
          );
          if (!materialized) return null;
          const stat = await fs.stat(materialized.absolutePath);
          if (!stat.isFile()) return null;
          return {
            body: await fs.readFile(materialized.absolutePath),
            contentType: materialized.mime,
          };
        }
        const asset = resolveProjectPath(projectId, relativePath);
        const stat = await fs.stat(asset.absolutePath);
        if (!stat.isFile()) return null;
        return {
          body: await fs.readFile(asset.absolutePath),
          contentType: mimeForPath(asset.relativePath),
        };
      } catch {
        return null;
      }
    },
  );
  const attributedHtml = injectHtmlAssetAttribution(html, projectId);

  return new Response(attributedHtml, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': 'sandbox allow-scripts',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});

designRoutes.get('/projects/:id/blob', async (c) => {
  const requestedPath = c.req.query('path');
  if (!requestedPath) return c.json({ error: 'path is required' }, 400);
  let resolved: ReturnType<typeof resolveProjectPath>;
  try {
    resolved = resolveProjectPath(c.req.param('id'), requestedPath);
  } catch {
    return c.json({ error: 'BAD_REQUEST' }, 400);
  }
  const stat = await fs.stat(resolved.absolutePath).catch(() => null);
  if (!stat?.isFile()) return c.json({ error: 'Path is not a file' }, 404);
  const contentType = mimeForPath(resolved.relativePath);
  const policyError = validateDesignBlobDownload(contentType, stat.size);
  if (policyError) {
    return c.json(
      { error: policyError.error, maxBytes: policyError.maxBytes },
      policyError.status,
    );
  }
  const contentPolicyError = await validateDesignBlobFileContent(
    resolved.absolutePath,
    contentType,
  );
  if (contentPolicyError) {
    return c.json(
      { error: contentPolicyError.error },
      contentPolicyError.status,
    );
  }
  const seekable = isRangeSeekableMime(contentType);
  const headers: Record<string, string> = {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
  if (seekable) headers['Accept-Ranges'] = 'bytes';
  headers['Content-Disposition'] = contentDispositionForDesignBlob(
    resolved.relativePath,
    isActiveMimeType(contentType) ? 'attachment' : 'inline',
  );
  const range = seekable
    ? parseByteRange(c.req.header('range'), stat.size)
    : null;
  if (range === 'unsatisfiable') {
    return new Response(null, {
      status: 416,
      headers: {
        ...headers,
        'Content-Length': '0',
        'Content-Range': `bytes */${stat.size}`,
      },
    });
  }
  if (range) {
    headers['Content-Length'] = String(range.end - range.start + 1);
    headers['Content-Range'] = `bytes ${range.start}-${range.end}/${stat.size}`;
    return new Response(
      Readable.toWeb(
        createReadStream(resolved.absolutePath, {
          start: range.start,
          end: range.end,
        }),
      ) as ReadableStream,
      { status: 206, headers },
    );
  }
  headers['Content-Length'] = String(stat.size);
  return new Response(
    Readable.toWeb(createReadStream(resolved.absolutePath)) as ReadableStream,
    { headers },
  );
});

designRoutes.get('/projects/:id/file-location', async (c) => {
  const requestedPath = c.req.query('path');
  if (!requestedPath) return c.json({ error: 'path is required' }, 400);
  const resolved = resolveProjectPath(c.req.param('id'), requestedPath);
  // absolutePath is the user's own workspace path on the local machine;
  // ExportsDrawer needs it for the OS-level "Open" / "Copy path" actions.
  return c.json({
    path: resolved.relativePath,
    absolutePath: resolved.absolutePath,
  });
});

designRoutes.post(
  '/projects/:id/file',
  zValidator('json', fileWriteSchema),
  async (c) => {
    const id = c.req.param('id');
    const body = c.req.valid('json');
    if (body.source === 'generated' && /\.html?$/i.test(body.path)) {
      const validation = validateHtmlArtifact(body.content);
      if (!validation.ok) {
        return c.json(
          {
            error: 'Generated HTML artifact failed validation',
            reason: validation.reason,
          },
          422,
        );
      }
    }
    const file = await writeProjectTextFile(id, body.path, body.content);
    const findings = shouldLint(body.path)
      ? lintDesignArtifact(body.content, { path: body.path })
      : [];
    await appendProjectHistory(id, {
      type: 'file.written',
      at: new Date().toISOString(),
      path: file.path,
      lint: findings,
    });
    publishProjectPreviewEvent(id, 'reload', {
      reason: 'file.written',
      path: file.path,
      lint: findings.length,
    });
    return c.json({ file, lint: findings });
  },
);

designRoutes.post(
  '/projects/:id/files/rename',
  zValidator('json', filesRenameSchema),
  async (c) => {
    const id = c.req.param('id');
    const body = c.req.valid('json');
    try {
      const file = await renameProjectFile(id, body.from, body.to);
      const project = await getDesignProject(id);
      const outputs = project.outputs.map((output) =>
        output.path === file.from ? { ...output, path: file.path } : output,
      );
      const nextProject = outputs.some(
        (output, index) => output.path !== project.outputs[index]?.path,
      )
        ? await patchDesignProject(id, { outputs })
        : project;
      await appendProjectHistory(id, {
        type: 'file.renamed',
        at: new Date().toISOString(),
        from: file.from,
        to: file.path,
      });
      publishProjectPreviewEvent(id, 'reload', {
        reason: 'file.renamed',
        path: file.path,
        previousPath: file.from,
      });
      return c.json({ file, project: nextProject });
    } catch (error) {
      if (error instanceof ProjectFileConflictError) {
        return c.json({ error: error.message }, 409);
      }
      if (isProjectPathError(error)) {
        return c.json(
          { error: error instanceof Error ? error.message : String(error) },
          400,
        );
      }
      throw error;
    }
  },
);

designRoutes.delete(
  '/projects/:id/files',
  zValidator('json', filesDeleteSchema),
  async (c) => {
    const id = c.req.param('id');
    const deleted = await deleteProjectFiles(id, c.req.valid('json').paths);
    const deletedPaths = new Set(deleted.map((file) => file.path));
    const project = await getDesignProject(id);
    const nextOutputs = project.outputs.filter(
      (output) => !deletedPaths.has(output.path),
    );
    const nextProject =
      nextOutputs.length === project.outputs.length
        ? project
        : await patchDesignProject(id, { outputs: nextOutputs });
    await appendProjectHistory(id, {
      type: 'files.deleted',
      at: new Date().toISOString(),
      paths: [...deletedPaths],
      trashPaths: deleted.map((file) => file.trashPath),
    });
    publishProjectPreviewEvent(id, 'reload', {
      reason: 'files.deleted',
      paths: [...deletedPaths],
    });
    return c.json({ deleted, project: nextProject });
  },
);

// Catalogs
designRoutes.get('/skills', async (c) =>
  c.json({ skills: await listDesignSkills() }),
);

designRoutes.post('/skills/:id/install', async (c) => {
  try {
    const skill = await installDesignSkillPack(c.req.param('id'));
    return c.json({ skill }, 201);
  } catch (error) {
    return catalogMutationError(c, error);
  }
});

designRoutes.delete('/skills/:id/install', async (c) => {
  try {
    const id = c.req.param('id');
    const skill = await getDesignSkill(id);
    if (skill?.origin === 'builtin') {
      return c.json(
        {
          error: {
            code: 'BUILTIN_PROTECTED',
            message: 'Built-in skills cannot be uninstalled.',
          },
        },
        403,
      );
    }
    await uninstallDesignSkillPack(id);
    return c.json({ ok: true });
  } catch (error) {
    return catalogMutationError(c, error);
  }
});

designRoutes.get('/skills/:id/example', async (c) => {
  const html = await readDesignSkillExample(c.req.param('id'));
  if (!html) return c.json({ error: 'Skill example not found' }, 404);
  return c.body(html, 200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Disposition': 'attachment; filename="example.html"',
    'X-Content-Type-Options': 'nosniff',
  });
});

designRoutes.get('/skills/:id', async (c) =>
  c.json({ skill: await getDesignSkill(c.req.param('id')) }),
);

designRoutes.get('/design-systems', async (c) =>
  // Summary mode: omit each system's components.html (the grid lazy-fetches the
  // full record per card for live previews) to keep the catalog list small.
  c.json({ designSystems: await listDesignSystems(true) }),
);

designRoutes.post('/design-systems/:id/install', async (c) => {
  try {
    const designSystem = await installDesignSystemPack(c.req.param('id'));
    return c.json({ designSystem }, 201);
  } catch (error) {
    return catalogMutationError(c, error);
  }
});

designRoutes.delete('/design-systems/:id/install', async (c) => {
  try {
    await uninstallDesignSystemPack(c.req.param('id'));
    return c.json({ ok: true });
  } catch (error) {
    return catalogMutationError(c, error);
  }
});

designRoutes.post(
  '/design-systems/import/dtcg',
  zValidator('json', dtcgDesignSystemImportSchema),
  async (c) => {
    const body = c.req.valid('json');
    try {
      const designSystem = await importDtcgDesignSystem({
        id: body.id,
        title: body.title,
        category: body.category,
        summary: body.summary,
        document: body.tokens,
      });
      return c.json({ designSystem }, 201);
    } catch (error) {
      if (error instanceof DtcgTokenError) {
        return c.json({ error: error.message }, 400);
      }
      return catalogMutationError(c, error);
    }
  },
);

designRoutes.post(
  '/design-systems/import/shadcn-registry',
  zValidator('json', shadcnRegistryDesignSystemImportSchema),
  async (c) => {
    const body = c.req.valid('json');
    try {
      const designSystem = await importShadcnRegistryDesignSystem(body);
      return c.json({ designSystem }, 201);
    } catch (error) {
      if (error instanceof ShadcnRegistryImportError) {
        return c.json({ error: error.message }, 400);
      }
      return catalogMutationError(c, error);
    }
  },
);

designRoutes.post(
  '/design-systems',
  zValidator('json', designSystemCreateSchema),
  async (c) => {
    const body = c.req.valid('json');
    const id = slugify(body.id || body.title || 'custom-design-system');
    const content =
      body.body || `# ${body.title || id}\n\nCustom DesignMode system.\n`;
    const projectRoot = path.join(
      getDesignWorkspaceRoot(),
      '.neuma/design-systems',
    );
    const dest = path.join(projectRoot, id, 'DESIGN.md');
    await writeJsonAtomic(path.join(projectRoot, id, 'meta.json'), {
      id,
      sourceKind: 'custom',
      createdAt: new Date().toISOString(),
    });
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, content, 'utf-8');
    designSystemsLogger.info('custom_design_system_registered', {
      designSystemId: id,
    });
    return c.json({ designSystem: { id, title: body.title || id } }, 201);
  },
);

designRoutes.get('/design-systems/:id', async (c) =>
  c.json({ designSystem: await getDesignSystem(c.req.param('id')) }),
);

// Generated "Showcase" page (Open Design parity): a token-driven marketing
// surface synthesized from the system's DESIGN.md — NOT the bundled
// components.html (which is the bespoke "reference components" fixture exposed
// separately). Returns raw HTML for direct sandboxed-iframe rendering.
designRoutes.get('/design-systems/:id/showcase', async (c) => {
  const id = c.req.param('id');
  const designSystem = await getDesignSystem(id);
  if (!designSystem) return c.json({ error: 'Design system not found' }, 404);
  const html = renderDesignSystemShowcase(id, designSystem.body);
  return c.body(html, 200, {
    'Content-Type': 'text/html; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  });
});

designRoutes.get('/design-systems/:id/tokens.dtcg.json', async (c) => {
  const designSystem = await getDesignSystem(c.req.param('id'));
  if (!designSystem) return c.json({ error: 'Design system not found' }, 404);
  try {
    const tokens = designSystemTokensToDtcgDocument(designSystem);
    return c.json(tokens, 200, {
      'Content-Disposition': `attachment; filename="${slugify(designSystem.id)}.tokens.dtcg.json"`,
      'X-Content-Type-Options': 'nosniff',
    });
  } catch (error) {
    if (error instanceof DtcgTokenError) {
      return c.json({ error: error.message }, 404);
    }
    return catalogMutationError(c, error);
  }
});

designRoutes.patch(
  '/design-systems/:id',
  zValidator('json', designSystemPatchSchema),
  async (c) => {
    const body = c.req.valid('json');
    if (!body.body && !body.title) {
      return c.json({ error: 'title or body is required' }, 400);
    }
    try {
      const designSystem = await patchDesignSystem(c.req.param('id'), body);
      return c.json({ designSystem });
    } catch (error) {
      if (error instanceof DesignSystemReadOnlyError) {
        return c.json({ error: error.message }, 409);
      }
      if (error instanceof DesignSystemNotFoundError) {
        return c.json({ error: error.message }, 404);
      }
      return catalogMutationError(c, error);
    }
  },
);

designRoutes.get('/craft', async (c) => c.json({ craft: await listCraft() }));

designRoutes.get('/craft/:id', async (c) =>
  c.json({ craft: await getCraft(c.req.param('id')) }),
);

designRoutes.get('/prompt-templates', async (c) => {
  const surface = c.req.query('surface') === 'video' ? 'video' : 'image';
  return c.json({ templates: await listPromptTemplates(surface, false) });
});

designRoutes.get('/prompt-templates/:surface/:id', async (c) => {
  const surface = c.req.param('surface') === 'video' ? 'video' : 'image';
  return c.json({
    template: await getPromptTemplate(surface, c.req.param('id')),
  });
});

designRoutes.get('/live-artifact-templates', async (c) =>
  c.json({ templates: await listDesignLiveArtifactTemplates() }),
);

designRoutes.get('/live-artifact-templates/:id', async (c) =>
  c.json({
    template: await getDesignLiveArtifactTemplate(c.req.param('id')),
  }),
);

// Prompt composition
designRoutes.post(
  '/projects/:id/resolve-prompt',
  zValidator('json', resolvePromptSchema),
  async (c) => {
    const project = await getDesignProject(c.req.param('id'));
    const resolved = await resolveProjectPrompt(
      project,
      c.req.valid('json').latestMessage,
    );
    return c.json(resolved);
  },
);

// Media and generation
designRoutes.get('/media/voices', async (c) => {
  const provider = (c.req.query('provider') || 'elevenlabs').toLowerCase();
  if (provider !== 'elevenlabs') {
    return c.json({ error: 'Unsupported voice provider' }, 400);
  }
  if (!hasSpeechProvider(provider)) {
    return c.json({ error: 'ElevenLabs credentials are not configured' }, 401);
  }

  const now = Date.now();
  const cached = mediaVoiceCache.get(provider);
  if (cached && cached.expiresAt > now) {
    c.header('Cache-Control', 'private, max-age=300');
    return c.json({ voices: cached.voices });
  }

  try {
    const voices = await listSpeechVoices(provider);
    mediaVoiceCache.set(provider, {
      voices,
      expiresAt: now + MEDIA_VOICE_CACHE_TTL_MS,
    });
    c.header('Cache-Control', 'private, max-age=300');
    return c.json({ voices });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/auth|401|403|unauthorized|forbidden/i.test(message)) {
      return c.json({ error: 'ElevenLabs credentials were rejected' }, 401);
    }
    return c.json({ error: message }, 502);
  }
});

designRoutes.post(
  '/projects/:id/generate',
  zValidator('json', mediaSchema),
  async (c) => {
    const body = c.req.valid('json');
    const task = await startDesignMediaTask({
      ...body,
      projectId: c.req.param('id'),
      surface: body.surface === 'document' ? 'document' : body.surface,
    });
    return c.json({ taskId: task.taskId, status: task.state, task });
  },
);

designRoutes.post(
  '/projects/:id/media',
  zValidator('json', mediaSchema),
  async (c) => {
    const body = c.req.valid('json');
    const task = await startDesignMediaTask({
      ...body,
      projectId: c.req.param('id'),
    });
    return c.json({ taskId: task.taskId, status: task.state, task });
  },
);

designRoutes.get('/projects/:id/tasks', async (c) =>
  c.json({ tasks: listDesignMediaTasks(c.req.param('id')) }),
);

// ── DesignMode conversational chat loop (Fix-sync Phase 02) ──────────────
// Streams the agent runtime's AgentMessages over SSE so the project view is a
// real conversation that creates artifacts in the workspace. Gated client-side
// behind the `designMode.chatLoop` setting; the route is always available.
const designChatControllers = new Map<
  string,
  { controller: AbortController; projectId: string }
>();

function isDesignRawStreamRollbackEnabled(): boolean {
  return process.env.NEUMA_DESIGN_RAW_STREAM_ROLLBACK === '1';
}

async function* withDesignProjectUpdate(
  events: AsyncGenerator<BaseEvent>,
  input: {
    projectId: string;
    runId: string;
    provider: string;
    model?: string;
    signal: AbortSignal;
  },
): AsyncGenerator<BaseEvent> {
  for await (const event of events) {
    if (event.type !== EventType.RUN_FINISHED || input.signal.aborted) {
      yield event;
      continue;
    }
    const terminalSeq = (event as BaseEvent & { seq: number }).seq;
    try {
      const project = await harvestDesignChatArtifact(
        input.projectId,
        input.provider,
        input.model,
      );
      if (project) {
        yield {
          type: EventType.CUSTOM,
          name: 'design.project',
          value: project,
          threadId: input.projectId,
          runId: input.runId,
          timestamp: Date.now(),
          seq: terminalSeq,
        } as BaseEvent;
        yield { ...event, seq: terminalSeq + 1 } as BaseEvent;
        continue;
      }
    } catch (error) {
      logger.warn(
        `[${input.projectId}] design chat artifact harvest failed:`,
        error,
      );
    }
    yield event;
  }
}

const designChatSchema = z.object({
  prompt: z.string().min(1).max(200_000),
  provider: z.string().max(64).optional(),
  model: z.string().max(128).optional(),
  supplementalSkillIds: z.array(z.string()).max(3).optional(),
  runContext: RunContextEnvelopeInputSchema.optional(),
  // Prior turns as conversation history (Phase 06) so the build turn has the
  // brief + discovery questions + answers; absent/empty ⇒ turn 1.
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().max(200_000),
      }),
    )
    .max(40)
    .optional(),
});

designRoutes.post(
  '/projects/:id/chat',
  zValidator('json', designChatSchema),
  async (c) => {
    const projectId = c.req.param('id');
    const {
      prompt,
      provider,
      model,
      messages,
      supplementalSkillIds,
      runContext,
    } = c.req.valid('json');
    const runId = randomUUID();
    let normalizedRunContext;
    try {
      normalizedRunContext = await resolveRunContext({
        mode: 'design',
        ownerKey: projectId,
        envelope: {
          ...runContext,
          supplementalSkillIds:
            runContext?.supplementalSkillIds ?? supplementalSkillIds,
        },
      });
    } catch (error) {
      if (error instanceof RunContextError) {
        return c.json({ error: error.message }, error.status);
      }
      throw error;
    }
    let reservation;
    try {
      reservation = reserveAgentRun({
        runId,
        mode: normalizedRunContext.mode,
        ownerKey: normalizedRunContext.ownerKey,
        projectId: normalizedRunContext.projectId,
        conversationId: normalizedRunContext.conversationId,
        clientRequestId: normalizedRunContext.clientRequestId,
        requestMessageId: normalizedRunContext.messageId,
        messageContent: prompt,
        provider: provider ?? 'claude',
        model,
        recovery: normalizedRunContext.recovery,
      });
    } catch (error) {
      if (error instanceof AgentRunConflictError) {
        return c.json({ error: error.message }, 409);
      }
      throw error;
    }
    if (reservation.disposition === 'existing') {
      const existing = reservation.run;
      const replay = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            sseEncoder.encode(
              `event: run\ndata: ${JSON.stringify({ runId: existing.id, disposition: 'existing', status: existing.status })}\n\n`,
            ),
          );
          controller.enqueue(sseEncoder.encode('event: done\ndata: {}\n\n'));
          controller.close();
        },
      });
      return new Response(replay, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
        },
      });
    }
    const abortController = new AbortController();
    designChatControllers.set(runId, {
      controller: abortController,
      projectId,
    });

    if (isDesignRawStreamRollbackEnabled()) {
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const send = (event: string, data: unknown) => {
            controller.enqueue(
              sseEncoder.encode(
                `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
              ),
            );
          };
          send('run', { runId });
          try {
            const emitter = new AGUIEmitter(projectId, runId, {
              taskTitle: `Design ${projectId}`,
            });
            const persister = new AGUIEventPersister(
              projectId,
              runId,
              undefined,
              undefined,
              provider ?? 'claude',
              { model },
              'design',
            );
            const agentMessages = runDesignChat(projectId, {
              prompt,
              provider,
              model,
              messages,
              sessionId: runId,
              abortController,
              pinnedSkills: normalizedRunContext.supplementalSkillIds,
            });
            let terminalError: { message: string } | undefined;
            for await (const event of emitter.transform(
              agentMessages,
              (message) => {
                if (abortController.signal.aborted) {
                  throw new DOMException('Run stopped by user', 'AbortError');
                }
                send('agent', message);
              },
            )) {
              journalAGUIEvent(runId, event);
              persister.handleEvent(event);
              if (event.type === EventType.RUN_ERROR) {
                terminalError = event as BaseEvent & { message: string };
              }
            }
            if (terminalError) {
              if (!abortController.signal.aborted) {
                send('error', { message: terminalError.message });
              }
              return;
            }
            // Register any artifact the run wrote (→ Creations grid / auto-open)
            // and push the updated project so the client refreshes without a
            // reload. Best-effort: a harvest failure must not fail the run.
            if (!abortController.signal.aborted) {
              try {
                const updated = await harvestDesignChatArtifact(
                  projectId,
                  provider ?? 'claude',
                  model,
                );
                if (updated) send('project', updated);
              } catch (harvestErr) {
                logger.warn(
                  `[${projectId}] design chat artifact harvest failed:`,
                  harvestErr,
                );
              }
            }
            send('done', {});
          } catch (err) {
            // A client disconnect aborts the run via cancel(); that is not a
            // failure — don't log it or push a spurious error frame.
            const isAbort =
              abortController.signal.aborted ||
              (err instanceof Error && err.name === 'AbortError');
            if (!isAbort) {
              finishAgentRun({
                id: runId,
                status: 'failed',
                completeness: 'unfinished',
                error: err instanceof Error ? err.message : String(err),
              });
              logger.error(`[${projectId}] design chat failed:`, err);
              try {
                send('error', {
                  message: err instanceof Error ? err.message : String(err),
                });
              } catch {
                // Stream already closed.
              }
            }
            if (isAbort) {
              finishAgentRun({
                id: runId,
                status: 'cancelled',
                completeness: 'unfinished',
              });
            }
          } finally {
            designChatControllers.delete(runId);
            try {
              controller.close();
            } catch {
              // Already closed by client disconnect.
            }
          }
        },
        cancel() {
          abortController.abort();
          designChatControllers.delete(runId);
        },
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        },
      });
    }

    const emitter = new AGUIEmitter(projectId, runId, {
      taskTitle: `Design ${projectId}`,
    });
    const busKey = `agui-design-${projectId}-${runId}`;
    const persister = new AGUIEventPersister(
      projectId,
      runId,
      undefined,
      undefined,
      provider ?? 'claude',
      { model },
      'design',
    );
    const agentMessages = runDesignChat(projectId, {
      prompt,
      provider,
      model,
      messages,
      sessionId: runId,
      abortController,
      pinnedSkills: normalizedRunContext.supplementalSkillIds,
    });
    startDetachedAGUIRun({
      mode: 'design',
      ownerKey: projectId,
      runId,
      threadId: projectId,
      busKey,
      controller: abortController,
      persister,
      events: withDesignProjectUpdate(emitter.transform(agentMessages), {
        projectId,
        runId,
        provider: provider ?? 'claude',
        model,
        signal: abortController.signal,
      }),
      onTerminal: () => {
        designChatControllers.delete(runId);
      },
    }).catch((error) => {
      logger.error(`[${projectId}] detached design chat failed:`, error);
    });

    return streamSSE(c, async (stream) => {
      await subscribeSSEToBus(
        stream,
        busKey,
        c.req.header('Accept') ?? '',
        c.req.raw.signal,
      );
    });
  },
);

designRoutes.post('/projects/:id/chat/:runId/cancel', (c) => {
  const runId = c.req.param('runId');
  const entry = designChatControllers.get(runId);
  // Only cancel a run that belongs to this project (explicit ownership).
  const owned = entry && entry.projectId === c.req.param('id');
  if (owned) {
    cancelActiveAGUIRun('design', c.req.param('id'), runId);
    entry.controller.abort();
    designChatControllers.delete(runId);
  }
  return c.json({ ok: Boolean(owned) });
});

// ── Hand-off: open a project in a local editor / file manager (Phase 05) ──
designRoutes.get('/editors', async (c) =>
  c.json({ editors: await detectDesignEditors() }),
);

// Absolute project-root path for the editor / CLI hand-off menu (copy path,
// `cd` commands). Resolved through `resolveProjectPath` (path-escape-checked).
designRoutes.get('/projects/:id/dir', (c) =>
  c.json({ path: designProjectDir(c.req.param('id')) }),
);

const openInSchema = z.object({ editorId: z.string().min(1).max(32) });

designRoutes.post(
  '/projects/:id/open-in',
  zValidator('json', openInSchema),
  async (c) => {
    try {
      await openDesignProjectInEditor(
        c.req.param('id'),
        c.req.valid('json').editorId,
      );
      return c.json({ ok: true });
    } catch (err) {
      const code =
        err instanceof Error &&
        (err as Error & { code?: string }).code === 'EDITOR_NOT_AVAILABLE'
          ? 409
          : 400;
      return c.json(
        { error: err instanceof Error ? err.message : String(err) },
        code,
      );
    }
  },
);

designRoutes.get('/projects/:id/tasks/:taskId/wait', async (c) =>
  c.json(
    await waitDesignMediaTask(
      c.req.param('taskId'),
      Number(c.req.query('since') || 0),
    ),
  ),
);

designRoutes.post('/projects/:id/tasks/:taskId/cancel', async (c) =>
  c.json({ task: await cancelDesignMediaTask(c.req.param('taskId')) }),
);

designRoutes.get('/projects/:id/capabilities', async (c) => {
  const project = await getDesignProject(c.req.param('id'));
  return c.json({
    capabilities: getDesignCapabilities(),
    budget: await getDesignBudgetStatus(project),
    projectId: project.id,
  });
});

// Preview/edit/comment/sketch/export/governance
designRoutes.post(
  '/projects/:id/edit-target',
  zValidator('json', editTargetSchema),
  async (c) => {
    const body = c.req.valid('json');
    await appendProjectHistory(c.req.param('id'), {
      type: 'edit.target',
      at: new Date().toISOString(),
      instruction: body,
    });
    return c.json({ ok: true });
  },
);

designRoutes.post(
  '/projects/:id/edit/patch',
  zValidator('json', manualEditPatchSchema),
  async (c) => {
    try {
      const applied = await applyManualEditPatch(
        c.req.param('id'),
        c.req.valid('json'),
      );
      publishProjectPreviewEvent(c.req.param('id'), 'reload', {
        reason: 'edit.patch.applied',
        patchId: applied.patchId,
        path: applied.sourcePath,
      });
      return c.json({ patch: applied }, 201);
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : String(error) },
        400,
      );
    }
  },
);

designRoutes.get('/projects/:id/edit/patches', async (c) =>
  c.json({ patches: await listManualEditPatches(c.req.param('id')) }),
);

designRoutes.post(
  '/projects/:id/edit/revert',
  zValidator('json', manualEditRevertSchema),
  async (c) => {
    try {
      const reverted = await revertManualEditPatch(
        c.req.param('id'),
        c.req.valid('json').patchId,
      );
      publishProjectPreviewEvent(c.req.param('id'), 'reload', {
        reason: 'edit.patch.reverted',
        patchId: reverted.revertedPatchId,
      });
      return c.json({ patch: reverted }, 201);
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : String(error) },
        400,
      );
    }
  },
);

designRoutes.get('/projects/:id/comments', async (c) =>
  c.json({
    comments: await readProjectJson(
      c.req.param('id'),
      'comments/comments.json',
      [],
    ),
  }),
);

designRoutes.post(
  '/projects/:id/comments',
  zValidator('json', commentSchema),
  async (c) => {
    const id = c.req.param('id');
    const validated = c.req.valid('json');
    try {
      const comment = await withProjectLock(id, async () => {
        const comments = await readProjectJson<Record<string, unknown>[]>(
          id,
          'comments/comments.json',
          [],
        );
        const { attachments, ...commentFields } = validated;
        const storedAttachments = await materializeCommentAttachments(
          id,
          attachments,
        );
        const next = {
          id: `comment_${randomUUID()}`,
          status: 'open',
          createdAt: new Date().toISOString(),
          ...commentFields,
          ...(storedAttachments.length > 0
            ? { attachments: storedAttachments }
            : {}),
          attachToChat: validated.attachToChat ?? true,
        };
        comments.unshift(next);
        await writeProjectJson(id, 'comments/comments.json', comments);
        return next;
      });
      return c.json({ comment }, 201);
    } catch (error) {
      if (error instanceof CommentAttachmentError) {
        return c.json({ error: error.message }, 400);
      }
      throw error;
    }
  },
);

designRoutes.patch(
  '/projects/:id/comments/:commentId',
  zValidator('json', commentPatchSchema),
  async (c) => {
    const id = c.req.param('id');
    const commentId = c.req.param('commentId');
    const rawPatch = c.req.valid('json');
    const patch: Record<string, unknown> = {};
    if (rawPatch.status !== undefined) patch.status = rawPatch.status;
    if (rawPatch.text !== undefined) patch.text = rawPatch.text;
    if (rawPatch.attachToChat !== undefined) {
      patch.attachToChat = rawPatch.attachToChat;
    }
    if (rawPatch.target !== undefined) patch.target = rawPatch.target;
    const next = await withProjectLock(id, async () => {
      const comments = await readProjectJson<Record<string, unknown>[]>(
        id,
        'comments/comments.json',
        [],
      );
      const updated = comments.map((item) =>
        item.id === commentId
          ? {
              ...item,
              ...patch,
              id: item.id,
              createdAt: item.createdAt,
              updatedAt: new Date().toISOString(),
            }
          : item,
      );
      await writeProjectJson(id, 'comments/comments.json', updated);
      return updated;
    });
    return c.json({ comments: next });
  },
);

designRoutes.delete('/projects/:id/comments/:commentId', async (c) => {
  const id = c.req.param('id');
  const commentId = c.req.param('commentId');
  const next = await withProjectLock(id, async () => {
    const comments = await readProjectJson<Record<string, unknown>[]>(
      id,
      'comments/comments.json',
      [],
    );
    const filtered = comments.filter((item) => item.id !== commentId);
    await writeProjectJson(id, 'comments/comments.json', filtered);
    return filtered;
  });
  return c.json({ comments: next });
});

designRoutes.post(
  '/projects/:id/messages/:messageId/feedback',
  zValidator('json', messageFeedbackSchema),
  async (c) => {
    const id = c.req.param('id');
    const messageId = c.req.param('messageId');
    const validated = c.req.valid('json');
    const feedback = await withProjectLock(id, async () => {
      const items = await readProjectJson<Record<string, unknown>[]>(
        id,
        'comments/message-feedback.json',
        [],
      );
      const next = {
        id: `feedback_${randomUUID()}`,
        messageId,
        ...validated,
      };
      const updated = [
        next,
        ...items.filter((item) => item.messageId !== messageId),
      ];
      await writeProjectJson(id, 'comments/message-feedback.json', updated);
      return next;
    });
    return c.json({ feedback }, 201);
  },
);

designRoutes.get('/projects/:id/sketches', async (c) => {
  const files = await listProjectFiles(c.req.param('id'), 'sketches', 0, 1);
  return c.json({ sketches: files.filter((file) => !file.isDir) });
});

designRoutes.post(
  '/projects/:id/sketches',
  zValidator('json', sketchSchema),
  async (c) => {
    const body = c.req.valid('json');
    const screenId = slugify(body.screenId || 'overlay');
    await writeProjectJson(c.req.param('id'), `sketches/${screenId}.json`, {
      screenId,
      document: body.document ?? {},
      updatedAt: new Date().toISOString(),
    });
    return c.json({ screenId });
  },
);

designRoutes.get('/projects/:id/exports', async (c) =>
  c.json({
    exports: await readProjectJson(c.req.param('id'), 'exports/index.json', []),
  }),
);

designRoutes.post(
  '/projects/:id/export/pdf-input',
  zValidator('json', pdfInputRequestSchema),
  async (c) => {
    try {
      return c.json({
        buildInput: await buildArtifactPdfInput(
          c.req.param('id'),
          c.req.valid('json'),
        ),
      });
    } catch (error) {
      if (error instanceof ArtifactPdfInputUnavailableError) {
        return c.json({ error: error.message }, 422);
      }
      throw error;
    }
  },
);

designRoutes.post(
  '/projects/:id/export/design-package',
  zValidator('json', designPackageRequestSchema),
  async (c) => {
    try {
      const result = await packDesignPackage(
        c.req.param('id'),
        c.req.valid('json'),
      );
      return c.json(result, 201);
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : String(error) },
        400,
      );
    }
  },
);

designRoutes.post(
  '/projects/:id/export',
  zValidator('json', exportRequestSchema),
  async (c) => {
    const id = c.req.param('id');
    const body = c.req.valid('json');
    const project = await getDesignProject(id);
    const format = (
      body.format || defaultFormat(project.surface)
    ).toLowerCase();
    const lint = await collectExportLintFindings(id, project);
    const p0Findings = lint.filter((finding) => finding.severity === 'p0');
    if (p0Findings.length > 0 && !body.allowLintOverride) {
      return c.json(
        {
          code: 'export_blocked_by_lint',
          error: 'Export blocked by P0 DesignMode lint findings',
          findings: p0Findings,
        },
        409,
      );
    }
    const exportId = `export_${randomUUID()}`;
    const createdAt = new Date().toISOString();
    const disclosure = await buildExportDisclosureMetadata(id, project, {
      id: exportId,
      format,
      path: `exports/${exportId}.${format}`,
      createdAt,
    });
    let exported: Awaited<ReturnType<typeof writeProjectExport>>;
    try {
      exported = await writeProjectExport(
        id,
        project,
        exportId,
        format,
        disclosure,
      );
    } catch (error) {
      if (error instanceof DesignExportUnavailableError) {
        return c.json(
          {
            code: designExportErrorCode(error),
            error: error.message,
            format: error.format,
            dependency: error.dependency,
            source: error.source,
          },
          422,
        );
      }
      throw error;
    }
    const finalDisclosure = {
      ...disclosure,
      export: {
        ...disclosure.export,
        path: exported.path,
        mime: exported.mime,
        size: exported.size,
      },
    };
    const disclosurePath = await writeExportDisclosureSidecar(
      id,
      exportId,
      finalDisclosure,
    );
    const record = {
      id: exportId,
      format,
      path: exported.path,
      mime: exported.mime,
      size: exported.size,
      disclosurePath,
      createdAt,
    };
    await withProjectLock(id, async () => {
      const index = await readProjectJson<Record<string, unknown>[]>(
        id,
        'exports/index.json',
        [],
      );
      index.unshift(record);
      await writeProjectJson(id, 'exports/index.json', index);
    });
    await appendProjectHistory(id, {
      type: 'project.exported',
      at: record.createdAt,
      export: record,
    });
    return c.json({ export: record }, 201);
  },
);

designRoutes.get('/projects/:id/history', async (c) => {
  const file = resolveProjectPath(c.req.param('id'), 'history.jsonl');
  const content = await fs.readFile(file.absolutePath, 'utf-8').catch(() => '');
  const lines = content.split('\n').filter(Boolean);
  const HISTORY_TAIL = 500;
  const tail = lines.length > HISTORY_TAIL ? lines.slice(-HISTORY_TAIL) : lines;
  const events: unknown[] = [];
  let invalidLines = 0;
  for (const line of tail) {
    try {
      events.push(JSON.parse(line) as unknown);
    } catch {
      invalidLines += 1;
    }
  }
  return c.json({
    events,
    truncated: lines.length > HISTORY_TAIL,
    totalEvents: lines.length,
    invalidLines,
  });
});

designRoutes.get('/projects/:id/debug', async (c) => {
  const id = c.req.param('id');
  const project = await getDesignProject(id);
  const [
    metrics,
    systemPrompt,
    userPrompt,
    promptTemplate,
    promptStack,
    assetProvenance,
    taskProvenance,
    history,
    exports,
  ] = await Promise.all([
    getProjectMetrics(project),
    readProjectTextOptional(id, 'prompts/resolved-system.md'),
    readProjectTextOptional(id, 'prompts/resolved-user.md'),
    readProjectJson<unknown | null>(id, 'prompts/prompt-template.json', null),
    readProjectJson<unknown | null>(id, 'prompts/prompt-stack.json', null),
    readProjectJsonl(id, 'provenance/assets.jsonl'),
    readProjectJsonl(id, 'provenance/tasks.jsonl'),
    readProjectJsonl(id, 'history.jsonl'),
    readProjectJson<Record<string, unknown>[]>(id, 'exports/index.json', []),
  ]);
  const runtimeTasks = listDesignMediaTasks(id);
  const latestTasks = latestTaskRecords([
    ...taskProvenance.rows,
    ...runtimeTasks.map((task) => task as unknown as Record<string, unknown>),
  ]);
  const renderLog = latestTasks
    .flatMap((task) =>
      Array.isArray(task.progressLines)
        ? task.progressLines.map((line) => `${task.taskId}: ${line}`)
        : [],
    )
    .slice(-200);

  return c.json({
    snapshot: {
      project,
      metrics,
      prompts: {
        system: systemPrompt,
        user: userPrompt,
        template: promptTemplate,
        stack: promptStack,
      },
      provenance: {
        assets: assetProvenance.rows,
        tasks: taskProvenance.rows,
        invalidLines: {
          assets: assetProvenance.invalidLines,
          tasks: taskProvenance.invalidLines,
          history: history.invalidLines,
        },
      },
      runtimeTasks,
      renderLog,
      history: history.rows.slice(-200),
      exports,
    },
  });
});

designRoutes.get('/projects/:id/metrics', async (c) =>
  c.json({
    metrics: await getProjectMetrics(await getDesignProject(c.req.param('id'))),
  }),
);

designRoutes.get('/projects/:id/preview', async (c) => {
  const project = await getDesignProject(c.req.param('id'));
  const projectId = project.id;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
      const subscribers = previewSubscribers.get(projectId) ?? new Set();
      subscribers.add(controller);
      previewSubscribers.set(projectId, subscribers);
      controller.enqueue(
        encodeSse('ready', { projectId, at: new Date().toISOString() }),
      );
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(
            encodeSse('ping', { at: new Date().toISOString() }),
          );
        } catch {
          if (heartbeat) clearInterval(heartbeat);
          subscribers.delete(controller);
        }
      }, 25_000);
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat);
      const subscribers = previewSubscribers.get(projectId);
      if (controllerRef) subscribers?.delete(controllerRef);
      if (subscribers?.size === 0) previewSubscribers.delete(projectId);
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
});

designRoutes.get('/projects/:id/assets/:assetId/versions', async (c) =>
  c.json({
    versions: await readAssetVersions(
      c.req.param('id'),
      c.req.param('assetId'),
    ),
  }),
);

designRoutes.post(
  '/projects/:id/assets/:assetId/promote-version',
  zValidator('json', promoteVersionSchema),
  async (c) => {
    const projectId = c.req.param('id');
    const assetId = c.req.param('assetId');
    const body = c.req.valid('json');
    const promotedPath = normalizeProjectRelativePath(body.path);
    const current = await getDesignProject(projectId);
    const outputs = current.outputs.map((output) =>
      output.id === assetId ? { ...output, path: promotedPath } : output,
    );
    return c.json({
      project: await patchDesignProject(current.id, { outputs }),
    });
  },
);

designRoutes.get('/projects/:id/assets/:assetId/provenance', async (c) => {
  const project = await getDesignProject(c.req.param('id'));
  const output = project.outputs.find(
    (item) => item.id === c.req.param('assetId'),
  );
  const provenance = await readAssetProvenance(
    project.id,
    c.req.param('assetId'),
    output,
  );
  return c.json({ provenance });
});

designRoutes.post(
  '/projects/:id/lint',
  zValidator('json', lintRequestSchema),
  async (c) => {
    const id = c.req.param('id');
    const body = c.req.valid('json');
    const content =
      body.content ??
      (body.path ? (await readProjectTextFile(id, body.path)).content : '');
    const findings = lintDesignArtifact(content, { path: body.path });
    await appendProjectHistory(id, {
      type: 'lint.run',
      at: new Date().toISOString(),
      path: body.path,
      findings,
    });
    return c.json({ findings });
  },
);

designRoutes.onError((error, c) => {
  if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
    logger.debug(
      `DesignMode project file missing for ${c.req.method} ${c.req.path}`,
    );
    return c.json({ error: 'DesignMode project not found' }, 404);
  }
  logger.error('DesignMode API error:', error);
  return c.json({ error: 'Internal DesignMode server error' }, 500);
});

async function materializeCommentAttachments(
  projectId: string,
  attachments: CommentAttachmentInput[] = [],
): Promise<Record<string, unknown>[]> {
  const stored: Record<string, unknown>[] = [];
  for (const attachment of attachments) {
    if (attachment.kind === 'draw') {
      stored.push(attachment);
      continue;
    }
    if (attachment.kind === 'note') {
      stored.push({ kind: 'note', text: attachment.text.trim() });
      continue;
    }
    const buffer = decodeCommentImageDataUrl(
      attachment.dataUrl,
      attachment.mime,
    );
    if (buffer.length !== attachment.size) {
      throw new CommentAttachmentError('Image attachment size mismatch.');
    }
    if (!hasCommentImageSignature(buffer, attachment.mime)) {
      throw new CommentAttachmentError('Image attachment content mismatch.');
    }
    const storedName = commentImageStorageName(
      attachment.name,
      attachment.mime,
    );
    const resolved = resolveProjectPath(
      projectId,
      `comments/attachments/${randomUUID()}_${storedName}`,
    );
    await fs.mkdir(path.dirname(resolved.absolutePath), { recursive: true });
    await fs.writeFile(resolved.absolutePath, buffer, { flag: 'wx' });
    stored.push({
      kind: 'image',
      name: attachment.name,
      mime: attachment.mime,
      size: buffer.length,
      path: resolved.relativePath,
      ...(attachment.alt?.trim() ? { alt: attachment.alt.trim() } : {}),
    });
  }
  return stored;
}

function decodeCommentImageDataUrl(dataUrl: string, expectedMime: string) {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match || match[1] !== expectedMime) {
    throw new CommentAttachmentError('Invalid image attachment data URL.');
  }
  const buffer = Buffer.from(match[2] ?? '', 'base64');
  if (buffer.length === 0 || buffer.length > COMMENT_IMAGE_MAX_BYTES) {
    throw new CommentAttachmentError('Image attachment is too large.');
  }
  return buffer;
}

function hasCommentImageSignature(buffer: Buffer, mime: string) {
  if (mime === 'image/png') {
    return (
      buffer.length >= 8 &&
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a
    );
  }
  if (mime === 'image/jpeg') {
    return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8;
  }
  if (mime === 'image/gif') {
    const header = buffer.subarray(0, 6).toString('ascii');
    return header === 'GIF87a' || header === 'GIF89a';
  }
  if (mime === 'image/webp') {
    return (
      buffer.length >= 12 &&
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP'
    );
  }
  return false;
}

function commentImageStorageName(
  name: string,
  mime: keyof typeof COMMENT_IMAGE_EXT_BY_MIME,
) {
  const stem = path.basename(name, path.extname(name)) || 'image';
  return `${stem}${COMMENT_IMAGE_EXT_BY_MIME[mime]}`;
}

async function readProjectJson<T>(
  projectId: string,
  relative: string,
  fallback: T,
) {
  const resolved = resolveProjectPath(projectId, relative);
  return readJsonFile<T>(resolved.absolutePath, fallback);
}

async function writeProjectJson(
  projectId: string,
  relative: string,
  value: unknown,
) {
  const resolved = resolveProjectPath(projectId, relative);
  await writeJsonAtomic(resolved.absolutePath, value);
}

async function readProjectTextOptional(projectId: string, relative: string) {
  const resolved = resolveProjectPath(projectId, relative);
  return fs.readFile(resolved.absolutePath, 'utf-8').catch(() => '');
}

async function readProjectJsonl(projectId: string, relative: string) {
  const content = await readProjectTextOptional(projectId, relative);
  const rows: Record<string, unknown>[] = [];
  let invalidLines = 0;
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (parsed && typeof parsed === 'object') {
        rows.push(parsed as Record<string, unknown>);
      } else {
        invalidLines += 1;
      }
    } catch {
      invalidLines += 1;
    }
  }
  return { rows, invalidLines };
}

function latestTaskRecords(records: Record<string, unknown>[]) {
  const byId = new Map<string, Record<string, unknown>>();
  for (const record of records) {
    const taskId = record.taskId;
    if (typeof taskId === 'string') byId.set(taskId, record);
  }
  return [...byId.values()].sort((a, b) =>
    String(b.startedAt ?? '').localeCompare(String(a.startedAt ?? '')),
  );
}

async function readAssetVersions(projectId: string, assetId: string) {
  const versions = await readProjectJson<Record<string, unknown>[]>(
    projectId,
    `assets/generated/${assetId}/versions.json`,
    [],
  );
  if (versions.length > 0) return versions;
  const project = await getDesignProject(projectId);
  const output = project.outputs.find((item) => item.id === assetId);
  return output ? [output] : [];
}

async function readAssetProvenance(
  projectId: string,
  assetId: string,
  output?: Awaited<ReturnType<typeof getDesignProject>>['outputs'][number],
) {
  const provenance = await readProjectJsonl(
    projectId,
    'provenance/assets.jsonl',
  );
  const rows = provenance.rows.slice().reverse();
  const matched = rows.find((row) => {
    return (
      row.assetId === assetId ||
      (output?.path && row.path === output.path) ||
      (output?.taskId && row.taskId === output.taskId)
    );
  });
  if (matched) return matched;
  if (!output) return null;
  return {
    assetId: output.id,
    projectId,
    surface: output.kind,
    path: output.path,
    provider: output.provider,
    model: output.model,
    taskId: output.taskId,
    createdAt: output.createdAt,
    disclosureText: `AI-assisted ${output.kind} · ${output.provider ?? 'local'} ${output.model ?? 'auto'} · ${output.createdAt.slice(0, 10)}`,
  };
}

async function parseImportRequest(request: Request) {
  try {
    const contentType = request.headers.get('content-type') ?? '';
    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData();
      return importSchema.safeParse(await importInputFromMultipart(form));
    }
    return importSchema.safeParse(await request.json());
  } catch (error) {
    return {
      success: false as const,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function importInputFromMultipart(form: FormData): Promise<ImportInput> {
  const archive = form.get('archive');
  const archiveBase64 = isFormFile(archive)
    ? Buffer.from(await archive.arrayBuffer()).toString('base64')
    : undefined;
  const files = await Promise.all(
    form
      .getAll('files')
      .filter(isFormFile)
      .map(async (file) => {
        const filePath = file.name || 'imported-file';
        if (isTextImportPath(filePath)) {
          return { path: filePath, content: await file.text() };
        }
        return {
          path: filePath,
          dataBase64: Buffer.from(await file.arrayBuffer()).toString('base64'),
        };
      }),
  );
  return importSchema.parse({
    title: formString(form, 'title'),
    surface: formString(form, 'surface') ?? 'prototype',
    entrypoint: formString(form, 'entrypoint'),
    allowLintOverride: formBoolean(form, 'allowLintOverride'),
    archiveBase64,
    archiveName:
      formString(form, 'archiveName') ??
      (isFormFile(archive) ? archive.name : undefined),
    files,
  });
}

function formString(form: FormData, key: string) {
  const value = form.get(key);
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function formBoolean(form: FormData, key: string) {
  const value = form.get(key);
  return value === 'true' || value === '1';
}

function isFormFile(value: FormDataEntryValue | null): value is File {
  return typeof File !== 'undefined' && value instanceof File;
}

function stripDataUrlBase64(value: string) {
  return value.includes(',') ? value.slice(value.indexOf(',') + 1) : value;
}

async function loadImportFiles(input: z.infer<typeof importSchema>): Promise<{
  files: ImportFile[];
  report: ImportReportItem[];
  entrypoint?: string;
}> {
  const files: ImportFile[] = input.files.map((file) => {
    const content =
      file.content !== undefined && file.path.toLowerCase().endsWith('.html')
        ? sanitizeImportedHtml(file.content)
        : file.content;
    return {
      path: file.path,
      content,
      data:
        file.dataBase64 !== undefined
          ? Buffer.from(stripDataUrlBase64(file.dataBase64), 'base64')
          : undefined,
    };
  });
  if (!input.archiveBase64) return { files, report: [] };

  try {
    const buffer = Buffer.from(
      stripDataUrlBase64(input.archiveBase64),
      'base64',
    );
    const policyReport = inspectZipArchivePolicy(buffer);
    if (policyReport.some((item) => item.status === 'error')) {
      return { files, report: policyReport };
    }
    const entries = readImportZipEntries(buffer);
    if (entries.length > 5000) {
      return {
        files,
        report: [
          {
            rule: 'file-count',
            status: 'error',
            message: `${entries.length} archive files exceeds 5000`,
          },
        ],
      };
    }

    for (const entry of entries) {
      const safePath = normalizeProjectRelativePath(entry.name);
      const bytes = entry.data;
      if (isTextImportPath(safePath)) {
        const text = new TextDecoder().decode(bytes);
        files.push({
          path: safePath,
          content: safePath.endsWith('.html')
            ? sanitizeImportedHtml(text)
            : text,
        });
      } else {
        files.push({ path: safePath, data: bytes });
      }
    }
    return {
      files,
      report: [
        ...policyReport,
        {
          rule: 'archive-readable',
          status: 'ok',
          message: `${entries.length} archive entries inspected`,
        },
      ],
      entrypoint: files.find((file) => file.path.endsWith('.html'))?.path,
    };
  } catch (error) {
    return {
      files,
      report: [
        {
          rule: 'archive-readable',
          status: 'error',
          message:
            error instanceof Error
              ? error.message
              : 'Archive could not be read',
        },
      ],
    };
  }
}

function validateImportFiles(files: ImportFile[], strictEntrypoint: boolean) {
  const report: ImportReportItem[] = [];
  const totalBytes = files.reduce((sum, file) => sum + importFileSize(file), 0);
  report.push({
    rule: 'file-count',
    status: files.length <= 5000 ? 'ok' : 'error',
    message: `${files.length} files`,
  });
  report.push({
    rule: 'total-size',
    status: totalBytes <= 200 * 1024 * 1024 ? 'ok' : 'error',
    message: `${Math.round(totalBytes / 1024)} KB uncompressed`,
  });
  for (const file of files) {
    try {
      normalizeProjectRelativePath(file.path);
    } catch {
      report.push({
        rule: 'path-traversal',
        status: 'error',
        message: `Rejected path ${file.path}`,
      });
    }
    if (importFileSize(file) > 50 * 1024 * 1024) {
      report.push({
        rule: 'single-file-size',
        status: 'error',
        message: `${file.path} exceeds 50 MB`,
      });
    }
  }
  if (!files.some((file) => file.path.endsWith('.html'))) {
    report.push({
      rule: 'entry-html',
      status: strictEntrypoint ? 'error' : 'warn',
      message: strictEntrypoint
        ? 'Archive imports require an HTML entry point.'
        : 'No HTML entry found; project will still be created.',
    });
  }
  return report.length > 0
    ? report
    : [{ rule: 'empty', status: 'warn', message: 'No files supplied' }];
}

function lintImportFiles(files: ImportFile[]): DesignLintFinding[] {
  const findings: DesignLintFinding[] = [];
  for (const file of files) {
    if (file.content === undefined || !shouldLint(file.path)) continue;
    findings.push(
      ...lintDesignArtifact(file.content, { path: file.path }).map(
        (finding) => ({
          ...finding,
          path: finding.path ?? file.path,
        }),
      ),
    );
  }
  return findings;
}

function importLintReport(findings: DesignLintFinding[]): ImportReportItem[] {
  if (findings.length === 0) {
    return [
      {
        rule: 'lint',
        status: 'ok',
        message: 'DesignMode lint found no issues in imported text files.',
      },
    ];
  }
  return findings.map((finding) => ({
    rule: `lint.${finding.id}`,
    status: finding.severity === 'p0' ? 'error' : 'warn',
    message: `${finding.path ?? 'import'}: ${finding.message}`,
  }));
}

interface ImportZipCentralEntry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
  isDirectory: boolean;
}

interface ImportZipEntry {
  name: string;
  data: Buffer;
}

function readImportZipEntries(buffer: Buffer): ImportZipEntry[] {
  const centralEntries = readImportZipCentralDirectory(buffer);
  const files = centralEntries.filter((entry) => !entry.isDirectory);
  if (files.length > IMPORT_ARCHIVE_MAX_FILES) {
    throw new Error(`${files.length} archive files exceeds 5000`);
  }

  const entries: ImportZipEntry[] = [];
  let totalBytes = 0;
  for (const entry of files) {
    const safePath = normalizeProjectRelativePath(entry.name);
    if (entry.uncompressedSize > IMPORT_ARCHIVE_MAX_FILE_BYTES) {
      throw new Error(`${safePath} exceeds 50 MB`);
    }

    const data = readImportZipEntryBody(buffer, entry);
    if (data.length > IMPORT_ARCHIVE_MAX_FILE_BYTES) {
      throw new Error(`${safePath} exceeds 50 MB`);
    }
    if (entry.uncompressedSize > 0 && data.length !== entry.uncompressedSize) {
      throw new Error(`Archive entry size mismatch: ${safePath}`);
    }
    totalBytes += data.length;
    if (totalBytes > IMPORT_ARCHIVE_MAX_TOTAL_BYTES) {
      throw new Error('Archive exceeds 200 MB uncompressed');
    }
    entries.push({ name: safePath, data });
  }
  return entries;
}

function readImportZipCentralDirectory(
  buffer: Buffer,
): ImportZipCentralEntry[] {
  const eocdOffset = findZipEndOfCentralDirectory(buffer);
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralSize = buffer.readUInt32LE(eocdOffset + 12);
  const centralOffset = buffer.readUInt32LE(eocdOffset + 16);
  if (centralOffset + centralSize > buffer.length) {
    throw new Error('Invalid ZIP central directory');
  }

  const entries: ImportZipCentralEntry[] = [];
  let offset = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (
      offset > buffer.length - 46 ||
      buffer.readUInt32LE(offset) !== ZIP_CENTRAL_SIGNATURE
    ) {
      throw new Error('Invalid ZIP central directory entry');
    }
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > buffer.length) {
      throw new Error('Invalid ZIP central directory entry name');
    }
    const name = buffer.subarray(nameStart, nameEnd).toString('utf-8');
    if ((flags & 0x01) !== 0) {
      throw new Error(`Encrypted ZIP entry is not supported: ${name}`);
    }
    if (method !== 0 && method !== 8) {
      throw new Error(
        `Unsupported ZIP compression method ${method} for ${name}`,
      );
    }
    entries.push({
      name,
      method,
      compressedSize,
      uncompressedSize,
      localOffset,
      isDirectory: name.endsWith('/'),
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function findZipEndOfCentralDirectory(buffer: Buffer): number {
  const min = Math.max(0, buffer.length - 0xffff - 22);
  for (let offset = buffer.length - 22; offset >= min; offset -= 1) {
    if (buffer.readUInt32LE(offset) === ZIP_EOCD_SIGNATURE) {
      return offset;
    }
  }
  throw new Error('Invalid ZIP: missing central directory');
}

function readImportZipEntryBody(
  buffer: Buffer,
  entry: ImportZipCentralEntry,
): Buffer {
  const { localOffset } = entry;
  if (
    localOffset > buffer.length - 30 ||
    buffer.readUInt32LE(localOffset) !== ZIP_LOCAL_SIGNATURE
  ) {
    throw new Error(`Invalid ZIP local header: ${entry.name}`);
  }
  const nameLength = buffer.readUInt16LE(localOffset + 26);
  const extraLength = buffer.readUInt16LE(localOffset + 28);
  const bodyStart = localOffset + 30 + nameLength + extraLength;
  const bodyEnd = bodyStart + entry.compressedSize;
  if (bodyEnd > buffer.length) {
    throw new Error(`ZIP entry exceeds archive: ${entry.name}`);
  }
  const compressed = buffer.subarray(bodyStart, bodyEnd);
  if (entry.method === 0) return Buffer.from(compressed);
  if (compressed.length === 0) return Buffer.alloc(0);
  const maxOutputLength =
    entry.uncompressedSize > 0
      ? entry.uncompressedSize
      : IMPORT_ARCHIVE_MAX_FILE_BYTES + 1;
  return inflateRawSync(compressed, { maxOutputLength });
}

function inspectZipArchivePolicy(buffer: Buffer): ImportReportItem[] {
  const report: ImportReportItem[] = [];
  let inspected = 0;
  let offset = 0;
  while (offset <= buffer.length - 46) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      offset += 1;
      continue;
    }
    inspected += 1;
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;
    const name =
      nameEnd <= buffer.length
        ? buffer.subarray(nameStart, nameEnd).toString('utf-8')
        : '<truncated>';

    if ((flags & 0x01) !== 0) {
      report.push({
        rule: 'encrypted-entries',
        status: 'error',
        message: `Encrypted ZIP entry is not supported: ${name}`,
      });
    }
    if (method !== 0 && method !== 8) {
      report.push({
        rule: 'unsupported-compression',
        status: 'error',
        message: `Unsupported ZIP compression method ${method} for ${name}`,
      });
    }

    offset += 46 + nameLength + extraLength + commentLength;
  }

  if (report.length > 0) return report;
  return [
    {
      rule: 'archive-policy',
      status: inspected > 0 ? 'ok' : 'warn',
      message:
        inspected > 0
          ? 'Archive entries use supported ZIP policy.'
          : 'No ZIP central directory entries were found before parsing.',
    },
  ];
}

async function writeImportedProjectFile(projectId: string, file: ImportFile) {
  if (file.content !== undefined) {
    await writeProjectTextFile(projectId, file.path, file.content);
    return;
  }
  if (!file.data) return;
  const resolved = resolveProjectPath(projectId, file.path);
  await fs.mkdir(path.dirname(resolved.absolutePath), { recursive: true });
  await fs.writeFile(resolved.absolutePath, file.data);
}

interface ExportDisclosureAsset {
  assetId?: string;
  projectId: string;
  surface: string;
  path?: string;
  provider?: string;
  model?: string;
  promptHash?: string;
  promptSnapshot?: string;
  references: string[];
  taskId?: string;
  createdAt?: string;
  disclosureText: string;
}

interface ExportDisclosureMetadata {
  schema: 'neuma.design.export-disclosure.v1';
  project: {
    id: string;
    title: string;
    surface: string;
    createdAt: string;
    updatedAt: string;
  };
  export: {
    id: string;
    format: string;
    path: string;
    mime?: string;
    size?: number;
    createdAt: string;
  };
  generatedAt: string;
  disclosureText: string;
  assets: ExportDisclosureAsset[];
  provenance: {
    source: 'provenance/assets.jsonl';
    invalidLineCount: number;
  };
  signing: {
    status: 'unsigned';
    reason: string;
  };
}

async function buildExportDisclosureMetadata(
  projectId: string,
  project: DesignProject,
  exportInfo: ExportDisclosureMetadata['export'],
): Promise<ExportDisclosureMetadata> {
  const provenance = await readProjectJsonl(
    projectId,
    'provenance/assets.jsonl',
  );
  const rows = provenance.rows.slice().reverse();
  const assets = project.outputs.map((output) =>
    exportDisclosureAsset(projectId, output, rows),
  );
  const included = new Set(assets.flatMap(exportDisclosureKeys));
  for (const row of rows) {
    const extra = exportDisclosureAsset(projectId, undefined, [row]);
    if (exportDisclosureKeys(extra).some((key) => included.has(key))) continue;
    assets.push(extra);
    for (const key of exportDisclosureKeys(extra)) included.add(key);
  }
  const disclosureText =
    uniqueNonEmpty(assets.map((asset) => asset.disclosureText)).join('\n') ||
    `Created with Neuma DesignMode · ${exportInfo.createdAt.slice(0, 10)}`;
  return {
    schema: 'neuma.design.export-disclosure.v1',
    project: {
      id: project.id,
      title: project.title,
      surface: project.surface,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    },
    export: exportInfo,
    generatedAt: exportInfo.createdAt,
    disclosureText,
    assets,
    provenance: {
      source: 'provenance/assets.jsonl',
      invalidLineCount: provenance.invalidLines,
    },
    signing: {
      status: 'unsigned',
      reason:
        'C2PA-style structured metadata is embedded, but cryptographic signing is not configured for this build.',
    },
  };
}

function exportDisclosureAsset(
  projectId: string,
  output: DesignOutput | undefined,
  provenanceRows: Record<string, unknown>[],
): ExportDisclosureAsset {
  const row =
    output &&
    provenanceRows.find(
      (candidate) =>
        candidate.assetId === output.id ||
        candidate.path === output.path ||
        (output.taskId && candidate.taskId === output.taskId),
    );
  const record = asRecord(row ?? provenanceRows[0] ?? {});
  const surface =
    firstOptionalString(record.surface, output?.kind) ?? 'generated asset';
  const provider = firstOptionalString(record.provider, output?.provider);
  const model = firstOptionalString(record.model, output?.model);
  const createdAt = firstOptionalString(record.createdAt, output?.createdAt);
  const disclosureText =
    firstOptionalString(record.disclosureText) ??
    `AI-assisted ${surface} · ${provider ?? 'local'} ${model ?? 'auto'} · ${
      createdAt?.slice(0, 10) ?? new Date().toISOString().slice(0, 10)
    }`;
  return {
    assetId: firstOptionalString(record.assetId, output?.id),
    projectId,
    surface,
    path: firstOptionalString(record.path, output?.path),
    provider,
    model,
    promptHash: firstOptionalString(record.promptHash),
    promptSnapshot: firstOptionalString(record.promptSnapshot),
    references: Array.isArray(record.references)
      ? record.references.map(String).filter(Boolean)
      : [],
    taskId: firstOptionalString(record.taskId, output?.taskId),
    createdAt,
    disclosureText,
  };
}

function exportDisclosureKeys(asset: ExportDisclosureAsset) {
  return uniqueNonEmpty([
    asset.assetId ? `asset:${asset.assetId}` : undefined,
    asset.path ? `path:${asset.path}` : undefined,
    asset.taskId ? `task:${asset.taskId}` : undefined,
  ]);
}

function uniqueNonEmpty(values: Array<string | undefined>) {
  return [
    ...new Set(values.map((value) => value?.trim()).filter(Boolean)),
  ] as string[];
}

function addExportDisclosureToZip(
  zip: JSZip,
  disclosure: ExportDisclosureMetadata,
) {
  zip.file('metadata/designmode-disclosure.json', disclosureJson(disclosure), {
    date: new Date('2026-05-02T00:00:00.000Z'),
  });
}

async function writeExportDisclosureSidecar(
  projectId: string,
  exportId: string,
  disclosure: ExportDisclosureMetadata,
) {
  const written = await writeProjectTextFile(
    projectId,
    `exports/${exportId}.disclosure.json`,
    disclosureJson(disclosure),
  );
  return written.path;
}

function disclosureJson(disclosure: ExportDisclosureMetadata) {
  return `${JSON.stringify(disclosure, null, 2)}\n`;
}

async function writeProjectExport(
  projectId: string,
  project: DesignProject,
  exportId: string,
  format: string,
  disclosure: ExportDisclosureMetadata,
) {
  const normalizedFormat = format.toLowerCase();
  if (normalizedFormat === 'zip') {
    return writeProjectZipExport(projectId, exportId, disclosure);
  }
  if (normalizedFormat === 'designpkg') {
    const result = await packDesignPackage(projectId);
    return {
      path: result.path,
      mime: mimeForExportFormat(normalizedFormat),
      size: result.sizeBytes,
    };
  }
  if (isImageExportFormat(normalizedFormat)) {
    assertStaticImageExportAttributionAllowed(projectId, normalizedFormat);
  }

  const exactSource = await pickExistingExportSource(
    projectId,
    project,
    normalizedFormat,
  );
  if (exactSource) {
    return copyProjectExportSource(
      projectId,
      exactSource.path,
      exportId,
      normalizedFormat,
      exactSource.mime,
    );
  }

  if (normalizedFormat === 'html') {
    return writeTextExportFromCandidates(
      projectId,
      exportId,
      normalizedFormat,
      ['artifacts/index.html', 'artifacts/deck.html', 'artifacts/slides.html'],
    );
  }

  if (normalizedFormat === 'md') {
    return writeTextExportFromCandidates(
      projectId,
      exportId,
      normalizedFormat,
      ['artifacts/document.md', 'artifacts/index.md', 'README.md'],
    );
  }

  if (normalizedFormat === 'txt') {
    const markdown = await readFirstProjectTextFile(projectId, [
      'artifacts/document.md',
      'artifacts/index.md',
    ]);
    if (markdown) {
      const written = await writeProjectTextFile(
        projectId,
        `exports/${exportId}.txt`,
        markdownToPlainText(markdown.content),
      );
      return {
        path: written.path,
        mime: mimeForExportFormat(normalizedFormat),
        size: written.size,
      };
    }
    const html = await readFirstProjectTextFile(projectId, [
      'artifacts/index.html',
      'artifacts/deck.html',
    ]);
    if (html) {
      const written = await writeProjectTextFile(
        projectId,
        `exports/${exportId}.txt`,
        htmlToPlainText(html.content),
      );
      return {
        path: written.path,
        mime: mimeForExportFormat(normalizedFormat),
        size: written.size,
      };
    }
  }

  if (normalizedFormat === 'pdf') {
    const html = await pickExistingHtmlSource(projectId, project);
    if (html) {
      return renderHtmlPdfExportSource(projectId, html.path, exportId);
    }
    const markdown = await readFirstProjectTextFile(projectId, [
      'artifacts/document.md',
      'artifacts/index.md',
      'README.md',
    ]);
    if (markdown) {
      return renderMarkdownPdfExportSource(
        projectId,
        markdown.content,
        exportId,
      );
    }
  }

  if (normalizedFormat === 'pptx') {
    return writeProjectPptxExport(projectId, exportId, disclosure);
  }

  if (normalizedFormat === 'docx') {
    return writeProjectDocxExport(projectId, exportId, disclosure);
  }

  if (normalizedFormat === 'mp3') {
    const wav = await pickExistingAudioSource(projectId, project, ['wav']);
    if (wav) {
      return convertAudioExportSource(projectId, wav.path, exportId, 'mp3');
    }
  }

  if (isImageExportFormat(normalizedFormat)) {
    const source = await pickExistingImageSource(projectId, project);
    if (source) {
      return convertImageExportSource(
        projectId,
        source.path,
        exportId,
        normalizedFormat,
      );
    }
  }

  throw unavailableExport(normalizedFormat, project.surface);
}

async function collectExportLintFindings(
  projectId: string,
  project: DesignProject,
) {
  const activeAccent = await getProjectAccent(project);
  const files = flattenFiles(await listProjectFiles(projectId));
  const findings: DesignLintFinding[] = [];
  for (const file of files) {
    if (
      file.isDir ||
      !shouldLint(file.path) ||
      file.path.startsWith('exports/')
    ) {
      continue;
    }
    const content = await readProjectTextFile(projectId, file.path).catch(
      () => null,
    );
    if (!content) continue;
    findings.push(
      ...lintDesignArtifact(content.content, {
        path: file.path,
        activeAccent,
      }),
    );
  }
  return findings;
}

async function getProjectAccent(project: DesignProject) {
  if (!project.designSystemId) return undefined;
  const system = await getDesignSystem(project.designSystemId).catch(
    () => null,
  );
  return system?.swatches[0];
}

function flattenFiles(files: DesignFileEntry[]): DesignFileEntry[] {
  return files.flatMap((file) => [
    file,
    ...(file.children ? flattenFiles(file.children) : []),
  ]);
}

async function writeProjectZipExport(
  projectId: string,
  exportId: string,
  disclosure: ExportDisclosureMetadata,
) {
  const root = getProjectDir(projectId);
  const zip = new JSZip();
  await addProjectDirToZip(zip, root, root);
  addExportDisclosureToZip(zip, disclosure);
  const buffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
  const exportPath = `exports/${exportId}.zip`;
  const resolved = resolveProjectPath(projectId, exportPath);
  await fs.mkdir(path.dirname(resolved.absolutePath), { recursive: true });
  await fs.writeFile(resolved.absolutePath, buffer);
  return {
    path: resolved.relativePath,
    mime: 'application/zip',
    size: buffer.byteLength,
  };
}

async function addProjectDirToZip(zip: JSZip, root: string, dir: string) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === '.DS_Store') continue;
    const abs = path.join(dir, entry.name);
    const rel = path.relative(root, abs).replace(/\\/g, '/');
    if (rel.startsWith('exports/')) continue;
    if (entry.isDirectory()) {
      await addProjectDirToZip(zip, root, abs);
    } else if (entry.isFile()) {
      zip.file(rel, await fs.readFile(abs), {
        date: new Date('2026-05-02T00:00:00.000Z'),
      });
    }
  }
}

async function writeProjectPptxExport(
  projectId: string,
  exportId: string,
  disclosure: ExportDisclosureMetadata,
) {
  const source = await readFirstProjectTextFile(projectId, [
    'artifacts/slides.json',
  ]);
  if (!source) throw unavailableExport('pptx', 'deck');
  let slides: PptxSlide[];
  try {
    slides = parsePptxSlides(JSON.parse(source.content) as unknown);
  } catch (error) {
    throw new DesignExportUnavailableError(
      `PPTX export requires valid artifacts/slides.json: ${
        error instanceof Error ? error.message : String(error)
      }`,
      'pptx',
      'slides.json',
      source.path,
    );
  }
  if (slides.length === 0) {
    throw new DesignExportUnavailableError(
      'PPTX export requires at least one slide in artifacts/slides.json.',
      'pptx',
      'slides.json',
      source.path,
    );
  }

  const zip = new JSZip();
  addPptxStaticParts(zip, slides.length, disclosure);
  slides.forEach((slide, index) => {
    const slideNumber = index + 1;
    pptxFile(
      zip,
      `ppt/slides/slide${slideNumber}.xml`,
      pptxSlideXml(slide, slideNumber),
    );
    pptxFile(
      zip,
      `ppt/slides/_rels/slide${slideNumber}.xml.rels`,
      relsXml([
        {
          id: 'rId1',
          type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout',
          target: '../slideLayouts/slideLayout1.xml',
        },
      ]),
    );
  });
  const buffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
  const exportPath = `exports/${exportId}.pptx`;
  const resolved = resolveProjectPath(projectId, exportPath);
  await fs.mkdir(path.dirname(resolved.absolutePath), { recursive: true });
  await fs.writeFile(resolved.absolutePath, buffer);
  return {
    path: resolved.relativePath,
    mime: mimeForExportFormat('pptx'),
    size: buffer.byteLength,
  };
}

async function writeProjectDocxExport(
  projectId: string,
  exportId: string,
  disclosure: ExportDisclosureMetadata,
) {
  const markdown = await readFirstProjectTextFile(projectId, [
    'artifacts/document.md',
    'artifacts/index.md',
    'README.md',
  ]);
  const html = markdown
    ? null
    : await readFirstProjectTextFile(projectId, [
        'artifacts/index.html',
        'artifacts/deck.html',
      ]);
  const content = markdown
    ? markdown.content
    : html
      ? htmlToPlainText(html.content)
      : null;
  if (!content) throw unavailableExport('docx', 'document');

  const zip = new JSZip();
  addDocxStaticParts(
    zip,
    markdown ? markdownToDocxBlocks(content) : textToDocxBlocks(content),
    disclosure,
  );
  const buffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
  const exportPath = `exports/${exportId}.docx`;
  const resolved = resolveProjectPath(projectId, exportPath);
  await fs.mkdir(path.dirname(resolved.absolutePath), { recursive: true });
  await fs.writeFile(resolved.absolutePath, buffer);
  return {
    path: resolved.relativePath,
    mime: mimeForExportFormat('docx'),
    size: buffer.byteLength,
  };
}

type DocxBlock = {
  kind: 'heading1' | 'heading2' | 'bullet' | 'paragraph';
  text: string;
};

function addDocxStaticParts(
  zip: JSZip,
  blocks: DocxBlock[],
  disclosure: ExportDisclosureMetadata,
) {
  docxFile(zip, '[Content_Types].xml', docxContentTypesXml());
  docxFile(
    zip,
    '_rels/.rels',
    relsXml([
      {
        id: 'rId1',
        type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument',
        target: 'word/document.xml',
      },
      {
        id: 'rId2',
        type: 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties',
        target: 'docProps/core.xml',
      },
      {
        id: 'rId3',
        type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties',
        target: 'docProps/app.xml',
      },
      {
        id: 'rId4',
        type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties',
        target: 'docProps/custom.xml',
      },
    ]),
  );
  docxFile(zip, 'docProps/core.xml', corePropsXml());
  docxFile(zip, 'docProps/app.xml', docxAppPropsXml(blocks.length));
  docxFile(zip, 'docProps/custom.xml', customPropsXml(disclosure));
  docxFile(zip, 'word/document.xml', docxDocumentXml(blocks));
  docxFile(zip, 'word/styles.xml', docxStylesXml());
  docxFile(zip, 'word/settings.xml', docxSettingsXml());
  docxFile(zip, 'word/_rels/document.xml.rels', relsXml([]));
}

function docxFile(zip: JSZip, filePath: string, content: string) {
  zip.file(filePath, content, { date: new Date('2026-05-02T00:00:00.000Z') });
}

function markdownToDocxBlocks(content: string): DocxBlock[] {
  return content
    .split(/\n+/)
    .map((line): DocxBlock | null => {
      const trimmed = line.trim();
      if (!trimmed) return null;
      if (trimmed.startsWith('# ')) {
        return {
          kind: 'heading1',
          text: inlineMarkdownToText(trimmed.slice(2)),
        };
      }
      if (trimmed.startsWith('## ')) {
        return {
          kind: 'heading2',
          text: inlineMarkdownToText(trimmed.slice(3)),
        };
      }
      if (/^[-*]\s+/.test(trimmed)) {
        return {
          kind: 'bullet',
          text: inlineMarkdownToText(trimmed.replace(/^[-*]\s+/, '')),
        };
      }
      return { kind: 'paragraph', text: inlineMarkdownToText(trimmed) };
    })
    .filter((block): block is DocxBlock => Boolean(block));
}

function textToDocxBlocks(content: string): DocxBlock[] {
  return content
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((text) => ({ kind: 'paragraph', text }) satisfies DocxBlock);
}

function inlineMarkdownToText(content: string) {
  return content
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_~]/g, '')
    .trim();
}

function docxContentTypesXml() {
  return xmlDecl(
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/><Override PartName="/docProps/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/></Types>',
  );
}

function docxDocumentXml(blocks: DocxBlock[]) {
  const body =
    blocks.length > 0
      ? blocks.map(docxParagraphXml).join('')
      : docxParagraphXml({ kind: 'paragraph', text: 'DesignMode document' });
  return xmlDecl(
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`,
  );
}

function docxParagraphXml(block: DocxBlock) {
  const style =
    block.kind === 'heading1'
      ? '<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>'
      : block.kind === 'heading2'
        ? '<w:pPr><w:pStyle w:val="Heading2"/></w:pPr>'
        : block.kind === 'bullet'
          ? '<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>'
          : '';
  const text = block.kind === 'bullet' ? `• ${block.text}` : block.text;
  return `<w:p>${style}<w:r><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`;
}

function docxStylesXml() {
  return xmlDecl(
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:sz w:val="22"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style></w:styles>',
  );
}

function docxSettingsXml() {
  return xmlDecl(
    '<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:zoom w:percent="100"/></w:settings>',
  );
}

function docxAppPropsXml(paragraphCount: number) {
  return xmlDecl(
    `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Neuma DesignMode</Application><Paragraphs>${paragraphCount}</Paragraphs></Properties>`,
  );
}

type PptxSlide = {
  id: string;
  title: string;
  subtitle?: string;
  bullets: string[];
  notes?: string;
};

function parsePptxSlides(value: unknown): PptxSlide[] {
  const records = Array.isArray(value)
    ? value
    : value &&
        typeof value === 'object' &&
        Array.isArray((value as { slides?: unknown }).slides)
      ? (value as { slides: unknown[] }).slides
      : [];
  return records.map((item, index) => {
    const record = asRecord(item);
    const title = firstString(
      record.title,
      record.heading,
      record.name,
      record.id,
      `Slide ${index + 1}`,
    );
    return {
      id: firstString(record.id, `slide-${index + 1}`),
      title,
      subtitle: firstOptionalString(record.subtitle, record.kicker),
      bullets: slideBullets(record),
      notes: firstOptionalString(record.notes, record.speakerNotes),
    };
  });
}

function slideBullets(record: Record<string, unknown>) {
  for (const key of ['bullets', 'items', 'points']) {
    const value = record[key];
    if (Array.isArray(value)) return value.map(String).filter(Boolean);
  }
  const body = record.body ?? record.content ?? record.notes;
  if (Array.isArray(body)) return body.map(String).filter(Boolean);
  if (typeof body === 'string') {
    return body
      .split(/\n+/)
      .map((line) => line.replace(/^[-*]\s+/, '').trim())
      .filter(Boolean);
  }
  return [];
}

function addPptxStaticParts(
  zip: JSZip,
  slideCount: number,
  disclosure: ExportDisclosureMetadata,
) {
  pptxFile(zip, '[Content_Types].xml', contentTypesXml(slideCount));
  pptxFile(
    zip,
    '_rels/.rels',
    relsXml([
      {
        id: 'rId1',
        type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument',
        target: 'ppt/presentation.xml',
      },
      {
        id: 'rId2',
        type: 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties',
        target: 'docProps/core.xml',
      },
      {
        id: 'rId3',
        type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties',
        target: 'docProps/app.xml',
      },
      {
        id: 'rId4',
        type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties',
        target: 'docProps/custom.xml',
      },
    ]),
  );
  pptxFile(zip, 'docProps/core.xml', corePropsXml());
  pptxFile(zip, 'docProps/app.xml', appPropsXml(slideCount));
  pptxFile(zip, 'docProps/custom.xml', customPropsXml(disclosure));
  pptxFile(zip, 'ppt/presentation.xml', presentationXml(slideCount));
  pptxFile(
    zip,
    'ppt/_rels/presentation.xml.rels',
    presentationRelsXml(slideCount),
  );
  pptxFile(zip, 'ppt/slideMasters/slideMaster1.xml', slideMasterXml());
  pptxFile(
    zip,
    'ppt/slideMasters/_rels/slideMaster1.xml.rels',
    relsXml([
      {
        id: 'rId1',
        type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout',
        target: '../slideLayouts/slideLayout1.xml',
      },
      {
        id: 'rId2',
        type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme',
        target: '../theme/theme1.xml',
      },
    ]),
  );
  pptxFile(zip, 'ppt/slideLayouts/slideLayout1.xml', slideLayoutXml());
  pptxFile(
    zip,
    'ppt/slideLayouts/_rels/slideLayout1.xml.rels',
    relsXml([
      {
        id: 'rId1',
        type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster',
        target: '../slideMasters/slideMaster1.xml',
      },
    ]),
  );
  pptxFile(zip, 'ppt/theme/theme1.xml', themeXml());
}

function pptxFile(zip: JSZip, filePath: string, content: string) {
  zip.file(filePath, content, { date: new Date('2026-05-02T00:00:00.000Z') });
}

function contentTypesXml(slideCount: number) {
  const slides = Array.from(
    { length: slideCount },
    (_, index) =>
      `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`,
  ).join('');
  return xmlDecl(
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/><Override PartName="/docProps/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/>${slides}</Types>`,
  );
}

function presentationXml(slideCount: number) {
  const slideIds = Array.from(
    { length: slideCount },
    (_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 1}"/>`,
  ).join('');
  return xmlDecl(
    `<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId${slideCount + 1}"/></p:sldMasterIdLst><p:sldIdLst>${slideIds}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000" type="wide"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`,
  );
}

function presentationRelsXml(slideCount: number) {
  const rels = Array.from({ length: slideCount }, (_, index) => ({
    id: `rId${index + 1}`,
    type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide',
    target: `slides/slide${index + 1}.xml`,
  }));
  rels.push({
    id: `rId${slideCount + 1}`,
    type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster',
    target: 'slideMasters/slideMaster1.xml',
  });
  return relsXml(rels);
}

function pptxSlideXml(slide: PptxSlide, index: number) {
  const bodyLines = [
    ...(slide.subtitle ? [slide.subtitle] : []),
    ...slide.bullets,
    ...(slide.notes ? [`Notes: ${slide.notes}`] : []),
  ];
  return xmlDecl(
    `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld name="${xmlEscape(slide.id || `slide-${index}`)}"><p:spTree>${groupShapeXml()}${textShapeXml(2, slide.title, 685800, 457200, 10820400, 914400, 3600, true)}${textShapeXml(3, bodyLines, 914400, 1600200, 10363200, 4389120, 2100, false)}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`,
  );
}

function groupShapeXml() {
  return '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
}

function textShapeXml(
  id: number,
  lines: string | string[],
  x: number,
  y: number,
  cx: number,
  cy: number,
  fontSize: number,
  bold: boolean,
) {
  const paragraphs = (Array.isArray(lines) ? lines : [lines])
    .filter(Boolean)
    .map(
      (line) =>
        `<a:p><a:r><a:rPr lang="en-US" sz="${fontSize}"${bold ? ' b="1"' : ''}/><a:t>${xmlEscape(line)}</a:t></a:r></a:p>`,
    )
    .join('');
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Text ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="square"><a:spAutoFit/></a:bodyPr><a:lstStyle/>${paragraphs || '<a:p/>'}</p:txBody></p:sp>`;
}

function slideMasterXml() {
  return xmlDecl(
    `<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree>${groupShapeXml()}</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`,
  );
}

function slideLayoutXml() {
  return xmlDecl(
    `<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>${groupShapeXml()}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`,
  );
}

function themeXml() {
  return xmlDecl(
    '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Neuma DesignMode"><a:themeElements><a:clrScheme name="Neuma"><a:dk1><a:srgbClr val="111827"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="374151"/></a:dk2><a:lt2><a:srgbClr val="F9FAFB"/></a:lt2><a:accent1><a:srgbClr val="2563EB"/></a:accent1><a:accent2><a:srgbClr val="16A34A"/></a:accent2><a:accent3><a:srgbClr val="F97316"/></a:accent3><a:accent4><a:srgbClr val="DB2777"/></a:accent4><a:accent5><a:srgbClr val="7C3AED"/></a:accent5><a:accent6><a:srgbClr val="0891B2"/></a:accent6><a:hlink><a:srgbClr val="2563EB"/></a:hlink><a:folHlink><a:srgbClr val="7C3AED"/></a:folHlink></a:clrScheme><a:fontScheme name="Neuma"><a:majorFont><a:latin typeface="Aptos Display"/></a:majorFont><a:minorFont><a:latin typeface="Aptos"/></a:minorFont></a:fontScheme><a:fmtScheme name="Neuma"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>',
  );
}

function corePropsXml() {
  return xmlDecl(
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>DesignMode deck export</dc:title><dc:creator>Neuma DesignMode</dc:creator><cp:lastModifiedBy>Neuma DesignMode</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">2026-05-02T00:00:00Z</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">2026-05-02T00:00:00Z</dcterms:modified></cp:coreProperties>',
  );
}

function customPropsXml(disclosure: ExportDisclosureMetadata) {
  const json = JSON.stringify(disclosure);
  return xmlDecl(
    `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="NeumaDesignDisclosure"><vt:lpwstr>${xmlEscape(disclosure.disclosureText)}</vt:lpwstr></property><property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="3" name="NeumaDesignDisclosureJson"><vt:lpwstr>${xmlEscape(json)}</vt:lpwstr></property></Properties>`,
  );
}

function appPropsXml(slideCount: number) {
  return xmlDecl(
    `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Neuma DesignMode</Application><PresentationFormat>On-screen Show (16:9)</PresentationFormat><Slides>${slideCount}</Slides></Properties>`,
  );
}

function relsXml(
  relationships: Array<{ id: string; type: string; target: string }>,
) {
  return xmlDecl(
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships
      .map(
        (relationship) =>
          `<Relationship Id="${relationship.id}" Type="${relationship.type}" Target="${xmlEscape(relationship.target)}"/>`,
      )
      .join('')}</Relationships>`,
  );
}

function xmlDecl(body: string) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${body}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}

function firstString(...values: unknown[]) {
  const found = values.find(
    (value) => typeof value === 'string' && value.trim(),
  );
  return typeof found === 'string' ? found.trim() : '';
}

function firstOptionalString(...values: unknown[]) {
  const value = values.find(
    (candidate) => typeof candidate === 'string' && candidate.trim(),
  );
  return typeof value === 'string' ? value.trim() : undefined;
}

function xmlEscape(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function pickExistingExportSource(
  projectId: string,
  project: Awaited<ReturnType<typeof getDesignProject>>,
  format: string,
) {
  for (const output of project.outputs) {
    if (!output.path.toLowerCase().endsWith(`.${format}`)) continue;
    if (await projectFileExists(projectId, output.path)) return output;
  }
  return null;
}

async function pickExistingImageSource(
  projectId: string,
  project: Awaited<ReturnType<typeof getDesignProject>>,
) {
  for (const output of project.outputs) {
    if (!/\.(png|jpe?g|webp)$/i.test(output.path)) continue;
    if (await projectFileExists(projectId, output.path)) return output;
  }
  return null;
}

async function pickExistingHtmlSource(
  projectId: string,
  project: Awaited<ReturnType<typeof getDesignProject>>,
) {
  for (const output of project.outputs) {
    if (!/\.html?$/i.test(output.path)) continue;
    if (await projectFileExists(projectId, output.path)) return output;
  }
  for (const candidate of [
    'artifacts/index.html',
    'artifacts/deck.html',
    'artifacts/slides.html',
  ]) {
    if (await projectFileExists(projectId, candidate)) {
      return {
        id: candidate,
        kind: 'html',
        path: candidate,
        createdAt: project.updatedAt,
      };
    }
  }
  return null;
}

async function pickExistingAudioSource(
  projectId: string,
  project: Awaited<ReturnType<typeof getDesignProject>>,
  extensions: string[],
) {
  const pattern = new RegExp(`\\.(${extensions.join('|')})$`, 'i');
  for (const output of project.outputs) {
    if (!pattern.test(output.path)) continue;
    if (await projectFileExists(projectId, output.path)) return output;
  }
  for (const ext of extensions) {
    for (const candidate of [
      `assets/generated/audio.${ext}`,
      `assets/generated/voiceover.${ext}`,
      `artifacts/audio.${ext}`,
    ]) {
      if (await projectFileExists(projectId, candidate)) {
        return {
          id: candidate,
          kind: 'audio',
          path: candidate,
          createdAt: project.updatedAt,
        };
      }
    }
  }
  return null;
}

async function projectFileExists(projectId: string, relativePath: string) {
  try {
    const resolved = resolveProjectPath(projectId, relativePath);
    const stat = await fs.stat(resolved.absolutePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function copyProjectExportSource(
  projectId: string,
  sourcePath: string,
  exportId: string,
  format: string,
  mime?: string,
) {
  const source = resolveProjectPath(projectId, sourcePath);
  const dest = resolveProjectPath(projectId, `exports/${exportId}.${format}`);
  await fs.mkdir(path.dirname(dest.absolutePath), { recursive: true });
  await fs.copyFile(source.absolutePath, dest.absolutePath);
  const stat = await fs.stat(dest.absolutePath);
  return {
    path: dest.relativePath,
    mime: mime ?? mimeForExportFormat(format),
    size: stat.size,
  };
}

async function writeTextExportFromCandidates(
  projectId: string,
  exportId: string,
  format: string,
  candidates: string[],
) {
  const source = await readFirstProjectTextFile(projectId, candidates);
  if (!source) throw unavailableExport(format, 'document');
  const content =
    format === 'html'
      ? injectHtmlAssetAttribution(source.content, projectId)
      : source.content;
  const written = await writeProjectTextFile(
    projectId,
    `exports/${exportId}.${format}`,
    content,
  );
  return {
    path: written.path,
    mime: mimeForExportFormat(format),
    size: written.size,
  };
}

async function readFirstProjectTextFile(
  projectId: string,
  candidates: string[],
) {
  for (const candidate of candidates) {
    const file = await readProjectTextFile(projectId, candidate).catch(
      () => null,
    );
    if (file) return file;
  }
  return null;
}

async function convertImageExportSource(
  projectId: string,
  sourcePath: string,
  exportId: string,
  format: string,
) {
  try {
    const { default: sharp } = await import('sharp');
    const source = resolveProjectPath(projectId, sourcePath);
    const dest = resolveProjectPath(projectId, `exports/${exportId}.${format}`);
    await fs.mkdir(path.dirname(dest.absolutePath), { recursive: true });
    let pipeline = sharp(source.absolutePath);
    if (format === 'png') pipeline = pipeline.png();
    if (format === 'jpeg' || format === 'jpg') pipeline = pipeline.jpeg();
    if (format === 'webp') pipeline = pipeline.webp();
    await pipeline.toFile(dest.absolutePath);
    const stat = await fs.stat(dest.absolutePath);
    return {
      path: dest.relativePath,
      mime: mimeForExportFormat(format),
      size: stat.size,
    };
  } catch {
    throw new DesignExportUnavailableError(
      `Image ${format.toUpperCase()} export requires a readable source image and the sharp encoder.`,
      format,
      'sharp',
      sourcePath,
    );
  }
}

async function renderMarkdownPdfExportSource(
  projectId: string,
  content: string,
  exportId: string,
) {
  const renderSource = resolveProjectPath(
    projectId,
    `exports/${exportId}.render.html`,
  );
  await fs.mkdir(path.dirname(renderSource.absolutePath), { recursive: true });
  await fs.writeFile(
    renderSource.absolutePath,
    markdownToPrintHtml(content),
    'utf-8',
  );
  try {
    return await renderHtmlPdfExportSource(
      projectId,
      renderSource.relativePath,
      exportId,
    );
  } finally {
    await fs.rm(renderSource.absolutePath, { force: true }).catch(() => {});
  }
}

async function renderHtmlPdfExportSource(
  projectId: string,
  sourcePath: string,
  exportId: string,
) {
  let browser: PdfBrowser | null = null;
  let attributedSourcePath: string | null = null;
  try {
    const chromium = await loadPlaywrightChromium();
    const source = resolveProjectPath(projectId, sourcePath);
    const sourceHtml = await fs.readFile(source.absolutePath, 'utf-8');
    const attributedHtml = injectHtmlAssetAttribution(sourceHtml, projectId);
    const renderSource =
      attributedHtml === sourceHtml
        ? source
        : {
            absolutePath: path.join(
              path.dirname(source.absolutePath),
              `.neuma-${exportId}.render.html`,
            ),
            relativePath: path
              .join(
                path.dirname(source.relativePath),
                `.neuma-${exportId}.render.html`,
              )
              .replace(/\\/g, '/'),
          };
    if (renderSource !== source) {
      attributedSourcePath = renderSource.absolutePath;
      await fs.writeFile(renderSource.absolutePath, attributedHtml, 'utf-8');
    }
    const dest = resolveProjectPath(projectId, `exports/${exportId}.pdf`);
    await fs.mkdir(path.dirname(dest.absolutePath), { recursive: true });
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
    });
    await page.route('**/*', (route) => {
      const url = route.request().url();
      if (isAllowedPdfRenderUrl(url)) return route.continue();
      return route.abort('blockedbyclient');
    });
    await page.goto(pathToFileURL(renderSource.absolutePath).href, {
      waitUntil: 'networkidle',
      timeout: 20_000,
    });
    await page.pdf({
      path: dest.absolutePath,
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
    });
    const stat = await fs.stat(dest.absolutePath);
    return {
      path: dest.relativePath,
      mime: 'application/pdf',
      size: stat.size,
    };
  } catch (error) {
    throw new DesignExportUnavailableError(
      `PDF export requires a working Playwright Chromium renderer: ${
        error instanceof Error ? error.message : String(error)
      }`,
      'pdf',
      'playwright',
      sourcePath,
    );
  } finally {
    await browser?.close().catch(() => {});
    if (attributedSourcePath) {
      await fs.rm(attributedSourcePath, { force: true }).catch(() => {});
    }
  }
}

async function convertAudioExportSource(
  projectId: string,
  sourcePath: string,
  exportId: string,
  format: 'mp3',
) {
  const source = resolveProjectPath(projectId, sourcePath);
  const dest = resolveProjectPath(projectId, `exports/${exportId}.${format}`);
  await fs.mkdir(path.dirname(dest.absolutePath), { recursive: true });
  try {
    await execFileAsync(
      'ffmpeg',
      [
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        source.absolutePath,
        dest.absolutePath,
      ],
      { timeout: 120_000, maxBuffer: 256 * 1024 },
    );
    const stat = await fs.stat(dest.absolutePath);
    return {
      path: dest.relativePath,
      mime: mimeForExportFormat(format),
      size: stat.size,
    };
  } catch (error) {
    throw new DesignExportUnavailableError(
      `MP3 export requires ffmpeg and a readable WAV source: ${
        error instanceof Error ? error.message : String(error)
      }`,
      format,
      'ffmpeg',
      sourcePath,
    );
  }
}

type PdfBrowser = {
  newPage(options?: { viewport?: { width: number; height: number } }): Promise<{
    route(
      pattern: string,
      handler: (route: PdfRoute) => unknown,
    ): Promise<void>;
    goto(
      url: string,
      options?: {
        waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
        timeout?: number;
      },
    ): Promise<unknown>;
    pdf(options: {
      path: string;
      format?: string;
      printBackground?: boolean;
      preferCSSPageSize?: boolean;
    }): Promise<unknown>;
  }>;
  close(): Promise<void>;
};

type PdfRoute = {
  request(): { url(): string };
  continue(): Promise<void>;
  abort(errorCode?: string): Promise<void>;
};

async function loadPlaywrightChromium() {
  try {
    return (await import('playwright')).chromium;
  } catch {
    return (await import('@playwright/test')).chromium;
  }
}

function isAllowedPdfRenderUrl(url: string) {
  return (
    url.startsWith('file:') ||
    url.startsWith('data:') ||
    url.startsWith('blob:') ||
    url === 'about:blank'
  );
}

function isImageExportFormat(format: string) {
  return (
    format === 'png' ||
    format === 'jpeg' ||
    format === 'jpg' ||
    format === 'webp'
  );
}

function markdownToPlainText(content: string) {
  return content
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/[*_~>#]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .concat('\n');
}

function htmlToPlainText(content: string) {
  return content
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<\/(p|div|section|article|header|footer|li|h[1-6])>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .concat('\n');
}

function markdownToPrintHtml(content: string) {
  const body = markdownToDocxBlocks(content)
    .map((block) => {
      if (block.kind === 'heading1') return `<h1>${xmlEscape(block.text)}</h1>`;
      if (block.kind === 'heading2') return `<h2>${xmlEscape(block.text)}</h2>`;
      if (block.kind === 'bullet') return `<li>${xmlEscape(block.text)}</li>`;
      return `<p>${xmlEscape(block.text)}</p>`;
    })
    .join('\n')
    .replace(/(?:<li>[\s\S]*?<\/li>\n?)+/g, (items) => `<ul>${items}</ul>`);
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:Inter,Aptos,Arial,sans-serif;margin:48px;color:#111827;line-height:1.55}h1{font-size:32px;margin:0 0 24px}h2{font-size:22px;margin:28px 0 12px}p{margin:0 0 12px}ul{margin:0 0 16px 24px;padding:0}</style></head><body>${body || '<p>DesignMode document</p>'}</body></html>`;
}

function unavailableExport(format: string, surface: string) {
  if (format === 'pdf') {
    return new DesignExportUnavailableError(
      'PDF export requires a configured HTML/document renderer; no renderer is currently configured.',
      format,
      surface === 'document' ? 'pandoc or playwright' : 'playwright',
    );
  }
  if (format === 'docx') {
    return new DesignExportUnavailableError(
      'DOCX export requires a document converter such as pandoc; no converter is currently configured.',
      format,
      'pandoc',
    );
  }
  if (format === 'pptx') {
    return new DesignExportUnavailableError(
      'PPTX export requires a slides.json renderer; no PPTX renderer is currently configured.',
      format,
      'pptxgenjs',
    );
  }
  if (format === 'mp4') {
    return new DesignExportUnavailableError(
      'MP4 export requires an existing provider video output or a configured video renderer.',
      format,
      surface === 'video' ? 'provider video or HyperFrames renderer' : 'ffmpeg',
    );
  }
  if (format === 'mp3') {
    return new DesignExportUnavailableError(
      'MP3 export requires an existing MP3 output or an audio encoder; no encoder is currently configured.',
      format,
      'ffmpeg',
    );
  }
  if (format === 'wav') {
    return new DesignExportUnavailableError(
      'WAV export requires an existing WAV output or a configured speech/audio renderer.',
      format,
      'speech provider',
    );
  }
  return new DesignExportUnavailableError(
    `No export source exists for ${format.toUpperCase()} and no renderer is configured.`,
    format,
  );
}

function assertStaticImageExportAttributionAllowed(
  projectId: string,
  format: string,
) {
  const attribution = renderAssetAttributionBlock({
    scope: 'design_project',
    scopeId: projectId,
    format: 'text',
  });
  if (!attribution) return;
  throw new DesignExportUnavailableError(
    `Image ${format.toUpperCase()} export is blocked because attached assets require attribution and standalone image files cannot include an attribution sidecar. Export a ZIP or design package, or render credits directly into the image before exporting.`,
    format,
    'asset attribution',
    'asset_materializations',
  );
}

function injectHtmlAssetAttribution(html: string, projectId: string): string {
  if (html.includes('data-neuma-asset-attribution="true"')) return html;
  const attribution = renderAssetAttributionBlock({
    scope: 'design_project',
    scopeId: projectId,
    format: 'html',
  });
  if (!attribution) return html;
  const footer = `<footer data-neuma-export-attribution="true">${attribution}</footer>`;
  if (/<\/body\s*>/i.test(html)) {
    return html.replace(/<\/body\s*>/i, `${footer}</body>`);
  }
  if (/<\/html\s*>/i.test(html)) {
    return html.replace(/<\/html\s*>/i, `${footer}</html>`);
  }
  return `${html}\n${footer}\n`;
}

class DesignExportUnavailableError extends Error {
  constructor(
    message: string,
    readonly format: string,
    readonly dependency?: string,
    readonly source?: string,
  ) {
    super(message);
    this.name = 'DesignExportUnavailableError';
  }
}

// Stable low-cardinality code for the 422 export payload. Mirrors the shared
// frontend vocabulary in src/shared/utils/export-error.ts — keep both in sync.
function designExportErrorCode(
  error: DesignExportUnavailableError,
):
  | 'attribution_blocked'
  | 'invalid_input'
  | 'dependency_missing'
  | 'renderer_unavailable' {
  if (error.dependency === 'asset attribution') return 'attribution_blocked';
  if (error.dependency === 'slides.json') return 'invalid_input';
  if (error.dependency) return 'dependency_missing';
  return 'renderer_unavailable';
}

function importFileSize(file: ImportFile) {
  if (file.content !== undefined) return Buffer.byteLength(file.content);
  return file.data?.byteLength ?? 0;
}

function mimeForExportFormat(format: string) {
  if (format === 'md') return 'text/markdown';
  if (format === 'txt') return 'text/plain';
  if (format === 'html') return 'text/html';
  if (format === 'json') return 'application/json';
  if (format === 'zip') return 'application/zip';
  if (format === 'designpkg') return 'application/vnd.neuma.design-package+zip';
  if (format === 'pdf') return 'application/pdf';
  if (format === 'pptx')
    return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  if (format === 'docx')
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (format === 'png') return 'image/png';
  if (format === 'jpg' || format === 'jpeg') return 'image/jpeg';
  if (format === 'webp') return 'image/webp';
  if (format === 'gif') return 'image/gif';
  if (format === 'svg') return 'image/svg+xml';
  if (format === 'mp4') return 'video/mp4';
  if (format === 'webm') return 'video/webm';
  if (format === 'mov') return 'video/quicktime';
  if (format === 'mp3') return 'audio/mpeg';
  if (format === 'wav') return 'audio/wav';
  if (format === 'm4a') return 'audio/mp4';
  if (format === 'ogg') return 'audio/ogg';
  return 'application/octet-stream';
}

function mimeForPath(filePath: string) {
  const ext = path.extname(filePath).toLowerCase().slice(1);
  return mimeForExportFormat(ext);
}

function isActiveMimeType(mime: string) {
  return /^(text\/(html|xml|svg)|application\/(xhtml|xml|svg|javascript|x-javascript|ecmascript)|image\/svg)/i.test(
    mime,
  );
}

function validateDesignBlobDownload(
  contentType: string,
  size: number,
):
  | {
      error: string;
      status: ContentfulStatusCode;
      maxBytes?: number;
    }
  | undefined {
  if (!DESIGN_BLOB_ALLOWED_MIME_TYPES.has(contentType)) {
    return { error: 'UNSUPPORTED_FILE_TYPE', status: 415 };
  }
  const maxBytes = maxDesignBlobBytes(contentType);
  if (size > maxBytes) {
    return { error: 'FILE_TOO_LARGE', status: 413, maxBytes };
  }
  return undefined;
}

async function validateDesignBlobFileContent(
  absolutePath: string,
  contentType: string,
): Promise<
  | {
      error: string;
      status: ContentfulStatusCode;
    }
  | undefined
> {
  if (!contentType.startsWith('image/') || contentType === 'image/svg+xml') {
    return undefined;
  }
  const header = await readFileHeader(absolutePath, 12);
  if (!hasImageMagicBytes(header)) {
    return { error: 'INVALID_IMAGE_CONTENT', status: 415 };
  }
  return undefined;
}

async function readFileHeader(filePath: string, bytes: number) {
  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function maxDesignBlobBytes(contentType: string) {
  if (contentType.startsWith('image/')) return DESIGN_BLOB_IMAGE_MAX_BYTES;
  return DESIGN_BLOB_MAX_BYTES;
}

function contentDispositionForDesignBlob(
  relativePath: string,
  disposition: 'attachment' | 'inline',
) {
  const filename = sanitizeDownloadFilename(path.basename(relativePath));
  return `${disposition}; filename="${filename}"`;
}

function sanitizeDownloadFilename(filename: string) {
  const sanitized = replaceControlDownloadFilenameChars(filename)
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 180);
  return sanitized || 'download';
}

function replaceControlDownloadFilenameChars(filename: string) {
  let sanitized = '';
  for (const char of filename) {
    const code = char.charCodeAt(0);
    sanitized += code <= 0x1f || code === 0x7f ? '_' : char;
  }
  return sanitized;
}

function isInlineExportRequested(value: string) {
  return /^(1|true|yes|on)$/i.test(value);
}

function isRangeSeekableMime(mime: string) {
  return /^(video|audio)\//i.test(mime);
}

function isProjectPathError(error: unknown) {
  if (!(error instanceof Error)) return false;
  return /path|file cannot be renamed|absolute paths|traversal|escapes/i.test(
    error.message,
  );
}

function isTextImportPath(filePath: string) {
  return /\.(html|css|js|mjs|json|md|txt|svg|xml|csv)$/i.test(filePath);
}

function sanitizeImportedHtml(content: string) {
  return content
    .replace(/\sdata-od-([a-z0-9_-]+)=/gi, ' data-neuma-$1=')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<script\b[^>]*\/?>(?![\s\S]*?<\/script\s*>)/gi, '')
    .replace(/<(iframe|object|embed|link|meta)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(iframe|object|embed|link|meta)\b[^>]*\/?>/gi, '')
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '')
    .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '')
    .replace(
      /\s(href|src|action|formaction|xlink:href)\s*=\s*"\s*javascript:[^"]*"/gi,
      ' $1="#"',
    )
    .replace(
      /\s(href|src|action|formaction|xlink:href)\s*=\s*'\s*javascript:[^']*'/gi,
      " $1='#'",
    )
    .replace(
      /\s(href|src|action|formaction|xlink:href)\s*=\s*javascript:[^\s>]+/gi,
      ' $1="#"',
    );
}

function shouldLint(filePath: string) {
  return /\.(html|css|tsx|jsx|md)$/i.test(filePath);
}

function slugify(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 80) || 'design-system'
  );
}

function defaultFormat(surface: string) {
  if (surface === 'document') return 'md';
  if (surface === 'image') return 'png';
  if (surface === 'audio') return 'wav';
  if (surface === 'video') return 'mp4';
  return 'zip';
}

function publishProjectPreviewEvent(
  projectId: string,
  event: string,
  payload: Record<string, unknown>,
) {
  const subscribers = previewSubscribers.get(projectId);
  if (!subscribers || subscribers.size === 0) return;
  const encoded = encodeSse(event, {
    projectId,
    at: new Date().toISOString(),
    ...payload,
  });
  for (const controller of [...subscribers]) {
    try {
      controller.enqueue(encoded);
    } catch {
      subscribers.delete(controller);
    }
  }
  if (subscribers.size === 0) previewSubscribers.delete(projectId);
}

function encodeSse(event: string, data: unknown) {
  return sseEncoder.encode(
    `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
  );
}

function encodeSseMessage(data: unknown) {
  return sseEncoder.encode(`data: ${JSON.stringify(data)}\n\n`);
}
