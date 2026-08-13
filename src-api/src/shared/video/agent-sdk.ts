import { randomUUID } from 'node:crypto';

import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { TimelineOpSchema, type TimelineOp } from '@neumar/video-ir';
import { z } from 'zod';

import { createAgent } from '@/core/agent';
import { withToolResultLoopGuard } from '@/core/agent/tool-result-loop-guard';
import type { AgentMessage } from '@/core/agent/types';

import { getSetting } from '@/shared/db/operations';
import { createLogger } from '@/shared/utils/logger';
import { getProviderConfig } from '@/shared/utils/provider-resolution';

import {
  proposeVideoAgentAction,
  type VideoAgentActionName,
  type VideoAgentActionProposal,
  type VideoAgentActionReasoning,
  type VideoAgentContext,
} from './agent-actions';
import { getVideoProjectRoot } from './store';
import {
  VIDEO_TRANSITION_REGISTRY,
  isTransitionKind,
  normalizeTransition,
} from './types';
import type {
  StoryboardScene,
  TimelineTransition,
  TransitionDirection,
  VideoProject,
} from './types';

const logger = createLogger('VideoAgentSdk');
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_PROJECT_SCENES_IN_PROMPT = 20;
const MAX_ASSETS_IN_PROMPT = 30;

const sdkActionNameSchema = z.enum([
  'regenerateScene',
  'addScene',
  'removeScene',
  'setTransition',
  'setTimelineBookend',
  'clearTimelineBookend',
  'setClipAudioSeam',
  'applyTimelineOp',
  'applyTimelineOps',
  'setCaption',
  'generateMusic',
  'addNarration',
  'render',
  'cancelRender',
  'verifyRender',
  'searchLinkedAssets',
  'attachAsset',
]);

const sdkActionReasoningSchema = z
  .object({
    rationale: z.string().min(1),
    considered: z.array(z.string().min(1)).max(6).default([]),
    sourceClips: z.array(z.string().min(1)).max(12).optional(),
  })
  .strict();

const sdkPlanSchema = z
  .object({
    response: z.string().min(1),
    action: z
      .object({
        name: sdkActionNameSchema,
        summary: z.string().min(1),
        args: z.record(z.string(), z.unknown()).default({}),
        reasoning: sdkActionReasoningSchema.optional(),
      })
      .nullable()
      .default(null),
  })
  .strict();

const SUPPORTED_ACTION_NAMES = new Set<string>(sdkActionNameSchema.options);

/**
 * Coerce the model's structured output into the strict shape sdkPlanSchema
 * expects. Real responses regularly drift in three ways:
 *   - action.name is a tool that isn't in the planner's narrow allowlist
 *     (the planner is a proposal layer, not the full agent-tools surface)
 *   - action.summary is nested under action.reasoning.summary
 *   - action.reasoning uses { summary, facts } instead of
 *     { rationale, considered }
 * Rather than throwing the whole plan away, we normalize what we can and
 * downgrade unknown actions to action:null so the model's prose `response`
 * still reaches the user.
 */
