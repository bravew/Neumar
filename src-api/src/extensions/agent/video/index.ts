import { randomUUID } from 'node:crypto';

import { BaseAgent, defineAgentPlugin } from '@/core/agent/plugin';
import { getAgentRegistry } from '@/core/agent/registry';
import type {
  AgentConfig,
  AgentMessage,
  AgentOptions,
  AgentProvider,
  ExecuteOptions,
  PlanOptions,
  TaskPlan,
} from '@/core/agent/types';

import { DEFAULT_AGENT_MODEL } from '@/config/constants';

import {
  ingestProjectMediaFromResult,
  videoMediaAssetIngestHook,
} from '@/extensions/agent/video/asset-ingest-hook';
import { videoCostTelemetryHook } from '@/extensions/agent/video/cost-hook';
import {
  buildVideoToolCapabilityReference,
  buildVideoToolClassifications,
} from '@/extensions/agent/video/permissions';

import { composeCatalogPreamble } from '@/shared/assets';
import { isAssetsCatalogEnabled } from '@/shared/assets/flags';
import { getSetting } from '@/shared/db/operations';
import { createAssetsMcpServer, assetsTools } from '@/shared/mcp/assets-server';
import {
  createBrollMcpServer,
  createBrollTools,
} from '@/shared/mcp/broll-server';
import { createFFmpegMcpServer, ffmpegTools } from '@/shared/mcp/ffmpeg-server';
import { createMediaMcpServer, mediaTools } from '@/shared/mcp/media-server';
import {
  createVideoEditServer,
  createVideoEditTools,
} from '@/shared/mcp/video-edit-server';
import {
  createVideoMcpServer,
  videoSourceTools,
} from '@/shared/mcp/video-server/server';
import { withSessionContext } from '@/shared/services/session-context';
import { findSkill, loadSkills } from '@/shared/skills/loader';
import { createLogger } from '@/shared/utils/logger';
import { getProviderConfig } from '@/shared/utils/provider-resolution';
import {
  writeVideoAgentPlan,
  readVideoAgentPlan,
} from '@/shared/video/agent-plan';
import { getVideoFeatureFlag } from '@/shared/video/flags';
import { getLatestVideoResearchBrief } from '@/shared/video/plugins/atoms/research';
import { getVideoPlugin } from '@/shared/video/plugins/registry';
import {
  buildExactAllowedToolsForVideoPluginRun,
  computeVideoPluginRunGate,
  createVideoPluginRunSnapshot,
  filterMcpToolDefinitionsForVideoPluginRun,
  type VideoPluginToolGroup,
} from '@/shared/video/plugins/runtime';
import type { VideoPlugin } from '@/shared/video/plugins/types';
import {
  recordVideoIntentLog,
  type VideoAppliedPluginSnapshot,
} from '@/shared/video/recipes';
import {
  buildVideoHtmlTemplateContext,
  buildVideoSessionPrompt,
} from '@/shared/video/session-prompt';
import {
  getProject,
  getVideoAssetsDir,
  getVideoProjectDirForRoot,
  getVideoProjectRoot,
} from '@/shared/video/store';

import { VIDEO_AGENT_SYSTEM_PROMPT } from './system-prompt';

const VIDEO_ALLOWED_TOOLS = [
  'mcp__video-edit__*',
  'mcp__assets__*',
  'mcp__media__media_generate_image',
  'mcp__media__media_generate_video',
  'mcp__media__media_check_video',
  'mcp__media__media_list_capabilities',
  'mcp__ffmpeg__*',
  'WebSearch',
  'WebFetch',
  // Skills (canvas-design, video-editing, etc.) read their own SKILL.md and
  // referenced sub-files at runtime; without Read they fail on launch.
  'Read',
] as const;

const VIDEO_DISALLOWED_TOOLS = [
  'Bash',
  'Write',
  'Edit',
  'NotebookEdit',
  'Glob',
  'Grep',
  'TodoWrite',
] as const;

