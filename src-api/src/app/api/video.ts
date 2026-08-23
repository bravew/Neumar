import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { zValidator } from '@hono/zod-validator';
import { ContentGraphSchema, TimelineOpSchema } from '@neumar/video-ir';
import { Hono, type Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';

import { videoPluginRoutes } from '@/app/api/video-plugins';

import {
  resolveRunContext,
  RunContextEnvelopeInputSchema,
  RunContextError,
} from '@/core/agent/run-context';
import type { AgentMessage } from '@/core/agent/types';

import { storyboardSchema } from '@/extensions/agent/video/validators';

import { AssetsError } from '@/shared/assets';
import { AgentRunConflictError, reserveAgentRun } from '@/shared/db/operations';
import {
  CreateVideoProjectSchema,
  UpdateVideoProjectSchema,
} from '@/shared/db/schemas';
import { startDetachedAGUIRun } from '@/shared/services/ag-ui/detached-run';
import { AGUIEmitter } from '@/shared/services/ag-ui/emitter';
import { journalAGUIEvent } from '@/shared/services/ag-ui/journal';
import { AGUIEventPersister } from '@/shared/services/ag-ui/persistence';
import { subscribeSSEToBus } from '@/shared/services/ag-ui/transport';
import { validateInputFile } from '@/shared/services/ffmpeg';
import {
  deleteRenderProviderConfig,
  listRenderProviderConfigs,
  testRenderProvider,
  upsertRenderProviderConfig,
} from '@/shared/services/render/router';
import { createLogger } from '@/shared/utils/logger';
import {
  getVideoAgentHistory,
  setVideoAgentHistory,
} from '@/shared/video/agent-history';
import {
  isVideoAgenticRuntimeEnabled,
  planVideoAgentTurn,
  runVideoAgentTurn,
} from '@/shared/video/agent-sdk';
import {
  applyVideoAgentTool,
  redoVideoAgentJournalEntry,
  undoVideoAgentJournalEntry,
  videoAgentToolCallSchema,
} from '@/shared/video/agent-tools';
import { resolveProjectAssetPath } from '@/shared/video/asset-files';
import { downloadBrollHit, searchBroll } from '@/shared/video/broll';
import {
  mergeCaption,
  patchCaption,
  splitCaption,
  syncCaptions,
  transcribeAsset,
} from '@/shared/video/captions';
import { alignCaptureToStoryboard } from '@/shared/video/capture/align';
import {
  attachCatalogAssetToProject,
  cancelProjectAssetHydration,
  ensureTimelineAssetsHydrated,
  hydrateProjectAsset,
  shouldHydrateProjectAsset,
} from '@/shared/video/catalog-assets';
import { setFrameNativeEnhancement } from '@/shared/video/content-graph/native-enhancement';
import {
  pruneStaleFrameOverrides,
  readContentGraph,
  readSelectedTemplate,
  readTemplateVariables,
  selectTemplate,
  writeContentGraph,
  writeTemplateVariables,
} from '@/shared/video/content-graph/persistence';
import {
  EngineSelectionError,
  listEngineSelectionOptions,
  listVideoEnginesWithBuiltins,
  selectVideoEngine,
} from '@/shared/video/engines';
import { runVideoEvalReport } from '@/shared/video/eval';
import {
  getVideoFeatureFlag,
  snapshotVideoFeatureFlags,
} from '@/shared/video/flags';
import {
  checkHyperframesComposition,
  HyperframesInspectError,
  summarizeHyperframesCheck,
} from '@/shared/video/hyperframes-inspect';
import {
  getHyperframesStudioBridge,
  HyperframesStudioError,
  resolveHyperframesStudioProjectDir,
} from '@/shared/video/hyperframes-studio';
import {
  getRenderStreamBufferSize,
  getRenderStreamSeqBounds,
  isRenderStreamActive,
  subscribeRenderStream,
} from '@/shared/video/job-events';
import {
  cancelVideoJob,
  enqueueEditorHandoffJob,
  enqueueRenderJob,
  getVideoJob,
  listRenderJobs,
  listVideoJobs,
  retryVideoJob,
} from '@/shared/video/jobs';
import {
  addLinkedSource,
  attachLinkedAsset,
  enqueueLinkedSourceSync,
  getLinkedAsset,
  listFavoriteLinkedAssets,
  listLinkedFolderChildren,
  listLinkedAssets,
  listLinkedSources,
  listRecentLinkedAssets,
  markLinkedAssetOpened,
  previewLinkedAsset,
  removeLinkedSource,
  searchLinkedAssets,
  setLinkedAssetFavorite,
  setLinkedSourceFavorite,
  updateLinkedSource,
} from '@/shared/video/linked-sources';
import { createLocalFolderGrant } from '@/shared/video/linked-sources/local-grants';
import { generateBackgroundMusic } from '@/shared/video/music';
import {
  deleteImportedOverlayItem,
  getImportedOverlayAsset,
  ImportedOverlayError,
  listImportedOverlayItems,
  saveImportedOverlayItem,
  SaveImportedOverlayInputSchema,
} from '@/shared/video/overlays/imported-items';
import {
  deleteUserOverlayDocument,
  listUserOverlayDocuments,
  saveUserOverlayDocument,
  SaveUserOverlayDocumentInputSchema,
  UserOverlayDocumentError,
} from '@/shared/video/overlays/user-documents';
import {
  deleteUserOverlayPreset,
  listUserOverlayPresets,
  saveUserOverlayPreset,
  UserOverlayPresetError,
} from '@/shared/video/overlays/user-presets';
import {
  deleteUserOverlayStyle,
  exportUserOverlayStyles,
  importUserOverlayStyles,
  listUserOverlayStyles,
  saveUserOverlayStyle,
  SaveUserOverlayStyleInputSchema,
  USER_OVERLAY_STYLE_SCHEMA_ID,
  UserOverlayStyleError,
  UserOverlayStyleFileSchema,
} from '@/shared/video/overlays/user-styles';
import {
  cancelRender,
  getRenderStatus,
  materializeStoryboardSceneAsset,
  regenerateStoryboardSceneAsset,
  renderProject,
} from '@/shared/video/pipeline';
import { selectBackgroundMusic } from '@/shared/video/plugins/atoms/music-select';
import { loadVideoPlugins } from '@/shared/video/plugins/loader';
import { withProjectLock } from '@/shared/video/project-lock';
import {
  clearVideoProxyForAsset,
  generateVideoProxyForAsset,
  scheduleVideoProxyGeneration,
} from '@/shared/video/proxy';
import {
  getVideoRecipe,
  listVideoIntentLog,
  listVideoRecipes,
  recordVideoIntentLog,
} from '@/shared/video/recipes';
import { reframeProject } from '@/shared/video/reframe/pipeline';
import {
  applyRenderPlanSceneModel,
  buildRenderPlan,
} from '@/shared/video/render-plan';
import { shareVideoProject } from '@/shared/video/share';
import { fetchSource, SourceIngestError } from '@/shared/video/source/ingest';
import { buildSourceProvenance } from '@/shared/video/source/provenance';
import {
  listVideoProjectStorageTree,
  parseVideoStorageRoot,
} from '@/shared/video/storage-tree';
import {
  addExternalProjectAsset,
  addProjectAssetFromPath,
  addProjectAssetFromUpload,
  addProjectImageAssetFromUpload,
  analyzeSource,
  applyCutPlan,
  approveStoryboard,
  createProject,
  createCutPlan,
  deleteProject,
  deleteProjectAsset,
  enqueueYtDlpImport,
  getSourceAnalysis,
  getProject,
  getProviderConfig,
  getVideoAssetDerivativesDir,
  getVideoProjectRoot,
  getVideoWorkspaceRoot,
  getStoryboard,
  generateStoryboardDraft,
  importSource,
  listSources,
  listProjects,
  listProviderConfigs,
  patchStoryboard,
  rejectStoryboard,
  replanStoryboardScene,
  updateProject,
  upsertProviderConfig,
  writeProject,
} from '@/shared/video/store';
import {
  createCustomVideoTemplate,
  getVideoTemplate,
  listVideoTemplates,
  removeCustomVideoTemplate,
} from '@/shared/video/templates';
import {
  applyTemplateToProject,
  createProjectFromTemplate,
  saveProjectAsTemplate,
} from '@/shared/video/templates/agent-bridge';
import { schemaToFormSpec } from '@/shared/video/templates/form-mapper';
import {
  loadTemplateGallery,
  readTemplateSource,
  resolveDefaultTemplateGalleryRoots,
  resolveTemplateAssetPath,
  type GalleryTemplate,
} from '@/shared/video/templates/gallery-loader';
import {
  FromTemplateSchema,
  SaveAsTemplateSchema,
  VideoTemplateSchema,
} from '@/shared/video/templates/validator';
import {
  applyProjectTimelineOp,
  redoProjectTimelineOp,
  undoProjectTimelineOp,
} from '@/shared/video/timeline-ops';
import {
  synthesizeStoryboardNarration,
  synthesizeTtsPreview,
} from '@/shared/video/tts';
import type {
  MediaItem,
  ProviderId,
  Storyboard,
  VideoTimeline,
} from '@/shared/video/types';
import {
  getGlobalVideoUsage,
  getProjectVideoUsage,
} from '@/shared/video/usage';

const logger = createLogger('VideoApi');

export const videoRoutes = new Hono();

const assetPathSchema = z.object({
  paths: z.array(z.string().min(1)).min(1).max(50),
  /**
   * `'reference'` registers the user's own file where it already is.
   * `'copy'` (the default, for agent and ingest callers that write into the
   * project and expect it to own the bytes) duplicates it into the project.
   */
  mode: z.enum(['copy', 'reference']).optional(),
});

const providerUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  providerSettingId: z.string().min(1).nullable().optional(),
  defaultCostCentsPerSec: z.number().int().min(0).max(100_000).optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
});

const renderProviderUpsertSchema = z.object({
  id: z.string().min(1).max(80).optional(),
  provider: z.enum(['local', 'fal', 'modal', 'replicate']),
  label: z.string().min(1).max(120).optional(),
  enabled: z.boolean().optional(),
  baseUrl: z.string().min(1).max(500).optional(),
  endpointId: z.string().min(1).max(200).optional(),
  apiKey: z.string().min(1).max(4000).optional(),
  providerSettingId: z.string().min(1).max(200).nullable().optional(),
  rendererImage: z.string().min(1).max(300).optional(),
  rendererVersion: z.string().min(1).max(80).optional(),
  defaultCostCentsPerRenderSec: z.number().int().min(0).max(100_000).optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
});

const sourceImportSchema = z.object({
  path: z.string().min(1).optional(),
  rights: z
    .object({
      userConfirmed: z.boolean(),
      notes: z.string().optional(),
    })
    .optional(),
});

const captureImportSchema = z.object({
  paths: z.array(z.string().min(1)).min(1).max(20).optional(),
  rights: z
    .object({
      userConfirmed: z.boolean(),
      notes: z.string().optional(),
    })
    .optional(),
});

const sourceYtdlSchema = z.object({
  url: z.string().url(),
  maxDurationSec: z.number().int().positive().max(3600).optional(),
  format: z.enum(['mp4', 'best']).optional(),
  userConfirmedRights: z.literal(true),
});

const cutPlanSchema = z.object({
  candidateIds: z.array(z.string()).optional(),
  mode: z.enum(['cut', 'speed-up', 'review-only']).optional(),
  approved: z.boolean().optional(),
});

const agentTurnSchema = z.object({
  message: z.string().min(1).max(4000),
  mode: z.enum(['storyboard', 'chat']).default('storyboard'),
  // User-selected LLM model id for the agentic chat runtime (optional).
  model: z.string().min(1).max(120).optional(),
  supplementalSkillIds: z.array(z.string()).max(3).optional(),
  runContext: RunContextEnvelopeInputSchema.optional(),
  // Prior conversation turns so the agent has multi-turn context.
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1).max(8000),
      }),
    )
    .max(40)
    .optional(),
  context: z
    .object({
      selectedSceneId: z.string().min(1).optional(),
      projectAssetIds: z.array(z.string().min(1)).max(20).optional(),
      aspectRatio: z.enum(['16:9', '9:16', '1:1', '4:5']).optional(),
      step: z.string().min(1).max(80).optional(),
      transcriptSelection: z
        .object({
          sceneId: z.string().min(1).optional(),
          clipId: z.string().min(1).optional(),
          startMs: z.number().int().min(0),
          endMs: z.number().int().min(0),
          text: z.string().min(1).max(4000),
        })
        .refine((selection) => selection.endMs > selection.startMs, {
          message: 'endMs must be greater than startMs',
        })
        .optional(),
      editorSelection: z
        .object({
          playheadMs: z.number().int().min(0).optional(),
          selectedClipIds: z.array(z.string().min(1)).max(20).optional(),
          previewFrame: z
            .object({
              atMs: z.number().int().min(0),
              sceneId: z.string().min(1).optional(),
              clipId: z.string().min(1).optional(),
              aspectRatio: z.enum(['16:9', '9:16', '1:1', '4:5']).optional(),
              source: z.literal('timeline-preview'),
            })
            .optional(),
          activePanel: z
            .object({
              kind: z.literal('clip-inspector'),
              clipId: z.string().min(1),
              tab: z.string().min(1).max(40).optional(),
            })
            .optional(),
        })
        .optional(),
      pluginId: z.string().min(1).max(160).optional(),
      pluginInputs: z.record(z.string(), z.unknown()).optional(),
      approvedPluginCapabilities: z.array(z.string().min(1)).max(50).optional(),
      lastReviewedPluginDigest: z.string().min(1).nullable().optional(),
      pluginSignatureOk: z.boolean().nullable().optional(),
    })
    .optional(),
});