export function normalizeSdkPlanInput(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const next: Record<string, unknown> = { ...value };
  const action = isRecord(next.action) ? { ...next.action } : null;
  if (!action) {
    if (next.action !== null && next.action !== undefined) next.action = null;
    return next;
  }

  // Unknown / unsupported action names → drop the action, keep the prose.
  if (
    typeof action.name !== 'string' ||
    !SUPPORTED_ACTION_NAMES.has(action.name)
  ) {
    next.action = null;
    return next;
  }

  const reasoning = isRecord(action.reasoning) ? { ...action.reasoning } : null;

  if (reasoning) {
    // Lift a misplaced summary up to action.summary.
    if (
      (typeof action.summary !== 'string' || !action.summary.trim()) &&
      typeof reasoning.summary === 'string' &&
      reasoning.summary.trim()
    ) {
      action.summary = reasoning.summary;
    }
    // Remap reasoning.summary → rationale when the model used the wrong key.
    if (
      (typeof reasoning.rationale !== 'string' ||
        !reasoning.rationale.trim()) &&
      typeof reasoning.summary === 'string' &&
      reasoning.summary.trim()
    ) {
      reasoning.rationale = reasoning.summary;
    }
    // Remap reasoning.facts → considered when the model used the wrong key.
    if (
      !Array.isArray(reasoning.considered) &&
      Array.isArray(reasoning.facts)
    ) {
      reasoning.considered = reasoning.facts;
    }
    delete reasoning.summary;
    delete reasoning.facts;
    // Drop reasoning entirely if rationale still missing — schema marks it
    // optional and buildPlannerReasoning() will synthesize one.
    if (typeof reasoning.rationale === 'string' && reasoning.rationale.trim()) {
      action.reasoning = reasoning;
    } else {
      delete action.reasoning;
    }
  }

  // Final fallback: if summary is still missing, mirror the top-level response.
  if (typeof action.summary !== 'string' || !action.summary.trim()) {
    if (typeof next.response === 'string' && next.response.trim()) {
      action.summary = next.response.trim();
    }
  }

  next.action = action;
  return next;
}

type SdkPlan = z.infer<typeof sdkPlanSchema>;

export interface VideoAgentPlannerResult {
  message: string;
  proposal: VideoAgentActionProposal | null;
  source: 'claude' | 'fallback';
}

export interface PlanVideoAgentTurnOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface RunVideoAgentTurnOptions {
  signal?: AbortSignal;
  /** User-selected LLM model id for this run (overrides the default). */
  model?: string;
  /** Prior turns so the agent has multi-turn context (remembers pasted URLs etc.). */
  conversation?: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** Prompt-only utilities validated as explicitly Video-compatible. */
  supplementalSkillIds?: string[];
}

/**
 * The agentic runtime (PTC tool calling + media/video-edit MCP servers) is
 * the default Video Mode chat path. The env var lets operators opt OUT
 * (back to the legacy single-turn planner) without code changes — useful
 * for an incident or when the Anthropic API is unavailable.
 *
 *   unset / 'on' / 'true' / '1'  → agentic runtime
 *   'off' / 'false' / '0'        → legacy planVideoAgentTurn path
 */
export function isVideoAgenticRuntimeEnabled(): boolean {
  const value = process.env.NEUMA_VIDEO_AGENTIC_RUNTIME?.trim().toLowerCase();
  if (value === 'off' || value === 'false' || value === '0') return false;
  return true;
}

export function hasVideoAgenticRuntimeCredentials(): boolean {
  const providerConfig = getProviderConfig();
  return Boolean(
    providerConfig.apiKey ||
    getSetting('anthropicApiKey') ||
    getSetting('apiKey') ||
    process.env.ANTHROPIC_API_KEY ||
    process.env.ANTHROPIC_AUTH_TOKEN,
  );
}

export function runVideoAgentTurn(
  project: VideoProject,
  message: string,
  context?: VideoAgentContext,
  options: RunVideoAgentTurnOptions = {},
): AsyncGenerator<AgentMessage> {
  const abortController = new AbortController();
  const cleanup = linkAbortOnly(options.signal, abortController);
  const agent = createAgent({ provider: 'video' });
  const source = withToolResultLoopGuard(
    agent.run(message, {
      runMode: 'video',
      taskId: project.id,
      abortController,
      ...(options.conversation && options.conversation.length > 0
        ? { conversation: options.conversation }
        : {}),
      pinnedSkills: options.supplementalSkillIds,
      videoContext: {
        projectId: project.id,
        model: options.model,
        selectedSceneId: context?.selectedSceneId,
        projectAssetIds: context?.projectAssetIds,
        aspectRatio: context?.aspectRatio,
        transcriptSelection: context?.transcriptSelection,
        editorSelection: context?.editorSelection,
        pluginId: context?.pluginId,
        pluginInputs: context?.pluginInputs,
        approvedPluginCapabilities: context?.approvedPluginCapabilities,
        lastReviewedPluginDigest: context?.lastReviewedPluginDigest,
        pluginSignatureOk: context?.pluginSignatureOk,
      },
      channelContext: {
        platform: 'desktop',
        conversationId: project.id,
        identityId: project.id,
      },
    }),
  );
  return withCleanup(source, cleanup);
}

