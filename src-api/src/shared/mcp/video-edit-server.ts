/**
 * Video Mode edit MCP server.
 *
 * This request-scoped surface exposes compact read tools and the journaled
 * project mutation tools used by the agentic runtime.
 */

import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import {
  ContentGraphSchema,
  CLIP_EFFECT_CATALOG,
  ClipEffectInputSchema,
  ClipEffectStackSchema,
  clipEffectFromInput,
  deriveBeatTimelinePoints,
  deriveTimelineClipFrameFields,
  durationMsToFrames,
  KeyframeSchema,
  KeyframeTrackSchema,
  KeyframeablePropertySchema,
  normalizeFrameRate,
  TimelineOpSchema,
  VIVID_OVERLAY_MOTION_TEMPLATE_IDS,
  VIVID_OVERLAY_MOTION_TEMPLATE_STRENGTHS,
} from '@neumar/video-ir';
import type {
  BeatGridArtifact,
  ClipEffect,
  ClipEffectStack,
  FrameRate,
  TimelineOp,
  VividOverlayPresetDef,
} from '@neumar/video-ir';
import { z } from 'zod';

import { validatePath } from '@/shared/services/ffmpeg';
import { getSessionContext } from '@/shared/services/session-context';
import { createLogger } from '@/shared/utils/logger';
import {
  applyVideoAgentTool,
  buildTimelineEditToolOps,
  clipInterpolationQualitySchema,
  clipPlaybackTimingPolicySchema,
  clipTransformSchema,
  cutRetainSchema,
  duplicatePlacementSchema,
  editLinkPolicySchema,
  isTimelineEditAgentToolCall,
  redoVideoAgentJournalEntry,
  undoVideoAgentJournalEntry,
} from '@/shared/video/agent-tools';
import type {
  TimelineEditAgentToolCall,
  VideoAgentToolCall,
  VideoAgentToolName,
} from '@/shared/video/agent-tools';
import { analyzeSourceBeats } from '@/shared/video/analysis/beats';
import { analyzeClipGradeImage } from '@/shared/video/analysis/clip-grade';
import {
  indexProjectFrames,
  searchProjectFrames,
} from '@/shared/video/analysis/frame-index';
import { analyzeProjectAssets } from '@/shared/video/asset-aspect';
import {
  generateVideoAudio,
  transformVideoAudio,
} from '@/shared/video/audio-generation';
import { generateProjectCaptions } from '@/shared/video/caption-generate';
import {
  hydrateReferencedProjectAssets,
  hydrateProjectAsset,
  isReferencedProjectAsset,
} from '@/shared/video/catalog-assets';
import { setFrameNativeEnhancement } from '@/shared/video/content-graph/native-enhancement';
import {
  pruneStaleFrameOverrides,
  readContentGraph,
  selectTemplate,
  writeContentGraph,
  writeFrameHtml,
} from '@/shared/video/content-graph/persistence';
import { normalizeCssColor } from '@/shared/video/css-colors';
import {
  buildCurrentVideoContext,
  CURRENT_VIDEO_CONTEXT_INCLUDES,
} from '@/shared/video/editor-context';
import { buildEditorHandoffModel } from '@/shared/video/editor-handoff/build-model';
import { evaluateHandoffConformance } from '@/shared/video/editor-handoff/conformance';
import { listVideoEnginesWithBuiltins } from '@/shared/video/engines';
import { getVideoFeatureFlag } from '@/shared/video/flags';
import {
  getHyperframesStudioBridge,
  HyperframesStudioError,
  resolveHyperframesStudioProjectDir,
} from '@/shared/video/hyperframes-studio';
import { analyzeImageFocalPoint } from '@/shared/video/image-analysis';
import { enqueueEditorHandoffJob } from '@/shared/video/jobs';
import {
  attachLinkedAsset,
  searchLinkedAssets,
} from '@/shared/video/linked-sources';
import {
  applyNarrationDraft,
  getNarrationFrames,
  NarrationDraftError,
} from '@/shared/video/narration-draft';
import { vividOverlayContextSummary } from '@/shared/video/overlays/context-summary';
import {
  findVividOverlayPreset,
  VIDEO_OVERLAY_REGISTRY,
} from '@/shared/video/overlays/registry';
import {
  saveUserOverlayDocument,
  UserOverlayDocumentError,
} from '@/shared/video/overlays/user-documents';
import { saveUserOverlayPreset } from '@/shared/video/overlays/user-presets';
import {
  saveUserOverlayStyle,
  UserOverlayStyleError,
} from '@/shared/video/overlays/user-styles';
import { cancelRender, renderProject } from '@/shared/video/pipeline';
import { importYoutubeBroll } from '@/shared/video/plugins/atoms/broll/youtube';
import { recordVideoResearchBrief } from '@/shared/video/plugins/atoms/research';
import { withProjectLock } from '@/shared/video/project-lock';
import { recordVideoIntentLog } from '@/shared/video/recipes';
import { renderTimelineFramesWithRemotion } from '@/shared/video/remotion-renderer';
import { shareVideoProject } from '@/shared/video/share';
import { fetchSource, SourceIngestError } from '@/shared/video/source/ingest';
import { buildSourceProvenance } from '@/shared/video/source/provenance';
import {
  approveStoryboard,
  getProject,
  getVideoProjectRoot,
  getVideoProjectJsonPath,
  getVideoWorkspaceRoot,
  setVideoProjectAspectRatio,
  updateProjectDocument,
  writeProject,
} from '@/shared/video/store';
import { saveProjectAsTemplate } from '@/shared/video/templates/agent-bridge';
import {
  loadTemplateGallery,
  resolveDefaultTemplateGalleryRoots,
} from '@/shared/video/templates/gallery-loader';
import {
  inspectTemplate,
  searchTemplates,
} from '@/shared/video/templates/search';
import {
  migrateStoryboardToTimeline,
  rebuildTimelineFromStoryboard,
} from '@/shared/video/timeline';
import { proposeProjectTimelineOps } from '@/shared/video/timeline-ops';
import {
  buildTimelineWindow,
  findTimelineClips,
} from '@/shared/video/timeline-window';
import { transitionQualityEntry } from '@/shared/video/transition-quality';
import {
  deriveTimelineTransitionSeams,
  findTimelineTransitionSeam,
  resolveTimelineTransitionForSeam,
} from '@/shared/video/transition-seams';
import type {
  TimelineTransitionResolution,
  TimelineTransitionSeamView,
} from '@/shared/video/transition-seams';
import {
  normalizeTransition,
  VIDEO_TRANSITION_REGISTRY,
} from '@/shared/video/types';
import type {
  AspectRatio,
  MediaItem,
  Scene,
  StoryboardScene,
  TimelineClip,
  TimelineTransition,
  TimelineTrack,
  TransitionKind,
  VideoExportDestination,
  VideoEditorSelectionContext,
  VideoProject,
} from '@/shared/video/types';

const logger = createLogger('VideoEditMCP');
const DEFAULT_TIMELINE_FPS = 30;

const OVERLAY_CONTROL_VALUE_SCHEMA = z.union([
  z.string(),
  z.number(),
  z.boolean(),
]);

const OVERLAY_STYLE_TRANSFORM_SCHEMA = z
  .object({
    scale: z.number().finite().optional(),
    scaleX: z.number().finite().optional(),
    scaleY: z.number().finite().optional(),
    positionX: z.number().finite().optional(),
    positionY: z.number().finite().optional(),
    opacity: z.number().finite().optional(),
    rotation: z.number().finite().optional(),
  })
  .strict();

const USER_OVERLAY_DOCUMENT_CONTROL_SCHEMA = z
  .object({
    id: z.string().min(1).max(80),
    type: z.enum(['number', 'color', 'text', 'select', 'toggle']),
    label: z.string().min(1).max(120),
    defaultValue: OVERLAY_CONTROL_VALUE_SCHEMA,
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
    step: z.number().positive().optional(),
    options: z.array(z.string().min(1).max(80)).max(40).optional(),
  })
  .strict();

export const VIDEO_EDIT_TOOL_NAMES = [
  'video_get_project_summary',
  'video_get_current_context',
  'video_get_scene',
  'video_get_timeline',
  'video_get_timeline_window',
  'video_inspect_timeline_frames',
  'video_find_clips',
  'video_list_assets',
  'video_describe_scene',
  'video_list_transition_presets',
  'video_list_effect_presets',
  'video_list_overlay_presets',
  'video_save_overlay_preset',
  'video_save_overlay_style_from_template',
  'video_save_user_overlay_document',
  'video_get_transition_seams',
  'video_list_engines',
  'video_get_html_selection',
  'video_search_templates',
  'video_list_custom_templates',
  'video_inspect_template',
  'video_fetch_source',
  'video_record_research_brief',
  'video_get_content_graph',
  'video_analyze_image',
  'video_set_aspect_ratio',
  'video_analyze_assets',
  'video_import_youtube',
  'video_select_template',
  'video_save_as_template',
  'video_write_content_graph',
  'video_write_frame_html',
  'video_set_frame_native_enhancement',
  'video_draft_narration',
  'video_estimate_plan',
  'video_add_scene',
  'video_split_scene',
  'video_remove_scene',
  'video_reorder_scenes',
  'video_set_duration',
  'video_set_transition',
  'video_set_timeline_transition',
  'video_update_timeline_transition',
  'video_remove_timeline_transition',
  'video_suggest_timeline_transitions',
  'video_set_timeline_bookend',
  'video_clear_timeline_bookend',
  'video_set_clip_audio_seam',
  'video_set_keyframes',
  'video_apply_capture_to_timeline',
  'video_propose_timeline_ops',
  'video_apply_timeline_op',
  'video_apply_timeline_ops',
  'video_cut_clip',
  'video_cut_range',
  'video_duplicate_clips',
  'video_delete_clips',
  'video_move_clips',
  'video_set_clip_speed',
  'video_reverse_clip',
  'video_rotate_clip',
  'video_flip_clip',
  'video_set_clip_transform',
  'video_set_clip_effects',
  'video_analyze_clip_grade',
  'video_detect_beats',
  'video_snap_cuts_to_beats',
  'video_set_overlay_controls',
  'video_set_overlay_control_keyframes',
  'video_apply_overlay_motion_template',
  'video_set_clip_params',
  'video_close_gap',
  'video_set_audio_clip_gain',
  'video_set_audio_clip_mute',
  'video_set_audio_clip_fade',
  'video_set_audio_track_volume',
  'video_set_audio_track_mute',
  'video_set_audio_transition',
  'video_crossfade_audio_clips',
  'video_set_audio_volume_keyframes',
  'video_replace_audio_clip_source',
  'video_get_handoff_conformance',
  'video_export_editor_handoff',
  'video_undo_timeline_op',
  'video_redo_timeline_op',
  'video_set_caption',
  'video_regenerate_scene',
  'video_generate_broll',
  'video_generate_audio',
  'video_transform_audio',
  'video_generate_voiceover',
  'video_generate_music',
  'video_trim_clip',
  'video_remove_filler_words',
  'video_tighten_pacing',
  'video_duck_audio',
  'video_add_captions',
  'video_generate_captions',
  'video_add_lower_third',
  'video_reframe',
  'video_restyle',
  'video_translate',
  'video_verify_render',
  'video_search_assets',
  'video_search_frames',
  'video_rank_moments',
  'video_attach_asset',
  'video_approve_storyboard',
  'video_render',
  'video_cancel_render',
  'video_publish_to',
] as const;

export interface VideoEditServerOptions {
  projectId?: string;
  selectedSceneId?: string;
  aspectRatio?: AspectRatio | string;
  editorSelection?: VideoEditorSelectionContext;
  clientKind?: 'first-party' | 'external-mcp';
  mutationMode?: 'apply' | 'proposal-only';
  // Whether video_import_youtube may download. Defaults to allowed (the trusted
  // first-party agent path). A plugin run passes false unless its manifest was
  // granted network:youtube, so a plugin cannot bypass the capability gate.
  youtubeImportGranted?: boolean;
}

const PROJECT_ID_SCHEMA = z
  .string()
  .min(1)
  .optional()
  .describe('Video project id. Defaults to the active session project.');
const REASONING_SCHEMA = z
  .string()
  .min(1)
  .optional()
  .describe('Short rationale for the edit.');
const ASPECT_RATIO_SCHEMA = z.enum(['16:9', '9:16', '1:1', '4:5']);
const BOOKEND_POSITION_SCHEMA = z.enum(['intro', 'outro']);
const AUDIO_SEAM_SCHEMA = z.enum(['follow', 'cut']);
const PROVIDER_KIND_SCHEMA = z.enum(['image', 'video', 'audio']);
const EXPORT_DESTINATION_SCHEMA = z.enum([
  'download-mp4',
  'youtube',
  'tiktok',
  'slack',
  'discord',
  'telegram',
  'lark',
]);
const LANGUAGE_SCHEMA = z.enum(['en', 'zh', 'es', 'fr', 'hi', 'pt']);
const RENDER_PRESET_SCHEMA = z.enum(['draft', 'standard', 'high']);
const RENDER_WHERE_SCHEMA = z.enum(['local', 'cloud']);
const CURRENT_CONTEXT_INCLUDE_SCHEMA = z.enum(CURRENT_VIDEO_CONTEXT_INCLUDES);
const EDITOR_HANDOFF_TARGET_SCHEMA = z.enum([
  'neuma-package',
  'final-cut-pro',
  'premiere-pro',
  'resolve',
  'otio',
  'edl',
  'capcut-fallback',
]);
const EDITOR_HANDOFF_MEDIA_MODE_SCHEMA = z.enum(['copy', 'link']);
type EditorHandoffTargetInput = z.infer<typeof EDITOR_HANDOFF_TARGET_SCHEMA>;
const TIMELINE_PROPOSAL_APPLY_MODE_SCHEMA = z.enum([
  'suggest',
  'auto',
  'review-each',
]);
const NAMED_EDIT_APPLY_MODE_SCHEMA = z.enum(['auto', 'apply', 'propose']);
const EDIT_LINK_POLICY_SCHEMA = editLinkPolicySchema;
const CUT_RETAIN_SCHEMA = cutRetainSchema;
const CLIP_PLAYBACK_TIMING_POLICY_SCHEMA = clipPlaybackTimingPolicySchema;
const CLIP_INTERPOLATION_QUALITY_SCHEMA = clipInterpolationQualitySchema;
const DUPLICATE_PLACEMENT_SCHEMA = duplicatePlacementSchema;
const CLIP_TRANSFORM_SCHEMA = clipTransformSchema;
const AUDIO_FADE_CURVE_SCHEMA = z.enum([
  'linear',
  'equal-power',
  'ease-in-out',
]);
const GENERATED_AUDIO_KIND_SCHEMA = z.enum([
  'music',
  'sfx',
  'ambience',
  'voiceover',
]);
const GENERATED_AUDIO_PROVIDER_SCHEMA = z.enum([
  'elevenlabs-music',
  'stable-audio',
  'minimax-music',
  'kokoro',
  'elevenlabs',
  'cartesia',
  'openai-tts',
  'gemini-tts',
  'hume-octave',
  'indextts',
]);
const AUDIO_TRANSFORM_MODE_SCHEMA = z.enum([
  'cleanup',
  'extend',
  'remix',
  'replace',
  'voiceover',
  'sfx',
]);
const AUDIO_TRANSITION_SCHEMA = z
  .object({
    kind: z.enum(['cut', 'crossfade']),
    durationMs: z.number().int().min(0),
    curve: AUDIO_FADE_CURVE_SCHEMA.optional(),
  })
  .strict();
const SUBTITLE_STYLE_SCHEMA = z
  .object({
    fontFamily: z.string().min(1).optional(),
    fontSize: z.number().int().min(8).max(128).optional(),
    color: z.string().min(1).optional(),
    background: z.string().min(1).optional(),
    position: z.enum(['top', 'middle', 'bottom']).optional(),
    animation: z
      .enum(['none', 'tiktok-word', 'hormozi-bold', 'classic', 'karaoke'])
      .optional(),
  })
  .strict();
const TRANSITION_SCHEMA = z.union([
  z.string().min(1),
  z
    .object({
      kind: z.string().min(1),
      durationMs: z.number().int().min(33).max(3000).optional(),
      direction: z
        .enum(['from-left', 'from-right', 'from-top', 'from-bottom'])
        .optional(),
    })
    .strict(),
]);
const PREVIEW_RANGE_SCHEMA = z
  .object({
    startMs: z.number().int().min(0),
    endMs: z.number().int().positive(),
  })
  .strict()
  .refine((range) => range.endMs > range.startMs, {
    message: 'Preview range end must be after start',
    path: ['endMs'],
  });
const TIMELINE_FRAME_INSPECT_INPUT_SCHEMA = z
  .object({
    projectId: PROJECT_ID_SCHEMA,
    startMs: z.number().int().min(0),
    endMs: z.number().int().positive(),
    frameCount: z.number().int().min(1).max(8).optional(),
    aspectRatio: ASPECT_RATIO_SCHEMA.optional(),
    maxEdgePx: z.number().int().min(64).max(1024).optional(),
  })
  .strict()
  .refine((range) => range.endMs > range.startMs, {
    message: 'endMs must be after startMs',
    path: ['endMs'],
  });
const RESEARCH_CITATION_SCHEMA = z
  .object({
    title: z.string().min(1).max(240),
    url: z.string().url(),
    fetchedAt: z.string().min(1).optional(),
  })
  .strict();
const TIMELINE_RESOLVER_REFS_SCHEMA = z
  .object({
    selectionClipIds: z.array(z.string().min(1)).min(1).optional(),
    transcriptSelection: z
      .object({
        clipId: z.string().min(1).optional(),
        startMs: z.number().int().min(0),
        endMs: z.number().int().positive(),
        text: z.string().optional(),
      })
      .strict()
      .refine((range) => range.endMs > range.startMs, {
        message: 'Transcript selection endMs must be after startMs',
        path: ['endMs'],
      })
      .optional(),
  })
  .strict();
type TimelineResolverRefs = z.infer<typeof TIMELINE_RESOLVER_REFS_SCHEMA>;
const VIDEO_TEMPLATE_CATEGORY_SCHEMA = z.enum([
  'shorts',
  'explainer',
  'ad',
  'tutorial',
  'product',
  'podcast',
  'testimonial',
  'recap',
  'announcement',
  'other',
  'custom',
]);
const VIDEO_TEMPLATE_LICENSE_SCHEMA = z.enum(['CC0', 'CC-BY', 'proprietary']);
const VIDEO_TOOL_TIMEOUT_MS = 45_000;