const storyboardPatchSchema = z.object({
  patch: storyboardSchema.partial(),
});
const frameNativeEnhancementSchema = z
  .object({
    enabled: z.boolean(),
    nativeTemplateId: z.string().min(1).max(128).optional(),
  })
  .strict();

const replanSceneSchema = z.object({
  sceneId: z.string().min(1),
  hint: z.string().max(1000).optional(),
});

const renderPlanSceneModelSchema = z.object({
  providerId: z.string().min(1).max(200),
});

const timelineMarkerSchema = z.object({
  id: z.string().min(1).max(128),
  timeMs: z
    .number()
    .int()
    .min(0)
    .max(24 * 60 * 60 * 1000),
  label: z.string().max(200),
  color: z
    .enum(['red', 'orange', 'yellow', 'green', 'blue', 'purple'])
    .optional(),
  isChapter: z.boolean().optional(),
  comment: z.string().max(2000).optional(),
});

const timelineBookendSchema = z.object({
  kind: z.literal('fade'),
  durationMs: z.number().int().min(0).max(60_000),
});

const timelineUpdateSchema = z.object({
  // Strict on outer fields (no mass-assignment); per-track shape is still
  // loose (`Record<string, unknown>`) because the discriminated-union
  // TimelineTrack lives in types.ts and isn't worth duplicating here.
  timeline: z.object({
    schema: z.literal('neuma.video.timeline.v1'),
    tracks: z.array(z.record(z.string(), z.unknown())).max(64),
    durationMs: z
      .number()
      .int()
      .min(0)
      .max(24 * 60 * 60 * 1000),
    fps: z.number().positive().max(240),
    markers: z.array(timelineMarkerSchema).max(1000).optional(),
    intro: timelineBookendSchema.optional(),
    outro: timelineBookendSchema.optional(),
    migration: z
      .object({
        from: z.literal('storyboard'),
        version: z.number().int().positive(),
      })
      .optional(),
  }),
});

const timelineOpApplySchema = z.object({
  op: TimelineOpSchema,
  source: z.enum(['user', 'agent', 'system']).default('agent'),
  summary: z.string().max(280).optional(),
});

const regenerateSceneSchema = z.object({
  prompt: z.string().min(1).max(2000).optional(),
  lipsyncText: z.string().min(1).max(4000).optional(),
  voiceId: z.string().max(200).optional(),
  voiceProvider: z
    .enum([
      'kokoro',
      'elevenlabs',
      'cartesia',
      'openai-tts',
      'gemini-tts',
      'hume-octave',
      'indextts',
    ])
    .optional(),
  refImageAssetId: z.string().min(1).optional(),
  refImageTailAssetId: z.string().min(1).optional(),
  provider: z.string().min(1).max(200).optional(),
  durationMs: z.number().int().min(1000).max(60000).optional(),
  seed: z.number().int().optional(),
  motionScale: z.number().min(0).max(1).optional(),
  background: z
    .discriminatedUnion('kind', [
      z.object({ kind: z.literal('transparent') }),
      z.object({ kind: z.literal('color'), color: z.string().optional() }),
      z.object({ kind: z.literal('image'), assetId: z.string().min(1) }),
    ])
    .optional(),
  confirmReferenceUpload: z.literal(true).optional(),
});

const loudnessTargetSchema = z.union([
  z.literal(-14),
  z.literal(-16),
  z.literal(-23),
]);

const renderRequestSchema = z.object({
  aspectRatios: z
    .array(z.enum(['16:9', '9:16', '1:1', '4:5']))
    .min(1)
    .max(4)
    .optional(),
  mode: z.enum(['speed', 'reproducible']).optional(),
  renderer: z.enum(['ffmpeg', 'remotion', 'webcodecs']).optional(),
  captionMode: z.enum(['off', 'burn-in', 'sidecar']).optional(),
  where: z.enum(['local', 'cloud']).optional(),
  renderProviderId: z.string().min(1).max(80).optional(),
  cloudEgressConfirmed: z.boolean().optional(),
  loudnessTargetLufs: z
    .union([loudnessTargetSchema, z.literal('off')])
    .optional(),
  autoColor: z.boolean().optional(),
  autoReframe: z.boolean().optional(),
});

const editorHandoffRequestSchema = z.object({
  targets: z
    .array(
      z.enum([
        'neuma-package',
        'final-cut-pro',
        'premiere-pro',
        'resolve',
        'otio',
        'edl',
        'capcut-fallback',
      ]),
    )
    .min(1)
    .max(7)
    .optional(),
  mediaMode: z.enum(['copy', 'link']).optional(),
});

const shareRequestSchema = z.object({
  destination: z.enum([
    'download-mp4',
    'youtube',
    'tiktok',
    'slack',
    'discord',
    'telegram',
    'lark',
  ]),
  aspectRatio: z.enum(['16:9', '9:16', '1:1', '4:5']).optional(),
  channelConfigId: z.string().min(1).max(120).optional(),
  conversationId: z.string().min(1).max(300).optional(),
  message: z.string().max(2000).optional(),
});

const ttsPreviewSchema = z.object({
  text: z.string().min(1).max(5000),
  voiceId: z.string().max(200).optional(),
  provider: z
    .enum([
      'kokoro',
      'elevenlabs',
      'cartesia',
      'openai-tts',
      'gemini-tts',
      'hume-octave',
      'indextts',
    ])
    .optional(),
});

const ttsBatchSchema = z.object({
  segments: z
    .array(
      z.object({
        id: z.string().min(1).optional(),
        sceneId: z.string().min(1),
        text: z.string().min(1).max(4000),
        voiceId: z.string().max(200).optional(),
        provider: z
          .enum([
            'kokoro',
            'elevenlabs',
            'cartesia',
            'openai-tts',
            'gemini-tts',
            'hume-octave',
            'indextts',
          ])
          .optional(),
      }),
    )
    .max(80)
    .optional(),
  voiceId: z.string().max(200).optional(),
  provider: z
    .enum([
      'kokoro',
      'elevenlabs',
      'cartesia',
      'openai-tts',
      'gemini-tts',
      'hume-octave',
      'indextts',
    ])
    .optional(),
});

const transcribeSchema = z.object({
  assetId: z.string().min(1),
  engine: z.string().optional(),
});

const captureAlignSchema = z.object({
  sceneIds: z.array(z.string().min(1)).max(40).optional(),
  engine: z.string().optional(),
});

const captionSyncSchema = z.object({
  sourceId: z.string().optional(),
  cutPlanId: z.string().optional(),
  regenerate: z.boolean().optional(),
});

const captionPatchSchema = z.object({
  text: z.string().optional(),
  startMs: z.number().int().min(0).optional(),
  endMs: z.number().int().min(0).optional(),
});

const captionSplitSchema = z.object({
  wordIndex: z.number().int().min(1),
});

const brollSearchSchema = z.object({
  query: z.string().min(1).max(200),
  provider: z.enum(['pexels', 'pixabay', 'storyblocks']).optional(),
  limit: z.number().int().min(1).max(8).optional(),
});

const brollDownloadSchema = z.object({
  hit: z.object({
    id: z.string().min(1),
    provider: z.enum(['pexels', 'pixabay', 'storyblocks']),
    previewUrl: z.string().url(),
    downloadUrl: z.string().url(),
    widths: z.array(z.number()),
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
    durationSec: z.number().positive(),
    license: z.string(),
    attribution: z.string().optional(),
    attributionUrl: z.string().url().optional(),
    attributionRequired: z.boolean().optional(),
    commercialUse: z.boolean(),
    sourceUrl: z.string().url().optional(),
    sourceDisplayName: z.string().optional(),
    thumbnailUrl: z.string().url().optional(),
    providerLinkLabel: z.string().optional(),
    downloadMimeType: z.string().optional(),
    fileExtension: z.string().optional(),
    query: z.string().optional(),
  }),
});

const musicSchema = z.object({
  prompt: z.string().min(1).max(1000),
  durationMs: z.number().int().min(1000).max(600000),
  tempoBpm: z.number().int().min(40).max(240).optional(),
  mood: z.string().max(100).optional(),
  provider: z
    .enum(['elevenlabs-music', 'stable-audio', 'minimax-music'])
    .optional(),
  model: z.string().min(1).max(120).optional(),
  seed: z.number().int().optional(),
});

const musicSelectSchema = z.object({
  prompt: z.string().min(1).max(1000).optional(),
  durationMs: z.number().int().min(1000).max(600000).optional(),
  tempoBpm: z.number().int().min(40).max(240).optional(),
  mood: z.string().max(100).optional(),
  generateIfMissing: z.boolean().optional(),
  provider: z
    .enum(['elevenlabs-music', 'stable-audio', 'minimax-music'])
    .optional(),
  model: z.string().min(1).max(120).optional(),
  seed: z.number().int().optional(),
});

const projectSettingsSchema = z.object({
  renderCaptionMode: z.enum(['off', 'burn-in', 'sidecar']).optional(),
  renderWhere: z.enum(['local', 'cloud']).optional(),
  cloudRenderProviderId: z.string().min(1).max(80).optional(),
  musicProviderId: z
    .enum(['elevenlabs-music', 'stable-audio', 'minimax-music'])
    .optional(),
  musicProviderModel: z.string().min(1).max(120).optional(),
  youtubeRightsAck: z
    .object({
      accepted: z.literal(true),
      acceptedAt: z.string().min(1),
      scope: z.literal('project'),
    })
    .optional(),
  cloudRenderConsents: z
    .record(
      z.string(),
      z.object({
        confirmed: z.boolean(),
        confirmedAt: z.string(),
      }),
    )
    .optional(),
  loudnessTargetLufs: z
    .union([loudnessTargetSchema, z.literal('off')])
    .optional(),
  autoColorEnabled: z.boolean().optional(),
  autoReframeEnabled: z.boolean().optional(),
});

const reframeSchema = z.object({
  aspectRatio: z.enum(['9:16', '1:1', '4:5']),
});

const linkedSourceProviderSchema = z.enum([
  'local-fs',
  'google-drive',
  'box',
  'dropbox',
  'onedrive',
  'immich',
  's3',
]);

const linkedSourceRoleSchema = z.enum(['context', 'b-roll', 'reference']);

const linkedSourceFiltersSchema = z
  .object({
    types: z
      .array(z.enum(['image', 'video', 'audio']))
      .max(3)
      .optional(),
    extensions: z.array(z.string().min(1).max(16)).max(24).optional(),
    maxDepth: z.number().int().min(0).max(12).optional(),
    minDurationMs: z.number().int().min(0).optional(),
    maxDurationMs: z.number().int().min(0).optional(),
  })
  .optional();

const linkedSourceBudgetSchema = z
  .object({
    maxFiles: z.number().int().min(1).max(100_000).optional(),
    maxBytes: z
      .number()
      .int()
      .min(1024 * 1024)
      .optional(),
    ttlSec: z.number().int().min(60).optional(),
    captionUsd: z.number().min(0).max(10_000).optional(),
  })
  .optional();

const linkedSourceCreateSchema = z.object({
  provider: linkedSourceProviderSchema,
  connectionId: z.string().min(1).optional(),
  rootPath: z.string().min(1),
  displayName: z.string().max(200).optional(),
  role: linkedSourceRoleSchema.optional(),
  filters: linkedSourceFiltersSchema,
  budget: linkedSourceBudgetSchema,
  localGrantToken: z.string().uuid().optional(),
});

const linkedSourcePatchSchema = z.object({
  displayName: z.string().max(200).optional(),
  role: linkedSourceRoleSchema.optional(),
  filters: linkedSourceFiltersSchema,
  budget: linkedSourceBudgetSchema,
});

const linkedSourceSyncSchema = z.object({
  depth: z.number().int().min(0).max(12).optional(),
});

const localFolderGrantSchema = z.object({
  rootPath: z.string().min(1),
});

const linkedAssetAttachSchema = z.object({
  sceneId: z.string().min(1).optional(),
  role: z.enum(['asset', 'reference']).optional(),
});

const catalogAssetAttachSchema = z.object({
  role: z.enum(['asset', 'b-roll', 'reference']).optional(),
  sessionId: z.string().min(1).optional(),
  clientRequestId: z.string().min(1).optional(),
  // 'none' (default) creates a reference-only MediaItem with no bytes
  // on disk. The use-site (drop-on-timeline / agent / manual download)
  // triggers `POST /projects/:id/assets/:mediaItemId/hydrate` when it
  // actually needs the file. 'proxy' / 'full' keep the legacy eager
  // path so older agent flows keep working without churn.
  hydrate: z.enum(['none', 'proxy', 'full']).optional(),
});