export async function planVideoAgentTurn(
  project: VideoProject,
  message: string,
  context?: VideoAgentContext,
  options: PlanVideoAgentTurnOptions = {},
): Promise<VideoAgentPlannerResult> {
  if (isClaudeVideoPlannerDisabled()) {
    return fallbackPlan(project, message, context);
  }

  try {
    const plan = await runClaudeVideoPlanner(
      project,
      message,
      context,
      options,
    );
    const proposal = normalizeVideoAgentSdkPlan(project, plan, context);
    return {
      message: plan.response,
      proposal,
      source: 'claude',
    };
  } catch (error) {
    logger.warn('Claude video planner failed, using local parser fallback', {
      error: error instanceof Error ? error.message : String(error),
      projectId: project.id,
    });
    return fallbackPlan(project, message, context);
  }
}

function linkAbortOnly(
  source: AbortSignal | undefined,
  target: AbortController,
): () => void {
  const abort = () => target.abort();
  source?.addEventListener('abort', abort, { once: true });
  return () => source?.removeEventListener('abort', abort);
}

async function* withCleanup<T>(
  source: AsyncGenerator<T>,
  cleanup: () => void,
): AsyncGenerator<T> {
  try {
    yield* source;
  } finally {
    cleanup();
  }
}

export function normalizeVideoAgentSdkPlan(
  project: VideoProject,
  plan: SdkPlan,
  context?: VideoAgentContext,
): VideoAgentActionProposal | null {
  if (!plan.action) return null;
  const action = normalizeActionArgs(
    project,
    plan.action.name,
    plan.action.args,
    context,
  );
  if (!action) return null;

  return {
    id: randomUUID(),
    type: 'action',
    name: plan.action.name,
    args: action.args,
    summary: plan.action.summary,
    reasoning:
      plan.action.reasoning ??
      buildPlannerReasoning(
        project,
        plan.action.name,
        action.args,
        plan.action.summary,
        context,
      ),
    requiresApproval: true,
    status: 'pending',
  };
}