function textResult(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

function jsonResult(value: unknown) {
  return textResult(JSON.stringify(value, null, 2));
}

function errorResult(message: string) {
  return { ...textResult(message), isError: true };
}

function withToolTimeout<T>(
  toolName: string,
  run: () => Promise<T>,
  timeoutMs = VIDEO_TOOL_TIMEOUT_MS,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(
      () => reject(new Error(`${toolName} timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    Promise.resolve()
      .then(run)
      .then(
        (result) => {
          clearTimeout(timeoutId);
          resolve(result);
        },
        (error: unknown) => {
          clearTimeout(timeoutId);
          reject(error);
        },
      );
  });
}

function clampLimit(limit: number | undefined, defaultLimit: number): number {
  return Math.min(Math.max(limit ?? defaultLimit, 1), 100);
}

function truncate(
  value: string | undefined,
  maxLength = 240,
): string | undefined {
  if (!value) return undefined;
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function activeContext(options: VideoEditServerOptions) {
  const session = getSessionContext();
  return {
    projectId: options.projectId ?? session?.videoProjectId,
    selectedSceneId: options.selectedSceneId ?? session?.selectedSceneId,
    aspectRatio: options.aspectRatio ?? session?.aspectRatio,
    editorSelection: options.editorSelection ?? session?.editorSelection,
  };
}

function activeWorkspaceRoot(options: VideoEditServerOptions): string {
  const projectId = activeContext(options).projectId;
  return projectId ? getVideoProjectRoot(projectId) : getVideoWorkspaceRoot();
}

function resolveAspectRatio(
  value: AspectRatio | string | undefined,
): AspectRatio | undefined {
  return value === '16:9' ||
    value === '9:16' ||
    value === '1:1' ||
    value === '4:5'
    ? value
    : undefined;
}

function resolveProjectId(
  inputProjectId: string | undefined,
  options: VideoEditServerOptions,
): string {
  const projectId = inputProjectId ?? activeContext(options).projectId;
  if (!projectId) {
    throw new Error('No video project id was provided for this MCP call.');
  }
  return projectId;
}

async function readProjectSnapshot(projectId: string): Promise<VideoProject> {
  const raw = await fs.readFile(getVideoProjectJsonPath(projectId), 'utf8');
  return migrateStoryboardToTimeline(JSON.parse(raw) as VideoProject);
}

async function loadProjectForTool(
  inputProjectId: string | undefined,
  options: VideoEditServerOptions,
): Promise<VideoProject> {
  return readProjectSnapshot(resolveProjectId(inputProjectId, options));
}

async function applyVideoToolCall(
  inputProjectId: string | undefined,
  options: VideoEditServerOptions,
  call: VideoAgentToolCall,
) {
  const projectId = resolveProjectId(inputProjectId, options);
  return withProjectLock(projectId, async () => {
    const previousProject = await getProject(projectId);
    const previouslyUsedReferencedAssets = new Set(
      usedReferencedAssetIds(previousProject),
    );
    let execution = applyVideoAgentTool(previousProject, call);
    // Persist the project to disk first; only record the intent log after
    // the write succeeds so we don't leave phantom accepted rows pointing at
    // a project state that was never committed.
    await writeProject(execution.project);
    const referencedAssetIds = usedReferencedAssetIds(execution.project).filter(
      (assetId) => !previouslyUsedReferencedAssets.has(assetId),
    );
    if (referencedAssetIds.length > 0) {
      const hydrated = await hydrateReferencedProjectAssets(
        projectId,
        referencedAssetIds,
        { role: 'asset' },
      );
      execution = { ...execution, project: hydrated.project };
    }
    if (call.name === 'proposeTimelineOps') {
      try {
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
      } catch (logError) {
        // Don't fail the agent turn because of a non-critical intent-log
        // write — the project state is already persisted.
        logger.warn('video.intent_log.record_failed', {
          projectId,
          error:
            logError instanceof Error ? logError.message : String(logError),
        });
      }
    }
    return execution;
  });
}

function usedReferencedAssetIds(project: VideoProject): string[] {
  const ids = new Set<string>();
  const add = (assetId: string | undefined) => {
    if (!assetId) return;
    const asset = project.assets.find((item) => item.id === assetId);
    if (asset && isReferencedProjectAsset(asset)) ids.add(asset.id);
  };

  for (const scene of project.storyboard?.scenes ?? []) {
    if (
      scene.assetPlan.kind === 'existing' ||
      scene.assetPlan.kind === 'image-pan'
    ) {
      add(scene.assetPlan.assetId);
    }
  }
  if (project.storyboard?.music?.assetId) add(project.storyboard.music.assetId);
  if (project.storyboard?.narration?.assetId) {
    add(project.storyboard.narration.assetId);
  }
  for (const track of project.timeline?.tracks ?? []) {
    for (const clip of track.clips) {
      if (clip.sourceRef.kind === 'asset') add(clip.sourceRef.assetId);
    }
  }
  for (const scene of project.scenes ?? []) {
    for (const clip of scene.clips) add(clip.mediaId);
  }

  return [...ids];
}

async function applyJournalUndoRedo(
  inputProjectId: string | undefined,
  options: VideoEditServerOptions,
  entryId: string,
  direction: 'undo' | 'redo',
) {
  const projectId = resolveProjectId(inputProjectId, options);
  return withProjectLock(projectId, async () => {
    const current = await getProject(projectId);
    const execution =
      direction === 'undo'
        ? undoVideoAgentJournalEntry(current, entryId)
        : redoVideoAgentJournalEntry(current, entryId);
    await writeProject(execution.project);
    return execution;
  });
}

/**
 * Narrow a VideoAgentToolExecution to a small acknowledgement payload.
 *
 * The full execution object contains the entire VideoProject document, which
 * can be 50–200 KB after timeline ops, agent journal, and asset lists. The
 * MCP tool result feeds straight into the model context — emitting the full
 * project every mutation floods the conversation and triggers
 * tool-result-limiter truncation. Callers that need fresh state must call a
 * read tool (video_get_project_summary, video_get_scene, …) on the next turn.
 */
function mutationResult(execution: {
  project: { id: string; updatedAt?: string };
  entry: { id: string; tool: string; result?: unknown; ts: string };
}) {
  return jsonResult(mutationPayload(execution));
}

function mutationPayload(execution: {
  project: { id: string; updatedAt?: string };
  entry: { id: string; tool: string; result?: unknown; ts: string };
}) {
  return {
    projectId: execution.project.id,
    updatedAt: execution.project.updatedAt ?? execution.entry.ts,
    entryId: execution.entry.id,
    tool: execution.entry.tool,
    result: execution.entry.result,
  };
}

function toolCallResult(
  inputProjectId: string | undefined,
  options: VideoEditServerOptions,
  call: VideoAgentToolCall,
) {
  return withToolTimeout(call.name, async () => {
    const proposal = await proposalOnlyToolResult(
      inputProjectId,
      options,
      call,
    );
    if (proposal) return proposal;
    return mutationResult(
      await applyVideoToolCall(inputProjectId, options, call),
    );
  }).catch((error) =>
    errorResult(error instanceof Error ? error.message : String(error)),
  );
}

async function proposalOnlyToolResult(
  inputProjectId: string | undefined,
  options: VideoEditServerOptions,
  call: VideoAgentToolCall,
): Promise<ReturnType<typeof jsonResult> | undefined> {
  if (resolvedMutationMode(options) === 'apply') return undefined;
  const projectId = resolveProjectId(inputProjectId, options);
  const project = await loadProjectForTool(projectId, options);
  if (externalDirectApplyEnabled(project)) return undefined;
  if (call.name === 'applyTimelineOp') {
    return jsonResult(
      timelineApplyProposalPayload(project, [call.args.op], {
        tool: call.name,
        summary: call.args.summary,
      }),
    );
  }
  if (call.name === 'applyTimelineOps') {
    return jsonResult(
      timelineApplyProposalPayload(project, call.args.ops, {
        tool: call.name,
        summary: call.args.summary,
      }),
    );
  }
  if (call.name === 'proposeTimelineOps') return undefined;
  if (isTimelineEditAgentToolCall(call)) {
    return timelineEditProposalResult(project, call);
  }
  return jsonResult(proposalRequiredPayload(project, call.name));
}

async function timelineEditToolCallResult(
  inputProjectId: string | undefined,
  options: VideoEditServerOptions,
  call: TimelineEditAgentToolCall,
  applyMode: z.infer<typeof NAMED_EDIT_APPLY_MODE_SCHEMA> = 'auto',
) {
  return withToolTimeout(call.name, async () => {
    if (applyMode === 'propose') {
      const project = await loadProjectForTool(inputProjectId, options);
      return timelineEditProposalResult(project, call);
    }
    return toolCallResult(inputProjectId, options, call);
  }).catch((error) =>
    errorResult(error instanceof Error ? error.message : String(error)),
  );
}

function timelineEditProposalResult(
  project: VideoProject,
  call: TimelineEditAgentToolCall,
) {
  const build = buildTimelineEditToolOps(project, call);
  return jsonResult(
    timelineApplyProposalPayload(project, build.ops, {
      tool: call.name,
      summary: call.args.summary,
      metadata: build.metadata,
    }),
  );
}

async function proposalOnlyServiceMutationResult(
  inputProjectId: string | undefined,
  options: VideoEditServerOptions,
  toolName: string,
): Promise<ReturnType<typeof jsonResult> | undefined> {
  if (resolvedMutationMode(options) === 'apply') return undefined;
  const projectId = resolveProjectId(inputProjectId, options);
  const project = await loadProjectForTool(projectId, options);
  if (externalDirectApplyEnabled(project)) return undefined;
  return jsonResult(proposalRequiredPayload(project, toolName));
}

function resolvedMutationMode(
  options: VideoEditServerOptions,
): 'apply' | 'proposal-only' {
  if (options.mutationMode) return options.mutationMode;
  return options.clientKind === 'external-mcp' ? 'proposal-only' : 'apply';
}

function externalDirectApplyEnabled(project: VideoProject): boolean {
  return (
    getVideoFeatureFlag('video.agentApply') &&
    project.settings?.agentEdits === 'apply'
  );
}

function timelineApplyProposalPayload(
  project: VideoProject,
  ops: TimelineOp[],
  input: {
    tool: string;
    summary?: string;
    metadata?: unknown;
    reason?: string;
  },
) {
  const proposal = proposeProjectTimelineOps(project, { ops });
  return {
    schema: 'neuma.video.mcp-proposal.v1',
    projectId: project.id,
    mode: 'proposal-only',
    reason: input.reason ?? 'external_mcp_proposal_only',
    tool: input.tool,
    summary: input.summary,
    opCount: ops.length,
    opKinds: ops.map((op) => op.kind),
    ops,
    inverses: proposal.inverses,
    conflicts: proposal.conflicts,
    metadata: input.metadata,
    timelineDurationMs: proposal.timeline.durationMs,
    agentEdits: project.settings?.agentEdits ?? 'proposal-only',
    agentApplyFlag: getVideoFeatureFlag('video.agentApply'),
  };
}

function proposalRequiredPayload(project: VideoProject, tool: string) {
  return {
    schema: 'neuma.video.mcp-proposal-required.v1',
    projectId: project.id,
    mode: 'proposal-only',
    reason: 'external_mcp_proposal_only',
    tool,
    agentEdits: project.settings?.agentEdits ?? 'proposal-only',
    agentApplyFlag: getVideoFeatureFlag('video.agentApply'),
  };
}

/** Narrow {project, asset} from attach-style services. */
function narrowAttachResult(payload: {
  project: { id: string; updatedAt?: string };
  asset: {
    id: string;
    kind?: string;
    source?: string;
    path?: string;
    materializationState?: MediaItem['materializationState'];
  };
}) {
  const referenced =
    payload.asset.path !== undefined
      ? isReferencedProjectAsset({
          path: payload.asset.path,
          materializationState: payload.asset.materializationState,
        })
      : payload.asset.materializationState === 'referenced';
  return jsonResult({
    projectId: payload.project.id,
    updatedAt: payload.project.updatedAt,
    asset: {
      id: payload.asset.id,
      kind: payload.asset.kind,
      source: payload.asset.source,
      materializationState:
        payload.asset.materializationState ??
        (referenced ? 'referenced' : 'ready'),
      renderable: !referenced,
      path: payload.asset.path,
      filePath:
        payload.asset.path && !referenced
          ? validatePath(
              payload.asset.path,
              getVideoProjectRoot(payload.project.id),
              'read',
            )
          : undefined,
    },
  });
}

function withProjectAndReasoning<T extends Record<string, unknown>>(
  input: T & { projectId?: string; reasoning?: string },
): {
  projectId?: string;
  reasoning?: string;
  args: Omit<T, 'projectId' | 'reasoning'>;
} {
  const { projectId, reasoning, ...args } = input;
  return { projectId, reasoning, args };
}

function camelToolCall<Name extends VideoAgentToolName>(
  name: Name,
  input: Record<string, unknown> & { projectId?: string; reasoning?: string },
): {
  projectId?: string;
  call: Extract<VideoAgentToolCall, { name: Name }>;
} {
  const { projectId, reasoning, args } = withProjectAndReasoning(input);
  return {
    projectId,
    call: { name, args, reasoning } as Extract<
      VideoAgentToolCall,
      { name: Name }
    >,
  };
}

function parseTimelineOpsWithResolverRefs(
  rawOps: Array<Record<string, unknown>>,
  refs: TimelineResolverRefs | undefined,
): TimelineOp[] {
  return rawOps.map((rawOp) =>
    TimelineOpSchema.parse(resolveTimelineOpRefs(rawOp, refs)),
  );
}

function resolveTimelineOpRefs(
  rawOp: Record<string, unknown>,
  refs: TimelineResolverRefs | undefined,
): Record<string, unknown> {
  const op = { ...rawOp };
  if (typeof op.clipId === 'string') {
    op.clipId = resolveClipRef(op.clipId, refs);
  }
  if (
    op.kind === 'clip.removeTimeRange' &&
    op.rangeRef === 'transcript_selection'
  ) {
    const range = refs?.transcriptSelection;
    if (!range) {
      throw new Error('transcript_selection range resolver was not provided');
    }
    op.startMs = range.startMs;
    op.endMs = range.endMs;
    delete op.rangeRef;
  }
  return op;
}

/**
 * Resolver refs backed by the live editor selection (session or options).
 * An open clip inspector wins over a multi-clip selection — "the overlay"
 * means the clip the user is looking at.
 */
function selectionResolverRefs(
  options: VideoEditServerOptions,
): TimelineResolverRefs | undefined {
  const selection = activeContext(options).editorSelection;
  const inspected = selection?.activePanel?.clipId;
  if (inspected) return { selectionClipIds: [inspected] };
  const selected = selection?.selectedClipIds;
  return selected && selected.length > 0
    ? { selectionClipIds: selected }
    : undefined;
}

function resolveClipRef(
  value: string,
  refs: TimelineResolverRefs | undefined,
): string {
  if (value === 'selection' || value === '$selection') {
    const selected = refs?.selectionClipIds ?? [];
    if (selected.length !== 1) {
      throw new Error('selection resolver requires exactly one selected clip');
    }
    return selected[0] ?? value;
  }
  if (value === 'transcript_selection' || value === '$transcript_selection') {
    const clipId = refs?.transcriptSelection?.clipId;
    if (!clipId) {
      throw new Error('transcript_selection clip resolver was not provided');
    }
    return clipId;
  }
  return value;
}

function findProjectTimelineClip(
  project: VideoProject,
  clipId: string,
): TimelineClip {
  for (const track of project.timeline?.tracks ?? []) {
    const clip = track.clips.find((candidate) => candidate.id === clipId);
    if (clip) return clip;
  }
  throw new Error(`Timeline clip not found: ${clipId}`);
}

function isVisualTimelineMediaClip(
  clip: TimelineClip,
): clip is Extract<TimelineClip, { kind: 'video' | 'image' | 'overlay' }> {
  return (
    clip.kind === 'video' || clip.kind === 'image' || clip.kind === 'overlay'
  );
}

function proposedGradeEffects(
  current: ClipEffectStack | undefined,
  correction: {
    brightness: number;
    contrast: number;
    temperature: number;
  },
): ClipEffectStack {
  const effects = [...(current?.effects ?? [])];
  upsertGradeEffect(effects, 'brightness', { amount: correction.brightness });
  upsertGradeEffect(effects, 'contrast', { amount: correction.contrast });
  const whiteBalance = effects.find(
    (effect) => effect.kind === 'white-balance',
  );
  if (whiteBalance?.kind === 'white-balance') {
    const index = effects.indexOf(whiteBalance);
    effects[index] = {
      ...whiteBalance,
      params: { ...whiteBalance.params, temperature: correction.temperature },
    };
  } else {
    effects.push({
      id: randomUUID(),
      version: 1,
      kind: 'white-balance',
      params: { temperature: correction.temperature, tint: 0 },
    });
  }
  return {
    schema: 'neuma.video.clip-effects.v1',
    effects,
    ...(current?.keyframes ? { keyframes: current.keyframes } : {}),
  };
}

function upsertGradeEffect(
  effects: ClipEffect[],
  kind: 'brightness' | 'contrast',
  params: { amount: number },
): void {
  const existing = effects.find((effect) => effect.kind === kind);
  if (existing?.kind === kind) {
    effects[effects.indexOf(existing)] = { ...existing, params };
    return;
  }
  effects.push({ id: randomUUID(), version: 1, kind, params });
}

function assetCounts(assets: MediaItem[]) {
  return assets.reduce(
    (counts, asset) => {
      counts[asset.kind] += 1;
      return counts;
    },
    { image: 0, video: 0, audio: 0 },
  );
}

function summarizeAsset(asset: MediaItem, projectId: string) {
  const referenced = isReferencedProjectAsset(asset);
  return {
    id: asset.id,
    kind: asset.kind,
    source: asset.source,
    path: asset.path,
    filePath: referenced
      ? undefined
      : validatePath(asset.path, getVideoProjectRoot(projectId), 'read'),
    materializationState:
      asset.materializationState ?? (referenced ? 'referenced' : 'ready'),
    renderable: !referenced,
    durationMs: asset.metadata.durationMs,
    width: asset.metadata.width,
    height: asset.metadata.height,
    fileSize: asset.metadata.fileSize,
    bytesTotal: asset.bytesTotal,
    provider: asset.provenance?.provider,
    model: asset.provenance?.model,
    cost: asset.provenance?.cost,
    catalogAssetId: asset.provenance?.catalogAssetId,
    sourceDisplayName: asset.provenance?.sourceDisplayName,
    thumbnailUrl: asset.provenance?.thumbnailUrl,
    promptPreview: truncate(asset.provenance?.prompt),
  };
}

function summarizeClip(clip: TimelineClip, frameRate: FrameRate) {
  const frameFields = deriveTimelineClipFrameFields(clip, frameRate);
  const overlay = vividOverlayContextSummary(clip);
  return {
    id: clip.id,
    kind: clip.kind,
    name: clip.name,
    sceneId: clip.sceneId,
    sourceRef: clip.sourceRef,
    startMs: clip.startMs,
    durationMs: clip.durationMs,
    ...frameFields,
    trimStartMs: clip.trimStartMs,
    trimEndMs: clip.trimEndMs,
    ...(overlay ? { overlay } : {}),
  };
}

function summarizeTrack(
  track: TimelineTrack,
  sceneId: string | undefined,
  limit: number,
  frameRate: FrameRate,
) {
  const clips = sceneId
    ? track.clips.filter((clip) => clip.sceneId === sceneId)
    : track.clips;
  return {
    id: track.id,
    kind: track.kind,
    name: track.name,
    muted: track.muted,
    locked: track.locked,
    order: track.order,
    clipCount: clips.length,
    clips: clips.slice(0, limit).map((clip) => summarizeClip(clip, frameRate)),
    truncated: clips.length > limit,
  };
}

function findScene(project: VideoProject, sceneId: string | undefined) {
  if (!sceneId) return {};
  return {
    scene: project.scenes?.find((candidate) => candidate.id === sceneId),
    storyboardScene: project.storyboard?.scenes.find(
      (candidate) => candidate.id === sceneId,
    ),
  };
}

function summarizeProject(
  project: VideoProject,
  options: VideoEditServerOptions,
) {
  const timeline = project.timeline;
  const tracks = timeline?.tracks ?? [];
  const clipCount = tracks.reduce(
    (total, track) => total + track.clips.length,
    0,
  );
  return {
    id: project.id,
    name: project.name,
    template: project.template,
    promptPreview: truncate(project.prompt),
    scriptPreview: truncate(project.script),
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    activeContext: activeContext(options),
    assets: {
      total: project.assets.length,
      byKind: assetCounts(project.assets),
    },
    sources: {
      total: project.sources?.length ?? 0,
      linked: project.linkedSources?.length ?? 0,
      analyses: project.sourceAnalyses?.length ?? 0,
      cutPlans: project.cutPlans?.length ?? 0,
      analysisArtifacts: project.analysisArtifacts?.length ?? 0,
    },
    storyboard: project.storyboard
      ? {
          status: project.storyboard.status,
          intent: project.storyboard.intent,
          sceneCount: project.storyboard.scenes.length,
          totalDurationMs: project.storyboard.totalDurationMs,
          approvedAt: project.storyboard.approvedAt,
          approvedBy: project.storyboard.approvedBy,
          costEstimateUsd: project.storyboard.costEstimateUsd,
        }
      : null,
    scenes: {
      total: project.scenes?.length ?? 0,
      selectedSceneId: activeContext(options).selectedSceneId,
    },
    timeline: timeline
      ? {
          schema: timeline.schema,
          durationMs: timeline.durationMs,
          fps: timeline.fps,
          trackCount: tracks.length,
          clipCount,
          markerCount: timeline.markers?.length ?? 0,
        }
      : null,
    render: project.render
      ? {
          status: project.render.status,
          progress: project.render.progress,
          message: project.render.message,
          where: project.render.where,
          provider: project.render.provider,
          outputPath: project.render.outputPath,
          updatedAt: project.render.updatedAt,
        }
      : null,
    outputs: project.outputs?.length ?? 0,
    budget: project.budget ?? null,
    history: project.history
      ? {
          head: project.history.head,
          entries: project.history.entries.length,
        }
      : null,
  };
}

function scenePayload(
  project: VideoProject,
  sceneId: string,
): {
  scene?: Scene;
  storyboardScene?: StoryboardScene;
  timelineClips: ReturnType<typeof summarizeClip>[];
} {
  const { scene, storyboardScene } = findScene(project, sceneId);
  const frameRate = frameRateForTimeline(project.timeline);
  const timelineClips =
    project.timeline?.tracks.flatMap((track) =>
      track.clips
        .filter((clip) => clip.sceneId === sceneId)
        .map((clip) => summarizeClip(clip, frameRate)),
    ) ?? [];
  return { scene, storyboardScene, timelineClips };
}

function describeScene(project: VideoProject, sceneId: string): string {
  const payload = scenePayload(project, sceneId);
  if (
    !payload.scene &&
    !payload.storyboardScene &&
    payload.timelineClips.length === 0
  ) {
    throw new Error(`Scene ${sceneId} was not found in project ${project.id}.`);
  }

  const storyboard = payload.storyboardScene;
  const scene = payload.scene;
  const assetIds = new Set(scene?.clips.map((clip) => clip.mediaId) ?? []);
  const assets = project.assets.filter((asset) => assetIds.has(asset.id));
  const lines = [
    `Scene ${sceneId}`,
    `Project: ${project.name} (${project.id})`,
    `Duration: ${storyboard?.durationMs ?? scene?.durationMs ?? 'unknown'} ms`,
  ];
  if (storyboard?.intent) lines.push(`Intent: ${storyboard.intent}`);
  if (storyboard?.caption?.text)
    lines.push(`Caption: ${storyboard.caption.text}`);
  if (storyboard?.assetPlan) {
    lines.push(
      `Storyboard asset plan: ${JSON.stringify(storyboard.assetPlan)}`,
    );
  }
  if (scene?.transition || storyboard?.transition) {
    lines.push(
      `Transition: ${JSON.stringify(scene?.transition ?? storyboard?.transition)}`,
    );
  }
  lines.push(`Scene clips: ${scene?.clips.length ?? 0}`);
  lines.push(`Timeline clips: ${payload.timelineClips.length}`);
  if (assets.length > 0) {
    lines.push(
      `Referenced assets: ${assets
        .map((asset) => `${asset.id} (${asset.kind}, ${asset.source})`)
        .join(', ')}`,
    );
  }
  return lines.join('\n');
}

type TimelineTransitionApplyMode = z.infer<typeof NAMED_EDIT_APPLY_MODE_SCHEMA>;
type TimelineTransitionProposalMode = z.infer<
  typeof TIMELINE_PROPOSAL_APPLY_MODE_SCHEMA
>;
type ClipSetTransitionTimelineOp = Extract<
  TimelineOp,
  { kind: 'clip.setTransition' }
>;

interface TimelineTransitionEditInput {
  projectId?: string;
  reasoning?: string;
  seamId: string;
  transition?: z.infer<typeof TRANSITION_SCHEMA>;
  summary?: string;
  applyMode?: TimelineTransitionApplyMode;
  requireExisting?: boolean;
}

interface TimelineTransitionEditBuild {
  project: VideoProject;
  seam: TimelineTransitionSeamView;
  resolution: TimelineTransitionResolution;
  op: ClipSetTransitionTimelineOp;
  diffSummary: string;
}

interface TimelineTransitionSuggestion {
  seamId: string;
  seam: TimelineTransitionSeamView;
  action: 'set' | 'remove' | 'no-change';
  reason: string;
  currentTransition?: TimelineTransition | null;
  requestedTransition?: TimelineTransitionResolution['requestedTransition'];
  effectiveTransition?: TimelineTransition | null;
  requestedDurationMs?: number;
  effectiveDurationMs?: number;
  clamped?: boolean;
  fallbackWarnings?: TimelineTransitionResolution['warnings'];
  op?: ClipSetTransitionTimelineOp;
}

function transitionPresetCatalog() {
  return VIDEO_TRANSITION_REGISTRY.map((entry) => {
    const quality = transitionQualityEntry(entry.kind);
    return {
      kind: entry.kind,
      tier: entry.tier,
      group: entry.group,
      labelKey: entry.labelKey,
      descriptionKey: entry.descriptionKey,
      defaultDurationMs: entry.defaultDurationMs,
      minDurationMs: entry.minDurationMs,
      maxDurationMs: entry.maxDurationMs,
      directions: entry.directions,
      native: entry.native,
      fallbackFor: entry.fallbackFor,
      webglPreview: entry.webglPreview,
      quality: {
        ffmpeg: quality.ffmpeg,
        remotion: quality.remotion,
        webgl: quality.webgl,
      },
      recommendedUse: entry.recommendedUse,
    };
  });
}

async function transitionSeamEditResult(
  input: TimelineTransitionEditInput,
  options: VideoEditServerOptions,
  toolName: string,
) {
  return withToolTimeout(toolName, async () => {
    const build = await buildTimelineTransitionEdit(input, options);
    const applyMode = input.applyMode ?? 'auto';
    logger.debug('video.transition_tool.decision', {
      toolName,
      projectId: build.project.id,
      seamId: build.seam.seamId,
      applyMode,
      requestedTransition: build.resolution.requestedTransition,
      effectiveTransition: build.resolution.effectiveTransition,
    });
    if (transitionsEqual(build.seam.currentTransition, build.op.after)) {
      return jsonResult({
        ...transitionEditBasePayload(toolName, build),
        approvalState: 'no-change',
        message: 'The requested transition already matches this seam.',
      });
    }
    if (
      shouldReturnTimelineTransitionProposal(build.project, options, applyMode)
    ) {
      const proposal = timelineApplyProposalPayload(build.project, [build.op], {
        tool: 'applyTimelineOp',
        summary: build.diffSummary,
        metadata: transitionEditMetadata(toolName, build),
        reason:
          applyMode === 'propose'
            ? 'requested_proposal'
            : 'external_mcp_proposal_only',
      });
      return jsonResult({
        ...transitionEditBasePayload(toolName, build),
        approvalState:
          applyMode === 'propose' ? 'proposed' : 'proposal-required',
        proposal,
      });
    }

    const execution = await applyVideoToolCall(input.projectId, options, {
      name: 'applyTimelineOp',
      args: { op: build.op, summary: build.diffSummary },
      reasoning: input.reasoning,
    });
    return jsonResult({
      ...transitionEditBasePayload(toolName, build),
      approvalState: 'applied',
      mutation: mutationPayload(execution),
    });
  }).catch((error) =>
    errorResult(error instanceof Error ? error.message : String(error)),
  );
}

async function buildTimelineTransitionEdit(
  input: TimelineTransitionEditInput,
  options: VideoEditServerOptions,
): Promise<TimelineTransitionEditBuild> {
  const project = await loadProjectForTool(input.projectId, options);
  const seam = findTimelineTransitionSeam(project, input.seamId);
  if (!seam) {
    throw new Error(
      `Transition seam ${input.seamId} was not found in project ${project.id}.`,
    );
  }
  if (input.requireExisting && !seam.currentTransition) {
    throw new Error(
      `Transition seam ${input.seamId} does not currently have a transition to update.`,
    );
  }
  const resolution = input.transition
    ? resolveTimelineTransitionForSeam(
        project,
        seam,
        input.transition as TimelineTransition,
      )
    : {
        requestedTransition: { kind: 'cut' as const },
        effectiveTransition: null,
        clamped: false,
        warnings: [],
      };
  const op = TimelineOpSchema.parse({
    kind: 'clip.setTransition',
    clipId: seam.fromClipId,
    before: seam.currentTransition,
    after: resolution.effectiveTransition,
  }) as ClipSetTransitionTimelineOp;
  return {
    project,
    seam,
    resolution,
    op,
    diffSummary:
      input.summary ??
      transitionDiffSummary(seam, resolution.effectiveTransition),
  };
}

function shouldReturnTimelineTransitionProposal(
  project: VideoProject,
  options: VideoEditServerOptions,
  applyMode: TimelineTransitionApplyMode,
): boolean {
  if (applyMode === 'propose') return true;
  if (resolvedMutationMode(options) === 'apply') return false;
  return !externalDirectApplyEnabled(project);
}

function transitionEditBasePayload(
  toolName: string,
  build: TimelineTransitionEditBuild,
) {
  return {
    schema: 'neuma.video.timeline-transition-edit.v1',
    projectId: build.project.id,
    tool: toolName,
    seamId: build.seam.seamId,
    seam: build.seam,
    context: transitionHumanContext(build.seam),
    requestedTransition: build.resolution.requestedTransition,
    effectiveTransition: build.resolution.effectiveTransition,
    requestedDurationMs: build.resolution.requestedDurationMs,
    effectiveDurationMs: build.resolution.effectiveDurationMs,
    clamped: build.resolution.clamped,
    fallbackWarnings: build.resolution.warnings,
    diffSummary: build.diffSummary,
    op: build.op,
  };
}

function transitionEditMetadata(
  toolName: string,
  build: TimelineTransitionEditBuild,
) {
  return {
    transitionTool: toolName,
    seamId: build.seam.seamId,
    fromClipId: build.seam.fromClipId,
    toClipId: build.seam.toClipId,
    requestedTransition: build.resolution.requestedTransition,
    effectiveTransition: build.resolution.effectiveTransition,
    clamped: build.resolution.clamped,
  };
}

function transitionDiffSummary(
  seam: TimelineTransitionSeamView,
  transition: TimelineTransition | null,
): string {
  const target = transition ? normalizeTransition(transition).kind : 'cut';
  return `Set ${target} transition between ${seam.fromClip.label} and ${seam.toClip.label}`;
}

function transitionHumanContext(seam: TimelineTransitionSeamView): string {
  return `${seam.trackName}: ${seam.fromClip.label} (${seam.fromClip.startMs}-${seam.fromClip.endMs}ms) to ${seam.toClip.label} (${seam.toClip.startMs}-${seam.toClip.endMs}ms) at ${seam.startMs}ms.`;
}

function transitionsEqual(
  left: TimelineTransition | null,
  right: TimelineTransition | null,
): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function isClipSetTransitionTimelineOp(
  op: ClipSetTransitionTimelineOp | undefined,
): op is ClipSetTransitionTimelineOp {
  return Boolean(op);
}

async function timelineTransitionSuggestionResult(
  input: {
    projectId?: string;
    reasoning?: string;
    seamIds?: string[];
    intentText?: string;
    maxChanges?: number;
    summary?: string;
    applyMode?: TimelineTransitionProposalMode;
  },
  options: VideoEditServerOptions,
) {
  return withToolTimeout('video_suggest_timeline_transitions', async () => {
    const project = await loadProjectForTool(input.projectId, options);
    const suggestions = buildTimelineTransitionSuggestions(project, input);
    const ops = suggestions
      .map((suggestion) => suggestion.op)
      .filter(isClipSetTransitionTimelineOp);
    const summary =
      input.summary ??
      (ops.length > 0
        ? `Propose ${ops.length} timeline transition change${ops.length === 1 ? '' : 's'}`
        : 'Keep current timeline cuts');

    if (ops.length === 0) {
      return jsonResult({
        schema: 'neuma.video.timeline-transition-suggestions.v1',
        projectId: project.id,
        approvalState: 'no-change',
        summary,
        suggestions,
      });
    }

    const execution = await applyVideoToolCall(input.projectId, options, {
      name: 'proposeTimelineOps',
      args: {
        summary,
        ops,
        applyMode: input.applyMode ?? 'suggest',
      },
      reasoning: input.reasoning,
    });
    return jsonResult({
      schema: 'neuma.video.timeline-transition-suggestions.v1',
      projectId: project.id,
      approvalState: 'proposed',
      summary,
      suggestions,
      proposal: execution.entry.result,
      mutation: mutationPayload(execution),
    });
  }).catch((error) =>
    errorResult(error instanceof Error ? error.message : String(error)),
  );
}

function buildTimelineTransitionSuggestions(
  project: VideoProject,
  input: {
    seamIds?: string[];
    intentText?: string;
    maxChanges?: number;
  },
): TimelineTransitionSuggestion[] {
  const requestedSeamIds = new Set(input.seamIds ?? []);
  const maxChanges = Math.max(1, Math.min(20, input.maxChanges ?? 6));
  const intentText = (input.intentText ?? '').toLowerCase();
  const explicitKind = explicitTransitionKind(intentText);
  const removeFlashy = /\b(remove|less|dial back|tone down|flashy)\b/.test(
    intentText,
  );
  const wantsSmooth =
    explicitKind !== undefined ||
    /\b(smooth|smoother|soft|subtle|dissolve|fade|montage)\b/.test(intentText);
  let changed = 0;

  return deriveTimelineTransitionSeams(project)
    .filter(
      (seam) =>
        requestedSeamIds.size === 0 || requestedSeamIds.has(seam.seamId),
    )
    .map((seam) => {
      const current = seam.currentTransition
        ? normalizeTransition(seam.currentTransition)
        : { kind: 'cut' as const };
      if (!seam.canAcceptTransition) {
        return transitionNoChangeSuggestion(
          seam,
          `No change: seam is blocked by ${seam.blockedReason ?? 'timeline constraints'}.`,
        );
      }

      const targetKind =
        explicitKind ??
        transitionKindForIntent(project, seam, current.kind, {
          removeFlashy,
          wantsSmooth,
        });
      if (!targetKind) {
        return transitionNoChangeSuggestion(
          seam,
          'No change: cuts are the default unless there is a scene shift, chapter boundary, or explicit style intent.',
        );
      }
      if (changed >= maxChanges) {
        return transitionNoChangeSuggestion(
          seam,
          `No change: maxChanges ${maxChanges} already reached.`,
        );
      }

      try {
        const resolution = resolveTimelineTransitionForSeam(project, seam, {
          kind: targetKind,
        });
        const op = TimelineOpSchema.parse({
          kind: 'clip.setTransition',
          clipId: seam.fromClipId,
          before: seam.currentTransition,
          after: resolution.effectiveTransition,
        }) as ClipSetTransitionTimelineOp;
        if (transitionsEqual(seam.currentTransition, op.after)) {
          return transitionNoChangeSuggestion(
            seam,
            `No change: ${targetKind} already matches this seam.`,
          );
        }
        changed += 1;
        return {
          seamId: seam.seamId,
          seam,
          action: op.after ? 'set' : 'remove',
          reason: transitionSuggestionReason(project, seam, targetKind),
          requestedTransition: resolution.requestedTransition,
          effectiveTransition: resolution.effectiveTransition,
          requestedDurationMs: resolution.requestedDurationMs,
          effectiveDurationMs: resolution.effectiveDurationMs,
          clamped: resolution.clamped,
          fallbackWarnings: resolution.warnings,
          op,
        };
      } catch (error) {
        return transitionNoChangeSuggestion(
          seam,
          error instanceof Error ? error.message : String(error),
        );
      }
    });
}

function transitionKindForIntent(
  project: VideoProject,
  seam: TimelineTransitionSeamView,
  currentKind: TransitionKind,
  intent: { removeFlashy: boolean; wantsSmooth: boolean },
): TransitionKind | null {
  if (intent.removeFlashy) {
    return currentKind === 'cut' ? null : 'cut';
  }
  if (isChapterBoundary(project, seam)) return 'fade';
  if (!intent.wantsSmooth) return null;
  if (seam.fromClip.sceneId && seam.fromClip.sceneId !== seam.toClip.sceneId) {
    return 'fade';
  }
  return 'dissolve';
}

function transitionSuggestionReason(
  project: VideoProject,
  seam: TimelineTransitionSeamView,
  kind: TransitionKind,
): string {
  if (kind === 'cut')
    return 'Remove the existing transition and keep a direct cut.';
  if (isChapterBoundary(project, seam)) {
    return 'Chapter boundary: use a subtle fade instead of a hard cut.';
  }
  if (seam.fromClip.sceneId && seam.fromClip.sceneId !== seam.toClip.sceneId) {
    return 'Scene change: use a subtle transition to smooth the shift.';
  }
  return 'Montage smoothing: use a restrained transition.';
}

function transitionNoChangeSuggestion(
  seam: TimelineTransitionSeamView,
  reason: string,
): TimelineTransitionSuggestion {
  return {
    seamId: seam.seamId,
    seam,
    action: 'no-change',
    reason,
    currentTransition: seam.currentTransition,
  };
}

function explicitTransitionKind(
  intentText: string,
): TransitionKind | undefined {
  return VIDEO_TRANSITION_REGISTRY.find((entry) => {
    const words = entry.kind.replace('-', ' ');
    return intentText.includes(entry.kind) || intentText.includes(words);
  })?.kind;
}

function isChapterBoundary(
  project: VideoProject,
  seam: TimelineTransitionSeamView,
): boolean {
  return Boolean(
    project.timeline?.markers?.some(
      (marker) =>
        marker.isChapter && Math.abs(marker.timeMs - seam.startMs) <= 250,
    ),
  );
}

function serviceResult(promise: Promise<unknown>) {
  return promise
    .then(jsonResult)
    .catch((error) =>
      errorResult(error instanceof Error ? error.message : String(error)),
    );
}

async function lockedServiceCall<T>(
  inputProjectId: string | undefined,
  options: VideoEditServerOptions,
  fn: (projectId: string) => Promise<T>,
): Promise<T> {
  const projectId = resolveProjectId(inputProjectId, options);
  return withProjectLock(projectId, () => fn(projectId));
}

async function searchVideoAssets(
  inputProjectId: string | undefined,
  options: VideoEditServerOptions,
  input: {
    query: string;
    kinds?: Array<'image' | 'video' | 'audio'>;
    sourceIds?: string[];
    limit?: number;
  },
) {
  const projectId = resolveProjectId(inputProjectId, options);
  const project = await loadProjectForTool(projectId, options);
  const query = input.query.trim().toLowerCase();
  const kinds = input.kinds?.length ? new Set(input.kinds) : undefined;
  const limit = clampLimit(input.limit, 20);
  const localAssets = project.assets
    .filter((asset) => !kinds || kinds.has(asset.kind))
    .filter((asset) => {
      const haystack = [
        asset.id,
        asset.path,
        asset.source,
        asset.provenance?.provider,
        asset.provenance?.model,
        asset.provenance?.prompt,
        asset.provenance?.sourceDisplayName,
      ]
        .filter((value): value is string => Boolean(value))
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    })
    .slice(0, limit)
    .map((asset) => ({
      source: 'project',
      asset: summarizeAsset(asset, project.id),
    }));

  let linkedAssets: unknown[] = [];
  try {
    const linked = await searchLinkedAssets(projectId, {
      query: input.query,
      sourceIds: input.sourceIds,
      limit,
    });
    linkedAssets = linked.results
      .filter(
        (hit) =>
          !kinds || (hit.asset.kind !== 'other' && kinds.has(hit.asset.kind)),
      )
      .slice(0, limit)
      .map((hit) => ({
        source: 'linked',
        assetId: hit.asset.id,
        name: hit.asset.name,
        kind: hit.asset.kind,
        durationMs: hit.asset.durationMs,
        score: hit.score,
        matchedOn: hit.matchedOn,
        thumbnailUrl: hit.thumbnailUrl,
        sourceDisplayName: hit.sourceDisplayName,
      }));
  } catch (error) {
    linkedAssets = [
      {
        source: 'linked',
        error: error instanceof Error ? error.message : String(error),
      },
    ];
  }

  return {
    projectId,
    query: input.query,
    localAssets,
    linkedAssets,
  };
}

function rankProjectMoments(
  project: VideoProject,
  input: { signal?: string; limit?: number },
) {
  const limit = clampLimit(input.limit, 10);
  const cutMoments = (project.sourceAnalyses ?? []).flatMap((analysis) =>
    analysis.cutCandidates.map((candidate) => ({
      source: 'cut-candidate',
      sourceId: candidate.sourceId,
      id: candidate.id,
      startMs: candidate.startMs,
      endMs: candidate.endMs,
      score: candidate.confidence,
      reason: candidate.reason,
      recommendation: candidate.recommendation,
      evidence: candidate.evidence.map((item) => item.summary),
    })),
  );
  const visualMoments = (project.sourceAnalyses ?? []).flatMap((analysis) =>
    analysis.visualBeats.map((beat, index) => ({
      source: 'visual-beat',
      sourceId: analysis.sourceId,
      id: `${analysis.id}:beat:${index}`,
      startMs: beat.startMs,
      endMs: beat.endMs,
      score: 0.5,
      caption: beat.caption,
      tags: beat.tags,
    })),
  );
  const moments = [...cutMoments, ...visualMoments]
    .sort((a, b) => b.score - a.score || a.startMs - b.startMs)
    .slice(0, limit);
  return {
    projectId: project.id,
    signal: input.signal,
    moments,
  };
}

function beatGridForAudioClip(
  project: VideoProject,
  clip: TimelineClip,
): BeatGridArtifact | undefined {
  if (clip.kind !== 'audio' || clip.sourceRef.kind !== 'asset')
    return undefined;
  const assetId = clip.sourceRef.assetId;
  const source = project.sources?.find(
    (entry) => entry.mediaItemId === assetId,
  );
  if (!source) return undefined;
  for (const artifact of project.analysisArtifacts ?? []) {
    if (
      artifact.kind !== 'beat-markers' ||
      artifact.sourceMediaId !== source.id ||
      artifact.contentHash !== source.contentHash
    ) {
      continue;
    }
    const grid = readBeatGrid(artifact.metadata?.beatGrid);
    if (grid) return grid;
  }
  return undefined;
}

function readBeatGrid(value: unknown): BeatGridArtifact | undefined {
  if (!isUnknownRecord(value)) return undefined;
  const record = value;
  if (
    record.schema !== 'neuma.video.beat-grid.v1' ||
    typeof record.sourceMediaId !== 'string' ||
    typeof record.contentHash !== 'string' ||
    !Array.isArray(record.points)
  ) {
    return undefined;
  }
  const points = record.points.flatMap((point) => {
    if (!isUnknownRecord(point)) return [];
    const entry = point;
    if (
      typeof entry.sourceMs !== 'number' ||
      typeof entry.confidence !== 'number'
    ) {
      return [];
    }
    return [
      {
        sourceMs: entry.sourceMs,
        confidence: entry.confidence,
        ...(typeof entry.bar === 'number' ? { bar: entry.bar } : {}),
        ...(typeof entry.beat === 'number' ? { beat: entry.beat } : {}),
      },
    ];
  });
  return {
    schema: 'neuma.video.beat-grid.v1',
    sourceMediaId: record.sourceMediaId,
    contentHash: record.contentHash,
    ...(typeof record.tempoBpm === 'number'
      ? { tempoBpm: record.tempoBpm }
      : {}),
    points,
  };
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function buildSnapCutsToBeatOps(
  project: VideoProject,
  beatTimesMs: number[],
  toleranceMs: number,
): TimelineOp[] {
  const ops: TimelineOp[] = [];
  for (const track of project.timeline?.tracks ?? []) {
    if (track.kind !== 'video' && track.kind !== 'broll') continue;
    const clips = [...track.clips].sort(
      (left, right) => left.startMs - right.startMs,
    );
    // A clip sits on two boundaries when both of its neighbours snap. Each op
    // must therefore build on the timing the previous op left behind, not on
    // the clip's original timing — otherwise the second op silently reverts
    // the first and the cut reopens.
    const pending = new Map(clips.map((clip) => [clip.id, clipTiming(clip)]));
    for (let index = 1; index < clips.length; index += 1) {
      const previous = clips[index - 1]!;
      const next = clips[index]!;
      const previousFrom = pending.get(previous.id)!;
      const nextFrom = pending.get(next.id)!;
      const boundary = nextFrom.startMs;
      if (
        Math.abs(previousFrom.startMs + previousFrom.durationMs - boundary) > 1
      ) {
        continue;
      }
      const beat = nearestNumber(boundary, beatTimesMs, toleranceMs);
      if (beat === undefined || Math.round(beat) === boundary) continue;
      const deltaMs = Math.round(beat) - boundary;
      const previousTo = retimeCutSide(previous, previousFrom, deltaMs, 'end');
      const nextTo = retimeCutSide(next, nextFrom, deltaMs, 'start');
      if (!previousTo || !nextTo) continue;
      const previousOp: TimelineOp = {
        kind: 'clip.trim',
        clipId: previous.id,
        from: previousFrom,
        to: previousTo,
      };
      const nextOp: TimelineOp = {
        kind: 'clip.trim',
        clipId: next.id,
        from: nextFrom,
        to: nextTo,
      };
      // Move the clip that vacates the boundary first so the batch never
      // passes through a transient overlap, which would read as a conflict.
      ops.push(...(deltaMs > 0 ? [nextOp, previousOp] : [previousOp, nextOp]));
      pending.set(previous.id, previousTo);
      pending.set(next.id, nextTo);
    }
  }
  return ops;
}

function retimeCutSide(
  clip: TimelineClip,
  from: ReturnType<typeof clipTiming>,
  deltaMs: number,
  side: 'start' | 'end',
) {
  const speed = clip.playback?.speed ?? 1;
  const sourceDeltaMs = Math.round(deltaMs * speed);
  const reverse = clip.playback?.reverse === true;
  const next = { ...from };
  if (side === 'end') {
    next.durationMs += deltaMs;
    if (reverse) next.trimStartMs -= sourceDeltaMs;
    else next.trimEndMs += sourceDeltaMs;
  } else {
    next.startMs += deltaMs;
    next.durationMs -= deltaMs;
    if (reverse) next.trimEndMs -= sourceDeltaMs;
    else next.trimStartMs += sourceDeltaMs;
  }
  if (
    next.startMs < 0 ||
    next.durationMs <= 0 ||
    next.trimStartMs < 0 ||
    next.trimEndMs <= next.trimStartMs
  ) {
    return undefined;
  }
  return next;
}

function clipTiming(clip: TimelineClip) {
  return {
    startMs: clip.startMs,
    durationMs: clip.durationMs,
    trimStartMs: clip.trimStartMs,
    trimEndMs: clip.trimEndMs,
  };
}

function nearestNumber(
  value: number,
  candidates: number[],
  tolerance: number,
): number | undefined {
  let best: number | undefined;
  let distance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const nextDistance = Math.abs(candidate - value);
    if (nextDistance <= tolerance && nextDistance < distance) {
      best = candidate;
      distance = nextDistance;
    }
  }
  return best;
}

async function attachVideoAsset(
  inputProjectId: string | undefined,
  options: VideoEditServerOptions,
  input: {
    assetId: string;
    sceneId?: string;
    role?: 'asset' | 'reference';
  },
) {
  return lockedServiceCall(inputProjectId, options, async (projectId) => {
    let project = await getProject(projectId);
    let existing = project.assets.find((asset) => asset.id === input.assetId);
    if (!existing) {
      return attachLinkedAsset(projectId, input.assetId, {
        sceneId: input.sceneId,
        role: input.role === 'reference' ? 'reference' : 'asset',
      });
    }
    if (isReferencedProjectAsset(existing)) {
      const hydrated = await hydrateProjectAsset(projectId, existing.id, {
        role: input.role ?? 'asset',
      });
      project = hydrated.project;
      existing = hydrated.asset;
    }
    if (!input.sceneId) return { project, asset: existing };

    const now = new Date().toISOString();
    const patched: VideoProject = {
      ...project,
      storyboard: project.storyboard
        ? {
            ...project.storyboard,
            scenes: project.storyboard.scenes.map((scene) =>
              scene.id === input.sceneId
                ? {
                    ...scene,
                    assetPlan: { kind: 'existing', assetId: existing.id },
                  }
                : scene,
            ),
          }
        : project.storyboard,
      scenes: (project.scenes ?? []).map((scene) =>
        scene.id === input.sceneId
          ? {
              ...scene,
              clips: [{ id: randomUUID(), mediaId: existing.id }],
            }
          : scene,
      ),
      updatedAt: now,
    };
    const next = rebuildTimelineFromStoryboard(patched);
    await writeProject(next);
    return { project: next, asset: existing };
  });
}

export function createVideoEditTools(options: VideoEditServerOptions = {}) {
  return [
    tool(
      'video_get_project_summary',
      'Read a compact summary of the active Video Mode project. This tool is read-only.',
      { projectId: PROJECT_ID_SCHEMA },
      async ({ projectId }) => {
        try {
          const project = await loadProjectForTool(projectId, options);
          return jsonResult(summarizeProject(project, options));
        } catch (error) {
          return errorResult(
            error instanceof Error ? error.message : String(error),
          );
        }
      },
    ),
    tool(
      'video_get_current_context',
      'Read current Video Mode editor context from the active UI selection. Use this before resolving pronouns like "this", "selected", "current scene", or framing/crop requests. This tool is read-only.',
      {
        projectId: PROJECT_ID_SCHEMA,
        include: z
          .array(CURRENT_CONTEXT_INCLUDE_SCHEMA)
          .max(CURRENT_VIDEO_CONTEXT_INCLUDES.length)
          .optional()
          .describe(
            'Context sections to return: scene, selection, previewFrame, timelineWindow, assets.',
          ),
        windowMs: z
          .number()
          .int()
          .min(500)
          .max(60_000)
          .optional()
          .describe(
            'Half-window around the current playhead for timelineWindow, in ms.',
          ),
      },
      async ({ projectId, include, windowMs }) => {
        try {
          const project = await loadProjectForTool(projectId, options);
          const context = activeContext(options);
          return jsonResult(
            buildCurrentVideoContext(project, {
              selectedSceneId: context.selectedSceneId,
              aspectRatio: context.aspectRatio,
              editorSelection: context.editorSelection,
              include,
              windowMs,
            }),
          );
        } catch (error) {
          return errorResult(
            error instanceof Error ? error.message : String(error),
          );
        }
      },
    ),
    tool(
      'video_get_scene',
      'Read one scene from the active Video Mode project. Defaults to the selected scene when available. This tool is read-only.',
      {
        projectId: PROJECT_ID_SCHEMA,
        sceneId: z
          .string()
          .min(1)
          .optional()
          .describe(
            'Scene id. Defaults to the selected scene in session context.',
          ),
      },
      async ({ projectId, sceneId }) => {
        try {
          const project = await loadProjectForTool(projectId, options);
          const resolvedSceneId =
            sceneId ?? activeContext(options).selectedSceneId;
          if (!resolvedSceneId) {
            return errorResult('No scene id was provided for this MCP call.');
          }
          const payload = scenePayload(project, resolvedSceneId);
          if (
            !payload.scene &&
            !payload.storyboardScene &&
            payload.timelineClips.length === 0
          ) {
            return errorResult(
              `Scene ${resolvedSceneId} was not found in project ${project.id}.`,
            );
          }
          return jsonResult({
            projectId: project.id,
            sceneId: resolvedSceneId,
            ...payload,
          });
        } catch (error) {
          return errorResult(
            error instanceof Error ? error.message : String(error),
          );
        }
      },
    ),
    tool(
      'video_get_timeline',
      'Read a bounded slice of the active Video Mode timeline with millisecond compatibility fields and derived project-frame fields. This tool is read-only.',
      {
        projectId: PROJECT_ID_SCHEMA,
        trackId: z
          .string()
          .min(1)
          .optional()
          .describe('Optional timeline track id.'),
        sceneId: z
          .string()
          .min(1)
          .optional()
          .describe('Optional scene id filter.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe('Maximum clips per returned track. Default: 20.'),
      },
      async ({ projectId, trackId, sceneId, limit }) => {
        try {
          const project = await loadProjectForTool(projectId, options);
          const timeline = project.timeline;
          if (!timeline)
            return jsonResult({ projectId: project.id, timeline: null });
          const resolvedLimit = clampLimit(limit, 20);
          const frameRate = frameRateForTimeline(timeline);
          const tracks = trackId
            ? timeline.tracks.filter((track) => track.id === trackId)
            : timeline.tracks;
          return jsonResult({
            projectId: project.id,
            schema: timeline.schema,
            durationMs: timeline.durationMs,
            durationFrames: durationMsToFrames(timeline.durationMs, frameRate),
            fps: timeline.fps,
            frameRate,
            markers: timeline.markers ?? [],
            tracks: tracks.map((track) =>
              summarizeTrack(track, sceneId, resolvedLimit, frameRate),
            ),
          });
        } catch (error) {
          return errorResult(
            error instanceof Error ? error.message : String(error),
          );
        }
      },
    ),
    tool(
      'video_get_timeline_window',
      'Read only clips intersecting a timeline time window. Returns compact rows with millisecond compatibility fields and derived project-frame fields for agent inspection before edits.',
      {
        projectId: PROJECT_ID_SCHEMA,
        startMs: z.number().int().min(0),
        endMs: z.number().int().positive(),
        trackId: z.string().min(1).optional(),
        limit: z.number().int().min(1).max(100).optional(),
      },
      async ({ projectId, startMs, endMs, trackId, limit }) =>
        withToolTimeout('video_get_timeline_window', async () => {
          const project = await loadProjectForTool(projectId, options);
          return jsonResult(
            buildTimelineWindow(project, { startMs, endMs, trackId, limit }),
          );
        }).catch((error) =>
          errorResult(error instanceof Error ? error.message : String(error)),
        ),
    ),
    tool(
      'video_inspect_timeline_frames',
      'Render small composited timeline frames from the current Remotion composition. Use before claiming visual facts and after applying visual edits. This is read-only and reflects transforms, overlays, captions, and render-time composition.',
      TIMELINE_FRAME_INSPECT_INPUT_SCHEMA.shape,
      async (input) => {
        const parsed = TIMELINE_FRAME_INSPECT_INPUT_SCHEMA.safeParse(input);
        if (!parsed.success) {
          return errorResult(
            `video_inspect_timeline_frames: ${parsed.error.issues
              .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
              .join('; ')}`,
          );
        }
        const {
          projectId,
          startMs,
          endMs,
          frameCount,
          aspectRatio,
          maxEdgePx,
        } = parsed.data;
        return withToolTimeout(
          'video_inspect_timeline_frames',
          async () => {
            const project = await loadProjectForTool(projectId, options);
            const resolvedAspectRatio =
              aspectRatio ??
              resolveAspectRatio(activeContext(options).aspectRatio) ??
              project.settings?.defaultAspectRatios?.[0] ??
              '16:9';
            const root = getVideoProjectRoot(project.id);
            return jsonResult(
              await renderTimelineFramesWithRemotion({
                project,
                startMs,
                endMs,
                frameCount,
                aspectRatio: resolvedAspectRatio,
                maxEdgePx,
                root,
              }),
            );
          },
          90_000,
        ).catch((error) =>
          errorResult(error instanceof Error ? error.message : String(error)),
        );
      },
    ),
    tool(
      'video_find_clips',
      'Search timeline clips by id, name, scene id, source ref, transcript/caption text, or params. Returns compact clip rows.',
      {
        projectId: PROJECT_ID_SCHEMA,
        query: z.string().min(1),
        trackId: z.string().min(1).optional(),
        kind: z
          .enum(['video', 'image', 'audio', 'caption', 'overlay', 'effect'])
          .optional(),
        limit: z.number().int().min(1).max(100).optional(),
      },
      async ({ projectId, query, trackId, kind, limit }) =>
        withToolTimeout('video_find_clips', async () => {
          const project = await loadProjectForTool(projectId, options);
          return jsonResult(
            findTimelineClips(project, { query, trackId, kind, limit }),
          );
        }).catch((error) =>
          errorResult(error instanceof Error ? error.message : String(error)),
        ),
    ),
    tool(
      'video_list_assets',
      'List bounded asset metadata from the active Video Mode project. This tool is read-only.',
      {
        projectId: PROJECT_ID_SCHEMA,
        kind: z.enum(['image', 'video', 'audio']).optional(),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe('Maximum assets to return. Default: 25.'),
        offset: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('Pagination offset.'),
      },
      async ({ projectId, kind, limit, offset }) => {
        try {
          const project = await loadProjectForTool(projectId, options);
          const filtered = kind
            ? project.assets.filter((asset) => asset.kind === kind)
            : project.assets;
          const resolvedOffset = offset ?? 0;
          const resolvedLimit = clampLimit(limit, 25);
          return jsonResult({
            projectId: project.id,
            total: filtered.length,
            offset: resolvedOffset,
            limit: resolvedLimit,
            assets: filtered
              .slice(resolvedOffset, resolvedOffset + resolvedLimit)
              .map((asset) => summarizeAsset(asset, project.id)),
          });
        } catch (error) {
          return errorResult(
            error instanceof Error ? error.message : String(error),
          );
        }
      },
    ),
    tool(
      'video_describe_scene',
      'Return a concise human-readable description of one scene. Defaults to the selected scene when available. This tool is read-only.',
      {
        projectId: PROJECT_ID_SCHEMA,
        sceneId: z
          .string()
          .min(1)
          .optional()
          .describe(
            'Scene id. Defaults to the selected scene in session context.',
          ),
      },
      async ({ projectId, sceneId }) => {
        try {
          const project = await loadProjectForTool(projectId, options);
          const resolvedSceneId =
            sceneId ?? activeContext(options).selectedSceneId;
          if (!resolvedSceneId) {
            return errorResult('No scene id was provided for this MCP call.');
          }
          return textResult(describeScene(project, resolvedSceneId));
        } catch (error) {
          return errorResult(
            error instanceof Error ? error.message : String(error),
          );
        }
      },
    ),
    tool(
      'video_list_transition_presets',
      'Return the timeline transition preset catalog with duration constraints, direction support, preview support, and renderer fallbacks. This tool is read-only.',
      { projectId: PROJECT_ID_SCHEMA },
      async ({ projectId }) => {
        try {
          const resolvedProjectId = resolveProjectId(projectId, options);
          return jsonResult({
            schema: 'neuma.video.transition-presets.v1',
            projectId: resolvedProjectId,
            presets: transitionPresetCatalog(),
          });
        } catch (error) {
          return errorResult(
            error instanceof Error ? error.message : String(error),
          );
        }
      },
    ),
    tool(
      'video_list_effect_presets',
      'Return the installed clip-effect catalog with closed parameter ranges and defaults. This tool is read-only.',
      { projectId: PROJECT_ID_SCHEMA },
      async ({ projectId }) => {
        try {
          return jsonResult({
            schema: 'neuma.video.effect-presets.v1',
            projectId: resolveProjectId(projectId, options),
            presets: CLIP_EFFECT_CATALOG,
          });
        } catch (error) {
          return errorResult(
            error instanceof Error ? error.message : String(error),
          );
        }
      },
    ),
    tool(
      'video_list_overlay_presets',
      'Return the vivid-overlay preset catalog: id, category, tags (the video-to-template classifier label space), control schema, durations, placement metadata, and optional taste metadata for routing choices. Use this to pick the closest preset when recreating an overlay seen in reference footage. This tool is read-only.',
      {
        projectId: PROJECT_ID_SCHEMA,
        category: z.string().min(1).optional(),
      },
      async ({ projectId, category }) => {
        try {
          const resolvedProjectId = resolveProjectId(projectId, options);
          const catalog: readonly VividOverlayPresetDef[] =
            VIDEO_OVERLAY_REGISTRY;
          const presets = catalog
            .filter((preset) => !category || preset.category === category)
            .map((preset) => ({
              id: preset.id,
              backend: preset.backend,
              category: preset.category,
              tags: preset.tags ?? [],
              controls: preset.controls.map((control) => ({
                id: control.id,
                type: control.type,
                defaultValue: control.defaultValue,
                min: control.min,
                max: control.max,
                step: control.step,
                options: control.options,
              })),
              requiresSourceAsset: preset.requiresSourceAsset ?? false,
              defaultDurationMs: preset.defaultDurationMs,
              minDurationMs: preset.minDurationMs,
              aspectAffinity: preset.aspectAffinity ?? 'any',
              anchor: preset.anchor ?? 'center',
              taste: preset.taste,
            }));
          return jsonResult({
            schema: 'neuma.video.overlay-presets.v1',
            projectId: resolvedProjectId,
            presets,
          });
        } catch (error) {
          return errorResult(
            error instanceof Error ? error.message : String(error),
          );
        }
      },
    ),
    tool(
      'video_save_overlay_preset',
      'Save a derived overlay preset to the user\'s "My overlays" library: a built-in base preset plus control values (extracted text, colors, sizes) and loop mode. Use after matching reference footage to the closest catalog preset via video_list_overlay_presets. Color values accept CSS names and are normalized to hex.',
      {
        projectId: PROJECT_ID_SCHEMA,
        reasoning: REASONING_SCHEMA,
        name: z.string().min(1).max(80),
        basePresetId: z.string().min(1),
        controls: z.record(
          z.string(),
          z.union([z.string(), z.number(), z.boolean()]),
        ),
        loop: z.enum(['loop', 'hold', 'none']).optional(),
      },
      async ({ projectId, name, basePresetId, controls, loop }) => {
        try {
          const proposal = await proposalOnlyServiceMutationResult(
            projectId,
            options,
            'video_save_overlay_preset',
          );
          if (proposal) return proposal;
          const resolvedProjectId = resolveProjectId(projectId, options);
          const normalized = normalizeOverlayControlValues(
            basePresetId,
            controls,
          );
          const preset = await saveUserOverlayPreset({
            name,
            basePresetId,
            controls: normalized,
            loop,
          });
          return jsonResult({
            schema: 'neuma.video.user-overlay-preset.v1',
            projectId: resolvedProjectId,
            preset,
          });
        } catch (error) {
          return errorResult(
            error instanceof Error ? error.message : String(error),
          );
        }
      },
    ),
    tool(
      'video_save_overlay_style_from_template',
      'Save the video-to-template v2 result as a reusable overlay style: closest built-in preset plus extracted controls, optional transform/keyframes/tags, and video-to-template provenance. Prefer this over video_save_overlay_preset when the reference overlay includes placement, scale, opacity, or motion that should remain editable.',
      {
        projectId: PROJECT_ID_SCHEMA,
        reasoning: REASONING_SCHEMA,
        name: z.string().min(1).max(80),
        basePresetId: z.string().min(1),
        controls: z.record(z.string(), OVERLAY_CONTROL_VALUE_SCHEMA),
        loop: z.enum(['loop', 'hold', 'none']).optional(),
        transform: OVERLAY_STYLE_TRANSFORM_SCHEMA.optional(),
        keyframes: z.array(KeyframeTrackSchema).max(50).optional(),
        tags: z.array(z.string().min(1).max(40)).max(24).optional(),
        sourceId: z.string().min(1).optional(),
      },
      async ({
        projectId,
        name,
        basePresetId,
        controls,
        loop,
        transform,
        keyframes,
        tags,
        sourceId,
      }) => {
        try {
          const proposal = await proposalOnlyServiceMutationResult(
            projectId,
            options,
            'video_save_overlay_style_from_template',
          );
          if (proposal) return proposal;
          const resolvedProjectId = resolveProjectId(projectId, options);
          const style = await saveUserOverlayStyle({
            name,
            basePresetId,
            controls: normalizeOverlayControlValues(basePresetId, controls),
            loop,
            transform,
            keyframes,
            tags,
            provenance: {
              kind: 'video-to-template',
              ...(sourceId ? { sourceId } : {}),
            },
          });
          return jsonResult({
            schema: 'neuma.video.user-overlay-style.v1',
            projectId: resolvedProjectId,
            style,
          });
        } catch (error) {
          return errorResult(
            error instanceof UserOverlayStyleError
              ? error.message
              : error instanceof Error
                ? error.message
                : String(error),
          );
        }
      },
    ),
    tool(
      'video_save_user_overlay_document',
      "Save an explicitly approved custom vivid-overlay HTML document after linting it with Neuma's deterministic overlay authoring contract. Only call when the user has opted into custom document synthesis; otherwise use video_save_overlay_style_from_template.",
      {
        projectId: PROJECT_ID_SCHEMA,
        reasoning: REASONING_SCHEMA,
        userConfirmed: z.literal(true),
        name: z.string().min(1).max(80),
        html: z.string().min(1).max(200_000),
        controls: z
          .array(USER_OVERLAY_DOCUMENT_CONTROL_SCHEMA)
          .max(40)
          .optional(),
        tags: z.array(z.string().min(1).max(40)).max(24).optional(),
        provenanceKind: z
          .enum(['agent', 'video-to-template'])
          .default('video-to-template'),
        sourceId: z.string().min(1).optional(),
      },
      async ({
        projectId,
        userConfirmed,
        name,
        html,
        controls,
        tags,
        provenanceKind,
        sourceId,
      }) => {
        try {
          const proposal = await proposalOnlyServiceMutationResult(
            projectId,
            options,
            'video_save_user_overlay_document',
          );
          if (proposal) return proposal;
          const resolvedProjectId = resolveProjectId(projectId, options);
          const document = await saveUserOverlayDocument({
            name,
            html,
            controls,
            tags,
            userConfirmed,
            provenance: {
              kind: provenanceKind ?? 'video-to-template',
              ...(sourceId ? { sourceId } : {}),
            },
          });
          return jsonResult({
            schema: 'neuma.video.user-overlay-document.v1',
            projectId: resolvedProjectId,
            document,
          });
        } catch (error) {
          if (error instanceof UserOverlayDocumentError) {
            return errorResult(
              JSON.stringify({
                error: error.message,
                code: error.code,
                issues: error.issues,
              }),
            );
          }
          return errorResult(
            error instanceof Error ? error.message : String(error),
          );
        }
      },
    ),
    tool(
      'video_get_transition_seams',
      'Return editable timeline transition seams with seam IDs, adjacent clip context, duration constraints, current transitions, and blocked reasons. This tool is read-only.',
      {
        projectId: PROJECT_ID_SCHEMA,
        seamIds: z
          .array(z.string().min(1))
          .max(50)
          .optional()
          .describe('Optional seam IDs to filter to.'),
      },
      async ({ projectId, seamIds }) => {
        try {
          const project = await loadProjectForTool(projectId, options);
          const requested = new Set(seamIds ?? []);
          const seams = deriveTimelineTransitionSeams(project).filter(
            (seam) => requested.size === 0 || requested.has(seam.seamId),
          );
          return jsonResult({
            schema: 'neuma.video.transition-seams.v1',
            projectId: project.id,
            timelinePresent: Boolean(project.timeline),
            seamCount: seams.length,
            seams,
          });
        } catch (error) {
          return errorResult(
            error instanceof Error ? error.message : String(error),
          );
        }
      },
    ),
    tool(
      'video_list_engines',
      'List the registered video render engines (id, name, version, installed, capabilities). ' +
        'Read-only. Surfaces the engine adapter seam from dev-doc/html-video Phase 1.',
      {},
      async () => {
        try {
          const engines = await listVideoEnginesWithBuiltins();
          return jsonResult({ engines });
        } catch (error) {
          return errorResult(
            error instanceof Error ? error.message : String(error),
          );
        }
      },
    ),
    tool(
      'video_get_html_selection',
      'Read the element currently selected in the managed HyperFrames Studio preview. Prefer the stable data-hf-id target; if no element is selected, ask the user to click it in Studio.',
      {
        projectId: PROJECT_ID_SCHEMA,
        compositionDir: z.string().min(1).max(500).default('hyperframes'),
      },
      async ({ projectId, compositionDir }) => {
        try {
          const resolvedProjectId = resolveProjectId(projectId, options);
          const projectDir = resolveHyperframesStudioProjectDir(
            getVideoProjectRoot(resolvedProjectId),
            compositionDir,
          );
          const selection =
            await getHyperframesStudioBridge().getSelection(projectDir);
          return jsonResult({
            schema: 'neuma.video.hyperframes-selection.v1',
            projectId: resolvedProjectId,
            selection,
            contextTarget: selection.stableTarget,
          });
        } catch (error) {
          if (
            error instanceof HyperframesStudioError &&
            error.code === 'no-selection'
          ) {
            return errorResult(
              'No element is selected in HyperFrames Studio. Ask the user to click the target element, then retry.',
            );
          }
          return errorResult(
            error instanceof Error ? error.message : String(error),
          );
        }
      },
    ),
    tool(
      'video_search_templates',
      'Search the video template gallery by category, tags, engine, and ' +
        'license. Read-only. Applies license gating at selection (RFC-07): ' +
        'failing templates are returned in `filteredOut` with a reason, ' +
        'never silently dropped.',
      {
        category: z.string().min(1).optional(),
        tags: z.array(z.string().min(1)).optional(),
        engine: z.string().min(1).optional(),
        search: z.string().min(1).optional(),
        requireCommercialUse: z.boolean().optional(),
        requireRedistributable: z.boolean().optional(),
      },
      async (filters) => {
        try {
          const roots = resolveDefaultTemplateGalleryRoots(
            activeWorkspaceRoot(options),
          );
          const gallery = await loadTemplateGallery(roots);
          const result = searchTemplates(gallery.templates, filters);
          return jsonResult({
            ...result,
            galleryIssues: gallery.issues,
          });
        } catch (error) {
          return errorResult(
            error instanceof Error ? error.message : String(error),
          );
        }
      },
    ),
    tool(
      'video_list_custom_templates',
      'List only user-created folder-gallery templates. Read-only. ' +
        'Use this to distinguish saved HTML/Motion templates in ' +
        '<workDir>/.neuma/video-templates from built-in branded templates.',
      {
        engine: z.string().min(1).optional(),
        category: z.string().min(1).optional(),
      },
      async ({ engine, category }) => {
        try {
          const roots = resolveDefaultTemplateGalleryRoots(
            activeWorkspaceRoot(options),
          );
          const gallery = await loadTemplateGallery({ ...roots, ttlMs: 0 });
          const templates = gallery.templates
            .filter((template) => template.rootKind === 'user')
            .filter((template) =>
              engine ? template.metadata.engine === engine : true,
            )
            .filter((template) =>
              category ? template.metadata.category === category : true,
            )
            .map((template) => ({
              id: template.id,
              name: template.metadata.name,
              description: template.metadata.description,
              engine: template.metadata.engine,
              category: template.metadata.category,
              tags: template.metadata.tags ?? [],
              license: template.metadata.license,
              warnings: template.warnings,
            }));
          return jsonResult({
            templates,
            galleryIssues: gallery.issues.filter(
              (issue) => issue.rootDir === roots.userRoot,
            ),
          });
        } catch (error) {
          return errorResult(
            error instanceof Error ? error.message : String(error),
          );
        }
      },
    ),
    tool(
      'video_inspect_template',
      "Return a single template's metadata, computed FormSpec, provenance " +
        'status, and inputs.examples. Read-only.',
      {
        templateId: z.string().min(1),
      },
      async ({ templateId }) => {
        try {
          const roots = resolveDefaultTemplateGalleryRoots(
            activeWorkspaceRoot(options),
          );
          const gallery = await loadTemplateGallery(roots);
          const template = gallery.templates.find((t) => t.id === templateId);
          if (!template) {
            return errorResult(
              `video_inspect_template: template "${templateId}" not found in ` +
                `${roots.userRoot} or ${roots.brandingRoot}. ` +
                `Issues: ${JSON.stringify(gallery.issues)}`,
            );
          }
          return jsonResult(inspectTemplate(template));
        } catch (error) {
          return errorResult(
            error instanceof Error ? error.message : String(error),
          );
        }
      },
    ),
    tool(
      'video_fetch_source',
      'Fetch and extract readable text (Markdown) from a public article URL ' +
        'or GitHub repo to use as source material for a video. Read-only. ' +
        'HTTPS only; private, loopback, and cloud-metadata addresses are ' +
        'blocked. Returns the extracted markdown plus a provenance partial to ' +
        'stamp onto any MediaItem derived from the source.',
      {
        url: z.string().url(),
      },
      async ({ url }) => {
        try {
          const source = await fetchSource(url);
          return jsonResult({
            source,
            provenance: buildSourceProvenance(source),
          });
        } catch (error) {
          if (error instanceof SourceIngestError) {
            return errorResult(`${error.code}: ${error.message}`);
          }
          return errorResult(
            error instanceof Error ? error.message : String(error),
          );
        }
      },
    ),
    tool(
      'video_record_research_brief',
      'Persist a grounded research brief for storyboard drafting. Call this after using WebSearch/WebFetch or video_fetch_source so future scene intents, captions, and b-roll queries can reuse the findings and citations.',
      {
        projectId: PROJECT_ID_SCHEMA,
        topic: z.string().min(1).max(240),
        depth: z.enum(['quick', 'standard', 'deep']).optional(),
        findings: z.array(z.string().min(1).max(1000)).min(1).max(20),
        facts: z
          .record(z.string().min(1).max(120), z.string().min(1).max(1000))
          .optional(),
        suggestedBeats: z.array(z.string().min(1).max(500)).max(20).optional(),
        citations: z.array(RESEARCH_CITATION_SCHEMA).max(20).optional(),
      },
      async (input) => {
        try {
          const proposal = await proposalOnlyServiceMutationResult(
            input.projectId,
            options,
            'video_record_research_brief',
          );
          if (proposal) return proposal;
          const projectId = resolveProjectId(input.projectId, options);
          const result = await recordVideoResearchBrief(projectId, {
            topic: input.topic,
            depth: input.depth,
            findings: input.findings,
            facts: input.facts,
            suggestedBeats: input.suggestedBeats,
            citations: input.citations,
          });
          return jsonResult({
            projectId,
            updatedAt: result.project.updatedAt,
            topic: result.brief.topic,
            findingCount: result.brief.findings.length,
            citationCount: result.brief.citations.length,
          });
        } catch (error) {
          return errorResult(
            error instanceof Error ? error.message : String(error),
          );
        }
      },
    ),
    tool(
      'video_get_content_graph',
      'Return the persisted content-graph (narrative IR) for the active ' +
        'project, or null if none has been written yet. Read-only. Use this to ' +
        'see frames authored in the UI or by a prior turn before editing or ' +
        'rendering.',
      {
        projectId: PROJECT_ID_SCHEMA,
      },
      async ({ projectId }) => {
        try {
          const resolvedProjectId = resolveProjectId(projectId, options);
          const graph = await readContentGraph(resolvedProjectId);
          return jsonResult({ projectId: resolvedProjectId, graph });
        } catch (error) {
          return errorResult(
            error instanceof Error ? error.message : String(error),
          );
        }
      },
    ),
    tool(
      'video_analyze_image',
      'Analyze a project image with a vision model to locate its focal subject ' +
        '(face/person/object/text) and get a suggested Ken Burns plan that zooms ' +
        'toward it. Use before placing a photo as an image-pan scene so the ' +
        'pan/zoom lands on what matters. Returns { description, subject, focus, ' +
        'kenBurns: { from, to } } — pass kenBurns straight into the image-pan ' +
        'assetPlan. Hydrates referenced/cloud images first.',
      {
        projectId: PROJECT_ID_SCHEMA,
        assetId: z.string().min(1),
      },
      async (input) => {
        try {
          const projectId = resolveProjectId(input.projectId, options);
          let project = await getProject(projectId);
          let asset = project.assets.find((item) => item.id === input.assetId);
          if (!asset) return errorResult(`Asset not found: ${input.assetId}`);
          if (asset.kind !== 'image') {
            return errorResult(
              'video_analyze_image only supports image assets',
            );
          }
          if (isReferencedProjectAsset(asset)) {
            const proposal = await proposalOnlyServiceMutationResult(
              input.projectId,
              options,
              'video_analyze_image',
            );
            if (proposal) return proposal;
            const hydrated = await hydrateProjectAsset(projectId, asset.id, {
              role: 'asset',
            });
            project = hydrated.project;
            asset = hydrated.asset;
          }
          const filePath = validatePath(
            asset.path,
            getVideoProjectRoot(projectId),
            'read',
          );
          const analysis = await analyzeImageFocalPoint(
            filePath,
            mimeTypeForPath(asset.path),
          );
          return jsonResult({ projectId, assetId: asset.id, ...analysis });
        } catch (error) {
          return errorResult(
            error instanceof Error ? error.message : String(error),
          );
        }
      },
    ),
    tool(
      'video_set_aspect_ratio',
      'Set the project output aspect ratio (16:9, 9:16, 1:1, 4:5). Use this when ' +
        'the target orientation differs from the project default — e.g. building a ' +
        'video from a 9:16 vertical reference in a 16:9 project, or replicating a ' +
        'reference template. Detect the reference orientation with ' +
        'video_analyze_assets (or the source video dimensions); if you are unsure ' +
        'which orientation the user wants, ask before changing. Applies to the ' +
        'whole project (preview + render).',
      {
        projectId: PROJECT_ID_SCHEMA,
        aspect: z.enum(['16:9', '9:16', '1:1', '4:5']),
      },
      async (input) => {
        try {
          const proposal = await proposalOnlyServiceMutationResult(
            input.projectId,
            options,
            'video_set_aspect_ratio',
          );
          if (proposal) return proposal;
          const projectId = resolveProjectId(input.projectId, options);
          await setVideoProjectAspectRatio(projectId, input.aspect);
          return jsonResult({ projectId, aspect: input.aspect });
        } catch (error) {
          return errorResult(
            error instanceof Error ? error.message : String(error),
          );
        }
      },
    ),
    tool(
      'video_analyze_assets',
      'Pre-flight analysis for the analysis/planning phase. For every ' +
        'image/video project asset, compares its aspect ratio to the target ' +
        'canvas and returns width/height, aspectLabel, orientation, cropLossPct, ' +
        'a recommended fit (cover/contain/pan/ask) and a needsDecision flag. ' +
        "Also returns each asset's capturedAt (when known) with orderBasis " +
        '(captured-at | filename | filename-sequence | name), gps {lat,lng} ' +
        'when known, per-asset isLikelyLogo, a top-level suggestedOrder array, ' +
        'and logoAssetIds. suggestedOrder is always best-effort: it degrades ' +
        'from capture time → a timestamp in the filename → a sequence number ' +
        '(IMG_0001) → natural name order, so there is always a proposed ' +
        'sequence even with no EXIF. orderBasis tells you how confident that ' +
        'order is. Computed from metadata only (no download). Call this BEFORE ' +
        'building the storyboard: follow suggestedOrder rather than attach ' +
        'order, use gps to cluster consecutive same-location shots into ' +
        'segments, place logoAssetIds as an intro/outro title or bookend rather ' +
        'than inline, and when needsDecision is true ask the user how to treat ' +
        'that asset.',
      {
        projectId: PROJECT_ID_SCHEMA,
        aspect: z.enum(['16:9', '9:16', '1:1', '4:5']).optional(),
      },
      async (input) => {
        try {
          const projectId = resolveProjectId(input.projectId, options);
          const project = await getProject(projectId);
          const target =
            input.aspect ??
            project.settings?.defaultAspectRatios?.[0] ??
            '16:9';
          return jsonResult({
            projectId,
            ...analyzeProjectAssets(project, target),
          });
        } catch (error) {
          return errorResult(
            error instanceof Error ? error.message : String(error),
          );
        }
      },
    ),
    tool(
      'video_import_youtube',
      'Download a YouTube video by URL into the project as a video asset (yt-dlp) ' +
        'so it can be placed on the timeline. Use this when the user pastes a ' +
        'YouTube link to use as footage — do not web-fetch the page. Downloads ' +
        'directly without any rights/copyright confirmation. On success returns ' +
        'the new assetId; then place it on a scene (e.g. as scene 1 via ' +
        'set_storyboard with an "existing" plan).',
      {
        projectId: PROJECT_ID_SCHEMA,
        url: z.string().url(),
        maxDurationSec: z.number().int().positive().max(3600).optional(),
      },
      async (input) => {
        try {
          const proposal = await proposalOnlyServiceMutationResult(
            input.projectId,
            options,
            'video_import_youtube',
          );
          if (proposal) return proposal;
          const projectId = resolveProjectId(input.projectId, options);
          const result = await importYoutubeBroll(
            projectId,
            {
              url: input.url,
              // Copyright gate intentionally disabled — always allow.
              rightsAcknowledged: true,
              ...(input.maxDurationSec
                ? { maxDurationSec: input.maxDurationSec }
                : {}),
            },
            { capabilityGranted: options.youtubeImportGranted ?? true },
          );
          return jsonResult({
            projectId,
            assetId: result.asset.id,
            name: result.asset.provenance?.sourceDisplayName,
            kind: result.asset.kind,
            durationMs: result.asset.metadata.durationMs,
          });
        } catch (error) {
          return errorResult(
            error instanceof Error ? error.message : String(error),
          );
        }
      },
    ),
    ...createVideoEditMutationTools(options),
  ];
}

function frameRateForTimeline(
  timeline: VideoProject['timeline'] | undefined,
): FrameRate {
  return normalizeFrameRate(
    timeline?.frameRate ?? timeline?.fps ?? DEFAULT_TIMELINE_FPS,
  );
}

function mimeTypeForPath(path: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  if (ext === 'png') return 'image/png';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'webp') return 'image/webp';
  return 'image/jpeg';
}

function createVideoEditMutationTools(options: VideoEditServerOptions = {}) {
  return [
    tool(
      'video_select_template',
      'Pick a template from the gallery for the active project. ' +
        'Persists the selection so the render queue compiles the next ' +
        'content-graph against this template.',
      {
        projectId: PROJECT_ID_SCHEMA,
        templateId: z.string().min(1),
      },
      async ({ projectId, templateId }) => {
        try {
          const proposal = await proposalOnlyServiceMutationResult(
            projectId,
            options,
            'video_select_template',
          );
          if (proposal) return proposal;
          const resolvedProjectId = resolveProjectId(projectId, options);
          // Verify the template exists in the gallery before persisting.
          const roots = resolveDefaultTemplateGalleryRoots(
            getVideoProjectRoot(resolvedProjectId),
          );
          const gallery = await loadTemplateGallery(roots);
          const found = gallery.templates.find((t) => t.id === templateId);
          if (!found) {
            return errorResult(
              `video_select_template: "${templateId}" not found in the ` +
                `gallery (user root or branding default).`,
            );
          }
          await selectTemplate(resolvedProjectId, templateId);
          return jsonResult({
            projectId: resolvedProjectId,
            templateId,
            engine: found.metadata.engine,
            category: found.metadata.category,
          });
        } catch (error) {
          return errorResult(
            error instanceof Error ? error.message : String(error),
          );
        }
      },
    ),
    tool(
      'video_save_as_template',
      'Save the active project as a reusable video template. If the project ' +
        'has a content-graph, saves an HTML/Motion folder template under ' +
        '<workDir>/.neuma/video-templates; otherwise saves the storyboard ' +
        'template JSON under the video template namespace.',
      {
        projectId: PROJECT_ID_SCHEMA,
        displayName: z.string().min(1).max(120),
        category: VIDEO_TEMPLATE_CATEGORY_SCHEMA,
        license: VIDEO_TEMPLATE_LICENSE_SCHEMA.default('proprietary'),
      },
      async ({ projectId, displayName, category, license }) => {
        try {
          const proposal = await proposalOnlyServiceMutationResult(
            projectId,
            options,
            'video_save_as_template',
          );
          if (proposal) return proposal;
          const resolvedProjectId = resolveProjectId(projectId, options);
          const template = await saveProjectAsTemplate(resolvedProjectId, {
            displayName,
            category,
            license,
          });
          return jsonResult({
            projectId: resolvedProjectId,
            template: {
              id: template.id,
              displayName: template.displayName,
              source: template.source,
              category: template.category,
              engine:
                template.html?.engine ?? template.renderer ?? 'storyboard',
              hasHtml: Boolean(template.html),
            },
          });
        } catch (error) {
          return errorResult(
            error instanceof Error ? error.message : String(error),
          );
        }
      },
    ),
    tool(
      'video_write_content_graph',
      'Persist a Phase 2 content-graph (narrative IR) for the active ' +
        'project. Zod-validated; the render queue compiles + materializes ' +
        'on the next render trigger. By default, prunes per-frame HTML ' +
        'overrides whose nodeIds left the graph.',
      {
        projectId: PROJECT_ID_SCHEMA,
        graph: z
          .unknown()
          .describe(
            'The full ContentGraph (see @neumar/video-ir ContentGraphSchema).',
          ),
        preserveFrames: z.boolean().optional(),
      },
      async ({ projectId, graph, preserveFrames }) => {
        try {
          const proposal = await proposalOnlyServiceMutationResult(
            projectId,
            options,
            'video_write_content_graph',
          );
          if (proposal) return proposal;
          const resolvedProjectId = resolveProjectId(projectId, options);
          const parsed = ContentGraphSchema.safeParse(graph);
          if (!parsed.success) {
            return errorResult(
              'video_write_content_graph: ContentGraph validation failed: ' +
                parsed.error.issues
                  .map((i) => `${i.path.join('.')}: ${i.message}`)
                  .join('; '),
            );
          }
          await writeContentGraph(resolvedProjectId, parsed.data);
          let prunedNodeIds: string[] = [];
          if (!preserveFrames) {
            prunedNodeIds = await pruneStaleFrameOverrides(
              resolvedProjectId,
              parsed.data,
            );
          }
          return jsonResult({
            projectId: resolvedProjectId,
            nodeCount: parsed.data.nodes.length,
            edgeCount: parsed.data.edges.length,
            prunedFrameOverrides: prunedNodeIds,
          });
        } catch (error) {
          return errorResult(
            error instanceof Error ? error.message : String(error),
          );
        }
      },
    ),
    tool(
      'video_write_frame_html',
      'Persist a per-frame HTML override for a given content-graph node. ' +
        'The override replaces the template source/index.html for that ' +
        'scene at render time; variable injection still runs on top. ' +
        'Safe because the render context is an isolated Chromium with no ' +
        'Neuma origin (dev-doc/html-video/06-06/05).',
      {
        projectId: PROJECT_ID_SCHEMA,
        nodeId: z.string().min(1),
        html: z
          .string()
          .min(1)
          .max(2 * 1024 * 1024)
          .refine((s) => Buffer.byteLength(s, 'utf8') <= 2 * 1024 * 1024, {
            message: 'html exceeds 2 MiB (UTF-8 bytes)',
          }),
      },
      async ({ projectId, nodeId, html }) => {
        try {
          const proposal = await proposalOnlyServiceMutationResult(
            projectId,
            options,
            'video_write_frame_html',
          );
          if (proposal) return proposal;
          const resolvedProjectId = resolveProjectId(projectId, options);
          await writeFrameHtml(resolvedProjectId, nodeId, html);
          return jsonResult({
            projectId: resolvedProjectId,
            nodeId,
            bytes: Buffer.byteLength(html, 'utf8'),
          });
        } catch (error) {
          return errorResult(
            error instanceof Error ? error.message : String(error),
          );
        }
      },
    ),
    tool(
      'video_set_frame_native_enhancement',
      'Enable or disable a native Remotion enhancement for one data frame. ' +
        'Use this when a content-graph data node should render with the ' +
        'native frame-data-rollup template instead of the selected HTML ' +
        'frame template. Disabling is non-destructive; any HTML frame ' +
        'override remains on disk.',
      {
        projectId: PROJECT_ID_SCHEMA,
        nodeId: z.string().min(1),
        enabled: z.boolean(),
        nativeTemplateId: z.string().min(1).optional(),
      },
      async ({ projectId, nodeId, enabled, nativeTemplateId }) => {
        try {
          const proposal = await proposalOnlyServiceMutationResult(
            projectId,
            options,
            'video_set_frame_native_enhancement',
          );
          if (proposal) return proposal;
          const resolvedProjectId = resolveProjectId(projectId, options);
          const result = await setFrameNativeEnhancement(
            resolvedProjectId,
            nodeId,
            { enabled, nativeTemplateId },
          );
          return jsonResult({
            projectId: resolvedProjectId,
            nodeId: result.nodeId,
            enabled: result.enabled,
            nativeTemplateId: result.nativeTemplateId,
          });
        } catch (error) {
          return errorResult(
            error instanceof Error ? error.message : String(error),
          );
        }
      },
    ),
    tool(
      'video_draft_narration',
      'Draft per-frame spoken narration from the project content-graph. Call ' +
        'with NO lines to list the frames to narrate (in render order); then ' +
        'call again with `linesByFrame` (a map of content-graph node id → one ' +
        'short spoken sentence for that frame), or `frameId` + `line` for a ' +
        'single frame. Lines are persisted to the project soundtrack ' +
        '(narrationByFrame); an empty string skips narration on that frame.',
      {
        projectId: PROJECT_ID_SCHEMA,
        linesByFrame: z
          .record(z.string().min(1), z.string().max(1000))
          .optional()
          .describe(
            'Map of content-graph node id → spoken line for the frame.',
          ),
        frameId: z
          .string()
          .min(1)
          .optional()
          .describe('Single content-graph node id to narrate (with `line`).'),
        line: z
          .string()
          .max(1000)
          .optional()
          .describe('The spoken line for `frameId`.'),
      },
      async ({ projectId, linesByFrame, frameId, line }) => {
        try {
          const resolvedProjectId = resolveProjectId(projectId, options);
          const hasLines =
            linesByFrame !== undefined ||
            frameId !== undefined ||
            line !== undefined;
          if (!hasLines) {
            // Discovery: hand the agent the frames + an instruction to write.
            const { frames, synopsis } =
              await getNarrationFrames(resolvedProjectId);
            return jsonResult({
              projectId: resolvedProjectId,
              frames,
              ...(synopsis ? { synopsis } : {}),
              instruction:
                'Write ONE short spoken sentence per frame — distinct, in the ' +
                'frame language, plain text. Then call video_draft_narration ' +
                'again with linesByFrame keyed by each frame id.',
            });
          }
          const proposal = await proposalOnlyServiceMutationResult(
            projectId,
            options,
            'video_draft_narration',
          );
          if (proposal) return proposal;
          const result = await applyNarrationDraft(resolvedProjectId, {
            ...(linesByFrame ? { linesByFrame } : {}),
            ...(frameId !== undefined ? { frameId } : {}),
            ...(line !== undefined ? { line } : {}),
          });
          return jsonResult({ projectId: resolvedProjectId, ...result });
        } catch (error) {
          if (error instanceof NarrationDraftError) {
            return errorResult(`${error.code}: ${error.message}`);
          }
          return errorResult(
            error instanceof Error ? error.message : String(error),
          );
        }
      },
    ),
    tool(
      'video_estimate_plan',
      'Build or refresh the render plan for the active project.',
      { projectId: PROJECT_ID_SCHEMA, reasoning: REASONING_SCHEMA },
      async (input) => {
        const { projectId, call } = camelToolCall('estimatePlan', input);
        return toolCallResult(projectId, options, call);
      },
    ),
    tool(
      'video_add_scene',
      'Add a storyboard scene.',
      {
        projectId: PROJECT_ID_SCHEMA,
        reasoning: REASONING_SCHEMA,
        afterSceneId: z.string().min(1).optional(),
        intent: z.string().min(1),
        durationMs: z.number().int().positive(),
        captionText: z.string().min(1).optional(),
        aspectRatio: ASPECT_RATIO_SCHEMA.optional(),
      },
      async (input) => {
        const { projectId, call } = camelToolCall('addScene', input);
        return toolCallResult(projectId, options, call);
      },
    ),
    tool(
      'video_split_scene',
      'Split a storyboard scene at a timestamp.',
      {
        projectId: PROJECT_ID_SCHEMA,
        reasoning: REASONING_SCHEMA,
        sceneId: z.string().min(1),
        atMs: z.number().int().positive(),
      },
      async (input) => {
        const { projectId, call } = camelToolCall('splitScene', input);
        return toolCallResult(projectId, options, call);
      },
    ),
    tool(
      'video_remove_scene',
      'Remove a storyboard scene.',
      {
        projectId: PROJECT_ID_SCHEMA,
        reasoning: REASONING_SCHEMA,
        sceneId: z.string().min(1),
      },
      async (input) => {
        const { projectId, call } = camelToolCall('removeScene', input);
        return toolCallResult(projectId, options, call);
      },
    ),
    tool(
      'video_reorder_scenes',
      'Replace the storyboard scene order.',
      {
        projectId: PROJECT_ID_SCHEMA,
        reasoning: REASONING_SCHEMA,
        order: z.array(z.string().min(1)).min(1),
      },
      async (input) => {
        const { projectId, call } = camelToolCall('reorderScenes', input);
        return toolCallResult(projectId, options, call);
      },
    ),
    tool(
      'video_set_duration',
      'Set a storyboard scene duration.',
      {
        projectId: PROJECT_ID_SCHEMA,
        reasoning: REASONING_SCHEMA,
        sceneId: z.string().min(1),
        durationMs: z.number().int().positive(),
      },
      async (input) => {
        const { projectId, call } = camelToolCall('setDuration', input);
        return toolCallResult(projectId, options, call);
      },
    ),
    tool(
      'video_set_transition',
      'Set the transition after a storyboard scene.',
      {
        projectId: PROJECT_ID_SCHEMA,
        reasoning: REASONING_SCHEMA,
        sceneId: z.string().min(1),
        transition: TRANSITION_SCHEMA,
      },
      async (input) => {
        const { projectId, call } = camelToolCall('setTransition', input);
        return toolCallResult(projectId, options, call);
      },
    ),
    tool(
      'video_set_timeline_transition',
      'Set a transition on a timeline seam. Distinct from video_set_transition, which edits storyboard scene transitions.',
      {
        projectId: PROJECT_ID_SCHEMA,
        reasoning: REASONING_SCHEMA,
        seamId: z.string().min(1),
        transition: TRANSITION_SCHEMA,
        summary: z.string().max(280).optional(),
        applyMode: NAMED_EDIT_APPLY_MODE_SCHEMA.default('auto'),
      },
      async (input) =>
        transitionSeamEditResult(
          input,
          options,
          'video_set_timeline_transition',
        ),
    ),
    tool(
      'video_update_timeline_transition',
      'Update an existing timeline seam transition after resolving seam constraints. Use video_set_timeline_transition when the seam currently has a cut.',
      {
        projectId: PROJECT_ID_SCHEMA,
        reasoning: REASONING_SCHEMA,
        seamId: z.string().min(1),
        transition: TRANSITION_SCHEMA,
        summary: z.string().max(280).optional(),
        applyMode: NAMED_EDIT_APPLY_MODE_SCHEMA.default('auto'),
      },
      async (input) =>
        transitionSeamEditResult(
          { ...input, requireExisting: true },
          options,
          'video_update_timeline_transition',
        ),
    ),
    tool(
      'video_remove_timeline_transition',
      'Remove the transition on a timeline seam, leaving a direct cut.',
      {
        projectId: PROJECT_ID_SCHEMA,
        reasoning: REASONING_SCHEMA,
        seamId: z.string().min(1),
        summary: z.string().max(280).optional(),
        applyMode: NAMED_EDIT_APPLY_MODE_SCHEMA.default('auto'),
      },
      async (input) =>
        transitionSeamEditResult(
          { ...input, transition: undefined },
          options,
          'video_remove_timeline_transition',
        ),
    ),
    tool(
      'video_suggest_timeline_transitions',
      'Suggest timeline transition changes using conservative editorial grammar. No change is a valid suggestion; proposed changes are emitted as existing timeline proposal ops.',
      {
        projectId: PROJECT_ID_SCHEMA,
        reasoning: REASONING_SCHEMA,
        seamIds: z.array(z.string().min(1)).max(50).optional(),
        intentText: z
          .string()
          .min(1)
          .optional()
          .describe(
            'User editing intent, e.g. smoother montage or remove flashy transitions.',
          ),
        maxChanges: z.number().int().min(1).max(20).optional(),
        summary: z.string().max(280).optional(),
        applyMode: TIMELINE_PROPOSAL_APPLY_MODE_SCHEMA.default('suggest'),
      },
      async (input) => timelineTransitionSuggestionResult(input, options),
    ),
    tool(
      'video_set_timeline_bookend',
      'Set an intro or outro timeline fade.',
      {
        projectId: PROJECT_ID_SCHEMA,
        reasoning: REASONING_SCHEMA,
        position: BOOKEND_POSITION_SCHEMA,
        kind: z.literal('fade'),
        durationMs: z.number().int().min(33).max(3000),
      },
      async (input) => {
        const { projectId, call } = camelToolCall('setTimelineBookend', input);
        return toolCallResult(projectId, options, call);
      },
    ),
    tool(
      'video_clear_timeline_bookend',
      'Clear an intro or outro timeline fade.',
      {
        projectId: PROJECT_ID_SCHEMA,
        reasoning: REASONING_SCHEMA,
        position: BOOKEND_POSITION_SCHEMA,
      },
      async (input) => {
        const { projectId, call } = camelToolCall(
          'clearTimelineBookend',
          input,
        );
        return toolCallResult(projectId, options, call);
      },
    ),
    tool(
      'video_set_clip_audio_seam',
      'Set how a visual clip audio seam behaves at the next boundary.',
      {
        projectId: PROJECT_ID_SCHEMA,
        reasoning: REASONING_SCHEMA,
        clipId: z.string().min(1),
        mode: AUDIO_SEAM_SCHEMA,
      },
      async (input) => {
        const { projectId, call } = camelToolCall('setClipAudioSeam', input);
        return toolCallResult(projectId, options, call);
      },
    ),
    tool(
      'video_set_keyframes',
      'Replace or clear a clip-local keyframe track for opacity, transform, crop, volume, or caption text animation.',
      {
        projectId: PROJECT_ID_SCHEMA,
        reasoning: REASONING_SCHEMA,
        clipId: z.string().min(1),
        property: KeyframeablePropertySchema,
        keys: z.array(KeyframeSchema).max(50),
        summary: z.string().max(280).optional(),
      },
      async (input) => {
        const { projectId, call } = camelToolCall('setKeyframes', input);
        return toolCallResult(projectId, options, call);
      },
    ),
    tool(
      'video_apply_capture_to_timeline',
      'Insert or replace a capture source on the project timeline.',
      {
        projectId: PROJECT_ID_SCHEMA,
        reasoning: REASONING_SCHEMA,
        captureId: z.string().min(1),
        targetTrackId: z.string().min(1).optional(),
        atMs: z.number().int().min(0),
        replaceClipId: z.string().min(1).optional(),
      },
      async (input) => {
        const { projectId, call } = camelToolCall(
          'applyCaptureToTimeline',
          input,
        );
        return toolCallResult(projectId, options, call);
      },
    ),
    tool(
      'video_propose_timeline_ops',
      'Validate and journal a proposed timeline operation set without applying it.',
      {
        projectId: PROJECT_ID_SCHEMA,
        reasoning: REASONING_SCHEMA,
        summary: z.string().min(1).max(280),
        ops: z.array(TimelineOpSchema).min(1).max(20),
        previewRange: PREVIEW_RANGE_SCHEMA.optional(),
        recipeId: z.string().min(1).optional(),
        recipeVersion: z.number().int().positive().optional(),
        intentTurn: z.number().int().positive().optional(),
        intentText: z.string().min(1).optional(),
        applyMode: TIMELINE_PROPOSAL_APPLY_MODE_SCHEMA.default('suggest'),
      },
      async (input) => {
        const { projectId, call } = camelToolCall('proposeTimelineOps', input);
        return toolCallResult(projectId, options, call);
      },
    ),
    tool(
      'video_apply_timeline_op',
      'Apply one timeline operation and journal its inverse for undo.',
      {
        projectId: PROJECT_ID_SCHEMA,
        reasoning: REASONING_SCHEMA,
        op: TimelineOpSchema,
        summary: z.string().max(280).optional(),
      },
      async (input) => {
        const { projectId, call } = camelToolCall('applyTimelineOp', input);
        return toolCallResult(projectId, options, call);
      },
    ),
    tool(
      'video_apply_timeline_ops',
      'Apply an ordered timeline operation batch atomically. The batch is one audit entry and one undo unit; if any op fails, no project write is committed.',
      {
        projectId: PROJECT_ID_SCHEMA,
        reasoning: REASONING_SCHEMA,
        ops: z.array(z.record(z.string(), z.unknown())).min(1).max(20),
        resolverRefs: TIMELINE_RESOLVER_REFS_SCHEMA.optional(),
        summary: z.string().max(280).optional(),
      },
      async (input) =>
        withToolTimeout('video_apply_timeline_ops', async () => {
          const { resolverRefs, ops, ...rest } = input;
          const resolvedOps = parseTimelineOpsWithResolverRefs(
            ops,
            resolverRefs,
          );
          const { projectId, call } = camelToolCall('applyTimelineOps', {
            ...rest,
            ops: resolvedOps,
          });
          return toolCallResult(projectId, options, call);
        }).catch((error) =>
          errorResult(error instanceof Error ? error.message : String(error)),
        ),
    ),
    tool(
      'video_cut_clip',
      'Split one clip at a project frame. Read timeline/context first, use project-frame fields, and inspect frames after visual edits.',
      {
        projectId: PROJECT_ID_SCHEMA,
        reasoning: REASONING_SCHEMA,
        clipId: z.string().min(1),
        atFrame: z.number().int().min(0),
        retain: CUT_RETAIN_SCHEMA.default('both'),
        ripple: z.boolean().optional(),
        linkPolicy: EDIT_LINK_POLICY_SCHEMA.default('linked'),
        applyMode: NAMED_EDIT_APPLY_MODE_SCHEMA.default('auto'),
        summary: z.string().max(280).optional(),
      },
      async (input) => {
        const { applyMode, ...rest } = input;
        const { projectId, call } = camelToolCall('cutClip', rest);
        return timelineEditToolCallResult(projectId, options, call, applyMode);
      },
    ),
    tool(
      'video_cut_range',
      'Remove a half-open project-frame range from a timeline track, optionally rippling downstream clips.',
      {
        projectId: PROJECT_ID_SCHEMA,
        reasoning: REASONING_SCHEMA,
        trackId: z.string().min(1).optional(),
        startFrame: z.number().int().min(0),
        endFrame: z.number().int().positive(),
        ripple: z.boolean().optional(),
        applyMode: NAMED_EDIT_APPLY_MODE_SCHEMA.default('auto'),
        summary: z.string().max(280).optional(),
      },
      async (input) => {
        const { applyMode, ...rest } = input;
        const { projectId, call } = camelToolCall('cutRange', rest);
        return timelineEditToolCallResult(projectId, options, call, applyMode);
      },
    ),
    tool(
      'video_duplicate_clips',
      'Duplicate clips with deterministic new IDs, preserving timing offsets, media refs, transforms, filters, playback, and keyframes.',
      {
        projectId: PROJECT_ID_SCHEMA,
        reasoning: REASONING_SCHEMA,
        clipIds: z.array(z.string().min(1)).min(1).max(20),
        placement: DUPLICATE_PLACEMENT_SCHEMA.default({
          kind: 'after-originals',
        }),
        linkPolicy: EDIT_LINK_POLICY_SCHEMA.default('primary-only'),
        applyMode: NAMED_EDIT_APPLY_MODE_SCHEMA.default('auto'),
        summary: z.string().max(280).optional(),
      },
      async (input) => {
        const { applyMode, ...rest } = input;
        const { projectId, call } = camelToolCall('duplicateClips', rest);
        return timelineEditToolCallResult(projectId, options, call, applyMode);
      },
    ),
    tool(
      'video_delete_clips',
      'Delete clips, expanding linked partners by default, with optional ripple close.',
      {
        projectId: PROJECT_ID_SCHEMA,
        reasoning: REASONING_SCHEMA,
        clipIds: z.array(z.string().min(1)).min(1).max(50),
        ripple: z.boolean().optional(),
        linkPolicy: EDIT_LINK_POLICY_SCHEMA.default('linked'),
        applyMode: NAMED_EDIT_APPLY_MODE_SCHEMA.default('auto'),
        summary: z.string().max(280).optional(),
      },
      async (input) => {
        const { applyMode, ...rest } = input;
        const { projectId, call } = camelToolCall('deleteClips', rest);
        return timelineEditToolCallResult(projectId, options, call, applyMode);
      },
    ),
    tool(
      'video_move_clips',
      'Move one or more clips to project-frame positions. Linked partners move by default.',
      {
        projectId: PROJECT_ID_SCHEMA,
        reasoning: REASONING_SCHEMA,
        moves: z
          .array(
            z
              .object({
                clipId: z.string().min(1),
                toFrame: z.number().int().min(0),
                toTrackId: z.string().min(1).optional(),
              })
              .strict(),
          )
          .min(1)
          .max(20),
        magnetic: z.boolean().optional(),
        linkPolicy: EDIT_LINK_POLICY_SCHEMA.default('linked'),
        applyMode: NAMED_EDIT_APPLY_MODE_SCHEMA.default('auto'),
        summary: z.string().max(280).optional(),
      },
      async (input) => {
        const { applyMode, ...rest } = input;
        const { projectId, call } = camelToolCall('moveClips', rest);
        return timelineEditToolCallResult(projectId, options, call, applyMode);
      },
    ),
    tool(
      'video_set_clip_speed',
      'Set constant clip playback speed as typed playback state. Use project frames and inspect after render-relevant edits.',
      {
        projectId: PROJECT_ID_SCHEMA,
        reasoning: REASONING_SCHEMA,
        clipIds: z.array(z.string().min(1)).min(1).max(20),
        speed: z.number().min(0.1).max(20),
        timingPolicy: CLIP_PLAYBACK_TIMING_POLICY_SCHEMA.default(
          'preserve-source-span',
        ),
        ripple: z.boolean().optional(),
        linkPolicy: EDIT_LINK_POLICY_SCHEMA.default('linked'),
        pitchCorrection: z.boolean().optional(),
        smoothSlowMo: z.boolean().optional(),
        interpolationQuality: CLIP_INTERPOLATION_QUALITY_SCHEMA.optional(),
        applyMode: NAMED_EDIT_APPLY_MODE_SCHEMA.default('auto'),
        summary: z.string().max(280).optional(),
      },
      async (input) => {
        const { applyMode, ...rest } = input;
        const { projectId, call } = camelToolCall('setClipSpeed', rest);
        return timelineEditToolCallResult(projectId, options, call, applyMode);
      },
    ),
    tool(
      'video_reverse_clip',
      'Toggle reverse playback as typed playback state without changing timeline duration.',
      {
        projectId: PROJECT_ID_SCHEMA,
        reasoning: REASONING_SCHEMA,
        clipIds: z.array(z.string().min(1)).min(1).max(20),
        reverse: z.boolean(),
        linkPolicy: EDIT_LINK_POLICY_SCHEMA.default('linked'),
        applyMode: NAMED_EDIT_APPLY_MODE_SCHEMA.default('auto'),
        summary: z.string().max(280).optional(),
      },
      async (input) => {
        const { applyMode, ...rest } = input;
        const { projectId, call } = camelToolCall('reverseClip', rest);
        return timelineEditToolCallResult(projectId, options, call, applyMode);
      },
    ),
    tool(
      'video_rotate_clip',
      'Rotate visual clips by setting typed transform rotation. Inspect timeline frames after applying.',
      {
        projectId: PROJECT_ID_SCHEMA,
        reasoning: REASONING_SCHEMA,
        clipIds: z.array(z.string().min(1)).min(1).max(20),
        degrees: z.number(),
        relative: z.boolean().optional(),
        applyMode: NAMED_EDIT_APPLY_MODE_SCHEMA.default('auto'),
        summary: z.string().max(280).optional(),
      },
      async (input) => {
        const { applyMode, ...rest } = input;
        const { projectId, call } = camelToolCall('rotateClip', rest);
        return timelineEditToolCallResult(projectId, options, call, applyMode);
      },
    ),
    tool(
      'video_flip_clip',
      'Flip visual clips horizontally and/or vertically through transform scale fields.',
      {
        projectId: PROJECT_ID_SCHEMA,
        reasoning: REASONING_SCHEMA,
        clipIds: z.array(z.string().min(1)).min(1).max(20),
        horizontal: z.boolean().optional(),
        vertical: z.boolean().optional(),
        mode: z.enum(['toggle', 'set']).default('toggle'),
        applyMode: NAMED_EDIT_APPLY_MODE_SCHEMA.default('auto'),
        summary: z.string().max(280).optional(),
      },
      async (input) => {
        const { applyMode, ...rest } = input;
        const { projectId, call } = camelToolCall('flipClip', rest);
        return timelineEditToolCallResult(projectId, options, call, applyMode);
      },
    ),
    tool(
      'video_set_clip_transform',
      'Set or merge visual clip transform fields such as scale, position, opacity, crop, fit, and rotation.',
      {
        projectId: PROJECT_ID_SCHEMA,
        reasoning: REASONING_SCHEMA,
        clipIds: z.array(z.string().min(1)).min(1).max(20),
        transform: CLIP_TRANSFORM_SCHEMA,
        merge: z.boolean().default(true),
        applyMode: NAMED_EDIT_APPLY_MODE_SCHEMA.default('auto'),
        summary: z.string().max(280).optional(),
      },
      async (input) => {
        const { applyMode, ...rest } = input;
        const { projectId, call } = camelToolCall('setClipTransform', rest);
        return timelineEditToolCallResult(projectId, options, call, applyMode);
      },
    ),
    tool(
      'video_set_clip_effects',
      'Replace a visual clip canvas-effect stack with validated grading and blur effects. Legacy CSS filters remain unchanged. Pass clipId "selection" for the inspected clip.',
      {
        projectId: PROJECT_ID_SCHEMA,
        reasoning: REASONING_SCHEMA,
        clipId: z.string().min(1),
        effects: z.array(ClipEffectInputSchema).max(12),
        applyMode: NAMED_EDIT_APPLY_MODE_SCHEMA.default('auto'),
        summary: z.string().max(280).optional(),
      },
      async ({ projectId, clipId, effects, applyMode, summary }) => {
        try {
          const project = await loadProjectForTool(projectId, options);
          const resolvedClipId = resolveClipRef(
            clipId,
            selectionResolverRefs(options),
          );
          const clip = findProjectTimelineClip(project, resolvedClipId);
          if (!isVisualTimelineMediaClip(clip)) {
            return errorResult(`Clip is not visual media: ${resolvedClipId}`);
          }
          const after =
            effects.length > 0
              ? ClipEffectStackSchema.parse({
                  schema: 'neuma.video.clip-effects.v1',
                  effects: effects.map(clipEffectFromInput),
                })
              : null;
          const op: TimelineOp = {
            kind: 'clip.setEffects',
            clipId: resolvedClipId,
            before: clip.effects ?? null,
            after,
          };
          if (applyMode === 'propose') {
            return jsonResult(
              timelineApplyProposalPayload(project, [op], {
                tool: 'video_set_clip_effects',
                summary,
              }),
            );
          }
          const resolved = camelToolCall('applyTimelineOps', {
            projectId: project.id,
            ops: [op],
            summary,
          });
          return toolCallResult(resolved.projectId, options, resolved.call);
        } catch (error) {
          return errorResult(
            error instanceof Error ? error.message : String(error),
          );
        }
      },
    ),
    tool(
      'video_analyze_clip_grade',
      'Measure a rendered clip frame and propose a bounded brightness, contrast, and white-balance correction. This tool never applies its proposal.',
      {
        projectId: PROJECT_ID_SCHEMA,
        clipId: z.string().min(1),
        intent: z
          .enum(['neutral', 'warmer', 'cooler', 'less-contrasty'])
          .default('neutral'),
        aspectRatio: ASPECT_RATIO_SCHEMA.optional(),
      },
      async ({ projectId, clipId, intent, aspectRatio }) =>
        withToolTimeout(
          'video_analyze_clip_grade',
          async () => {
            const project = await loadProjectForTool(projectId, options);
            const resolvedClipId = resolveClipRef(
              clipId,
              selectionResolverRefs(options),
            );
            const clip = findProjectTimelineClip(project, resolvedClipId);
            if (!isVisualTimelineMediaClip(clip)) {
              return errorResult(`Clip is not visual media: ${resolvedClipId}`);
            }
            const sampleMs = Math.floor(clip.startMs + clip.durationMs / 2);
            const frames = await renderTimelineFramesWithRemotion({
              project,
              startMs: sampleMs,
              endMs: sampleMs + 1,
              frameCount: 1,
              aspectRatio:
                aspectRatio ??
                project.settings?.defaultAspectRatios?.[0] ??
                '16:9',
              maxEdgePx: 480,
              root: getVideoProjectRoot(project.id),
            });
            const frame = frames.frames[0];
            if (!frame) return errorResult('Grade analysis produced no frame.');
            const analysis = await analyzeClipGradeImage(
              frame.imageBase64,
              intent,
            );
            const effects = proposedGradeEffects(
              clip.effects,
              analysis.correction,
            );
            const op: TimelineOp = {
              kind: 'clip.setEffects',
              clipId: resolvedClipId,
              before: clip.effects ?? null,
              after: effects,
            };
            return jsonResult({
              ...analysis,
              projectId: project.id,
              clipId: resolvedClipId,
              sampleMs,
              proposal: timelineApplyProposalPayload(project, [op], {
                tool: 'video_analyze_clip_grade',
                summary: `Apply bounded grade correction to ${resolvedClipId}`,
              }),
            });
          },
          90_000,
        ).catch((error) =>
          errorResult(error instanceof Error ? error.message : String(error)),
        ),
    ),
    tool(
      'video_detect_beats',
      'Detect a source-relative beat grid for an audio timeline clip and persist the derived analysis artifact. Moving, trimming, or retiming the clip does not require re-analysis.',
      {
        projectId: PROJECT_ID_SCHEMA,
        clipId: z.string().min(1),
        bins: z.number().int().min(128).max(2048).default(2048),
      },
      async ({ projectId, clipId, bins }) =>
        withToolTimeout(
          'video_detect_beats',
          async () => {
            const project = await loadProjectForTool(projectId, options);
            const resolvedClipId = resolveClipRef(
              clipId,
              selectionResolverRefs(options),
            );
            const clip = findProjectTimelineClip(project, resolvedClipId);
            if (clip.kind !== 'audio' || clip.sourceRef.kind !== 'asset') {
              return errorResult(
                `Clip is not project audio: ${resolvedClipId}`,
              );
            }
            const assetId = clip.sourceRef.assetId;
            const source = project.sources?.find(
              (entry) => entry.mediaItemId === assetId,
            );
            const asset = project.assets.find((entry) => entry.id === assetId);
            if (!source || !asset) {
              return errorResult('Audio clip is missing its source or asset.');
            }
            const analysis = await analyzeSourceBeats({
              source,
              asset,
              workspaceRoot: getVideoProjectRoot(project.id),
              bins,
            });
            // `updateProjectDocument` has its own lock map, so it does not
            // exclude the `withProjectLock` writers every other tool uses.
            // Hold the shared lock too, or a concurrent edit can be lost.
            await withProjectLock(project.id, () =>
              updateProjectDocument(project.id, (current) => ({
                ...current,
                analysisArtifacts: [
                  ...(current.analysisArtifacts ?? []).filter(
                    (artifact) =>
                      artifact.kind !== 'beat-markers' ||
                      artifact.sourceMediaId !== source.id,
                  ),
                  analysis.artifact,
                ],
                updatedAt: new Date().toISOString(),
              })),
            );
            return jsonResult({
              projectId: project.id,
              clipId: resolvedClipId,
              artifact: analysis.artifact,
              grid: analysis.grid,
              timelinePoints: deriveBeatTimelinePoints(analysis.grid, clip),
            });
          },
          90_000,
        ).catch((error) =>
          errorResult(error instanceof Error ? error.message : String(error)),
        ),
    ),
    tool(
      'video_snap_cuts_to_beats',
      'Propose an invertible op batch that snaps touching visual cut boundaries to the nearest derived beat. This tool never applies the proposal.',
      {
        projectId: PROJECT_ID_SCHEMA,
        sourceClipId: z.string().min(1),
        toleranceMs: z.number().int().min(10).max(1000).default(150),
      },
      async ({ projectId, sourceClipId, toleranceMs }) => {
        try {
          const project = await loadProjectForTool(projectId, options);
          const resolvedClipId = resolveClipRef(
            sourceClipId,
            selectionResolverRefs(options),
          );
          const sourceClip = findProjectTimelineClip(project, resolvedClipId);
          const grid = beatGridForAudioClip(project, sourceClip);
          if (!grid) {
            return errorResult(
              'No current beat-grid artifact exists for this audio clip.',
            );
          }
          const beatTimesMs = deriveBeatTimelinePoints(grid, sourceClip)
            .map((point) => point.timelineMs)
            .sort((a, b) => a - b);
          const ops = buildSnapCutsToBeatOps(project, beatTimesMs, toleranceMs);
          return jsonResult(
            timelineApplyProposalPayload(project, ops, {
              tool: 'video_snap_cuts_to_beats',
              summary: `Snap ${ops.length / 2} cut boundaries to detected beats`,
              metadata: { sourceClipId: resolvedClipId, toleranceMs },
            }),
          );
        } catch (error) {
          return errorResult(
            error instanceof Error ? error.message : String(error),
          );
        }
      },
    ),
    tool(
      'video_set_overlay_controls',
      'Update a vivid overlay clip\'s editable controls (text, color, fontSize, …) and/or loop mode in place. Use this for overlay parameter changes — do NOT remove and re-insert the clip. Color values accept CSS names ("green") and are normalized to hex. Pass clipId "selection" to target the currently selected overlay clip.',
      {
        projectId: PROJECT_ID_SCHEMA,
        reasoning: REASONING_SCHEMA,
        clipId: z.string().min(1),
        controls: z
          .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
          .optional(),
        loop: z.enum(['loop', 'hold', 'none']).optional(),
        applyMode: NAMED_EDIT_APPLY_MODE_SCHEMA.default('auto'),
        summary: z.string().max(280).optional(),
      },
      async (input) => {
        const { applyMode, clipId, ...rest } = input;
        const { projectId, call } = camelToolCall('setOverlayControls', {
          ...rest,
          clipId: resolveClipRef(clipId, selectionResolverRefs(options)),
        });
        return timelineEditToolCallResult(projectId, options, call, applyMode);
      },
    ),
    tool(
      'video_set_overlay_control_keyframes',
      'Replace or clear keyframes for a numeric vivid overlay control. Text, color, select, and toggle controls cannot be interpolated. Pass clipId "selection" to target the currently selected overlay clip.',
      {
        projectId: PROJECT_ID_SCHEMA,
        reasoning: REASONING_SCHEMA,
        clipId: z.string().min(1),
        controlId: z.string().min(1),
        keys: z.array(KeyframeSchema).max(50),
        applyMode: NAMED_EDIT_APPLY_MODE_SCHEMA.default('auto'),
        summary: z.string().max(280).optional(),
      },
      async (input) => {
        const { applyMode, clipId, ...rest } = input;
        const { projectId, call } = camelToolCall(
          'setOverlayControlKeyframes',
          {
            ...rest,
            clipId: resolveClipRef(clipId, selectionResolverRefs(options)),
          },
        );
        return timelineEditToolCallResult(projectId, options, call, applyMode);
      },
    ),
    tool(
      'video_apply_overlay_motion_template',
      'Apply a named motion template to a vivid overlay clip by replacing only the template\'s affected keyframe tracks and recording template provenance. Pass clipId "selection" to target the currently selected overlay clip.',
      {
        projectId: PROJECT_ID_SCHEMA,
        reasoning: REASONING_SCHEMA,
        clipId: z.string().min(1),
        templateId: z.enum(VIVID_OVERLAY_MOTION_TEMPLATE_IDS),
        strength: z
          .enum(VIVID_OVERLAY_MOTION_TEMPLATE_STRENGTHS)
          .default('normal'),
        applyMode: NAMED_EDIT_APPLY_MODE_SCHEMA.default('auto'),
        summary: z.string().max(280).optional(),
      },
      async (input) => {
        const { applyMode, clipId, ...rest } = input;
        const { projectId, call } = camelToolCall(
          'applyOverlayMotionTemplate',
          {
            ...rest,
            clipId: resolveClipRef(clipId, selectionResolverRefs(options)),
          },
        );
        return timelineEditToolCallResult(projectId, options, call, applyMode);
      },
    ),
    tool(
      'video_set_clip_params',
      "Shallow-merge a patch into a clip's params bag (a null value deletes the key). Generic escape hatch for effect clips; prefer video_set_overlay_controls for vivid overlay controls.",
      {
        projectId: PROJECT_ID_SCHEMA,
        reasoning: REASONING_SCHEMA,
        clipId: z.string().min(1),
        patch: z.record(z.string(), z.unknown()),
        applyMode: NAMED_EDIT_APPLY_MODE_SCHEMA.default('auto'),
        summary: z.string().max(280).optional(),
      },
      async (input) => {
        const { applyMode, clipId, ...rest } = input;
        const { projectId, call } = camelToolCall('setClipParams', {
          ...rest,
          clipId: resolveClipRef(clipId, selectionResolverRefs(options)),
        });
        return timelineEditToolCallResult(projectId, options, call, applyMode);
      },
    ),
    tool(
      'video_close_gap',
      'Close an empty half-open project-frame gap on one track by shifting downstream clips left.',
      {
        projectId: PROJECT_ID_SCHEMA,
        reasoning: REASONING_SCHEMA,
        trackId: z.string().min(1),
        gapStartFrame: z.number().int().min(0),
        gapEndFrame: z.number().int().positive(),
        applyMode: NAMED_EDIT_APPLY_MODE_SCHEMA.default('auto'),
        summary: z.string().max(280).optional(),
      },
      async (input) => {
        const { applyMode, ...rest } = input;
        const { projectId, call } = camelToolCall('closeGap', rest);
        return timelineEditToolCallResult(projectId, options, call, applyMode);
      },
    ),
    tool(
      'video_set_audio_clip_gain',
      'Set or clear gain in dB on one or more audio clips.',
      {
        projectId: PROJECT_ID_SCHEMA,
        reasoning: REASONING_SCHEMA,
        clipIds: z.array(z.string().min(1)).min(1).max(20),
        gainDb: z.number().min(-96).max(24).nullable(),
        linkPolicy: EDIT_LINK_POLICY_SCHEMA.default('primary-only'),
        applyMode: NAMED_EDIT_APPLY_MODE_SCHEMA.default('auto'),
        summary: z.string().max(280).optional(),
      },
      async (input) => {
        const { applyMode, ...rest } = input;
        const { projectId, call } = camelToolCall('setAudioClipGain', rest);
        return timelineEditToolCallResult(projectId, options, call, applyMode);
      },
    ),
    tool(
      'video_set_audio_clip_mute',
      'Mute or unmute one or more audio clips.',
      {
        projectId: PROJECT_ID_SCHEMA,
        reasoning: REASONING_SCHEMA,
        clipIds: z.array(z.string().min(1)).min(1).max(20),
        muted: z.boolean(),
        linkPolicy: EDIT_LINK_POLICY_SCHEMA.default('primary-only'),
        applyMode: NAMED_EDIT_APPLY_MODE_SCHEMA.default('auto'),
        summary: z.string().max(280).optional(),
      },
      async (input) => {
        const { applyMode, ...rest } = input;
        const { projectId, call } = camelToolCall('setAudioClipMute', rest);
        return timelineEditToolCallResult(projectId, options, call, applyMode);
      },
    ),
    tool(
      'video_set_audio_clip_fade',
      'Set audio clip fade-in, fade-out, or both with an optional curve.',
      {
        projectId: PROJECT_ID_SCHEMA,
        reasoning: REASONING_SCHEMA,
        clipIds: z.array(z.string().min(1)).min(1).max(20),
        edge: z.enum(['in', 'out', 'both']),
        durationMs: z.number().int().min(0),
        curve: AUDIO_FADE_CURVE_SCHEMA.optional(),
        linkPolicy: EDIT_LINK_POLICY_SCHEMA.default('primary-only'),
        applyMode: NAMED_EDIT_APPLY_MODE_SCHEMA.default('auto'),
        summary: z.string().max(280).optional(),
      },
      async (input) => {
        const { applyMode, ...rest } = input;
        const { projectId, call } = camelToolCall('setAudioClipFade', rest);
        return timelineEditToolCallResult(projectId, options, call, applyMode);
      },
    ),
    tool(
      'video_set_audio_track_volume',
      'Set or clear audio track volume in dB.',
      {
        projectId: PROJECT_ID_SCHEMA,
        reasoning: REASONING_SCHEMA,
        trackIds: z.array(z.string().min(1)).min(1).max(20),
        volumeDb: z.number().min(-96).max(24).nullable(),
        applyMode: NAMED_EDIT_APPLY_MODE_SCHEMA.default('auto'),
        summary: z.string().max(280).optional(),
      },
      async (input) => {
        const { applyMode, ...rest } = input;
        const { projectId, call } = camelToolCall('setAudioTrackVolume', rest);
        return timelineEditToolCallResult(projectId, options, call, applyMode);
      },
    ),
    tool(
      'video_set_audio_track_mute',
      'Mute or unmute one or more audio tracks.',
      {
        projectId: PROJECT_ID_SCHEMA,
        reasoning: REASONING_SCHEMA,
        trackIds: z.array(z.string().min(1)).min(1).max(20),
        muted: z.boolean(),
        applyMode: NAMED_EDIT_APPLY_MODE_SCHEMA.default('auto'),
        summary: z.string().max(280).optional(),
      },
      async (input) => {
        const { applyMode, ...rest } = input;
        const { projectId, call } = camelToolCall('setAudioTrackMute', rest);
        return timelineEditToolCallResult(projectId, options, call, applyMode);
      },
    ),
    tool(
      'video_set_audio_transition',
      'Set or clear the audio transition from an audio clip to its following adjacent clip.',
      {
        projectId: PROJECT_ID_SCHEMA,
        reasoning: REASONING_SCHEMA,
        clipId: z.string().min(1),
        transition: AUDIO_TRANSITION_SCHEMA.nullable(),
        applyMode: NAMED_EDIT_APPLY_MODE_SCHEMA.default('auto'),
        summary: z.string().max(280).optional(),
      },
      async (input) => {
        const { applyMode, ...rest } = input;
        const { projectId, call } = camelToolCall('setAudioTransition', rest);
        return timelineEditToolCallResult(projectId, options, call, applyMode);
      },
    ),
    tool(
      'video_crossfade_audio_clips',
      'Crossfade two adjacent audio clips on the same track.',
      {
        projectId: PROJECT_ID_SCHEMA,
        reasoning: REASONING_SCHEMA,
        fromClipId: z.string().min(1),
        toClipId: z.string().min(1),
        durationMs: z.number().int().min(0),
        curve: AUDIO_FADE_CURVE_SCHEMA.optional(),
        applyMode: NAMED_EDIT_APPLY_MODE_SCHEMA.default('auto'),
        summary: z.string().max(280).optional(),
      },
      async (input) => {
        const { applyMode, ...rest } = input;
        const { projectId, call } = camelToolCall('crossfadeAudioClips', rest);
        return timelineEditToolCallResult(projectId, options, call, applyMode);
      },
    ),
    tool(
      'video_set_audio_volume_keyframes',
      'Replace or upsert clip-local volumeDb keyframes on an audio clip.',
      {
        projectId: PROJECT_ID_SCHEMA,
        reasoning: REASONING_SCHEMA,
        clipId: z.string().min(1),
        keys: z.array(KeyframeSchema).max(50),
        mode: z.enum(['replace', 'upsert']).default('replace'),
        applyMode: NAMED_EDIT_APPLY_MODE_SCHEMA.default('auto'),
        summary: z.string().max(280).optional(),
      },
      async (input) => {
        const { applyMode, ...rest } = input;
        const { projectId, call } = camelToolCall(
          'setAudioVolumeKeyframes',
          rest,
        );
        return timelineEditToolCallResult(projectId, options, call, applyMode);
      },
    ),
    tool(
      'video_replace_audio_clip_source',
      'Replace an audio clip source with another project audio asset while preserving timeline timing.',
      {
        projectId: PROJECT_ID_SCHEMA,
        reasoning: REASONING_SCHEMA,
        clipId: z.string().min(1),
        assetId: z.string().min(1),
        sourceDurationMs: z.number().int().min(0).optional(),
        trimStartMs: z.number().int().min(0).optional(),
        name: z.string().min(1).optional(),
        transcriptText: z.string().nullable().optional(),
        applyMode: NAMED_EDIT_APPLY_MODE_SCHEMA.default('auto'),
        summary: z.string().max(280).optional(),
      },
      async (input) => {
        const { applyMode, assetId, ...rest } = input;
        const { projectId, call } = camelToolCall('replaceAudioClipSource', {
          ...rest,
          sourceRef: { kind: 'asset', assetId },
        });
        return timelineEditToolCallResult(projectId, options, call, applyMode);
      },
    ),
    tool(
      'video_get_handoff_conformance',
      'Read the editor-handoff conformance report for requested targets. Use before exporting to explain unverified targets, media relink requirements, and lossy feature degradations.',
      {
        projectId: PROJECT_ID_SCHEMA,
        targets: z.array(EDITOR_HANDOFF_TARGET_SCHEMA).min(1).max(7).optional(),
      },
      async ({ projectId, targets }) =>
        withToolTimeout('video_get_handoff_conformance', async () => {
          const project = await loadProjectForTool(projectId, options);
          const resolvedTargets: EditorHandoffTargetInput[] =
            targets && targets.length > 0 ? targets : ['neuma-package'];
          const report = evaluateHandoffConformance(
            buildEditorHandoffModel(project),
            resolvedTargets,
          );
          return jsonResult({
            projectId: project.id,
            report,
            supportRule:
              'Targets are generated-unverified until import-matrix.md records a manual import against a real editor version.',
          });
        }).catch((error) =>
          errorResult(error instanceof Error ? error.message : String(error)),
        ),
    ),
    tool(
      'video_export_editor_handoff',
      'Queue a .neuma-video-handoff.zip export. The package contains manifest.json, copied or linked media records, captions.srt, cut-list.json, OTIO JSON, FCPXML, Premiere XML, EDL, analysis artifacts, action log, and conformance report. CapCut is fallback-only.',
      {
        projectId: PROJECT_ID_SCHEMA,
        targets: z.array(EDITOR_HANDOFF_TARGET_SCHEMA).min(1).max(7).optional(),
        mediaMode: EDITOR_HANDOFF_MEDIA_MODE_SCHEMA.optional(),
      },
      async ({ projectId, targets, mediaMode }) =>
        withToolTimeout('video_export_editor_handoff', async () => {
          const proposal = await proposalOnlyServiceMutationResult(
            projectId,
            options,
            'video_export_editor_handoff',
          );
          if (proposal) return proposal;
          const resolvedProjectId = resolveProjectId(projectId, options);
          const project = await getProject(resolvedProjectId);
          const resolvedTargets: EditorHandoffTargetInput[] =
            targets && targets.length > 0 ? targets : ['neuma-package'];
          const conformance = evaluateHandoffConformance(
            buildEditorHandoffModel(project),
            resolvedTargets,
          );
          const job = await enqueueEditorHandoffJob(
            resolvedProjectId,
            {
              targets: resolvedTargets,
              mediaMode,
            },
            'mcp',
          );
          return jsonResult({
            projectId: resolvedProjectId,
            job,
            targets: resolvedTargets,
            mediaMode: mediaMode ?? 'copy',
            conformance: conformance.summary,
            supportRule:
              'Do not claim a target is supported until import-matrix.md has a successful manual import row.',
          });
        }).catch((error) =>
          errorResult(error instanceof Error ? error.message : String(error)),
        ),
    ),
    tool(
      'video_undo_timeline_op',
      'Undo a journaled Video Mode agent edit.',
      {
        projectId: PROJECT_ID_SCHEMA,
        entryId: z.string().min(1),
      },
      async ({ projectId, entryId }) =>
        withToolTimeout('video_undo_timeline_op', async () => {
          const proposal = await proposalOnlyServiceMutationResult(
            projectId,
            options,
            'video_undo_timeline_op',
          );
          if (proposal) return proposal;
          return mutationResult(
            await applyJournalUndoRedo(projectId, options, entryId, 'undo'),
          );
        }).catch((error) =>
          errorResult(error instanceof Error ? error.message : String(error)),
        ),
    ),
    tool(
      'video_redo_timeline_op',
      'Redo a journaled Video Mode agent edit.',
      {
        projectId: PROJECT_ID_SCHEMA,
        entryId: z.string().min(1),
      },
      async ({ projectId, entryId }) =>
        withToolTimeout('video_redo_timeline_op', async () => {
          const proposal = await proposalOnlyServiceMutationResult(
            projectId,
            options,
            'video_redo_timeline_op',
          );
          if (proposal) return proposal;
          return mutationResult(
            await applyJournalUndoRedo(projectId, options, entryId, 'redo'),
          );
        }).catch((error) =>
          errorResult(error instanceof Error ? error.message : String(error)),
        ),
    ),
    tool(
      'video_set_caption',
      'Set a storyboard scene caption.',
      {
        projectId: PROJECT_ID_SCHEMA,
        reasoning: REASONING_SCHEMA,
        sceneId: z.string().min(1),
        text: z.string().min(1),
      },
      async (input) => {
        const { projectId, call } = camelToolCall('setCaption', input);
        return toolCallResult(projectId, options, call);
      },
    ),
    tool(
      'video_regenerate_scene',
      'Update a scene generation prompt so the scene can be regenerated.',
      {
        projectId: PROJECT_ID_SCHEMA,
        reasoning: REASONING_SCHEMA,
        sceneId: z.string().min(1),
        prompt: z.string().min(1).optional(),
      },
      async (input) => {
        const { projectId, call } = camelToolCall('regenerateScene', input);
        return toolCallResult(projectId, options, call);
      },
    ),
    tool(
      'video_generate_broll',
      'Set a storyboard scene to use a B-roll search plan.',
      {
        projectId: PROJECT_ID_SCHEMA,
        reasoning: REASONING_SCHEMA,
        query: z.string().min(1),
        sceneId: z.string().min(1).optional(),
        rangeMs: z.tuple([
          z.number().int().min(0),
          z.number().int().positive(),
        ]),
      },
      async (input) => {
        const { projectId, call } = camelToolCall('generateBRoll', input);
        return toolCallResult(projectId, options, call);
      },
    ),
    tool(
      'video_generate_audio',
      'Generate music, SFX, ambience, or voiceover audio, add it as a project asset with provenance, and place it on an audio timeline track.',
      {
        projectId: PROJECT_ID_SCHEMA,
        reasoning: REASONING_SCHEMA,
        kind: GENERATED_AUDIO_KIND_SCHEMA,
        prompt: z.string().min(1),
        durationMs: z.number().int().positive().optional(),
        sceneId: z.string().min(1).optional(),
        startMs: z.number().int().min(0).optional(),
        trackId: z.string().min(1).optional(),
        provider: GENERATED_AUDIO_PROVIDER_SCHEMA.optional(),
        model: z.string().min(1).max(120).optional(),
        voiceId: z.string().min(1).max(120).optional(),
        tempoBpm: z.number().int().min(40).max(240).optional(),
        mood: z.string().min(1).max(120).optional(),
        name: z.string().min(1).max(120).optional(),
      },
      async (input) =>
        withToolTimeout('video_generate_audio', async () => {
          const proposal = await proposalOnlyServiceMutationResult(
            input.projectId,
            options,
            'video_generate_audio',
          );
          if (proposal) return proposal;
          const projectId = resolveProjectId(input.projectId, options);
          const result = await withProjectLock(projectId, () =>
            generateVideoAudio(projectId, {
              durationMs: input.durationMs,
              kind: input.kind,
              model: input.model,
              mood: input.mood,
              name: input.name,
              prompt: input.prompt,
              provider: input.provider,
              sceneId: input.sceneId,
              startMs: input.startMs,
              tempoBpm: input.tempoBpm,
              trackId: input.trackId,
              voiceId: input.voiceId,
            }),
          );
          return jsonResult({
            projectId: result.project.id,
            updatedAt: result.project.updatedAt,
            entryId: result.entryId,
            asset: {
              id: result.asset.id,
              kind: result.asset.kind,
              path: result.asset.path,
              provenance: result.asset.provenance,
              source: result.asset.source,
            },
            clip: {
              id: result.clip.id,
              durationMs: result.clip.durationMs,
              startMs: result.clip.startMs,
              trackId: result.trackId,
            },
            costCents: result.costCents,
          });
        }).catch((error) =>
          errorResult(error instanceof Error ? error.message : String(error)),
        ),
    ),
    tool(
      'video_transform_audio',
      'Generate a transformed replacement for an existing audio clip and swap the clip source through timeline edit operations.',
      {
        projectId: PROJECT_ID_SCHEMA,
        reasoning: REASONING_SCHEMA,
        sourceClipId: z.string().min(1),
        mode: AUDIO_TRANSFORM_MODE_SCHEMA,
        prompt: z.string().min(1),
        durationMs: z.number().int().positive().optional(),
        kind: GENERATED_AUDIO_KIND_SCHEMA.optional(),
        provider: GENERATED_AUDIO_PROVIDER_SCHEMA.optional(),
        model: z.string().min(1).max(120).optional(),
        voiceId: z.string().min(1).max(120).optional(),
        tempoBpm: z.number().int().min(40).max(240).optional(),
        mood: z.string().min(1).max(120).optional(),
        name: z.string().min(1).max(120).optional(),
      },
      async (input) =>
        withToolTimeout('video_transform_audio', async () => {
          const proposal = await proposalOnlyServiceMutationResult(
            input.projectId,
            options,
            'video_transform_audio',
          );
          if (proposal) return proposal;
          const projectId = resolveProjectId(input.projectId, options);
          const result = await withProjectLock(projectId, () =>
            transformVideoAudio(projectId, {
              durationMs: input.durationMs,
              kind: input.kind,
              mode: input.mode,
              model: input.model,
              mood: input.mood,
              name: input.name,
              prompt: input.prompt,
              provider: input.provider,
              sourceClipId: input.sourceClipId,
              tempoBpm: input.tempoBpm,
              voiceId: input.voiceId,
            }),
          );
          return jsonResult({
            projectId: result.project.id,
            updatedAt: result.project.updatedAt,
            entryId: result.entryId,
            asset: {
              id: result.asset.id,
              kind: result.asset.kind,
              path: result.asset.path,
              provenance: result.asset.provenance,
              source: result.asset.source,
            },
            clip: {
              id: result.clip.id,
              durationMs: result.clip.durationMs,
              startMs: result.clip.startMs,
              trackId: result.trackId,
            },
            costCents: result.costCents,
          });
        }).catch((error) =>
          errorResult(error instanceof Error ? error.message : String(error)),
        ),
    ),
    tool(
      'video_generate_voiceover',
      'Add a text-to-speech narration plan to the storyboard.',
      {
        projectId: PROJECT_ID_SCHEMA,
        reasoning: REASONING_SCHEMA,
        text: z.string().min(1),
        voiceId: z.string().min(1).optional(),
        sceneId: z.string().min(1).optional(),
      },
      async (input) => {
        const { projectId, call } = camelToolCall('generateVoiceover', input);
        return toolCallResult(projectId, options, call);
      },
    ),
    tool(
      'video_generate_music',
      'Add a generated music plan to the storyboard.',
      {
        projectId: PROJECT_ID_SCHEMA,
        reasoning: REASONING_SCHEMA,
        mood: z.string().min(1),
        durationMs: z.number().int().positive(),
        tempoBpm: z.number().int().min(40).max(240).optional(),
      },
      async (input) => {
        const { projectId, call } = camelToolCall('generateMusic', input);
        return toolCallResult(projectId, options, call);
      },
    ),
    tool(
      'video_trim_clip',
      'Trim one timeline clip to an in/out range.',
      {
        projectId: PROJECT_ID_SCHEMA,
        reasoning: REASONING_SCHEMA,
        clipId: z.string().min(1),
        inMs: z.number().int().min(0),
        outMs: z.number().int().positive(),
      },
      async (input) => {
        const { projectId, call } = camelToolCall('trimClip', input);
        return toolCallResult(projectId, options, call);
      },
    ),
    tool(
      'video_remove_filler_words',
      'Mark filler-word cleanup intent against an audio track.',
      {
        projectId: PROJECT_ID_SCHEMA,
        reasoning: REASONING_SCHEMA,
        trackId: z.string().min(1),
      },
      async (input) => {
        const { projectId, call } = camelToolCall('removeFillerWords', input);
        return toolCallResult(projectId, options, call);
      },
    ),
    tool(
      'video_tighten_pacing',
      'Tighten storyboard pacing toward a target total duration.',
      {
        projectId: PROJECT_ID_SCHEMA,
        reasoning: REASONING_SCHEMA,
        targetDurationMs: z.number().int().positive(),
      },
      async (input) => {
        const { projectId, call } = camelToolCall('tightenPacing', input);
        return toolCallResult(projectId, options, call);
      },
    ),
    tool(
      'video_duck_audio',
      'Duck one audio track underneath another.',
      {
        projectId: PROJECT_ID_SCHEMA,
        reasoning: REASONING_SCHEMA,
        trackId: z.string().min(1),
        underTrackId: z.string().min(1),
        attenuationDb: z.number().max(0),
        summary: z.string().max(280).optional(),
      },
      async (input) => {
        const { projectId, call } = camelToolCall('duckAudio', input);
        return toolCallResult(projectId, options, call);
      },
    ),
    tool(
      'video_add_captions',
      'Restyle existing scene captions. Does NOT transcribe — for real spoken-word captions synced to the audio, use video_generate_captions instead.',
      {
        projectId: PROJECT_ID_SCHEMA,
        reasoning: REASONING_SCHEMA,
        style: SUBTITLE_STYLE_SCHEMA,
      },
      async (input) => {
        const { projectId, call } = camelToolCall('addCaptions', input);
        return toolCallResult(projectId, options, call);
      },
    ),
    tool(
      'video_generate_captions',
      "Transcribe the timeline clips' audio (speech-to-text) and lay time-synced caption cues onto the caption track, matching the spoken words. Use this for real captions/subtitles; pass style.animation for tiktok-word/hormozi-bold/karaoke looks. Optionally limit to one clip or scene.",
      {
        projectId: PROJECT_ID_SCHEMA,
        reasoning: REASONING_SCHEMA,
        style: SUBTITLE_STYLE_SCHEMA.optional(),
        clipId: z.string().min(1).optional(),
        sceneId: z.string().min(1).optional(),
        wordsPerCue: z.number().int().min(1).max(12).optional(),
      },
      async (input) =>
        withToolTimeout('video_generate_captions', async () => {
          const proposal = await proposalOnlyServiceMutationResult(
            input.projectId,
            options,
            'video_generate_captions',
          );
          if (proposal) return proposal;
          const projectId = resolveProjectId(input.projectId, options);
          const result = await withProjectLock(projectId, () =>
            generateProjectCaptions(projectId, {
              style: input.style,
              clipId: input.clipId,
              sceneId: input.sceneId,
              wordsPerCue: input.wordsPerCue,
            }),
          );
          return jsonResult({
            projectId: result.project.id,
            updatedAt: result.project.updatedAt,
            cues: result.cues.length,
            clipsTranscribed: result.clipsTranscribed,
            clipsSkipped: result.clipsSkipped,
            // Surface why any clip produced no captions so the caller doesn't
            // have to guess (no audio track, transcription failed, etc.).
            skipped: result.skipped,
            preview: result.cues.slice(0, 8).map((cue) => ({
              startMs: cue.startMs,
              endMs: cue.startMs + cue.durationMs,
              text: cue.text,
            })),
          });
        }).catch((error) =>
          errorResult(error instanceof Error ? error.message : String(error)),
        ),
    ),
    tool(
      'video_add_lower_third',
      'Add a lower-third overlay to one scene.',
      {
        projectId: PROJECT_ID_SCHEMA,
        reasoning: REASONING_SCHEMA,
        sceneId: z.string().min(1),
        text: z.string().min(1),
        style: SUBTITLE_STYLE_SCHEMA.optional(),
      },
      async (input) => {
        const { projectId, call } = camelToolCall('addLowerThird', input);
        return toolCallResult(projectId, options, call);
      },
    ),
    tool(
      'video_reframe',
      'Set the project reframing target aspect ratio.',
      {
        projectId: PROJECT_ID_SCHEMA,
        reasoning: REASONING_SCHEMA,
        aspect: ASPECT_RATIO_SCHEMA,
      },
      async (input) => {
        const { projectId, call } = camelToolCall('reframe', input);
        return toolCallResult(projectId, options, call);
      },
    ),
    tool(
      'video_restyle',
      'Apply a high-level style preset to project settings.',
      {
        projectId: PROJECT_ID_SCHEMA,
        reasoning: REASONING_SCHEMA,
        preset: z.string().min(1),
      },
      async (input) => {
        const { projectId, call } = camelToolCall('restyle', input);
        return toolCallResult(projectId, options, call);
      },
    ),
    tool(
      'video_translate',
      'Record a target language for caption/script translation work.',
      {
        projectId: PROJECT_ID_SCHEMA,
        reasoning: REASONING_SCHEMA,
        lang: LANGUAGE_SCHEMA,
      },
      async (input) => {
        const { projectId, call } = camelToolCall('translate', input);
        return toolCallResult(projectId, options, call);
      },
    ),
    tool(
      'video_verify_render',
      'Build a render verification report for the latest or supplied output.',
      {
        projectId: PROJECT_ID_SCHEMA,
        reasoning: REASONING_SCHEMA,
        outputPath: z.string().min(1).optional(),
        maxIterations: z.number().int().min(1).max(3).default(3),
      },
      async (input) => {
        const { projectId, call } = camelToolCall('verifyRender', input);
        // Defense in depth: confirm the agent-supplied outputPath stays
        // inside the workspace before it lands in the journal entry.
        if (call.args.outputPath) {
          try {
            const resolvedProjectId = resolveProjectId(projectId, options);
            const workspaceRoot = getVideoProjectRoot(resolvedProjectId);
            validatePath(call.args.outputPath, workspaceRoot, 'read');
          } catch (error) {
            return errorResult(
              error instanceof Error ? error.message : String(error),
            );
          }
        }
        return toolCallResult(projectId, options, call);
      },
    ),
    tool(
      'video_search_assets',
      'Search project and linked assets for visual, video, or audio material.',
      {
        projectId: PROJECT_ID_SCHEMA,
        query: z.string().min(1),
        kinds: z.array(PROVIDER_KIND_SCHEMA).optional(),
        sourceIds: z.array(z.string().min(1)).optional(),
        limit: z.number().int().min(1).max(100).optional(),
      },
      async ({ projectId, query, kinds, sourceIds, limit }) =>
        serviceResult(
          searchVideoAssets(projectId, options, {
            query,
            kinds,
            sourceIds,
            limit,
          }),
        ),
    ),
    tool(
      'video_search_frames',
      'Search indexed visual frame captions for moments matching a visual query. Behind video.frameSearch; refreshes a project frame-caption index from existing visual analysis and media metadata before searching.',
      {
        projectId: PROJECT_ID_SCHEMA,
        query: z.string().min(1),
        sourceIds: z.array(z.string().min(1)).optional(),
        assetIds: z.array(z.string().min(1)).optional(),
        limit: z.number().int().min(1).max(50).optional(),
        refreshIndex: z.boolean().default(true),
      },
      async ({ projectId, query, sourceIds, assetIds, limit, refreshIndex }) =>
        serviceResult(
          (async () => {
            const project = await loadProjectForTool(projectId, options);
            const index = refreshIndex
              ? await indexProjectFrames(project)
              : undefined;
            const search = await searchProjectFrames(project.id, {
              query,
              sourceIds,
              assetIds,
              limit,
            });
            return {
              schema: 'neuma.video.frame-search.v1',
              projectId: project.id,
              query,
              index,
              ...search,
            };
          })(),
        ),
    ),
    tool(
      'video_rank_moments',
      'Rank existing analysis moments for hook, cut, or B-roll selection.',
      {
        projectId: PROJECT_ID_SCHEMA,
        signal: z.string().min(1).optional(),
        limit: z.number().int().min(1).max(100).optional(),
      },
      async ({ projectId, signal, limit }) => {
        try {
          const project = await loadProjectForTool(projectId, options);
          return jsonResult(rankProjectMoments(project, { signal, limit }));
        } catch (error) {
          return errorResult(
            error instanceof Error ? error.message : String(error),
          );
        }
      },
    ),
    tool(
      'video_attach_asset',
      'Hydrate/download an existing project asset when sceneId is omitted, or attach an existing project/linked asset to a scene when sceneId is provided.',
      {
        projectId: PROJECT_ID_SCHEMA,
        assetId: z.string().min(1),
        sceneId: z.string().min(1).optional(),
        role: z.enum(['asset', 'reference']).optional(),
      },
      async ({ projectId, assetId, sceneId, role }) =>
        withToolTimeout('video_attach_asset', async () => {
          const proposal = await proposalOnlyServiceMutationResult(
            projectId,
            options,
            'video_attach_asset',
          );
          if (proposal) return proposal;
          return narrowAttachResult(
            await attachVideoAsset(projectId, options, {
              assetId,
              sceneId,
              role,
            }),
          );
        }).catch((error) =>
          errorResult(error instanceof Error ? error.message : String(error)),
        ),
    ),
    tool(
      'video_approve_storyboard',
      'Approve the current storyboard so it can be rendered. This is the ' +
        'commit step the render gate requires: it freezes the scene plan, ' +
        'builds the generation jobs, and rebuilds the timeline from the ' +
        'storyboard. Call this before video_render when the storyboard status ' +
        'is "edited" or "draft" and the user has asked to render or approve. ' +
        'Any later edit reverts the status to "edited" and requires approving ' +
        'again.',
      { projectId: PROJECT_ID_SCHEMA },
      async ({ projectId }) => {
        try {
          const proposal = await proposalOnlyServiceMutationResult(
            projectId,
            options,
            'video_approve_storyboard',
          );
          if (proposal) return proposal;
          return serviceResult(
            lockedServiceCall(projectId, options, async (resolvedProjectId) => {
              const { storyboard, jobs } =
                await approveStoryboard(resolvedProjectId);
              return {
                projectId: resolvedProjectId,
                status: storyboard.status,
                approvedAt: storyboard.approvedAt,
                approvedBy: storyboard.approvedBy,
                queuedJobs: jobs.length,
                nextStep: 'Call video_render to produce the output.',
              };
            }),
          );
        } catch (error) {
          return errorResult(
            error instanceof Error ? error.message : String(error),
          );
        }
      },
    ),
    tool(
      'video_render',
      'Render the approved project to an output artifact.',
      {
        projectId: PROJECT_ID_SCHEMA,
        preset: RENDER_PRESET_SCHEMA.default('standard'),
        where: RENDER_WHERE_SCHEMA.default('local'),
        aspectRatio: ASPECT_RATIO_SCHEMA.optional(),
      },
      async ({ projectId, preset, where, aspectRatio }) => {
        try {
          const proposal = await proposalOnlyServiceMutationResult(
            projectId,
            options,
            'video_render',
          );
          if (proposal) return proposal;
          return serviceResult(
            lockedServiceCall(projectId, options, (resolvedProjectId) =>
              renderProject(resolvedProjectId, {
                mode: preset === 'draft' ? 'speed' : 'reproducible',
                where,
                aspectRatio,
              }),
            ),
          );
        } catch (error) {
          return errorResult(
            error instanceof Error ? error.message : String(error),
          );
        }
      },
    ),
    tool(
      'video_cancel_render',
      'Cancel the active render for the project.',
      { projectId: PROJECT_ID_SCHEMA },
      async ({ projectId }) => {
        try {
          const proposal = await proposalOnlyServiceMutationResult(
            projectId,
            options,
            'video_cancel_render',
          );
          if (proposal) return proposal;
          return serviceResult(
            lockedServiceCall(projectId, options, (resolvedProjectId) =>
              cancelRender(resolvedProjectId),
            ),
          );
        } catch (error) {
          return errorResult(
            error instanceof Error ? error.message : String(error),
          );
        }
      },
    ),
    tool(
      'video_publish_to',
      'Prepare or send the latest rendered output to a destination.',
      {
        projectId: PROJECT_ID_SCHEMA,
        channel: EXPORT_DESTINATION_SCHEMA,
        aspectRatio: ASPECT_RATIO_SCHEMA.optional(),
        channelConfigId: z.string().min(1).optional(),
        conversationId: z.string().min(1).optional(),
        message: z.string().min(1).optional(),
      },
      async ({
        projectId,
        channel,
        aspectRatio,
        channelConfigId,
        conversationId,
        message,
      }) => {
        try {
          const proposal = await proposalOnlyServiceMutationResult(
            projectId,
            options,
            'video_publish_to',
          );
          if (proposal) return proposal;
          return serviceResult(
            lockedServiceCall(projectId, options, (resolvedProjectId) =>
              shareVideoProject(resolvedProjectId, {
                destination: channel as VideoExportDestination,
                aspectRatio,
                channelConfigId,
                conversationId,
                message,
              }),
            ),
          );
        } catch (error) {
          return errorResult(
            error instanceof Error ? error.message : String(error),
          );
        }
      },
    ),
  ];
}

function normalizeOverlayControlValues(
  basePresetId: string,
  controls: Record<string, string | number | boolean>,
): Record<string, string | number | boolean> {
  const base = findVividOverlayPreset(basePresetId);
  if (!base) return controls;
  return Object.fromEntries(
    Object.entries(controls).map(([id, value]) => [
      id,
      base.controls.find((control) => control.id === id)?.type === 'color' &&
      typeof value === 'string'
        ? normalizeCssColor(value)
        : value,
    ]),
  );
}

export function createVideoEditServer(options: VideoEditServerOptions = {}) {
  return createSdkMcpServer({
    name: 'video-edit',
    version: '0.1.0',
    tools: createVideoEditTools({
      ...options,
      clientKind: options.clientKind ?? 'external-mcp',
    }),
  });
}