const logger = createLogger('VideoAgent');
// Per-message cap when folding prior turns into the system context, so a long
// history (schema allows up to 40 × 8000 chars) can't bloat the prompt.
const VIDEO_CONVERSATION_CHARS_PER_MESSAGE = 2_000;

export class VideoAgent extends BaseAgent {
  readonly provider = 'video' as AgentProvider;

  override get name(): string {
    return 'Video Storyboard Agent';
  }

  async *run(
    prompt: string,
    options?: AgentOptions,
  ): AsyncGenerator<AgentMessage> {
    const projectId = resolveVideoProjectId(options);
    const project = await getProject(projectId);
    const workspaceRoot = getVideoProjectRoot(projectId);
    const projectDir = getVideoProjectDirForRoot(workspaceRoot, projectId);
    const session = this.createSession('executing');
    // Route by the selected model's provider. `codex:`-prefixed ids run on the
    // Codex CLI and `cursor-agent:`-prefixed ids on the Cursor Agent CLI
    // (subprocesses); everything else uses the Claude adapter. The subprocess
    // paths reach the same video tools over the loopback bridge (see
    // bridgeInProcessServers below) — the mechanism is runtime-agnostic, so
    // future Gemini/DeepSeek model prefixes slot in the same way.
    const selectedModel = options?.videoContext?.model;
    const useCodex =
      typeof selectedModel === 'string' && selectedModel.startsWith('codex:');
    const useCursor =
      typeof selectedModel === 'string' &&
      selectedModel.startsWith('cursor-agent:');
    const useSubprocess = useCodex || useCursor;
    const agent = useSubprocess
      ? getAgentRegistry().create({
          provider: useCodex ? 'codex' : 'cursor-agent',
          model: selectedModel,
          workDir: projectDir,
        })
      : getAgentRegistry().create({
          provider: 'claude',
          ...resolveClaudeConfig(selectedModel),
          workDir: projectDir,
        });
    const plan = buildVideoExecutionPlan(project, prompt);
    const selectedSceneId = options?.videoContext?.selectedSceneId;
    const projectAssetIds = options?.videoContext?.projectAssetIds;
    const transcriptSelection = options?.videoContext?.transcriptSelection;
    const editorSelection = options?.videoContext?.editorSelection;
    const aspectRatio =
      options?.videoContext?.aspectRatio ??
      project.settings?.defaultAspectRatios?.[0];
    const assetsCatalogEnabled = isAssetsCatalogEnabled();
    const activePlugin = resolveActiveVideoPlugin(options);
    const pluginGate = activePlugin
      ? computeVideoPluginRunGate(activePlugin, {
          inputs: options?.videoContext?.pluginInputs,
          output: options?.videoContext?.pluginOutput,
          approvedCapabilities:
            options?.videoContext?.approvedPluginCapabilities ?? [],
          lastReviewedDigest:
            options?.videoContext?.lastReviewedPluginDigest ?? null,
          signatureOk: options?.videoContext?.pluginSignatureOk ?? null,
        })
      : undefined;
    const youtubeCapabilityGranted =
      pluginGate?.grantedCapabilities.includes('network:youtube') ?? false;
    // First-party agent runs (no plugin gate) keep YouTube import always
    // available per product policy; a plugin run only gets it when its manifest
    // was granted network:youtube. Enforced at the tool-execution layer so a
    // plugin that reaches video_import_youtube still cannot bypass the gate.
    const youtubeImportGranted = !pluginGate || youtubeCapabilityGranted;
    const videoEditTools = createVideoEditTools({
      projectId,
      selectedSceneId,
      aspectRatio,
      editorSelection,
      clientKind: 'first-party',
      youtubeImportGranted,
    });
    const brollTools = youtubeCapabilityGranted
      ? createBrollTools({
          projectId,
          youtubeCapabilityGranted,
        })
      : [];
    const permittedVideoEditTools = pluginGate
      ? filterMcpToolDefinitionsForVideoPluginRun(
          'video-edit',
          videoEditTools,
          pluginGate,
        )
      : videoEditTools;
    const toolGroups: VideoPluginToolGroup[] = [
      ...(pluginGate ? [{ serverName: 'video', tools: videoSourceTools }] : []),
      { serverName: 'video-edit', tools: videoEditTools },
      ...(assetsCatalogEnabled
        ? [{ serverName: 'assets', tools: assetsTools }]
        : []),
      { serverName: 'media', tools: mediaTools },
      { serverName: 'ffmpeg', tools: ffmpegTools },
      ...(youtubeCapabilityGranted
        ? [{ serverName: 'broll', tools: brollTools }]
        : []),
    ];
    const enabledMcpServers = [
      ...(pluginGate ? ['video'] : []),
      'video-edit',
      ...(assetsCatalogEnabled ? ['assets'] : []),
      'media',
      'ffmpeg',
      ...(youtubeCapabilityGranted ? ['broll'] : []),
    ];
    const allowedTools = pluginGate
      ? buildExactAllowedToolsForVideoPluginRun(toolGroups, pluginGate, [
          'WebSearch',
          'WebFetch',
          'Read',
        ])
      : [...VIDEO_ALLOWED_TOOLS];
    const ptcMcpTools = pluginGate
      ? [
          ...filterMcpToolDefinitionsForVideoPluginRun(
            'video',
            videoSourceTools,
            pluginGate,
          ),
          ...permittedVideoEditTools,
          ...(assetsCatalogEnabled
            ? filterMcpToolDefinitionsForVideoPluginRun(
                'assets',
                assetsTools,
                pluginGate,
              )
            : []),
          ...filterMcpToolDefinitionsForVideoPluginRun(
            'media',
            mediaTools,
            pluginGate,
          ),
          ...filterMcpToolDefinitionsForVideoPluginRun(
            'ffmpeg',
            ffmpegTools,
            pluginGate,
          ),
          ...(youtubeCapabilityGranted
            ? filterMcpToolDefinitionsForVideoPluginRun(
                'broll',
                brollTools,
                pluginGate,
              )
            : []),
        ]
      : [
          ...videoEditTools,
          ...(assetsCatalogEnabled ? assetsTools : []),
          ...mediaTools,
          ...ffmpegTools,
        ];
    const appliedPluginSnapshot = pluginGate
      ? createVideoPluginRunSnapshot(pluginGate, {
          inputs: options?.videoContext?.pluginInputs,
          output: options?.videoContext?.pluginOutput,
          allowedTools,
          enabledMcpServers,
        })
      : undefined;
    if (appliedPluginSnapshot) {
      recordAppliedPluginSnapshot(projectId, prompt, appliedPluginSnapshot);
    }
    const catalogContext = assetsCatalogEnabled
      ? await composeCatalogPreamble({
          scope: 'video_project',
          scopeId: projectId,
        })
      : '';
    const htmlTemplateContext = await buildVideoHtmlTemplateContext(projectId);
    const researchBrief = getLatestVideoResearchBrief(project);
    const systemPrompt = buildVideoSessionPrompt(project, {
      selectedSceneId,
      projectAssetIds,
      aspectRatio,
      transcriptSelection,
      editorSelection,
      researchBrief,
      plugin: pluginGate?.promptContext,
      catalogContext,
      htmlTemplateContext,
    });
    // execute() (unlike run()) does not inject conversation history, so fold the
    // prior turns into the system context — this is what lets the agent reuse a
    // URL/answer the user gave in an earlier turn (e.g. a pasted YouTube link
    // followed by a rights confirmation).
    const conversationContext = formatVideoConversation(options?.conversation);
    const capabilityReference = buildVideoToolCapabilityReference(
      permittedVideoEditTools,
    );

    // The video tool surface, as fresh-instance factories. The Claude path
    // mounts these in-process; the Codex (subprocess) path bridges them over
    // loopback via `bridgeInProcessServers`. One source of truth either way.
    const videoServerFactories = {
      ...(pluginGate ? { video: () => createVideoMcpServer() } : {}),
      'video-edit': () =>
        createVideoEditServer({
          projectId,
          selectedSceneId,
          aspectRatio,
          editorSelection,
          clientKind: 'first-party',
          youtubeImportGranted,
        }),
      ...(assetsCatalogEnabled
        ? { assets: () => createAssetsMcpServer() }
        : {}),
      media: () => createMediaMcpServer(),
      ffmpeg: () => createFFmpegMcpServer(),
      ...(youtubeCapabilityGranted
        ? {
            broll: () =>
              createBrollMcpServer({ projectId, youtubeCapabilityGranted }),
          }
        : {}),
    };

    // Subprocess CLIs can't load pinned skills, so inline the video-editing
    // SKILL.md for Codex and Cursor alike.
    const skillContext = useSubprocess
      ? await buildVideoSkillContext(options?.pinnedSkills)
      : '';

    const executionPolicy: NonNullable<AgentOptions['executionPolicy']> =
      getVideoFeatureFlag('video.hostNative') ? 'host-native' : 'isolated';
    const baseExecuteOptions = {
      ...(options ?? {}),
      planId: plan.id,
      originalPrompt: prompt,
      plan,
      cwd: projectDir,
      userWorkspaceDir: workspaceRoot,
      allowWorkspaceWrite: false,
      systemContext: `${VIDEO_AGENT_SYSTEM_PROMPT}\n\n${capabilityReference}\n\n${skillContext}${systemPrompt}${conversationContext}`,
      allowedTools,
      disallowedTools: [...VIDEO_DISALLOWED_TOOLS],
      // Scope the run to the video tool surface only. On Claude this skips the
      // built-in/policy MCP servers; on Codex it tells the subprocess bridge to
      // skip the global connector bridges (google/composio) — keeping both
      // runtimes to the same tight tool set.
      disablePolicyServers: true,
      sandbox: { enabled: false },
      executionPolicy,
    };

    const sessionCtx = {
      workDir: projectDir,
      sessionId: session.id,
      userCredentials: options?.userCredentials,
      videoProjectId: projectId,
      selectedSceneId,
      aspectRatio,
      transcriptSelection,
      editorSelection,
      // Media MCP writes generated images/videos into assets/ rather than
      // output/ in Video Mode. output/ stays reserved for final renders.
      mediaOutputDir: getVideoAssetsDir(projectId),
    };

    // Subprocess CLIs can't mount in-process MCP servers; expose the same
    // video tools over the loopback bridge. Fresh instance per request, and
    // carry the session context so bridged tools (media output dir,
    // generated-asset ingest) match the direct path.
    const bridgedVideoServers = Object.entries(videoServerFactories).map(
      ([name, make]) => ({
        name,
        createServer: () => make().instance,
        sessionContext: sessionCtx,
        // Subprocess runtimes have no lifecycle hooks, so register any
        // media a tool wrote here — the provider-agnostic equivalent of
        // videoMediaAssetIngestHook on the Claude path.
        onResult: (text: string) =>
          ingestProjectMediaFromResult(
            projectId,
            text,
            `${session.id}:${name}`,
            name,
          ),
      }),
    );

    yield* withSessionContext(
      sessionCtx,
      useCodex
        ? agent.execute({
            ...baseExecuteOptions,
            bridgeInProcessServers: bridgedVideoServers,
          })
        : useCursor
          ? // Cursor Agent has no plan/execute split — run the original
            // prompt directly with the composed video system context and the
            // bridged tool surface (the adapter renders the bridge into the
            // workspace `.cursor/mcp.json` for the run). History is already
            // folded into systemContext, so drop `conversation` to avoid
            // double-injecting it.
            agent.run(prompt, {
              ...baseExecuteOptions,
              conversation: undefined,
              bridgeInProcessServers: bridgedVideoServers,
            })
          : agent.execute({
              ...baseExecuteOptions,
              inProcessMcpServers: Object.fromEntries(
                Object.entries(videoServerFactories).map(([name, make]) => [
                  name,
                  make(),
                ]),
              ),
              pinnedSkills: [
                ...new Set(['video-editing', ...(options?.pinnedSkills ?? [])]),
              ],
              // A from-scratch build is analyze (per asset) → propose plan → (the
              // plan gate stops here for user approval, ending this run) → build →
              // render → verify, under the one-action-per-turn house style. 30
              // turns exhausted mid-assembly on multi-asset montages ("Reached
              // maximum number of turns"); the plan gate splits the work across
              // runs and this headroom lets the build phase finish in one turn.
              maxTurns: 60,
              ptcEnabled: true,
              ptcMcpTools,
              toolClassifications: buildVideoToolClassifications(),
              toolLifecycleHooks: [
                ...(options?.toolLifecycleHooks ?? []),
                videoCostTelemetryHook,
                videoMediaAssetIngestHook,
              ],
              isolation: 'shared',
            }),
    );
  }