async function runClaudeVideoPlanner(
  project: VideoProject,
  message: string,
  context: VideoAgentContext | undefined,
  options: PlanVideoAgentTurnOptions,
): Promise<SdkPlan> {
  const { query } = await import('@anthropic-ai/claude-agent-sdk');
  const abortController = new AbortController();
  const cleanup = linkAbortSignals(
    options.signal,
    abortController,
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  try {
    const queryResult = query({
      prompt: buildClaudeVideoPlannerPrompt(project, message, context),
      options: {
        abortController,
        cwd: getVideoProjectRoot(project.id),
        maxTurns: 1,
        permissionMode: 'dontAsk',
        tools: [],
        systemPrompt: videoPlannerSystemPrompt(),
        outputFormat: {
          type: 'json_schema',
          schema: z.toJSONSchema(sdkPlanSchema) as Record<string, unknown>,
        },
      },
    });

    for await (const sdkMessage of queryResult) {
      const structured = structuredOutputFromSdkMessage(sdkMessage);
      if (structured)
        return sdkPlanSchema.parse(normalizeSdkPlanInput(structured));
    }
  } finally {
    cleanup();
  }

  throw new Error('Claude video planner returned no structured output');
}

function fallbackPlan(
  project: VideoProject,
  message: string,
  context?: VideoAgentContext,
): VideoAgentPlannerResult {
  const proposal = proposeVideoAgentAction(project, message, context);
  return {
    message: proposal
      ? `Prepared "${proposal.name}" for approval.`
      : `Project "${project.name}" has ${project.assets.length} asset(s). Ask for a scene edit, music, caption, narration, render, or another storyboard action.`,
    proposal,
    source: 'fallback',
  };
}

function normalizeActionArgs(
  project: VideoProject,
  name: VideoAgentActionName,
  args: Record<string, unknown>,
  context?: VideoAgentContext,
): { args: VideoAgentActionProposal['args'] } | null {
  const scene = resolveScene(project, args, context);

  switch (name) {
    case 'cancelRender':
      return { args: {} };
    case 'verifyRender':
      return {
        args: {
          outputPath:
            getString(args, 'outputPath') ?? project.render?.outputPath,
          maxIterations: getNumber(args, 'maxIterations') ?? 3,
        },
      };
    case 'render':
      return {
        args: {
          aspectRatio:
            readAspectRatio(args) ??
            context?.aspectRatio ??
            project.settings?.defaultAspectRatios?.[0] ??
            '16:9',
          mode:
            readRenderMode(args) ??
            project.settings?.defaultRenderMode ??
            'speed',
        },
      };
    case 'generateMusic':
      return {
        args: {
          prompt:
            getString(args, 'prompt') ??
            getString(args, 'mood') ??
            'Generate a music bed for this video.',
          durationMs: getNumber(args, 'durationMs') ?? totalDuration(project),
          tempoBpm: getNumber(args, 'tempoBpm'),
        },
      };
    case 'addScene': {
      const captionText =
        getString(args, 'captionText') ?? getString(args, 'caption');
      return {
        args: {
          afterSceneId: getString(args, 'afterSceneId') ?? scene?.id,
          plan: {
            durationMs: getNumber(args, 'durationMs') ?? 3000,
            intent:
              getString(args, 'intent') ??
              getString(args, 'prompt') ??
              'New scene',
            ...(captionText ? { caption: { text: captionText } } : {}),
          },
        },
      };
    }
    case 'removeScene':
      return scene ? { args: { sceneId: scene.id } } : null;
    case 'regenerateScene':
      return scene
        ? {
            args: {
              sceneId: scene.id,
              prompt:
                getString(args, 'prompt') ??
                getString(args, 'intent') ??
                scene.intent,
              durationMs: scene.durationMs,
            },
          }
        : null;
    case 'setTransition':
      return scene
        ? {
            args: {
              sceneId: scene.id,
              transition: readTransition(args),
            },
          }
        : null;
    case 'setTimelineBookend': {
      const position = readBookendPosition(args);
      return position
        ? {
            args: {
              position,
              kind: 'fade',
              durationMs: getNumber(args, 'durationMs') ?? 500,
            },
          }
        : null;
    }
    case 'clearTimelineBookend': {
      const position = readBookendPosition(args);
      return position ? { args: { position } } : null;
    }
    case 'setClipAudioSeam': {
      const clipId =
        getString(args, 'clipId') ?? visualClipIdForScene(project, scene?.id);
      return clipId
        ? {
            args: {
              clipId,
              mode: readAudioSeamMode(args),
            },
          }
        : null;
    }
    case 'applyTimelineOp': {
      const op = readTimelineOp(args);
      if (!op) return null;
      const summary = getString(args, 'summary');
      return { args: summary ? { op, summary } : { op } };
    }
    case 'applyTimelineOps': {
      const ops = readTimelineOps(args);
      if (!ops) return null;
      const summary = getString(args, 'summary');
      const rippleImpact = readRippleImpact(args);
      return {
        args: {
          ops,
          ...(summary ? { summary } : {}),
          ...(rippleImpact ? { rippleImpact } : {}),
        },
      };
    }
    case 'setCaption': {
      const text = getString(args, 'text') ?? getString(args, 'captionText');
      return scene && text ? { args: { sceneId: scene.id, text } } : null;
    }
    case 'addNarration': {
      const text =
        getString(args, 'text') ?? scene?.caption?.text ?? scene?.intent;
      return scene && text
        ? {
            args: {
              sceneId: scene.id,
              text,
              voiceId: getString(args, 'voiceId'),
            },
          }
        : null;
    }
    case 'searchLinkedAssets':
      return {
        args: {
          query:
            getString(args, 'query') ??
            getString(args, 'prompt') ??
            scene?.intent ??
            project.prompt,
          role: readLinkedRole(args) ?? 'b-roll',
        },
      };
    case 'attachAsset': {
      const assetId = getString(args, 'assetId');
      return assetId
        ? {
            args: { assetId, sceneId: getString(args, 'sceneId') ?? scene?.id },
          }
        : null;
    }
  }
}

function buildClaudeVideoPlannerPrompt(
  project: VideoProject,
  message: string,
  context?: VideoAgentContext,
): string {
  return JSON.stringify(
    {
      task: 'Plan one Video Mode editor response for the user request.',
      userRequest: message,
      context,
      project: summarizeProject(project),
      actionContract: {
        behavior:
          'Return an action only when the request clearly maps to one supported approval card. Otherwise return action:null with a short helpful response.',
        approval:
          'Actions are proposals only. They will be shown to the user for approval before execution.',
        reasoning:
          'When returning an action, include a concise user-visible reasoning object. Summarize why this action was chosen, what project facts were considered, and source clip ids only when directly relevant. Do not reveal hidden chain-of-thought.',
        supportedActions: sdkActionNameSchema.options,
        timelineEditing:
          'For transcript-selection cut/remove/tighten requests, use applyTimelineOps with a clip.removeTimeRange op. Include startMs/endMs from context.transcriptSelection, magnetic:true when downstream clips should ripple, and a concise rippleImpact estimate when available. Prefer batches for related timeline edits.',
        transitionKinds: VIDEO_TRANSITION_REGISTRY.map((entry) => ({
          kind: entry.kind,
          tier: entry.tier,
          native: entry.native,
          directions: entry.directions,
        })),
      },
    },
    null,
    2,
  );
}

function videoPlannerSystemPrompt(): string {
  return [
    'You are the Video Mode planning adapter.',
    'Convert user requests into at most one structured editor action.',
    'Prefer the selected scene when the user says "this scene" or omits a scene.',
    'Keep summaries concise and concrete.',
    'Return only the structured JSON required by the output schema.',
    'Required shape (exact field names):',
    '  {',
    '    "response": "short user-facing message",',
    '    "action": null  // or:',
    '    "action": {',
    '      "name": "<one of the supported action names listed in actionContract.supportedActions>",',
    '      "summary": "one-line concrete description of what this action will do",',
    '      "args": { /* action-specific keys */ },',
    '      "reasoning": {  // optional',
    '        "rationale": "why this action was chosen",',
    '        "considered": ["fact 1", "fact 2"],',
    '        "sourceClips": ["clipId"]  // optional',
    '      }',
    '    }',
    '  }',
    'Rules:',
    '- Use "rationale" (not "summary") and "considered" (not "facts") inside action.reasoning.',
    '- action.summary lives at the action level, not inside reasoning.',
    '- If the request does not map to one of the supported action names, set action to null and explain in response.',
    '- Provide only observable project facts in reasoning, not private chain-of-thought.',
    '- Do not claim that an action already ran; the UI will ask for approval.',
  ].join('\n');
}

function buildPlannerReasoning(
  project: VideoProject,
  name: VideoAgentActionName,
  args: VideoAgentActionProposal['args'],
  summary: string,
  context?: VideoAgentContext,
): VideoAgentActionReasoning {
  const scene = resolveScene(project, args as Record<string, unknown>, context);
  const considered = new Set<string>();
  if (scene) considered.add(`Scene "${scene.intent}"`);
  if (project.storyboard) {
    considered.add(`${project.storyboard.scenes.length} storyboard scenes`);
  }
  for (const item of defaultConsiderations(name)) considered.add(item);
  const sourceClips = [
    getString(args as Record<string, unknown>, 'assetId'),
    getString(args as Record<string, unknown>, 'outputPath'),
  ].filter((value): value is string => Boolean(value));

  return {
    rationale: summary,
    considered: [...considered].slice(0, 6),
    sourceClips: sourceClips.length ? sourceClips : undefined,
  };
}

function defaultConsiderations(name: VideoAgentActionName): string[] {
  switch (name) {
    case 'searchLinkedAssets':
      return ['Linked asset search role', 'Current scene context'];
    case 'attachAsset':
      return ['Requested linked asset', 'Target scene context'];
    case 'render':
      return ['Render aspect ratio', 'Project render settings'];
    case 'verifyRender':
      return ['Latest render output', 'Timeline verification checks'];
    case 'setTimelineBookend':
    case 'clearTimelineBookend':
      return ['Timeline bookend settings', 'Requested fade position'];
    case 'setClipAudioSeam':
      return ['Timeline clip seam', 'Requested audio transition mode'];
    case 'applyTimelineOp':
      return ['Timeline operation kind', 'Target clip or track'];
    case 'applyTimelineOps':
      return [
        'Timeline operation batch',
        'Selected transcript range',
        'Ripple impact on downstream clips',
      ];
    case 'generateMusic':
      return ['Storyboard duration', 'Requested music mood or tempo'];
    case 'addNarration':
    case 'setCaption':
      return ['Scene text', 'Existing caption or narration'];
    default:
      return ['User request', 'Current storyboard context'];
  }
}

function summarizeProject(project: VideoProject) {
  return {
    id: project.id,
    name: project.name,
    prompt: project.prompt,
    render: project.render
      ? {
          status: project.render.status,
          outputPath: project.render.outputPath,
        }
      : undefined,
    settings: {
      defaultAspectRatios: project.settings?.defaultAspectRatios,
      defaultRenderMode: project.settings?.defaultRenderMode,
    },
    storyboard: project.storyboard
      ? {
          status: project.storyboard.status,
          totalDurationMs: project.storyboard.totalDurationMs,
          scenes: project.storyboard.scenes
            .slice(0, MAX_PROJECT_SCENES_IN_PROMPT)
            .map((scene, index) => ({
              index: index + 1,
              id: scene.id,
              durationMs: scene.durationMs,
              intent: scene.intent,
              captionText: scene.caption?.text,
              transition: scene.transition,
              assetPlanKind: scene.assetPlan.kind,
            })),
        }
      : undefined,
    assets: project.assets.slice(0, MAX_ASSETS_IN_PROMPT).map((asset) => ({
      id: asset.id,
      kind: asset.kind,
      source: asset.source,
      durationMs: asset.metadata.durationMs,
    })),
  };
}

function structuredOutputFromSdkMessage(message: SDKMessage): unknown {
  if (message.type !== 'result' || message.subtype !== 'success') {
    return undefined;
  }
  if (message.structured_output) return message.structured_output;
  return parseJson(message.result);
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function linkAbortSignals(
  source: AbortSignal | undefined,
  target: AbortController,
  timeoutMs: number,
): () => void {
  const timeout = setTimeout(() => target.abort(), timeoutMs);
  const abort = () => target.abort();
  source?.addEventListener('abort', abort, { once: true });
  return () => {
    clearTimeout(timeout);
    source?.removeEventListener('abort', abort);
  };
}

function resolveScene(
  project: VideoProject,
  args: Record<string, unknown>,
  context?: VideoAgentContext,
): StoryboardScene | undefined {
  const scenes = project.storyboard?.scenes ?? [];
  const sceneId = getString(args, 'sceneId') ?? context?.selectedSceneId;
  if (sceneId) {
    const found = scenes.find((scene) => scene.id === sceneId);
    if (found) return found;
  }
  const sceneIndex = getNumber(args, 'sceneIndex');
  if (sceneIndex && sceneIndex >= 1) return scenes[sceneIndex - 1];
  return scenes[0];
}

function totalDuration(project: VideoProject): number {
  return (
    project.storyboard?.totalDurationMs ??
    project.storyboard?.scenes.reduce(
      (total, scene) => total + scene.durationMs,
      0,
    ) ??
    30000
  );
}

function readAspectRatio(args: Record<string, unknown>) {
  const value = getString(args, 'aspectRatio') ?? getString(args, 'aspect');
  return value === '16:9' ||
    value === '9:16' ||
    value === '1:1' ||
    value === '4:5'
    ? value
    : undefined;
}

function readRenderMode(args: Record<string, unknown>) {
  const value = getString(args, 'mode');
  return value === 'speed' || value === 'reproducible' ? value : undefined;
}

function readTransition(
  args: Record<string, unknown>,
): StoryboardScene['transition'] {
  const value =
    getString(args, 'transition') ??
    getString(args, 'kind') ??
    getString(args, 'transitionKind');
  const kind = isTransitionKind(value) ? value : 'cut';
  const direction = readTransitionDirection(args);
  const durationMs = getNumber(args, 'durationMs');
  if (!direction && durationMs == null) return kind;
  return normalizeTransition({
    kind,
    direction,
    durationMs,
  } satisfies TimelineTransition);
}

function readTransitionDirection(
  args: Record<string, unknown>,
): TransitionDirection | undefined {
  const value = getString(args, 'direction');
  return value === 'from-left' ||
    value === 'from-right' ||
    value === 'from-top' ||
    value === 'from-bottom'
    ? value
    : undefined;
}

function readBookendPosition(args: Record<string, unknown>) {
  const value = getString(args, 'position');
  return value === 'intro' || value === 'outro' ? value : undefined;
}

function readAudioSeamMode(args: Record<string, unknown>) {
  const value = getString(args, 'mode');
  return value === 'cut' ? value : 'follow';
}

function readTimelineOp(args: Record<string, unknown>): TimelineOp | null {
  const candidate = getRecord(args, 'op') ?? args;
  const parsed = TimelineOpSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

function readTimelineOps(args: Record<string, unknown>): TimelineOp[] | null {
  const candidates = args.ops;
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const ops: TimelineOp[] = [];
  for (const candidate of candidates) {
    const parsed = TimelineOpSchema.safeParse(candidate);
    if (!parsed.success) return null;
    ops.push(parsed.data);
  }
  return ops;
}

function readRippleImpact(
  args: Record<string, unknown>,
): { downstreamClipCount: number; shiftMs: number } | undefined {
  const value = getRecord(args, 'rippleImpact');
  if (!value) return undefined;
  const downstreamClipCount = getNumber(value, 'downstreamClipCount');
  const shiftMs = getNumber(value, 'shiftMs');
  return downstreamClipCount === undefined || shiftMs === undefined
    ? undefined
    : { downstreamClipCount, shiftMs };
}

function readLinkedRole(args: Record<string, unknown>) {
  const value = getString(args, 'role');
  return value === 'context' || value === 'reference' || value === 'b-roll'
    ? value
    : undefined;
}

function visualClipIdForScene(
  project: VideoProject,
  sceneId: string | undefined,
): string | undefined {
  if (!sceneId) return undefined;
  for (const track of project.timeline?.tracks ?? []) {
    if (
      track.kind !== 'video' &&
      track.kind !== 'broll' &&
      track.kind !== 'overlay'
    ) {
      continue;
    }
    const clip = track.clips.find((item) => item.sceneId === sceneId);
    if (clip?.kind === 'video' || clip?.kind === 'image') return clip.id;
  }
  return undefined;
}

function getString(
  value: Record<string, unknown>,
  key: string,
): string | undefined {
  const item = value[key];
  return typeof item === 'string' && item.trim() ? item.trim() : undefined;
}

function getNumber(
  value: Record<string, unknown>,
  key: string,
): number | undefined {
  const item = value[key];
  return typeof item === 'number' && Number.isFinite(item) ? item : undefined;
}

function getRecord(
  value: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const item = value[key];
  return isRecord(item) ? item : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isClaudeVideoPlannerDisabled(): boolean {
  const value = process.env.NEUMA_VIDEO_AGENT_SDK;
  return value === '0' || value === 'false' || value === 'off';
}