const projectAssetHydrateSchema = z.object({
  sessionId: z.string().min(1).optional(),
  clientRequestId: z.string().min(1).optional(),
  role: z.enum(['asset', 'b-roll', 'reference']).optional(),
});

const linkedAssetSearchSchema = z.object({
  query: z.string().max(500).optional(),
  kind: z.enum(['image', 'video', 'audio']).optional(),
  sourceIds: z.array(z.string().min(1)).max(50).optional(),
  role: linkedSourceRoleSchema.optional(),
  durationMs: z
    .object({
      min: z.number().int().min(0).optional(),
      max: z.number().int().min(0).optional(),
    })
    .optional(),
  aspectRatio: z.enum(['16:9', '9:16', '1:1', '4:5']).optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

const linkedAssetFavoriteSchema = z.object({
  favorite: z.boolean().default(true),
});

const linkedFolderChildrenSchema = z.object({
  sourceId: z.string().min(1),
  path: z.string().optional(),
  page: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional(),
  kinds: z
    .array(z.enum(['image', 'video', 'audio', 'other']))
    .max(4)
    .optional(),
});

function errorResponse(error: unknown): {
  body: { error: string; detail?: unknown };
  status: ContentfulStatusCode;
} {
  const message = error instanceof Error ? error.message : String(error);
  logger.warn('video.api.error', {
    error: message,
    detail: error instanceof AssetsError ? error.detail : undefined,
  });
  if (error instanceof AssetsError) {
    return {
      body: { error: message, detail: error.detail },
      status: error.status as ContentfulStatusCode,
    };
  }
  if (error instanceof HyperframesStudioError) {
    // Surface the code so the client can distinguish an empty project from a
    // real bridge fault without string-matching the message.
    return {
      body: { error: message, detail: { code: error.code } },
      status: error.code === 'invalid-project' ? 422 : 502,
    };
  }
  if (message.includes('not found') || message.includes('ENOENT')) {
    return { body: { error: message }, status: 404 };
  }
  if (
    message.includes('outside') ||
    message.includes('escapes') ||
    message.includes('Invalid') ||
    message.includes('exceeds') ||
    message.includes('missing') ||
    message.includes('required') ||
    message.includes('sensitive') ||
    message.includes('not supported') ||
    message.includes('invalid or expired') ||
    message.includes('trusted local roots')
  ) {
    return { body: { error: message }, status: 422 };
  }
  return { body: { error: message }, status: 500 };
}

function jsonError(c: Context, error: unknown) {
  const response = errorResponse(error);
  return c.json(response.body, response.status);
}

async function resolveProjectAssetInputFile(
  projectId: string,
  asset: MediaItem,
  options: { preferProxy?: boolean } = {},
): Promise<string> {
  try {
    return validateProjectAssetInputFile(projectId, asset, options);
  } catch (error) {
    if (!shouldHydrateProjectAsset(projectId, asset)) throw error;
    logger.warn('video.asset.rehydrate_missing_file', {
      project_id: projectId,
      asset_id: asset.id,
      path: asset.path,
      error: error instanceof Error ? error.message : String(error),
    });
    const hydrated = await hydrateProjectAsset(projectId, asset.id, {
      role: 'asset',
    });
    return validateProjectAssetInputFile(projectId, hydrated.asset, options);
  }
}

function validateProjectAssetInputFile(
  projectId: string,
  asset: MediaItem,
  options: { preferProxy?: boolean },
): string {
  const root = getVideoProjectRoot(projectId);
  if (options.preferProxy && asset.proxy) {
    try {
      return validateInputFile(asset.proxy.path, root);
    } catch (error) {
      logger.warn('video.proxy.stream_fallback', {
        project_id: projectId,
        asset_id: asset.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return resolveProjectAssetPath(asset, root);
}

function htmlTemplatePreview(template: GalleryTemplate) {
  const poster = templatePreviewAssetPath(template.metadata.preview, 'poster');
  const aspect =
    template.metadata.output.resolution.supported_aspects[0] ?? '16:9';
  const params = new URLSearchParams();
  if (poster) params.set('path', poster);
  return {
    mode: poster ? ('poster' as const) : ('live' as const),
    aspect,
    posterUrl: poster
      ? `/video/html-gallery/${encodeURIComponent(template.id)}/asset?${params.toString()}`
      : null,
  };
}

function templatePreviewAssetPath(
  preview: GalleryTemplate['metadata']['preview'],
  key: 'poster' | 'thumbnail' | 'loop',
): string | null {
  if (!preview) return null;
  if (typeof preview === 'string') return key === 'poster' ? preview : null;
  return preview[key] ?? null;
}

function templatePreviewAssetPaths(
  preview: GalleryTemplate['metadata']['preview'],
): Set<string> {
  if (!preview) return new Set();
  if (typeof preview === 'string') return new Set([preview]);
  return new Set(
    [preview.poster, preview.thumbnail, preview.loop].filter(
      (assetPath): assetPath is string => typeof assetPath === 'string',
    ),
  );
}

function contentTypeForTemplateAsset(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.svg':
      return 'image/svg+xml';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    case '.html':
      return 'text/html; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    default:
      return 'application/octet-stream';
  }
}

/** Map a typed source-ingest failure to an HTTP status the composer can read. */
function sourceIngestStatus(
  code: SourceIngestError['code'],
): ContentfulStatusCode {
  switch (code) {
    case 'ssrf-denied':
      return 403;
    case 'unsupported-content-type':
      return 415;
    case 'oversized-body':
      return 413;
    case 'extraction-empty':
      return 422;
    case 'fetch-failed':
      return 502;
  }
}

type AgentTurnRequest = z.infer<typeof agentTurnSchema>;

function shouldUseVideoAgenticRuntime(): boolean {
  // Single gate: the env flag. Credential discovery is delegated to the
  // Claude Agent SDK (env + ~/.claude config + CLI login). Adding a
  // codebase-level Boolean(envKey || settingsKey) check here silently
  // falls back to the legacy planner whenever the user is authed via the
  // CLI but has no env var set — which is the common dev case.
  return isVideoAgenticRuntimeEnabled();
}

async function startVideoAgenticTurn(
  project: Awaited<ReturnType<typeof getProject>>,
  request: AgentTurnRequest,
  abortController: AbortController,
  runId: string,
  supplementalSkillIds: string[],
): Promise<string> {
  const emitter = new AGUIEmitter(project.id, runId, {
    workspaceRoot: getVideoWorkspaceRoot(),
    taskTitle: project.name,
  });
  if (request.context?.pluginId) {
    await loadVideoPlugins({ watch: false });
  }
  const messages = runVideoAgentTurn(
    project,
    request.message,
    request.context,
    {
      signal: abortController.signal,
      model: request.model,
      ...(request.messages ? { conversation: request.messages } : {}),
      supplementalSkillIds,
    },
  );
  const busKey = `agui-video-${project.id}-${runId}`;
  const persister = new AGUIEventPersister(
    project.id,
    runId,
    undefined,
    undefined,
    'video',
    { model: request.model },
    'video',
  );
  startDetachedAGUIRun({
    mode: 'video',
    ownerKey: project.id,
    runId,
    threadId: project.id,
    busKey,
    controller: abortController,
    persister,
    events: emitter.transform(messages),
  }).catch((error) => {
    logger.error('Detached Video agent pipeline failed', {
      projectId: project.id,
      runId,
      error,
    });
  });
  return busKey;
}

async function persistLegacyVideoJournal(input: {
  projectId: string;
  runId: string;
  model?: string;
  messages?: AgentMessage[];
  error?: unknown;
}): Promise<void> {
  const emitter = new AGUIEmitter(input.projectId, input.runId, {
    taskTitle: `Video ${input.projectId}`,
  });
  const persister = new AGUIEventPersister(
    input.projectId,
    input.runId,
    undefined,
    undefined,
    'video',
    { model: input.model },
    'video',
  );
  async function* legacyMessages(): AsyncGenerator<AgentMessage> {
    for (const message of input.messages ?? []) yield message;
    if (input.error !== undefined) throw input.error;
  }
  for await (const event of emitter.transform(legacyMessages())) {
    journalAGUIEvent(input.runId, event);
    persister.handleEvent(event);
  }
}

videoRoutes.route('/plugins', videoPluginRoutes);

function parseLinkedAssetKind(value: string | undefined) {
  if (
    value === 'image' ||
    value === 'video' ||
    value === 'audio' ||
    value === 'other'
  ) {
    return value;
  }
  return undefined;
}

function parseNonNegativeInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

/** Parse an SSE cursor (`?from=` query or `Last-Event-ID` header). */
function parseSSECursor(raw: string | undefined): number | null {
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

videoRoutes.get('/templates', async (c) => {
  try {
    return c.json({ templates: await listVideoTemplates() });
  } catch (error) {
    return jsonError(c, error);
  }
});

videoRoutes.get('/templates/:id', async (c) => {
  try {
    return c.json({ template: await getVideoTemplate(c.req.param('id')) });
  } catch (error) {
    return jsonError(c, error);
  }
});

// Phase 7 / Slice K — feature-flag snapshot so the Video Mode UI can hide the
// html-video surface when an operator flips a kill switch off. Flags are on by
// default (see flags.ts).
videoRoutes.get('/flags', (c) => {
  return c.json({ flags: snapshotVideoFeatureFlags() });
});

// Runtime-selection contract (P2-6) + packaged-runtime setup surface.
// Every registered engine, with its honest tradeoffs and — when it is not
// usable — the typed reason (`not-found` / `version-too-old` /
// `browser-missing`) the setup prompt turns into install guidance.
videoRoutes.get('/engines', async (c) => {
  try {
    await listVideoEnginesWithBuiltins();
    const options = await listEngineSelectionOptions();
    let recommendedEngineId: string | undefined;
    try {
      recommendedEngineId = (await selectVideoEngine({ options }))
        .selectedEngineId;
    } catch (error) {
      if (!(error instanceof EngineSelectionError)) throw error;
    }
    return c.json({
      schema: 'neuma.video.engine-options.v1',
      engines: options,
      ...(recommendedEngineId ? { recommendedEngineId } : {}),
    });
  } catch (error) {
    logger.error(
      `Failed to list video engines: ${error instanceof Error ? error.message : String(error)}`,
    );
    return c.json({ error: 'Failed to list video engines' }, 500);
  }
});

// "My overlays" — user-saved overlay presets (07-07 plan CP6). Data-only
// bookmarks over built-in presets; see overlays/user-presets.ts.
videoRoutes.get('/overlay-presets', async (c) => {
  try {
    return c.json({ presets: await listUserOverlayPresets() });
  } catch (error) {
    return jsonError(c, error);
  }
});

const saveOverlayPresetSchema = z
  .object({
    name: z.string().min(1).max(80),
    basePresetId: z.string().min(1),
    controls: z.record(
      z.string(),
      z.union([z.string(), z.number(), z.boolean()]),
    ),
    loop: z.enum(['loop', 'hold', 'none']).optional(),
  })
  .strict();

videoRoutes.post(
  '/overlay-presets',
  zValidator('json', saveOverlayPresetSchema),
  async (c) => {
    try {
      const preset = await saveUserOverlayPreset(c.req.valid('json'));
      return c.json({ preset }, 201);
    } catch (error) {
      if (error instanceof UserOverlayPresetError) {
        return c.json({ error: error.message, code: error.code }, 400);
      }
      return jsonError(c, error);
    }
  },
);

videoRoutes.delete('/overlay-presets/:id', async (c) => {
  try {
    const removed = await deleteUserOverlayPreset(c.req.param('id'));
    if (!removed) return c.json({ error: 'Preset not found' }, 404);
    return c.json({ ok: true });
  } catch (error) {
    return jsonError(c, error);
  }
});

// Overlay styles — reusable full looks over built-in overlay presets. Styles
// remain data-only and apply as built-in overlay clips plus saved controls,
// transforms, keyframes, tags, taste metadata, and provenance.
videoRoutes.get('/overlay-styles', async (c) => {
  try {
    return c.json({ styles: await listUserOverlayStyles() });
  } catch (error) {
    return jsonError(c, error);
  }
});

videoRoutes.post(
  '/overlay-styles',
  zValidator('json', SaveUserOverlayStyleInputSchema),
  async (c) => {
    try {
      const style = await saveUserOverlayStyle(c.req.valid('json'));
      return c.json({ style }, 201);
    } catch (error) {
      if (error instanceof UserOverlayStyleError) {
        return c.json({ error: error.message, code: error.code }, 400);
      }
      return jsonError(c, error);
    }
  },
);

videoRoutes.get('/overlay-styles/export', async (c) => {
  try {
    return c.json(await exportUserOverlayStyles());
  } catch (error) {
    return jsonError(c, error);
  }
});

videoRoutes.post(
  '/overlay-styles/import',
  zValidator('json', UserOverlayStyleFileSchema),
  async (c) => {
    try {
      const styles = await importUserOverlayStyles(c.req.valid('json'));
      return c.json({ schema: USER_OVERLAY_STYLE_SCHEMA_ID, styles });
    } catch (error) {
      if (error instanceof UserOverlayStyleError) {
        return c.json({ error: error.message, code: error.code }, 400);
      }
      return jsonError(c, error);
    }
  },
);

videoRoutes.delete('/overlay-styles/:id', async (c) => {
  try {
    const removed = await deleteUserOverlayStyle(c.req.param('id'));
    if (!removed) return c.json({ error: 'Style not found' }, 404);
    return c.json({ ok: true });
  } catch (error) {
    return jsonError(c, error);
  }
});

// Imported animated overlays — local GIF/Lottie files stored under the video
// workspace with explicit provenance. Project attachment stays separate so the
// library does not leak workspace-level assets into project-local timelines.
videoRoutes.get('/overlay-imports', async (c) => {
  try {
    return c.json({ imports: await listImportedOverlayItems() });
  } catch (error) {
    return jsonError(c, error);
  }
});

videoRoutes.post(
  '/overlay-imports',
  zValidator('json', SaveImportedOverlayInputSchema),
  async (c) => {
    try {
      const imported = await saveImportedOverlayItem(c.req.valid('json'));
      return c.json({ import: imported }, 201);
    } catch (error) {
      if (error instanceof ImportedOverlayError) {
        return c.json({ error: error.message, code: error.code }, 400);
      }
      return jsonError(c, error);
    }
  },
);

videoRoutes.get('/overlay-imports/:id/asset', async (c) => {
  try {
    const asset = await getImportedOverlayAsset(c.req.param('id'));
    if (!asset) return c.json({ error: 'Import not found' }, 404);
    c.header('Content-Type', asset.item.source.mimeType);
    c.header('Cache-Control', 'private, max-age=60');
    return c.body(new Uint8Array(asset.bytes).buffer);
  } catch (error) {
    return jsonError(c, error);
  }
});

videoRoutes.delete('/overlay-imports/:id', async (c) => {
  try {
    const removed = await deleteImportedOverlayItem(c.req.param('id'));
    if (!removed) return c.json({ error: 'Import not found' }, 404);
    return c.json({ ok: true });
  } catch (error) {
    return jsonError(c, error);
  }
});

// User-generated overlay documents are separate from built-ins/imported media:
// the authoring contract must lint and compile before anything is persisted.
videoRoutes.get('/overlay-documents', async (c) => {
  try {
    return c.json({ documents: await listUserOverlayDocuments() });
  } catch (error) {
    return jsonError(c, error);
  }
});

videoRoutes.post(
  '/overlay-documents',
  zValidator('json', SaveUserOverlayDocumentInputSchema),
  async (c) => {
    try {
      const document = await saveUserOverlayDocument(c.req.valid('json'));
      return c.json({ document }, 201);
    } catch (error) {
      if (error instanceof UserOverlayDocumentError) {
        return c.json(
          { error: error.message, code: error.code, issues: error.issues },
          400,
        );
      }
      return jsonError(c, error);
    }
  },
);

videoRoutes.delete('/overlay-documents/:id', async (c) => {
  try {
    const removed = await deleteUserOverlayDocument(c.req.param('id'));
    if (!removed) return c.json({ error: 'Document not found' }, 404);
    return c.json({ ok: true });
  } catch (error) {
    return jsonError(c, error);
  }
});

// Phase 6 M2 — HTML-video gallery + form-spec.
//
// The pre-existing `/templates` endpoints serve *project recipes*. The HTML
// gallery (under `branding/default/video-templates/<id>/`) is loaded via
// `loadTemplateGallery()` and lives at `/html-gallery` so the two namespaces
// stay distinct.
videoRoutes.get('/html-gallery', async (c) => {
  try {
    const roots = resolveDefaultTemplateGalleryRoots(getVideoWorkspaceRoot());
    const gallery = await loadTemplateGallery(roots);
    return c.json({
      templates: gallery.templates.map((t) => ({
        id: t.id,
        rootKind: t.rootKind,
        metadata: t.metadata,
        preview: htmlTemplatePreview(t),
        warnings: t.warnings,
      })),
      issues: gallery.issues,
    });
  } catch (error) {
    return jsonError(c, error);
  }
});

videoRoutes.get(
  '/html-gallery/:id/form-spec',
  zValidator('param', z.object({ id: z.string().min(1).max(200) })),
  async (c) => {
    try {
      const { id } = c.req.valid('param');
      const roots = resolveDefaultTemplateGalleryRoots(getVideoWorkspaceRoot());
      const gallery = await loadTemplateGallery(roots);
      const template = gallery.templates.find((t) => t.id === id);
      if (!template) {
        return c.json({ error: 'template-not-found' }, 404);
      }
      return c.json({
        templateId: template.id,
        formSpec: schemaToFormSpec(template.metadata.inputs.schema),
      });
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

videoRoutes.get(
  '/html-gallery/:id/asset',
  zValidator('param', z.object({ id: z.string().min(1).max(200) })),
  zValidator('query', z.object({ path: z.string().min(1).max(500) }).strict()),
  async (c) => {
    try {
      const { id } = c.req.valid('param');
      const { path: assetPath } = c.req.valid('query');
      const roots = resolveDefaultTemplateGalleryRoots(getVideoWorkspaceRoot());
      const gallery = await loadTemplateGallery(roots);
      const template = gallery.templates.find((t) => t.id === id);
      if (!template) {
        return c.json({ error: 'template-not-found' }, 404);
      }
      if (
        !templatePreviewAssetPaths(template.metadata.preview).has(assetPath)
      ) {
        return c.json({ error: 'template-asset-not-found' }, 404);
      }
      const resolved = resolveTemplateAssetPath(template, assetPath);
      const bytes = await fs.readFile(resolved);
      c.header('Content-Type', contentTypeForTemplateAsset(resolved));
      c.header('Cache-Control', 'public, max-age=60');
      return c.body(bytes);
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

// Slice K — raw template source HTML for the live in-editor frame preview.
videoRoutes.get(
  '/html-gallery/:id/source',
  zValidator('param', z.object({ id: z.string().min(1).max(200) })),
  async (c) => {
    try {
      const { id } = c.req.valid('param');
      const roots = resolveDefaultTemplateGalleryRoots(getVideoWorkspaceRoot());
      const gallery = await loadTemplateGallery(roots);
      const template = gallery.templates.find((t) => t.id === id);
      if (!template) {
        return c.json({ error: 'template-not-found' }, 404);
      }
      return c.json({
        templateId: template.id,
        html: await readTemplateSource(template),
      });
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

// Slice K — the Video Mode editor persists the user's HTML template choice +
// variable values so the agent + materializer see the same selection the UI
// shows. Reuses the file-backed `selectTemplate` the render path already reads.
videoRoutes.get(
  '/projects/:id/html-selection',
  zValidator('param', z.object({ id: z.string().min(1).max(200) })),
  async (c) => {
    try {
      const projectId = c.req.valid('param').id;
      return c.json({
        templateId: await readSelectedTemplate(projectId),
        variables: (await readTemplateVariables(projectId)) ?? {},
      });
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

videoRoutes.put(
  '/projects/:id/html-selection',
  zValidator('param', z.object({ id: z.string().min(1).max(200) })),
  zValidator(
    'json',
    z.object({
      templateId: z.string().min(1).max(200).optional(),
      variables: z.record(z.string(), z.unknown()).optional(),
    }),
  ),
  async (c) => {
    const projectId = c.req.valid('param').id;
    try {
      const { templateId, variables } = c.req.valid('json');
      await withProjectLock(projectId, async () => {
        if (templateId !== undefined)
          await selectTemplate(projectId, templateId);
        if (variables !== undefined) {
          await writeTemplateVariables(projectId, variables);
        }
      });
      return c.json({
        templateId: await readSelectedTemplate(projectId),
        variables: (await readTemplateVariables(projectId)) ?? {},
      });
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

// Phase 4 M2 — composer URL ingestion. The Video Mode composer detects a
// pasted article/repo URL, calls this to fetch readable source text
// server-side (SSRF-safe via safeFetch), then injects the markdown into the
// agent prompt. Gated behind `video.sourceIngestion`; the agent re-fetch path
// is the `video_fetch_source` MCP tool. Returns the source plus a provenance
// partial to stamp onto MediaItems derived from the article (M3).
videoRoutes.post(
  '/source/fetch',
  zValidator('json', z.object({ url: z.string().url() })),
  async (c) => {
    if (!getVideoFeatureFlag('video.sourceIngestion')) {
      return c.json({ error: 'source-ingestion-disabled' }, 403);
    }
    const { url } = c.req.valid('json');
    try {
      const source = await fetchSource(url);
      return c.json({ source, provenance: buildSourceProvenance(source) });
    } catch (error) {
      if (error instanceof SourceIngestError) {
        return c.json(
          { error: error.code, message: error.message },
          sourceIngestStatus(error.code),
        );
      }
      return jsonError(c, error);
    }
  },
);

videoRoutes.get('/recipes', (c) => {
  try {
    return c.json({ recipes: listVideoRecipes() });
  } catch (error) {
    return jsonError(c, error);
  }
});

videoRoutes.get('/recipes/:id', (c) => {
  try {
    return c.json({ recipe: getVideoRecipe(c.req.param('id')) });
  } catch (error) {
    return jsonError(c, error);
  }
});

videoRoutes.post(
  '/local-folder-grants',
  zValidator('json', localFolderGrantSchema),
  async (c) => {
    try {
      return c.json(
        { grant: await createLocalFolderGrant(c.req.valid('json').rootPath) },
        201,
      );
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

videoRoutes.post(
  '/templates',
  zValidator('json', VideoTemplateSchema),
  async (c) => {
    try {
      const template = await createCustomVideoTemplate(c.req.valid('json'));
      return c.json({ template }, 201);
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

videoRoutes.delete('/templates/:id', async (c) => {
  try {
    await removeCustomVideoTemplate(c.req.param('id'));
    return c.json({ ok: true });
  } catch (error) {
    return jsonError(c, error);
  }
});

videoRoutes.post(
  '/projects/from-template',
  zValidator('json', FromTemplateSchema),
  async (c) => {
    try {
      const result = await createProjectFromTemplate(c.req.valid('json'));
      return c.json(result, 201);
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

videoRoutes.post(
  '/projects/:id/save-as-template',
  zValidator('json', SaveAsTemplateSchema),
  async (c) => {
    try {
      const template = await saveProjectAsTemplate(
        c.req.param('id'),
        c.req.valid('json'),
      );
      return c.json({ template }, 201);
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

videoRoutes.post(
  '/projects/:id/apply-template',
  zValidator('json', FromTemplateSchema),
  async (c) => {
    try {
      const result = await applyTemplateToProject(
        c.req.param('id'),
        c.req.valid('json'),
      );
      return c.json(result);
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

videoRoutes.post(
  '/projects',
  zValidator('json', CreateVideoProjectSchema),
  async (c) => {
    try {
      const project = await createProject(c.req.valid('json'));
      return c.json({ project }, 201);
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

videoRoutes.get('/projects', async (c) => {
  try {
    return c.json({ projects: await listProjects() });
  } catch (error) {
    return jsonError(c, error);
  }
});

videoRoutes.get('/projects/:id', async (c) => {
  try {
    return c.json({ project: await getProject(c.req.param('id')) });
  } catch (error) {
    return jsonError(c, error);
  }
});

videoRoutes.get('/projects/:id/storage/tree', async (c) => {
  try {
    const projectId = c.req.param('id');
    await getProject(projectId);
    return c.json({
      tree: await listVideoProjectStorageTree(projectId, {
        root: parseVideoStorageRoot(c.req.query('root')),
        path: c.req.query('path'),
      }),
    });
  } catch (error) {
    return jsonError(c, error);
  }
});

videoRoutes.get('/projects/:id/output', async (c) => {
  try {
    const project = await getProject(c.req.param('id'));
    const aspect = c.req.query('aspectRatio');
    const output =
      (aspect &&
        project.outputs?.find((entry) => entry.aspectRatio === aspect)) ||
      project.outputs?.[0];
    const relativePath = output?.path ?? project.render?.outputPath;
    if (!relativePath) {
      return c.json({ error: 'No render output yet' }, 404);
    }
    const root = getVideoProjectRoot(project.id);
    const absolute = validateInputFile(relativePath, root);
    return c.redirect(
      `/files/stream?path=${encodeURIComponent(absolute)}`,
      307,
    );
  } catch (error) {
    return jsonError(c, error);
  }
});

videoRoutes.get('/projects/:id/poster', async (c) => {
  try {
    const project = await getProject(c.req.param('id'));
    const aspect = c.req.query('aspectRatio');
    const output =
      (aspect &&
        project.outputs?.find((entry) => entry.aspectRatio === aspect)) ||
      project.outputs?.find((entry) => entry.posterPath) ||
      project.outputs?.[0];
    const relativePath = output?.posterPath;
    if (!relativePath) {
      return c.json({ error: 'No render poster yet' }, 404);
    }
    const root = getVideoProjectRoot(project.id);
    const absolute = validateInputFile(relativePath, root);
    return c.redirect(
      `/files/stream?path=${encodeURIComponent(absolute)}`,
      307,
    );
  } catch (error) {
    return jsonError(c, error);
  }
});

videoRoutes.delete('/projects/:id', async (c) => {
  try {
    await deleteProject(c.req.param('id'));
    return c.json({ ok: true });
  } catch (error) {
    return jsonError(c, error);
  }
});

videoRoutes.patch(
  '/projects/:id',
  zValidator('json', UpdateVideoProjectSchema),
  async (c) => {
    try {
      const project = await updateProject(
        c.req.param('id'),
        c.req.valid('json'),
      );
      return c.json({ project });
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

videoRoutes.patch(
  '/projects/:id/settings',
  zValidator('json', projectSettingsSchema),
  async (c) => {
    try {
      const project = await getProject(c.req.param('id'));
      const next = {
        ...project,
        settings: { ...(project.settings ?? {}), ...c.req.valid('json') },
        updatedAt: new Date().toISOString(),
      };
      await writeProject(next);
      return c.json({ project: next });
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

videoRoutes.get('/projects/:id/storyboard', async (c) => {
  try {
    return c.json({ storyboard: await getStoryboard(c.req.param('id')) });
  } catch (error) {
    return jsonError(c, error);
  }
});

// Server-side persistence for the agent dock conversation so history follows
// the user across browsers/devices (previously localStorage-only). The message
// shape is owned by the frontend; we store/return the opaque array.
const AGENT_HISTORY_LIMIT = 200;
const AGENT_HISTORY_MAX_BYTES = 512 * 1024; // cap the stored conversation blob
const projectIdParamSchema = z.object({ id: z.string().min(1).max(200) });

videoRoutes.get(
  '/projects/:id/agent-history',
  zValidator('param', projectIdParamSchema),
  async (c) => {
    try {
      return c.json({
        messages: getVideoAgentHistory(c.req.valid('param').id),
      });
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

videoRoutes.put(
  '/projects/:id/agent-history',
  zValidator('param', projectIdParamSchema),
  zValidator(
    'json',
    z.object({ messages: z.array(z.unknown()).max(AGENT_HISTORY_LIMIT) }),
  ),
  async (c) => {
    try {
      const { messages } = c.req.valid('json');
      // Bound the total payload — each message is opaque (z.unknown), so cap the
      // serialized size to keep the stored blob and GET responses reasonable.
      const serialized = JSON.stringify(messages);
      if (serialized.length > AGENT_HISTORY_MAX_BYTES) {
        return c.json({ error: 'Agent history payload too large' }, 413);
      }
      setVideoAgentHistory(
        c.req.valid('param').id,
        messages,
        new Date().toISOString(),
      );
      return c.json({ ok: true, count: messages.length });
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

// Phase 6 M3 — content-graph read/write for the frames strip + viewer.
// The frontend computes topo order + durations from the graph via
// `@neumar/video-ir`; the server stays the persistence source of truth.
videoRoutes.get(
  '/projects/:id/content-graph',
  zValidator('param', z.object({ id: z.string().min(1).max(200) })),
  async (c) => {
    try {
      return c.json({ graph: await readContentGraph(c.req.valid('param').id) });
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

videoRoutes.put(
  '/projects/:id/content-graph',
  zValidator('json', z.object({ graph: ContentGraphSchema })),
  async (c) => {
    const projectId = c.req.param('id');
    try {
      const { graph } = c.req.valid('json');
      await withProjectLock(projectId, async () => {
        await writeContentGraph(projectId, graph);
        // Drop per-frame HTML overrides whose nodes were removed/renamed so a
        // reorder or delete never leaves an orphaned frame behind.
        await pruneStaleFrameOverrides(projectId, graph);
      });
      return c.json({ graph });
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

videoRoutes.patch(
  '/projects/:id/content-graph/frames/:nodeId/native-enhancement',
  zValidator('json', frameNativeEnhancementSchema),
  async (c) => {
    try {
      return c.json(
        await setFrameNativeEnhancement(
          c.req.param('id'),
          c.req.param('nodeId'),
          c.req.valid('json'),
        ),
      );
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

const hyperframesPreviewInputSchema = z.object({
  compositionDir: z.string().min(1).max(500).default('hyperframes'),
  subscriberId: z.string().uuid(),
});

videoRoutes.post(
  '/projects/:id/hyperframes-preview/open',
  zValidator('json', hyperframesPreviewInputSchema),
  async (c) => {
    try {
      const projectId = c.req.param('id');
      const projectDir = resolveHyperframesStudioProjectDir(
        getVideoProjectRoot(projectId),
        c.req.valid('json').compositionDir,
      );
      return c.json({
        session: await getHyperframesStudioBridge().acquire(
          projectDir,
          c.req.valid('json').subscriberId,
        ),
      });
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

videoRoutes.post(
  '/projects/:id/hyperframes-preview/release',
  zValidator('json', hyperframesPreviewInputSchema),
  async (c) => {
    try {
      const projectDir = resolveHyperframesStudioProjectDir(
        getVideoProjectRoot(c.req.param('id')),
        c.req.valid('json').compositionDir,
      );
      return c.json({
        stopped: await getHyperframesStudioBridge().release(
          projectDir,
          c.req.valid('json').subscriberId,
        ),
      });
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

const htmlCheckInputSchema = z.object({
  compositionDir: z.string().min(1).max(500).default('hyperframes'),
  samples: z.number().int().min(1).max(60).optional(),
  atSec: z.array(z.number().min(0)).max(20).optional(),
  atTransitions: z.boolean().optional(),
  contrast: z.boolean().optional(),
  strict: z.boolean().optional(),
  maxIssues: z.number().int().min(1).max(400).optional(),
});

// Phase E (P2-1): route HyperFrames' one-session lint + runtime + layout +
// motion + WCAG AA gate into the QA panel. Findings are a result, not a
// failure, so a non-clean report still returns 200.
videoRoutes.post(
  '/projects/:id/html-check',
  zValidator('json', htmlCheckInputSchema),
  async (c) => {
    const input = c.req.valid('json');
    try {
      const root = getVideoProjectRoot(c.req.param('id'));
      const report = await checkHyperframesComposition({
        compositionDir: resolveHyperframesStudioProjectDir(
          root,
          input.compositionDir,
        ),
        ...(input.samples !== undefined ? { samples: input.samples } : {}),
        ...(input.atSec?.length ? { atSec: input.atSec } : {}),
        ...(input.atTransitions !== undefined
          ? { atTransitions: input.atTransitions }
          : {}),
        ...(input.contrast !== undefined ? { contrast: input.contrast } : {}),
        ...(input.strict !== undefined ? { strict: input.strict } : {}),
        ...(input.maxIssues !== undefined
          ? { maxIssues: input.maxIssues }
          : {}),
        cwd: root,
        signal: c.req.raw.signal,
      });
      return c.json({
        schema: 'neuma.video.html-check.v1',
        compositionDir: input.compositionDir,
        summary: summarizeHyperframesCheck(report),
        report,
      });
    } catch (error) {
      if (error instanceof HyperframesInspectError) {
        return c.json(
          { error: error.message, detail: { code: error.code } },
          error.code === 'invalid-input' ? 400 : 502,
        );
      }
      return jsonError(c, error);
    }
  },
);

videoRoutes.patch(
  '/projects/:id/storyboard',
  zValidator('json', storyboardPatchSchema),
  async (c) => {
    try {
      return c.json(
        await patchStoryboard(
          c.req.param('id'),
          c.req.valid('json').patch as Partial<Storyboard>,
        ),
      );
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

videoRoutes.post('/projects/:id/storyboard/approve', async (c) => {
  try {
    return c.json(await approveStoryboard(c.req.param('id')));
  } catch (error) {
    return jsonError(c, error);
  }
});

videoRoutes.post('/projects/:id/storyboard/reject', async (c) => {
  try {
    return c.json(await rejectStoryboard(c.req.param('id')));
  } catch (error) {
    return jsonError(c, error);
  }
});

videoRoutes.post('/projects/:id/render-plan', async (c) => {
  try {
    const project = await getProject(c.req.param('id'));
    const renderPlan = buildRenderPlan(project);
    const next = {
      ...project,
      renderPlan,
      updatedAt: new Date().toISOString(),
    };
    await writeProject(next);
    return c.json({ project: next, renderPlan });
  } catch (error) {
    return jsonError(c, error);
  }
});

videoRoutes.patch(
  '/projects/:id/render-plan/scenes/:sceneId/model',
  zValidator('json', renderPlanSceneModelSchema),
  async (c) => {
    try {
      const project = await getProject(c.req.param('id'));
      const next = applyRenderPlanSceneModel(
        project,
        c.req.param('sceneId'),
        c.req.valid('json').providerId,
      );
      await writeProject(next);
      return c.json({ project: next, renderPlan: next.renderPlan });
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

videoRoutes.patch(
  '/projects/:id/timeline',
  zValidator('json', timelineUpdateSchema),
  async (c) => {
    try {
      const project = await getProject(c.req.param('id'));
      const input = c.req.valid('json').timeline;
      // Zod validates the outer timeline shape strictly (no .passthrough()).
      // Per-track structure stays loose at the schema layer; cast only the
      // tracks field to the discriminated-union type rather than the whole
      // timeline object so any future field divergence is caught by tsc.
      const timeline: VideoTimeline = {
        ...input,
        tracks: input.tracks as unknown as VideoTimeline['tracks'],
      };
      const next = {
        ...project,
        timeline,
        updatedAt: new Date().toISOString(),
      };
      await writeProject(next);
      // Kick off downloads for any reference-only assets now on the
      // timeline so their bytes are local before render/scrub.
      ensureTimelineAssetsHydrated(next);
      return c.json({ project: next, timeline });
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

videoRoutes.get('/projects/:id/timeline', async (c) => {
  try {
    const project = await getProject(c.req.param('id'));
    return c.json({
      timeline: project.timeline,
      history: project.history ?? { head: 0, entries: [] },
    });
  } catch (error) {
    return jsonError(c, error);
  }
});

videoRoutes.get('/projects/:id/intent-log', async (c) => {
  try {
    const projectId = c.req.param('id');
    await getProject(projectId);
    return c.json({
      entries: listVideoIntentLog(projectId, {
        limit: parseNonNegativeInt(c.req.query('limit')),
        offset: parseNonNegativeInt(c.req.query('offset')),
      }),
    });
  } catch (error) {
    return jsonError(c, error);
  }
});

videoRoutes.post(
  '/projects/:id/timeline/op',
  zValidator('json', timelineOpApplySchema),
  async (c) => {
    try {
      const projectId = c.req.param('id');
      const body = c.req.valid('json');
      const execution = await withProjectLock(projectId, async () => {
        const next = applyProjectTimelineOp(await getProject(projectId), body);
        await writeProject(next.project);
        return next;
      });
      // Kick off downloads for any reference-only assets now on the
      // timeline so their bytes are local before render/scrub.
      ensureTimelineAssetsHydrated(execution.project);
      return c.json(execution);
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

videoRoutes.post('/projects/:id/timeline/undo', async (c) => {
  try {
    const projectId = c.req.param('id');
    const execution = await withProjectLock(projectId, async () => {
      const next = undoProjectTimelineOp(await getProject(projectId));
      await writeProject(next.project);
      return next;
    });
    return c.json(execution);
  } catch (error) {
    return jsonError(c, error);
  }
});

videoRoutes.post('/projects/:id/timeline/redo', async (c) => {
  try {
    const projectId = c.req.param('id');
    const execution = await withProjectLock(projectId, async () => {
      const next = redoProjectTimelineOp(await getProject(projectId));
      await writeProject(next.project);
      return next;
    });
    return c.json(execution);
  } catch (error) {
    return jsonError(c, error);
  }
});

videoRoutes.post(
  '/projects/:id/storyboard/replan-scene',
  zValidator('json', replanSceneSchema),
  async (c) => {
    try {
      const body = c.req.valid('json');
      return c.json(
        await replanStoryboardScene(c.req.param('id'), body.sceneId, body.hint),
      );
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

videoRoutes.post(
  '/projects/:id/storyboard/scenes/:sceneId/materialize',
  async (c) => {
    try {
      return c.json(
        await materializeStoryboardSceneAsset(
          c.req.param('id'),
          c.req.param('sceneId'),
        ),
      );
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

videoRoutes.post(
  '/projects/:id/scenes/:sceneId/regenerate',
  zValidator('json', regenerateSceneSchema),
  async (c) => {
    try {
      return c.json(
        await regenerateStoryboardSceneAsset(
          c.req.param('id'),
          c.req.param('sceneId'),
          { ...c.req.valid('json'), signal: c.req.raw.signal },
        ),
      );
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

videoRoutes.get('/projects/:id/linked-sources', async (c) => {
  try {
    return c.json({ sources: await listLinkedSources(c.req.param('id')) });
  } catch (error) {
    return jsonError(c, error);
  }
});

videoRoutes.post(
  '/projects/:id/linked-sources',
  zValidator('json', linkedSourceCreateSchema),
  async (c) => {
    try {
      return c.json(
        await addLinkedSource(c.req.param('id'), c.req.valid('json')),
        201,
      );
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

videoRoutes.patch(
  '/projects/:id/linked-sources/:sourceId',
  zValidator('json', linkedSourcePatchSchema),
  async (c) => {
    try {
      return c.json(
        await updateLinkedSource(
          c.req.param('id'),
          c.req.param('sourceId'),
          c.req.valid('json'),
        ),
      );
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

videoRoutes.delete('/projects/:id/linked-sources/:sourceId', async (c) => {
  try {
    return c.json({
      project: await removeLinkedSource(
        c.req.param('id'),
        c.req.param('sourceId'),
      ),
    });
  } catch (error) {
    return jsonError(c, error);
  }
});

videoRoutes.post(
  '/projects/:id/linked-sources/:sourceId/favorite',
  zValidator('json', linkedAssetFavoriteSchema),
  async (c) => {
    try {
      return c.json(
        await setLinkedSourceFavorite(
          c.req.param('id'),
          c.req.param('sourceId'),
          c.req.valid('json').favorite,
        ),
      );
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

videoRoutes.post(
  '/projects/:id/linked-sources/:sourceId/sync',
  zValidator('json', linkedSourceSyncSchema),
  async (c) => {
    try {
      return c.json(
        await enqueueLinkedSourceSync(
          c.req.param('id'),
          c.req.param('sourceId'),
          c.req.valid('json').depth,
        ),
        202,
      );
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

videoRoutes.get('/projects/:id/linked-assets', (c) => {
  try {
    return c.json({
      assets: listLinkedAssets(c.req.param('id'), {
        sourceId: c.req.query('sourceId'),
        kind: parseLinkedAssetKind(c.req.query('kind')),
        query: c.req.query('q') ?? c.req.query('query'),
        limit: parseNonNegativeInt(c.req.query('limit')),
        offset: parseNonNegativeInt(c.req.query('offset')),
      }),
    });
  } catch (error) {
    return jsonError(c, error);
  }
});

videoRoutes.post(
  '/projects/:id/linked-assets/search',
  zValidator('json', linkedAssetSearchSchema),
  async (c) => {
    try {
      return c.json(
        await searchLinkedAssets(c.req.param('id'), c.req.valid('json')),
      );
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

videoRoutes.get('/projects/:id/linked-assets/recents', (c) => {
  try {
    return c.json({
      assets: listRecentLinkedAssets(
        c.req.param('id'),
        parseNonNegativeInt(c.req.query('limit')),
      ),
    });
  } catch (error) {
    return jsonError(c, error);
  }
});

videoRoutes.get('/projects/:id/linked-assets/favorites', (c) => {
  try {
    return c.json({
      assets: listFavoriteLinkedAssets(
        c.req.param('id'),
        parseNonNegativeInt(c.req.query('limit')),
      ),
    });
  } catch (error) {
    return jsonError(c, error);
  }
});

videoRoutes.post(
  '/projects/:id/linked-assets/:assetId/favorite',
  zValidator('json', linkedAssetFavoriteSchema),
  (c) => {
    try {
      return c.json({
        asset: setLinkedAssetFavorite(
          c.req.param('id'),
          c.req.param('assetId'),
          c.req.valid('json').favorite,
        ),
      });
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

videoRoutes.post('/projects/:id/linked-assets/:assetId/opened', (c) => {
  try {
    return c.json({
      asset: markLinkedAssetOpened(c.req.param('id'), c.req.param('assetId')),
    });
  } catch (error) {
    return jsonError(c, error);
  }
});

videoRoutes.post(
  '/projects/:id/linked-folders/children',
  zValidator('json', linkedFolderChildrenSchema),
  async (c) => {
    try {
      return c.json(
        await listLinkedFolderChildren(c.req.param('id'), c.req.valid('json')),
      );
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

videoRoutes.get('/projects/:id/linked-assets/:assetId/thumbnail', (c) => {
  try {
    const asset = getLinkedAsset(c.req.param('id'), c.req.param('assetId'));
    if (!asset.thumbnailCachePath) {
      return c.json({ error: 'Linked asset has no cached thumbnail' }, 404);
    }
    const absolute = validateInputFile(
      asset.thumbnailCachePath,
      getVideoWorkspaceRoot(),
    );
    return c.redirect(
      `/files/stream?path=${encodeURIComponent(absolute)}`,
      307,
    );
  } catch (error) {
    return jsonError(c, error);
  }
});

videoRoutes.get('/projects/:id/linked-assets/:assetId/preview', async (c) => {
  try {
    return c.json(
      await previewLinkedAsset(c.req.param('id'), c.req.param('assetId')),
    );
  } catch (error) {
    return jsonError(c, error);
  }
});

videoRoutes.post(
  '/projects/:id/linked-assets/:assetId/attach',
  zValidator('json', linkedAssetAttachSchema),
  async (c) => {
    try {
      const result = await attachLinkedAsset(
        c.req.param('id'),
        c.req.param('assetId'),
        c.req.valid('json'),
      );
      scheduleVideoProxyGeneration(c.req.param('id'), result.asset.id);
      return c.json(result, 201);
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

videoRoutes.post(
  '/projects/:id/assets/catalog/:assetId/attach',
  zValidator('json', catalogAssetAttachSchema),
  async (c) => {
    try {
      const result = await attachCatalogAssetToProject(
        c.req.param('id'),
        c.req.param('assetId'),
        c.req.valid('json'),
      );
      // Skip proxy generation for reference-only attaches — there are
      // no bytes on disk to proxy. Hydration triggers proxy generation
      // when it copies the file in.
      if (result.asset.materializationState !== 'referenced') {
        scheduleVideoProxyGeneration(c.req.param('id'), result.asset.id);
      }
      return c.json(result, 201);
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

videoRoutes.post(
  '/projects/:id/assets/:assetId/hydrate',
  zValidator('json', projectAssetHydrateSchema),
  async (c) => {
    try {
      const result = await hydrateProjectAsset(
        c.req.param('id'),
        c.req.param('assetId'),
        c.req.valid('json'),
      );
      scheduleVideoProxyGeneration(c.req.param('id'), result.asset.id);
      return c.json(result, 200);
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

videoRoutes.delete('/projects/:id/assets/:assetId/hydrate', async (c) => {
  try {
    const projectId = c.req.param('id');
    const mediaItemId = c.req.param('assetId');
    const project = await getProject(projectId);
    const item = project.assets.find((row) => row.id === mediaItemId);
    if (!item) return c.json({ error: 'MediaItem not found' }, 404);
    const catalogAssetId = item.provenance?.catalogAssetId;
    if (!catalogAssetId) {
      return c.json({ error: 'MediaItem is not catalog-backed' }, 400);
    }
    const cancelled = cancelProjectAssetHydration(projectId, catalogAssetId);
    return c.json({ cancelled }, 200);
  } catch (error) {
    return jsonError(c, error);
  }
});

videoRoutes.get('/projects/:id/messages', async (c) => {
  try {
    await getProject(c.req.param('id'));
    return c.json({ sessionId: `video:${c.req.param('id')}`, messages: [] });
  } catch (error) {
    return jsonError(c, error);
  }
});

videoRoutes.post(
  '/projects/:id/agent/tools',
  zValidator('json', videoAgentToolCallSchema),
  async (c) => {
    try {
      const call = c.req.valid('json');
      const projectId = c.req.param('id');
      const execution = await withProjectLock(projectId, async () => {
        const nextExecution = applyVideoAgentTool(
          await getProject(projectId),
          call,
        );
        if (call.name === 'proposeTimelineOps') {
          recordVideoIntentLog({
            projectId,
            turn: call.args.intentTurn,
            userIntentText: call.args.intentText ?? call.args.summary,
            recipeId: call.args.recipeId,
            recipeVersion: call.args.recipeVersion,
            plan: {
              summary: call.args.summary,
              previewRange: call.args.previewRange,
              applyMode: call.args.applyMode,
            },
            opsProposed: call.args.ops,
            accepted: false,
            diffSummary: call.args.summary,
            applyMode: call.args.applyMode,
          });
        }
        await writeProject(nextExecution.project);
        return nextExecution;
      });
      // Agent edits can place reference-only assets on the timeline — kick
      // off their downloads so bytes are local before render/scrub.
      ensureTimelineAssetsHydrated(execution.project);
      return c.json(execution);
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

videoRoutes.post('/projects/:id/agent-journal/:entryId/undo', async (c) => {
  try {
    const projectId = c.req.param('id');
    const execution = await withProjectLock(projectId, async () => {
      const nextExecution = undoVideoAgentJournalEntry(
        await getProject(projectId),
        c.req.param('entryId'),
      );
      await writeProject(nextExecution.project);
      return nextExecution;
    });
    return c.json(execution);
  } catch (error) {
    return jsonError(c, error);
  }
});

videoRoutes.post('/projects/:id/agent-journal/:entryId/redo', async (c) => {
  try {
    const projectId = c.req.param('id');
    const execution = await withProjectLock(projectId, async () => {
      const nextExecution = redoVideoAgentJournalEntry(
        await getProject(projectId),
        c.req.param('entryId'),
      );
      await writeProject(nextExecution.project);
      return nextExecution;
    });
    return c.json(execution);
  } catch (error) {
    return jsonError(c, error);
  }
});

videoRoutes.post(
  '/projects/:id/agent',
  zValidator('json', agentTurnSchema),
  async (c) => {
    const projectId = c.req.param('id');
    const request = c.req.valid('json');
    let normalizedRunContext;
    try {
      normalizedRunContext = await resolveRunContext({
        mode: 'video',
        ownerKey: projectId,
        envelope: {
          ...request.runContext,
          supplementalSkillIds:
            request.runContext?.supplementalSkillIds ??
            request.supplementalSkillIds,
        },
      });
    } catch (error) {
      if (error instanceof RunContextError) {
        return c.json({ error: error.message }, error.status);
      }
      throw error;
    }
    const runId = randomUUID();
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
        messageContent: request.message,
        provider: 'video',
        model: request.model,
        recovery: normalizedRunContext.recovery,
      });
    } catch (error) {
      if (error instanceof AgentRunConflictError) {
        return c.json({ error: error.message }, 409);
      }
      throw error;
    }
    if (reservation.disposition === 'existing') {
      return c.json({
        runId: reservation.run.id,
        disposition: 'existing',
        status: reservation.run.status,
      });
    }
    c.header('X-Accel-Buffering', 'no');
    return streamSSE(c, async (stream) => {
      const sessionId = `video:${projectId}`;
      await stream.writeSSE({
        event: 'session',
        data: JSON.stringify({ type: 'session', sessionId }),
      });

      try {
        if (request.mode === 'chat') {
          const project = await getProject(projectId);
          if (shouldUseVideoAgenticRuntime()) {
            const abortController = new AbortController();
            const busKey = await startVideoAgenticTurn(
              project,
              request,
              abortController,
              runId,
              normalizedRunContext.supplementalSkillIds,
            );
            await subscribeSSEToBus(
              stream,
              busKey,
              c.req.header('Accept') ?? '',
              c.req.raw.signal,
            );
            return;
          }

          const plan = await planVideoAgentTurn(
            project,
            request.message,
            request.context,
            {
              signal: c.req.raw.signal,
            },
          );
          await stream.writeSSE({
            event: 'message',
            data: JSON.stringify({
              type: 'text',
              sessionId,
              content: plan.message,
            }),
          });
          if (plan.proposal) {
            await stream.writeSSE({
              event: 'action',
              data: JSON.stringify({
                ...plan.proposal,
                sessionId,
                source: plan.source,
              }),
            });
          }
          await stream.writeSSE({
            event: 'done',
            data: JSON.stringify({ type: 'done', sessionId }),
          });
          await persistLegacyVideoJournal({
            projectId,
            runId,
            model: request.model,
            messages: [{ type: 'text', content: plan.message }],
          });
          return;
        }

        await stream.writeSSE({
          event: 'message',
          data: JSON.stringify({
            type: 'text',
            sessionId,
            content: request.message,
          }),
        });
        const result = await generateStoryboardDraft(projectId);
        storyboardSchema.parse(result.storyboard);
        const linkedSources = result.project.linkedSources ?? [];
        if (linkedSources.length > 0) {
          for (const scene of result.storyboard.scenes.slice(0, 3)) {
            const sourceIds =
              scene.assetPlan.kind === 'broll-search' &&
              scene.assetPlan.provider === 'linked'
                ? scene.assetPlan.sourceIds
                : undefined;
            const role =
              scene.assetPlan.kind === 'broll-search' ? 'b-roll' : 'context';
            const search = await searchLinkedAssets(projectId, {
              query: scene.intent,
              role,
              sourceIds,
              limit: 6,
            });
            if (search.results.length === 0) continue;
            await stream.writeSSE({
              event: 'action',
              data: JSON.stringify({
                type: 'searchLinkedAssets',
                sessionId,
                args: { query: scene.intent, role, sourceIds },
                preview: { results: search.results },
              }),
            });
          }
        }
        await stream.writeSSE({
          event: 'tool_result',
          data: JSON.stringify({
            type: 'tool_result',
            sessionId,
            name: 'set_storyboard',
            output: JSON.stringify(result.storyboard),
          }),
        });
        await stream.writeSSE({
          event: 'storyboard',
          data: JSON.stringify({
            type: 'storyboard',
            sessionId,
            storyboard: result.storyboard,
            project: result.project,
          }),
        });
        await stream.writeSSE({
          event: 'request_approval',
          data: JSON.stringify({
            type: 'request_approval',
            sessionId,
            message: 'Storyboard ready for review.',
          }),
        });
        await stream.writeSSE({
          event: 'done',
          data: JSON.stringify({ type: 'done', sessionId }),
        });
        await persistLegacyVideoJournal({
          projectId,
          runId,
          model: request.model,
          messages: [{ type: 'text', content: 'Storyboard ready for review.' }],
        });
      } catch (error) {
        await persistLegacyVideoJournal({
          projectId,
          runId,
          model: request.model,
          error,
        });
        const response = errorResponse(error);
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({
            type: 'error',
            sessionId,
            message: response.body.error,
            status: response.status,
          }),
        });
      }
    });
  },
);

videoRoutes.post('/projects/:id/assets', async (c) => {
  try {
    const projectId = c.req.param('id');
    const contentType = c.req.header('content-type') ?? '';
    if (contentType.includes('application/json')) {
      const parsed = assetPathSchema.parse(await c.req.json());
      const assets = [];
      let project = await getProject(projectId);
      for (const sourcePath of parsed.paths) {
        const result =
          parsed.mode === 'reference'
            ? await addExternalProjectAsset(projectId, sourcePath)
            : await addProjectAssetFromPath(projectId, sourcePath);
        project = result.project;
        assets.push(result.asset);
        scheduleVideoProxyGeneration(projectId, result.asset.id);
      }
      return c.json({ project, assets });
    }

    const form = await c.req.parseBody({ all: true });
    const entries = Array.isArray(form.file) ? form.file : [form.file];
    const files = entries.filter(
      (entry): entry is File => entry instanceof File,
    );
    if (files.length === 0) {
      return c.json({ error: 'file part required' }, 400);
    }
    const imageOnly = c.req.query('kind') === 'image';
    const assets = [];
    let project = await getProject(projectId);
    for (const file of files) {
      const result = imageOnly
        ? await addProjectImageAssetFromUpload(projectId, file)
        : await addProjectAssetFromUpload(projectId, file);
      project = result.project;
      assets.push(result.asset);
      if (!imageOnly) {
        scheduleVideoProxyGeneration(projectId, result.asset.id);
      }
    }
    return c.json({ project, assets });
  } catch (error) {
    return jsonError(c, error);
  }
});

videoRoutes.get('/projects/:id/assets/:assetId/stream', async (c) => {
  try {
    const project = await getProject(c.req.param('id'));
    const asset = project.assets.find(
      (item) => item.id === c.req.param('assetId'),
    );
    if (!asset) {
      return c.json({ error: 'Asset not found' }, 404);
    }
    const absolute = await resolveProjectAssetInputFile(project.id, asset, {
      preferProxy: c.req.query('variant') === 'proxy',
    });
    return c.redirect(
      `/files/stream?path=${encodeURIComponent(absolute)}`,
      307,
    );
  } catch (error) {
    return jsonError(c, error);
  }
});

videoRoutes.get('/projects/:id/assets/:assetId/filmstrip', async (c) => {
  try {
    const project = await getProject(c.req.param('id'));
    const asset = project.assets.find(
      (item) => item.id === c.req.param('assetId'),
    );
    if (!asset) {
      return c.json({ error: 'Asset not found' }, 404);
    }
    const count = Number.parseInt(c.req.query('count') ?? '8', 10);
    const { getFilmstrip } = await import('@/shared/video/asset-thumbs');
    const absolute = await resolveProjectAssetInputFile(project.id, asset);
    const result = await getFilmstrip(
      absolute,
      count,
      getVideoProjectRoot(project.id),
      {
        cacheDir: getVideoAssetDerivativesDir(project.id, asset.id),
        resolvedPath: absolute,
      },
    );
    return c.redirect(
      `/files/stream?path=${encodeURIComponent(result.stripPath)}`,
      307,
    );
  } catch (error) {
    return jsonError(c, error);
  }
});

videoRoutes.get('/projects/:id/assets/:assetId/peaks', async (c) => {
  try {
    const project = await getProject(c.req.param('id'));
    const asset = project.assets.find(
      (item) => item.id === c.req.param('assetId'),
    );
    if (!asset) {
      return c.json({ error: 'Asset not found' }, 404);
    }
    const bins = Number.parseInt(c.req.query('bins') ?? '256', 10);
    const startMs = Number.parseInt(c.req.query('startMs') ?? '', 10);
    const durationMs = Number.parseInt(c.req.query('durationMs') ?? '', 10);
    const { getPeaks } = await import('@/shared/video/asset-thumbs');
    const absolute = await resolveProjectAssetInputFile(project.id, asset);
    const hasRangeQuery =
      Number.isFinite(startMs) || Number.isFinite(durationMs);
    const rangeStartMs = Number.isFinite(startMs) ? startMs : 0;
    const rangeDurationMs = Number.isFinite(durationMs)
      ? durationMs
      : Math.max(1, asset.metadata.durationMs - rangeStartMs);
    const payload = await getPeaks(
      absolute,
      bins,
      getVideoProjectRoot(project.id),
      hasRangeQuery
        ? {
            startMs: rangeStartMs,
            durationMs: rangeDurationMs,
            reverse: c.req.query('reverse') === '1',
          }
        : undefined,
      {
        cacheDir: getVideoAssetDerivativesDir(project.id, asset.id),
        resolvedPath: absolute,
      },
    );
    return c.json(payload, 200, {
      'Cache-Control': 'public, max-age=86400, immutable',
    });
  } catch (error) {
    return jsonError(c, error);
  }
});

videoRoutes.post('/projects/:id/assets/:assetId/proxy', async (c) => {
  try {
    const result = await generateVideoProxyForAsset(
      c.req.param('id'),
      c.req.param('assetId'),
      { force: true },
    );
    return c.json(result);
  } catch (error) {
    return jsonError(c, error);
  }
});

videoRoutes.delete('/projects/:id/assets/:assetId/proxy', async (c) => {
  try {
    const result = await clearVideoProxyForAsset(
      c.req.param('id'),
      c.req.param('assetId'),
    );
    return c.json(result);
  } catch (error) {
    return jsonError(c, error);
  }
});

videoRoutes.delete('/projects/:id/assets/:assetId', async (c) => {
  try {
    const project = await deleteProjectAsset(
      c.req.param('id'),
      c.req.param('assetId'),
    );
    return c.json({ project });
  } catch (error) {
    return jsonError(c, error);
  }
});

videoRoutes.post('/projects/:id/sources/import', async (c) => {
  try {
    const projectId = c.req.param('id');
    const contentType = c.req.header('content-type') ?? '';
    if (contentType.includes('application/json')) {
      const parsed = sourceImportSchema.parse(await c.req.json());
      const result = await importSource(projectId, {
        path: parsed.path,
        origin: 'workspace-path',
        rights: parsed.rights,
      });
      scheduleVideoProxyGeneration(projectId, result.asset.id);
      return c.json(result, 201);
    }

    const form = await c.req.parseBody();
    const file = form.file;
    if (!file || typeof file === 'string') {
      return c.json({ error: 'file part required' }, 400);
    }
    const result = await importSource(projectId, {
      file,
      origin: 'upload',
      rights: { userConfirmed: form.userConfirmedRights === 'true' },
    });
    scheduleVideoProxyGeneration(projectId, result.asset.id);
    return c.json(result, 201);
  } catch (error) {
    return jsonError(c, error);
  }
});

videoRoutes.get('/projects/:id/captures', async (c) => {
  try {
    const project = await getProject(c.req.param('id'));
    const sources = (project.sources ?? []).filter(
      (source) => source.origin === 'capture',
    );
    const assets = sources
      .map((source) =>
        project.assets.find((asset) => asset.id === source.mediaItemId),
      )
      .filter((asset): asset is (typeof project.assets)[number] =>
        Boolean(asset),
      );
    return c.json({ project, sources, assets });
  } catch (error) {
    return jsonError(c, error);
  }
});

videoRoutes.post('/projects/:id/captures/import', async (c) => {
  try {
    const projectId = c.req.param('id');
    const contentType = c.req.header('content-type') ?? '';
    const sources = [];
    const assets = [];
    let project = await getProject(projectId);

    if (contentType.includes('application/json')) {
      const parsed = captureImportSchema.parse(await c.req.json());
      if (!parsed.paths?.length) {
        return c.json({ error: 'paths required' }, 400);
      }
      for (const sourcePath of parsed.paths) {
        const result = await importSource(projectId, {
          path: sourcePath,
          origin: 'capture',
          rights: parsed.rights ?? { userConfirmed: true },
        });
        project = result.project;
        sources.push(result.source);
        assets.push(result.asset);
        scheduleVideoProxyGeneration(projectId, result.asset.id);
      }
      return c.json({ project, sources, assets }, 201);
    }

    const form = await c.req.parseBody({ all: true });
    const entries = Array.isArray(form.file) ? form.file : [form.file];
    const files = entries.filter(
      (entry): entry is File => entry instanceof File,
    );
    if (files.length === 0) {
      return c.json({ error: 'file part required' }, 400);
    }
    for (const file of files) {
      const result = await importSource(projectId, {
        file,
        origin: 'capture',
        rights: { userConfirmed: form.userConfirmedRights === 'true' },
      });
      project = result.project;
      sources.push(result.source);
      assets.push(result.asset);
      scheduleVideoProxyGeneration(projectId, result.asset.id);
    }
    return c.json({ project, sources, assets }, 201);
  } catch (error) {
    return jsonError(c, error);
  }
});

videoRoutes.post(
  '/projects/:id/captures/:captureId/align',
  zValidator('json', captureAlignSchema),
  async (c) => {
    try {
      const projectId = c.req.param('id');
      const captureId = c.req.param('captureId');
      const body = c.req.valid('json');
      const project = await getProject(projectId);
      const source = (project.sources ?? []).find(
        (item) => item.id === captureId && item.origin === 'capture',
      );
      if (!source) {
        return c.json({ error: 'Capture not found' }, 404);
      }

      const transcription = await transcribeAsset(
        projectId,
        source.mediaItemId,
        body.engine,
      );
      const storyboard = transcription.project.storyboard;
      if (!storyboard) {
        return c.json({ error: 'Storyboard not found' }, 404);
      }
      return c.json({
        project: transcription.project,
        source,
        subtitles: transcription.subtitles,
        markers: alignCaptureToStoryboard(
          storyboard,
          transcription.subtitles,
          body.sceneIds,
        ),
      });
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

videoRoutes.post(
  '/projects/:id/sources/ytdl',
  zValidator('json', sourceYtdlSchema),
  async (c) => {
    try {
      const job = await enqueueYtDlpImport(
        c.req.param('id'),
        c.req.valid('json'),
      );
      return c.json({ job }, 202);
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

videoRoutes.get('/projects/:id/sources', async (c) => {
  try {
    return c.json({ sources: await listSources(c.req.param('id')) });
  } catch (error) {
    return jsonError(c, error);
  }
});

videoRoutes.post('/projects/:id/sources/:sourceId/analyze', async (c) => {
  try {
    return c.json(
      await analyzeSource(c.req.param('id'), c.req.param('sourceId')),
    );
  } catch (error) {
    return jsonError(c, error);
  }
});

videoRoutes.get('/projects/:id/sources/:sourceId/analysis', async (c) => {
  try {
    return c.json({
      analysis: await getSourceAnalysis(
        c.req.param('id'),
        c.req.param('sourceId'),
      ),
    });
  } catch (error) {
    return jsonError(c, error);
  }
});

videoRoutes.post(
  '/projects/:id/sources/:sourceId/cut-plan',
  zValidator('json', cutPlanSchema),
  async (c) => {
    try {
      return c.json(
        await createCutPlan(
          c.req.param('id'),
          c.req.param('sourceId'),
          c.req.valid('json'),
        ),
        201,
      );
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

videoRoutes.post('/projects/:id/cut-plans/:cutPlanId/apply', async (c) => {
  try {
    return c.json(
      await applyCutPlan(c.req.param('id'), c.req.param('cutPlanId')),
    );
  } catch (error) {
    return jsonError(c, error);
  }
});

videoRoutes.post(
  '/projects/:id/render',
  zValidator('json', renderRequestSchema),
  async (c) => {
    try {
      const body = c.req.valid('json');
      const aspectRatio = body.aspectRatios?.[0] ?? '16:9';
      return c.json({
        render: await renderProject(c.req.param('id'), {
          aspectRatio,
          mode: body.mode ?? 'speed',
          renderer: body.renderer,
          captionMode: body.captionMode,
          where: body.where,
          renderProviderId: body.renderProviderId,
          cloudEgressConfirmed: body.cloudEgressConfirmed,
          loudnessTargetLufs: body.loudnessTargetLufs,
          autoColorEnabled: body.autoColor,
          autoReframeEnabled: body.autoReframe,
        }),
      });
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

videoRoutes.post(
  '/projects/:id/render-queue',
  zValidator('json', renderRequestSchema),
  async (c) => {
    try {
      const body = c.req.valid('json');
      const job = await enqueueRenderJob(c.req.param('id'), {
        aspectRatios: body.aspectRatios,
        mode: body.mode,
        renderer: body.renderer,
        captionMode: body.captionMode,
        where: body.where,
        renderProviderId: body.renderProviderId,
        cloudEgressConfirmed: body.cloudEgressConfirmed,
        loudnessTargetLufs: body.loudnessTargetLufs,
        autoColorEnabled: body.autoColor,
        autoReframeEnabled: body.autoReframe,
      });
      return c.json({ job }, 202);
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

videoRoutes.get('/render-queue', (c) => {
  try {
    return c.json({
      jobs: listRenderJobs(c.req.query('projectId') ?? undefined),
    });
  } catch (error) {
    return jsonError(c, error);
  }
});

videoRoutes.delete('/render-queue/:jobId', (c) => {
  try {
    return c.json({ job: cancelVideoJob(c.req.param('jobId')) });
  } catch (error) {
    return jsonError(c, error);
  }
});

videoRoutes.post(
  '/projects/:id/editor-handoff',
  zValidator('json', editorHandoffRequestSchema),
  async (c) => {
    try {
      const body = c.req.valid('json');
      const job = await enqueueEditorHandoffJob(c.req.param('id'), {
        targets: body.targets,
        mediaMode: body.mediaMode,
      });
      return c.json({ job }, 202);
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

videoRoutes.get('/projects/:id/editor-handoff/:jobId', async (c) => {
  try {
    await getProject(c.req.param('id'));
    let job;
    try {
      job = getVideoJob(c.req.param('jobId'));
    } catch (error) {
      if (error instanceof Error && error.message === 'Video job not found') {
        return c.json({ error: 'Editor handoff job not found' }, 404);
      }
      throw error;
    }
    if (job.projectId !== c.req.param('id') || job.kind !== 'editor-handoff') {
      return c.json({ error: 'Editor handoff job not found' }, 404);
    }
    return c.json({
      job,
      packagePath:
        typeof job.result?.packagePath === 'string'
          ? job.result.packagePath
          : undefined,
      packageDir:
        typeof job.result?.packageDir === 'string'
          ? job.result.packageDir
          : undefined,
      conformance: job.result?.conformance,
    });
  } catch (error) {
    return jsonError(c, error);
  }
});

// Phase 6 M4 — resumable render progress stream. A browser EventSource resumes
// automatically on reconnect by sending `Last-Event-ID`; the server replays only
// events with `seq > lastEventId` from the bus buffer, then streams live ones.
// Native EventSource cannot set the header on the first connect, so a `?from=`
// query is also honoured.
videoRoutes.get(
  '/projects/:id/render/subscribe',
  zValidator('param', z.object({ id: z.string().min(1).max(200) })),
  async (c) => {
    const projectId = c.req.valid('param').id;
    // Match every other project-scoped route: 404 on an unknown id instead of
    // opening a stream that immediately returns `idle`.
    try {
      await getProject(projectId);
    } catch (error) {
      return jsonError(c, error);
    }

    const lastEventId = parseSSECursor(
      c.req.query('from') ?? c.req.header('Last-Event-ID'),
    );
    const seqBounds = getRenderStreamSeqBounds(projectId);
    const canReplayFromCursor =
      lastEventId !== null &&
      seqBounds.minSeq !== null &&
      lastEventId >= seqBounds.minSeq - 1;

    // Disable nginx/proxy buffering so progress events flush immediately —
    // without this a reverse proxy holds the stream until its buffer fills.
    c.header('X-Accel-Buffering', 'no');
    return streamSSE(c, async (stream) => {
      let resolveDone: () => void = () => {};
      const done = new Promise<void>((resolve) => {
        resolveDone = resolve;
      });
      let replaying = true;
      let sawTerminal = false;

      const unsubscribe = subscribeRenderStream(
        projectId,
        (message, event) => {
          void stream
            .writeSSE({ id: String(event.seq), data: JSON.stringify(message) })
            .catch(() => resolveDone());
          if (message.type === 'done' || message.type === 'error') {
            sawTerminal = true;
            if (!replaying) resolveDone();
          }
        },
        canReplayFromCursor ? { afterSeq: lastEventId } : undefined,
      );
      replaying = false;

      // If the render already finished, close after replay. Guard the race where
      // it completes between subscribe() and this check.
      if (!isRenderStreamActive(projectId) || sawTerminal) {
        if (!sawTerminal && getRenderStreamBufferSize(projectId) === 0) {
          await stream.writeSSE({ data: JSON.stringify({ type: 'idle' }) });
        }
        unsubscribe();
        return;
      }

      stream.onAbort(() => {
        unsubscribe();
        resolveDone();
      });
      await done;
      unsubscribe();
    });
  },
);

videoRoutes.post(
  '/projects/:id/share',
  zValidator('json', shareRequestSchema),
  async (c) => {
    try {
      const share = await shareVideoProject(
        c.req.param('id'),
        c.req.valid('json'),
      );
      return c.json({ share });
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

videoRoutes.get('/projects/:id/render/status', async (c) => {
  try {
    return c.json({ render: await getRenderStatus(c.req.param('id')) });
  } catch (error) {
    return jsonError(c, error);
  }
});

videoRoutes.post('/projects/:id/render/cancel', async (c) => {
  try {
    return c.json({ render: await cancelRender(c.req.param('id')) });
  } catch (error) {
    return jsonError(c, error);
  }
});

videoRoutes.post(
  '/projects/:id/tts/preview',
  zValidator('json', ttsPreviewSchema),
  async (c) => {
    try {
      return c.json(
        await synthesizeTtsPreview(c.req.param('id'), c.req.valid('json')),
        201,
      );
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

videoRoutes.post(
  '/projects/:id/tts/batch',
  zValidator('json', ttsBatchSchema),
  async (c) => {
    try {
      return c.json(
        await synthesizeStoryboardNarration(
          c.req.param('id'),
          c.req.valid('json'),
        ),
        201,
      );
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

videoRoutes.post(
  '/projects/:id/transcribe',
  zValidator('json', transcribeSchema),
  async (c) => {
    try {
      const body = c.req.valid('json');
      return c.json(
        await transcribeAsset(c.req.param('id'), body.assetId, body.engine),
      );
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

videoRoutes.post(
  '/projects/:id/captions/sync',
  zValidator('json', captionSyncSchema),
  async (c) => {
    try {
      return c.json(await syncCaptions(c.req.param('id'), c.req.valid('json')));
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

videoRoutes.patch(
  '/projects/:id/captions/:captionId',
  zValidator('json', captionPatchSchema),
  async (c) => {
    try {
      return c.json(
        await patchCaption(
          c.req.param('id'),
          c.req.param('captionId'),
          c.req.valid('json'),
        ),
      );
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

videoRoutes.post(
  '/projects/:id/captions/:captionId/split',
  zValidator('json', captionSplitSchema),
  async (c) => {
    try {
      return c.json(
        await splitCaption(
          c.req.param('id'),
          c.req.param('captionId'),
          c.req.valid('json').wordIndex,
        ),
      );
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

videoRoutes.post('/projects/:id/captions/:captionId/merge', async (c) => {
  try {
    return c.json(
      await mergeCaption(c.req.param('id'), c.req.param('captionId')),
    );
  } catch (error) {
    return jsonError(c, error);
  }
});

videoRoutes.post('/projects/:id/captions/relink', async (c) => {
  try {
    return c.json(await syncCaptions(c.req.param('id'), { regenerate: true }));
  } catch (error) {
    return jsonError(c, error);
  }
});

videoRoutes.post(
  '/projects/:id/broll/search',
  zValidator('json', brollSearchSchema),
  async (c) => {
    try {
      return c.json({ hits: await searchBroll(c.req.valid('json')) });
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

videoRoutes.post(
  '/projects/:id/broll/download',
  zValidator('json', brollDownloadSchema),
  async (c) => {
    try {
      return c.json(
        await downloadBrollHit(c.req.param('id'), c.req.valid('json').hit),
        201,
      );
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

videoRoutes.post(
  '/projects/:id/music/generate',
  zValidator('json', musicSchema),
  async (c) => {
    try {
      return c.json(
        await generateBackgroundMusic(c.req.param('id'), c.req.valid('json')),
        201,
      );
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

videoRoutes.post(
  '/projects/:id/music/select',
  zValidator('json', musicSelectSchema),
  async (c) => {
    try {
      return c.json(
        await selectBackgroundMusic(c.req.param('id'), c.req.valid('json')),
        201,
      );
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

videoRoutes.post(
  '/projects/:id/reframe',
  zValidator('json', reframeSchema),
  async (c) => {
    try {
      return c.json(
        await reframeProject(
          c.req.param('id'),
          c.req.valid('json').aspectRatio,
        ),
      );
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

videoRoutes.post('/projects/:id/eval', async (c) => {
  try {
    return c.json(await runVideoEvalReport(c.req.param('id')));
  } catch (error) {
    return jsonError(c, error);
  }
});

videoRoutes.get('/projects/:id/usage', (c) => {
  try {
    return c.json({ usage: getProjectVideoUsage(c.req.param('id')) });
  } catch (error) {
    return jsonError(c, error);
  }
});

videoRoutes.get('/usage', (c) => {
  try {
    return c.json({
      usage: getGlobalVideoUsage(c.req.query('since') ?? undefined),
    });
  } catch (error) {
    return jsonError(c, error);
  }
});

videoRoutes.get('/jobs', (c) => {
  try {
    return c.json({
      jobs: listVideoJobs(c.req.query('projectId') ?? undefined),
    });
  } catch (error) {
    return jsonError(c, error);
  }
});

videoRoutes.post('/jobs/:id/cancel', (c) => {
  try {
    return c.json({ job: cancelVideoJob(c.req.param('id')) });
  } catch (error) {
    return jsonError(c, error);
  }
});

videoRoutes.post('/jobs/:id/retry', async (c) => {
  try {
    return c.json({ job: await retryVideoJob(c.req.param('id')) });
  } catch (error) {
    return jsonError(c, error);
  }
});

videoRoutes.get('/render-providers', (c) => {
  try {
    return c.json({ providers: listRenderProviderConfigs() });
  } catch (error) {
    return jsonError(c, error);
  }
});

videoRoutes.post(
  '/render-providers',
  zValidator('json', renderProviderUpsertSchema),
  (c) => {
    try {
      return c.json(
        { provider: upsertRenderProviderConfig(c.req.valid('json')) },
        201,
      );
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

videoRoutes.post('/render-providers/:id/test', async (c) => {
  try {
    return c.json(await testRenderProvider(c.req.param('id')));
  } catch (error) {
    return jsonError(c, error);
  }
});

videoRoutes.delete('/render-providers/:id', (c) => {
  try {
    return c.json({ deleted: deleteRenderProviderConfig(c.req.param('id')) });
  } catch (error) {
    return jsonError(c, error);
  }
});

videoRoutes.get('/providers', (c) => {
  try {
    return c.json({ providers: listProviderConfigs() });
  } catch (error) {
    return jsonError(c, error);
  }
});

videoRoutes.get('/providers/:id', (c) => {
  try {
    return c.json({
      provider: getProviderConfig(c.req.param('id') as ProviderId),
    });
  } catch (error) {
    return jsonError(c, error);
  }
});

videoRoutes.put(
  '/providers/:id',
  zValidator('json', providerUpdateSchema),
  (c) => {
    try {
      const updates = c.req.valid('json');
      return c.json({
        provider: upsertProviderConfig(c.req.param('id') as ProviderId, {
          enabled: updates.enabled,
          providerSettingId: updates.providerSettingId ?? undefined,
          defaultCostCentsPerSec: updates.defaultCostCentsPerSec,
          settings: updates.settings,
        }),
      });
    } catch (error) {
      return jsonError(c, error);
    }
  },
);

videoRoutes.post('/providers/:id/test', (c) => {
  const config = getProviderConfig(c.req.param('id') as ProviderId);
  return c.json({
    ok: config.enabled,
    providerId: config.providerId,
    message: config.enabled ? 'provider-enabled' : 'provider-disabled',
  });
});