  async *plan(
    prompt: string,
    options?: PlanOptions,
  ): AsyncGenerator<AgentMessage> {
    const session = this.createSession('planning');
    yield { type: 'session', sessionId: session.id };
    const projectId = resolveVideoProjectId(options);
    const persisted = await writeVideoAgentPlan(projectId, {
      title: 'Video implementation plan',
      request: prompt,
      assumptions: [
        'Scene and asset decisions follow the order the user confirmed in chat.',
      ],
      steps: [
        {
          id: 'draft-storyboard',
          title: 'Draft and review the storyboard',
          intent: prompt,
          dependsOn: [],
          operation: 'video_set_storyboard',
          inputs: {},
          verification: [
            'The storyboard matches the order and media choices the user confirmed.',
          ],
          rollback:
            'Restore the previous storyboard with its inverse journal diff.',
        },
      ],
    });
    const plan = persisted.plan!;
    yield {
      type: 'plan',
      sessionId: session.id,
      content: prompt,
      plan: videoAgentPlanToTaskPlan(plan),
    };
    yield { type: 'done', sessionId: session.id };
  }

  async *execute(_options: ExecuteOptions): AsyncGenerator<AgentMessage> {
    const session = this.createSession('executing');
    yield { type: 'session', sessionId: session.id };
    yield {
      type: 'text',
      sessionId: session.id,
      content:
        'Video storyboard execution is handled by /video project routes.',
    };
    yield { type: 'done', sessionId: session.id };
  }
}

export function createVideoAgent(config: AgentConfig): VideoAgent {
  return new VideoAgent(config);
}

function resolveVideoProjectId(options: AgentOptions | undefined): string {
  const projectId =
    options?.videoContext?.projectId ??
    options?.channelContext?.identityId ??
    options?.channelContext?.conversationId ??
    options?.taskId;
  if (!projectId) {
    throw new Error('Video Mode agent requires a project id.');
  }
  return projectId;
}

function resolveActiveVideoPlugin(
  options: AgentOptions | undefined,
): VideoPlugin | undefined {
  const candidate = options?.videoContext?.plugin;
  if (isVideoPlugin(candidate)) return candidate;

  const pluginId =
    typeof candidate === 'string' ? candidate : options?.videoContext?.pluginId;
  return pluginId ? getVideoPlugin(pluginId) : undefined;
}

function isVideoPlugin(value: unknown): value is VideoPlugin {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.version === 'string' &&
    typeof candidate.manifestDigest === 'string' &&
    Array.isArray(candidate.stages) &&
    Array.isArray(candidate.capabilities) &&
    Array.isArray(candidate.impliedCapabilities)
  );
}

function recordAppliedPluginSnapshot(
  projectId: string,
  prompt: string,
  snapshot: VideoAppliedPluginSnapshot,
): void {
  try {
    recordVideoIntentLog({
      projectId,
      userIntentText: prompt,
      plan: {
        plugin: snapshot.plugin.id,
        stages: snapshot.payload.stages.map((stage) => ({
          id: stage.id,
          atoms: stage.atoms,
          optional: stage.optional,
          repeat: stage.repeat,
          until: stage.until,
        })),
      },
      opsProposed: [],
      accepted: false,
      diffSummary: `Applied video plugin ${snapshot.plugin.id}@${snapshot.plugin.version}`,
      appliedPluginSnapshot: snapshot,
    });
  } catch (error) {
    logger.warn('Failed to record video plugin snapshot', {
      projectId,
      pluginId: snapshot.plugin.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Render prior conversation turns as a labelled block for the system context. */
function formatVideoConversation(
  conversation: AgentOptions['conversation'],
): string {
  if (!conversation || conversation.length === 0) return '';
  const lines = conversation
    .map((message) => {
      const role = message.role === 'user' ? 'User' : 'Assistant';
      const content =
        message.content.length > VIDEO_CONVERSATION_CHARS_PER_MESSAGE
          ? `${message.content.slice(0, VIDEO_CONVERSATION_CHARS_PER_MESSAGE)}…`
          : message.content;
      return `${role}: ${content}`;
    })
    .join('\n');
  return `\n\n## Conversation so far (oldest first; reuse URLs/answers the user already gave)\n${lines}`;
}

function buildVideoExecutionPlan(
  project: Awaited<ReturnType<typeof getProject>>,
  prompt: string,
): TaskPlan {
  if (project.agentPlan) return videoAgentPlanToTaskPlan(project.agentPlan);
  return {
    id: `video-plan-${randomUUID()}`,
    goal: 'Persist a durable Video Mode plan and request approval',
    steps: [
      {
        id: 'draft-plan',
        description: `Draft a structured implementation plan for: ${prompt}`,
        status: 'pending',
      },
    ],
    executionMode: 'batch',
    createdAt: new Date(),
  };
}

function videoAgentPlanToTaskPlan(
  plan: NonNullable<Awaited<ReturnType<typeof readVideoAgentPlan>>['plan']>,
): TaskPlan {
  return {
    id: plan.id,
    goal: plan.title,
    steps: plan.steps.map((step) => ({
      id: step.id,
      description: step.intent,
      status: plan.status === 'completed' ? 'completed' : 'pending',
    })),
    notes: `Durable Video plan revision ${plan.revision}; status ${plan.status}.`,
    executionMode: 'batch',
    createdAt: new Date(plan.createdAt),
  };
}

// Claude gets the `video-editing` skill via `pinnedSkills` (the SDK injects
// SKILL.md). Codex has no skill mechanism, so fold the same SKILL.md body into
// its system context. Best-effort: if the skill isn't installed, the main
// VIDEO_AGENT_SYSTEM_PROMPT already covers the essential rules.
async function buildVideoSkillContext(
  supplementalSkillIds: readonly string[] = [],
): Promise<string> {
  try {
    const skills = await loadSkills();
    return ['video-editing', ...supplementalSkillIds]
      .flatMap((id) => {
        const skill = findSkill(skills, id);
        return skill
          ? [`<video-skill id="${id}">\n${skill.content}\n</video-skill>`]
          : [];
      })
      .join('\n\n');
  } catch {
    return '';
  }
}

function resolveClaudeConfig(modelOverride?: string): {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
} {
  const providerConfig = getProviderConfig();
  return {
    apiKey:
      providerConfig.apiKey ??
      getSetting('anthropicApiKey') ??
      getSetting('apiKey') ??
      process.env.ANTHROPIC_API_KEY,
    baseUrl: providerConfig.baseUrl ?? process.env.ANTHROPIC_BASE_URL,
    model:
      modelOverride ??
      providerConfig.model ??
      process.env.ANTHROPIC_MODEL ??
      DEFAULT_AGENT_MODEL,
  };
}

export const videoPlugin = defineAgentPlugin({
  metadata: {
    type: 'video',
    name: 'Video Storyboard Agent',
    version: '1.0.0',
    description:
      'Video Mode chat: delegates to the Claude adapter with a scoped video-edit MCP surface, pinned video-editing skill, and PTC tool-call execution.',
    supportsPlan: true,
    supportsStreaming: true,
    supportsSandbox: false,
    builtin: true,
    transport: 'process',
    // Video Mode runs through the Claude adapter which natively supports MCP
    // and Skills. Declaring 'none' here would gate downstream features that
    // gate on this metadata.
    supportsMcp: 'native',
    supportsSkills: 'native',
    supportsPlanMode: 'orchestrated',
  },
  factory: createVideoAgent,
});
