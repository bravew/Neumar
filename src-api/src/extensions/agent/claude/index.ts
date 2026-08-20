/**
 * Claude Agent SDK Adapter
 *
 * Implementation of the IAgent interface using @anthropic-ai/claude-agent-sdk
 */

import { execFileSync, execSync } from 'child_process';
import { existsSync, readdirSync } from 'fs';
import { mkdir, writeFile } from 'fs/promises';
import { createHash } from 'node:crypto';
import { arch, homedir, platform } from 'os';
import { dirname, join } from 'path';

import type {
  McpServerConfig as SdkMcpServerConfig,
  Options,
} from '@anthropic-ai/claude-agent-sdk';
import {
  createSdkMcpServer,
  query,
  tool,
  type Query as QueryType,
} from '@anthropic-ai/claude-agent-sdk';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

import { buildAskUserQuestionToolUse } from '@/core/agent/ask-user-question';
import {
  BaseAgent,
  formatPlanForExecution,
  getWorkspaceInstruction,
  parsePlanFromResponse,
  parsePlanningResponse,
  PLANNING_INSTRUCTION,
  type SandboxOptions,
} from '@/core/agent/base';
import {
  CLAUDE_FALLBACK_MODEL,
  DEFAULT_CLAUDE_MODEL,
  getClaudeCodeModelSupportError,
  isClaudeSonnet5,
  normalizeClaudeRuntimeError,
  normalizeClaudeThinkingForSdk,
} from '@/core/agent/claude-models';
import { DenialTracker } from '@/core/agent/denial-tracker';
import { hasHarnessCapability } from '@/core/agent/harness-profile';
import { LoopGuard } from '@/core/agent/loop-guard';
import {
  clampDefaultOutputTokens,
  estimateOutputBudgetInputTokens,
} from '@/core/agent/output-budget';
// Import plugin definition helpers
import { CLAUDE_METADATA, defineAgentPlugin } from '@/core/agent/plugin';
import type { AgentPlugin } from '@/core/agent/plugin';
import { AutoClassifier } from '@/core/agent/safety/auto-classifier';
import {
  assessRiskLevel,
  checkBashCommand,
} from '@/core/agent/safety/dangerous-patterns';
import { pythonErrorHintHook } from '@/core/agent/safety/python-error-classifier';
import { ToolLifecycleHookRunner } from '@/core/agent/tool-lifecycle-hooks';
import { ToolPermissionRegistry } from '@/core/agent/tool-permission-registry';
import { limitForDisplay } from '@/core/agent/tool-result-limiter';
import type {
  AgentConfig,
  AgentMessage,
  AgentOptions,
  AgentProvider,
  ConversationMessage,
  ExecuteOptions,
  ImageAttachment,
  McpConfig,
  PlanOptions,
  SkillsConfig,
} from '@/core/agent/types';
import {
  createWorktree,
  removeWorktree,
  hasChanges as worktreeHasChanges,
} from '@/core/agent/worktree';

import { APP_DISPLAY_NAME, APP_SLUG } from '@/config/branding';
import {
  DEFAULT_API_HOST,
  DEFAULT_API_PORT,
  DEFAULT_WORK_DIR,
} from '@/config/constants';

import { isAssetsCatalogEnabled } from '@/shared/assets/flags';
import {
  type ConnectorPolicyInput,
  evaluateConnectorGate,
  type GlobalConnector,
} from '@/shared/auth/connector-policy';
import {
  getGrantedScopes,
  getValidAccessToken,
} from '@/shared/auth/oauth-client';
// ============================================================================
// Logging - uses shared logger (writes to app data directory logs)
// ============================================================================
import { INBOUND_ATTACHMENTS_DIR } from '@/shared/channels/workspace';
import { isConnectorPlatformV2Enabled } from '@/shared/connectors/feature-flag';
import { getAllAgentProfiles, getSetting } from '@/shared/db/operations';
import {
  ASSETS_TOOL_NAMES,
  assetsTools,
  createAssetsMcpServer,
} from '@/shared/mcp/assets-server';
import { BOX_TOOL_NAMES, createBoxMcpServer } from '@/shared/mcp/box-server';
import {
  CLOUD_STORAGE_MEDIA_TOOL_NAMES,
  createCloudStorageMediaMcpServer,
} from '@/shared/mcp/cloud-storage-media-server';
import {
  CONNECTORS_TOOL_NAMES,
  createConnectorsMcpServer,
} from '@/shared/mcp/connectors-server';
import {
  createDropboxMcpServer,
  DROPBOX_TOOL_NAMES,
} from '@/shared/mcp/dropbox-server';
import {
  createFFmpegMcpServer,
  FFMPEG_TOOL_NAMES,
  ffmpegTools,
} from '@/shared/mcp/ffmpeg-server';
import {
  createFigmaMcpConfig,
  FIGMA_TOOL_PATTERN,
} from '@/shared/mcp/figma-server';
import { getGithubMcpConfig } from '@/shared/mcp/github-server';
import {
  createGoogleMcpServer,
  filterToolsByScopes,
  getEnabledGoogleServices,
  getGoogleToolNames,
} from '@/shared/mcp/google-server';
import {
  createLinearMcpServer,
  LINEAR_TOOL_NAMES,
  linearTools,
} from '@/shared/mcp/linear-server';
import type { McpServerConfig } from '@/shared/mcp/loader';
import { loadMcpServers } from '@/shared/mcp/loader';
import {
  createMediaMcpServer,
  MEDIA_TOOL_NAMES,
  mediaTools,
} from '@/shared/mcp/media-server';
import {
  createMemoryMcpServer,
  MEMORY_TOOL_NAMES,
  memoryTools,
} from '@/shared/mcp/memory-server';
import {
  createOneDriveMcpServer,
  ONEDRIVE_TOOL_NAMES,
} from '@/shared/mcp/onedrive-server';
import {
  createPublishMcpServer,
  PUBLISH_TOOL_NAMES,
  publishTools,
} from '@/shared/mcp/publish-server';
import {
  createScheduleMcpServer,
  SCHEDULE_SYSTEM_PROMPT,
  SCHEDULE_TOOL_NAMES,
  scheduleTools,
} from '@/shared/mcp/schedule-server';
import {
  createSearchMcpServer,
  SEARCH_TOOL_NAMES,
} from '@/shared/mcp/search-server';
import {
  createSlackSearchServer,
  SLACK_SEARCH_TOOL_NAMES,
} from '@/shared/mcp/slack-search-server';
import {
  discoverSlackMcpTools,
  getSlackMcpConfig,
} from '@/shared/mcp/slack-server';
import {
  createSpeechMcpServer,
  SPEECH_TOOL_NAMES,
  speechTools,
} from '@/shared/mcp/speech-server';
import {
  mcpAllowedToolNames,
  mcpSelectionTraceAttrs,
  selectMcpServers,
  summarizeMcpSelection,
} from '@/shared/mcp/tool-bundles';
import { recordTraceEvent } from '@/shared/observability/trace';
import { getPluginLoaderGeneration } from '@/shared/plugins';
import { activeQueryStore } from '@/shared/services/active-query-store';
import { deriveMemoryScope } from '@/shared/services/agent';
import { getRemainingBudgetUsd } from '@/shared/services/budget';
import { detectBinaries as detectFFmpegBinaries } from '@/shared/services/ffmpeg';
import { getLinearConfig } from '@/shared/services/linear-config';
import { listCapabilities } from '@/shared/services/media-generation';
import {
  detectSoulCorrection,
  flushIfNeeded,
  llmCapture,
} from '@/shared/services/memory/agent-hooks';
import {
  getEmbedOptions,
  getMemoryConfig,
} from '@/shared/services/memory/config';
import {
  isPublishPipelineEnabled,
  listPublishDestinationOptions,
} from '@/shared/services/publish';
import { getSearchConfig, isSearchEnabled } from '@/shared/services/search';
import { listCapabilities as listSpeechCapabilities } from '@/shared/services/speech';
import { taskEventBus } from '@/shared/services/task-event-bus';
import { logUsage, resolveBillingType } from '@/shared/services/usage-logger';
// Skills are loaded directly by Claude SDK from ~/.claude/skills/ via settingSources: ['user']
// Pinned skills are loaded explicitly and injected into the prompt for guaranteed availability
import {
  findSkill,
  loadSkills,
  type LoadedSkill,
} from '@/shared/skills/loader';
import { LimitedSet } from '@/shared/utils/limited-set';
import { createLogger, getLogFilePath } from '@/shared/utils/logger';
import { getMiseShimBinPaths } from '@/shared/utils/node-install-bins';
import { buildSandboxFilesystemConfig } from '@/shared/utils/path-validator';
import { expandPath } from '@/shared/utils/paths';
import { safeAsyncGenerator } from '@/shared/utils/stream-cleanup';

import { ContainerManager, executePTC } from './ptc';
import { adaptMcpTools } from './ptc-adapter';
import type { ToolHandler } from './ptc-types';
import { hasClaudeSdkStalled } from './stall-policy';

/**
 * Whether built-in MCP servers should be registered for this profile.
 * Built-in servers (media, speech, ffmpeg, memory, schedule) are system
 * capabilities — not user-installed skills — so they cannot be individually
 * gated by skill slugs. When a profile explicitly restricts skills to an
 * empty list, we skip all built-in servers; otherwise they follow their
 * own availability checks (binary installed, provider configured, etc.).
 */
function areBuiltinServersAllowed(
  profileSkills: string[] | undefined,
): boolean {
  if (profileSkills === undefined) return true; // No restriction
  return profileSkills.length > 0; // Empty = fully restricted profile
}

/**
 * Build the Slack search tools hint injected into the agent prompt.
 * Returns an empty string when the slack-search MCP server is not registered.
 */
/**
 * Phase D defense-in-depth: identity stamping. Tells the model who is
 * actually driving the conversation when the run is routed from a
 * channel adapter, so it doesn't blindly assume "the install owner is
 * the user". Empty string for desktop / unknown identities so the
 * model isn't nagged with boilerplate.
 */
function buildIdentityStamp(
  channelContext:
    | { platform?: string; displayName?: string; permissionTier?: string }
    | undefined,
): string {
  if (!channelContext) return '';
  if (!channelContext.platform || channelContext.platform === 'desktop')
    return '';
  const who = channelContext.displayName ?? 'an unknown user';
  const tier = channelContext.permissionTier ?? 'unknown';
  return (
    `\n\n## CALLER IDENTITY\n` +
    `You are acting on behalf of \`${who}\` (tier: ${tier}, platform: ${channelContext.platform}). ` +
    `Do not access mailbox/drive/calendar content unless the action is clearly self-service for that user. ` +
    `If a connector tool is unavailable for the caller's tier, explain that instead of attempting to read shared admin data.`
  );
}

function buildSlackSearchHint(mcpServers: Record<string, unknown>): string {
  if (!mcpServers['slack-search']) return '';
  return (
    `\n\n## AVAILABLE SLACK CHANNEL TOOLS\n` +
    `The following Slack workspace tools are available via the slack-search MCP server:\n` +
    `${SLACK_SEARCH_TOOL_NAMES.map((t) => `- ${t}`).join('\n')}\n\n` +
    `Use these tools when the user asks to search Slack, send messages, or post to channels.`
  );
}

export function normalizeInheritedAnthropicEnvForClaudeLogin(
  env: Record<string, string | undefined>,
): void {
  const baseUrl = env.ANTHROPIC_BASE_URL?.trim() ?? '';
  if (baseUrl.length > 0) {
    env.ANTHROPIC_BASE_URL = baseUrl;
    return;
  }
  delete env.ANTHROPIC_BASE_URL;
  delete env.ANTHROPIC_API_KEY;
}

export function registerInProcessMcpServers(
  mcpServers: Record<string, unknown>,
  inProcessMcpServers?: Record<string, SdkMcpServerConfig>,
): string[] {
  if (!inProcessMcpServers || Object.keys(inProcessMcpServers).length === 0) {
    return [];
  }

  const toolPatterns: string[] = [];
  for (const [name, config] of Object.entries(inProcessMcpServers)) {
    mcpServers[name] = config;
    toolPatterns.push(`mcp__${name}__*`);
  }
  return toolPatterns;
}

export function claudeStreamTextDedupeKey(text: string): string {
  return createHash('sha256').update(text, 'utf-8').digest('hex');
}

const CLAUDE_RESUME_INSTRUCTION_CACHE_LIMIT = 200;
const SONNET_5_PLANNING_MAX_TOKENS_HIGH = 32_768;
const SONNET_5_PLANNING_MAX_TOKENS_DEFAULT = 16_384;

interface ClaudePromptWithResumeCacheInput {
  prompt: string;
  imageInstruction?: string;
  prefixInstructionBlock: string;
  perTurnInstructionBlock?: string;
  suffixInstructionBlock?: string;
  sessionId?: string;
  resumeSessionId?: string;
  instructionBlockHashes: Map<string, string>;
  allowResumeSkip: boolean;
}

interface ClaudePromptWithResumeCacheResult {
  prompt: string;
  cacheKey?: string;
  instructionBlockHash?: string;
  skippedInstructionBlock: boolean;
  skippedInstructionBlockChars: number;
}

function rememberClaudeInstructionBlockHash(
  instructionBlockHashes: Map<string, string>,
  cacheKey: string,
  instructionBlockHash: string,
): void {
  if (!instructionBlockHashes.has(cacheKey)) {
    const oldestKey = instructionBlockHashes.keys().next().value as
      | string
      | undefined;
    if (
      oldestKey &&
      instructionBlockHashes.size >= CLAUDE_RESUME_INSTRUCTION_CACHE_LIMIT
    ) {
      instructionBlockHashes.delete(oldestKey);
    }
  }
  instructionBlockHashes.set(cacheKey, instructionBlockHash);
}

function joinClaudePromptBlocks(...blocks: string[]): string {
  return blocks
    .filter((block) => block.length > 0)
    .reduce((acc, block) => {
      if (!acc) return block;
      if (/\s$/.test(acc) || /^\s/.test(block)) return acc + block;
      return `${acc}\n${block}`;
    }, '');
}

export function composeClaudePromptWithResumeCache({
  prompt,
  imageInstruction = '',
  prefixInstructionBlock,
  perTurnInstructionBlock = '',
  suffixInstructionBlock = '',
  sessionId,
  resumeSessionId,
  instructionBlockHashes,
  allowResumeSkip,
}: ClaudePromptWithResumeCacheInput): ClaudePromptWithResumeCacheResult {
  const cacheKey = (resumeSessionId || sessionId)?.trim() || undefined;
  const cacheableInstructionBlock =
    prefixInstructionBlock + suffixInstructionBlock;
  const instructionBlockHash =
    cacheableInstructionBlock.length > 0
      ? claudeStreamTextDedupeKey(cacheableInstructionBlock)
      : undefined;
  const canSkipInstructionBlock =
    allowResumeSkip &&
    !!resumeSessionId?.trim() &&
    !!cacheKey &&
    !!instructionBlockHash &&
    instructionBlockHashes.get(cacheKey) === instructionBlockHash;

  if (allowResumeSkip && cacheKey && instructionBlockHash) {
    rememberClaudeInstructionBlockHash(
      instructionBlockHashes,
      cacheKey,
      instructionBlockHash,
    );
  }

  const prefix = canSkipInstructionBlock ? '' : prefixInstructionBlock;
  const suffix = canSkipInstructionBlock ? '' : suffixInstructionBlock;
  const skippedInstructionBlockChars = canSkipInstructionBlock
    ? cacheableInstructionBlock.length
    : 0;

  if (imageInstruction) {
    const instructionTail = prefix + perTurnInstructionBlock + suffix;
    return {
      prompt: instructionTail
        ? imageInstruction + prompt + '\n\n' + instructionTail
        : imageInstruction + prompt,
      cacheKey,
      instructionBlockHash,
      skippedInstructionBlock: canSkipInstructionBlock,
      skippedInstructionBlockChars,
    };
  }

  return {
    prompt: prefix + perTurnInstructionBlock + prompt + suffix,
    cacheKey,
    instructionBlockHash,
    skippedInstructionBlock: canSkipInstructionBlock,
    skippedInstructionBlockChars,
  };
}

function wrapPtcToolHandlersWithLifecycleHooks(
  handlers: Map<string, ToolHandler>,
  hookRunner: ToolLifecycleHookRunner,
  sessionId: string,
): Map<string, ToolHandler> {
  if (handlers.size === 0) return handlers;
  const wrapped = new Map<string, ToolHandler>();
  for (const [toolName, handler] of handlers) {
    wrapped.set(toolName, async (input) => {
      const preResult = await hookRunner.runPreToolUse(
        toolName,
        input,
        sessionId,
      );
      if (preResult.action === 'deny') {
        throw new Error(preResult.message ?? `${toolName} denied by hook`);
      }
      const effectiveInput =
        preResult.action === 'modify' && preResult.modifiedInput
          ? preResult.modifiedInput
          : input;
      const result = await handler(effectiveInput);
      await hookRunner.runPostToolUse(
        toolName,
        effectiveInput,
        result,
        sessionId,
      );
      return result;
    });
  }
  return wrapped;
}

/** Truncate tool input to a short string for logging and denial tracking. */
function summarizeInput(input: unknown, maxLen = 200): string {
  if (typeof input === 'object' && input) {
    return JSON.stringify(input).slice(0, maxLen);
  }
  return String(input ?? '');
}

// ── Auto-classifier singleton (lazy, feature-flagged) ──
// Cache the enabled setting to avoid DB reads on every tool call.
// Refreshed every 60s so settings changes take effect without restart.
let autoClassifierInstance: AutoClassifier | undefined;
let autoClassifierApiKey: string | undefined;
let autoClassifierEnabledCache: { value: boolean; ts: number } | undefined;
const CLASSIFIER_SETTING_TTL_MS = 60_000;

function getAutoClassifier(): AutoClassifier | undefined {
  const now = Date.now();
  if (
    !autoClassifierEnabledCache ||
    now - autoClassifierEnabledCache.ts > CLASSIFIER_SETTING_TTL_MS
  ) {
    const enabled = getSetting('autoClassifierEnabled');
    autoClassifierEnabledCache = {
      value: enabled === 'true' || enabled === '1',
      ts: now,
    };
  }
  if (!autoClassifierEnabledCache.value) return undefined;

  const apiKey = process.env.ANTHROPIC_API_KEY || getSetting('apiKey');
  if (!apiKey) return undefined;
  // Recreate if API key changed
  if (autoClassifierInstance && autoClassifierApiKey === apiKey) {
    return autoClassifierInstance;
  }
  autoClassifierApiKey = apiKey;
  autoClassifierInstance = new AutoClassifier(apiKey);
  return autoClassifierInstance;
}

/** Tool classifications that trigger the auto-classifier */
const CLASSIFIER_TARGET_CLASSIFICATIONS = new Set(['execute', 'destructive']);

/**
 * Build an `allow` permission result for the `canUseTool` callback.
 *
 * The Claude CLI subprocess validates the callback's return value against a Zod
 * schema whose `allow` branch REQUIRES `updatedInput` to be a record — even
 * though the SDK's TypeScript `PermissionResult` type marks it optional. A bare
 * `{ behavior: 'allow' }` therefore fails at runtime with
 * "Tool permission request failed: ZodError" and the tool call errors out
 * (observed for control tools like `Monitor`). Always echo the unmodified tool
 * input back so the allow branch validates.
 */
function allowTool(input: unknown): {
  behavior: 'allow';
  updatedInput: Record<string, unknown>;
} {
  return {
    behavior: 'allow',
    updatedInput:
      input && typeof input === 'object'
        ? (input as Record<string, unknown>)
        : {},
  };
}

/**
 * Build a canUseTool callback for the Claude Agent SDK.
 *
 * Shared between runGenerator (direct run) and executeStepGenerator (plan-then-execute)
 * to avoid duplicating ~70 lines of denial tracking, danger checks, permission flow.
 */
function buildCanUseTool(
  denialTracker: DenialTracker,
  permissionRegistry: ToolPermissionRegistry,
  pendingPermissions: Map<string, PendingPermission>,
  taskId: string | undefined,
  sessionId: string,
  loopGuard: LoopGuard,
): NonNullable<Options['canUseTool']> {
  return async (toolName, input, { signal }) => {
    // 0a. Loop guard — stop runaway thrashing/fan-out before maxTurns (200)
    // would, forcing the agent to report the blocker instead of looping.
    const loopStop = loopGuard.check(toolName, summarizeInput(input));
    if (loopStop) {
      logger.warn(`[${sessionId}] Loop guard tripped on ${toolName}`);
      return { behavior: 'deny', message: loopStop };
    }
    // 0b. Check denial tracker — stop retrying repeatedly denied tools
    if (denialTracker.shouldFallback(toolName)) {
      return { behavior: 'deny', message: denialTracker.getSummary() };
    }
    // Bash run_in_background processes are children of this turn's CLI
    // subprocess and are killed the instant the turn ends — there is no
    // mechanism in this app to resume or notify the user later, so a
    // backgrounded job that outlives the turn silently dies unfinished
    // (confirmed: output files show `[killed]` seconds after turn end).
    // Force foreground instead, with the timeout raised to the SDK's max so
    // multi-step batches (e.g. downloading a dozen files) still have room
    // to actually finish before the tool call returns.
    let effectiveInput = input;
    if (toolName === 'Bash') {
      const bashInput = effectiveInput as Record<string, unknown> | undefined;
      if (bashInput?.run_in_background === true) {
        logger.info(
          `[${sessionId}] Forcing Bash foreground (run_in_background jobs don't survive turn end): ${summarizeInput(input)}`,
        );
        effectiveInput = {
          ...bashInput,
          run_in_background: false,
          timeout: Math.max(
            typeof bashInput.timeout === 'number' ? bashInput.timeout : 0,
            600_000,
          ),
        };
      }
    }
    // 1. Check dangerous patterns (Bash commands)
    if (toolName === 'Bash') {
      const command = (effectiveInput as Record<string, unknown>)?.command;
      if (typeof command === 'string') {
        const danger = checkBashCommand(command);
        if (danger.isDangerous && danger.severity === 'block') {
          denialTracker.record(toolName, summarizeInput(effectiveInput));
          return {
            behavior: 'deny',
            message: danger.suggestion ?? 'Blocked: dangerous command',
          };
        }
      }
    }
    // 2. Check registry rules (deny → ask → classification → allow)
    const decision = permissionRegistry.evaluate(toolName, effectiveInput);
    if (decision === 'allow') {
      // 2b. Auto-classifier check for execute/destructive tools (feature-flagged)
      const classifier = getAutoClassifier();
      if (!classifier) return allowTool(effectiveInput);

      const classification = permissionRegistry.classifyTool(toolName);
      if (
        !classification ||
        !CLASSIFIER_TARGET_CLASSIFICATIONS.has(classification)
      ) {
        return allowTool(effectiveInput);
      }

      try {
        const result = await classifier.classify(toolName, effectiveInput);
        if (result.decision === 'allow') return allowTool(effectiveInput);
        if (result.decision === 'deny') {
          logger.warn(
            `Auto-classifier denied ${toolName}: ${result.reasoning}`,
          );
          denialTracker.record(toolName, summarizeInput(effectiveInput));
          return {
            behavior: 'deny',
            message: `Safety review: ${result.reasoning}`,
          };
        }
        // 'warn' — fall through to 'ask' flow below (prompt user)
        logger.info(
          `Auto-classifier flagged ${toolName} for review: ${result.reasoning}`,
        );
      } catch {
        // Classifier failure — never block, proceed with 'allow'
        return allowTool(effectiveInput);
      }
    }
    if (decision === 'deny') {
      denialTracker.record(toolName, summarizeInput(effectiveInput));
      return { behavior: 'deny', message: 'Blocked by permission rules' };
    }
    // 3. 'ask' → emit permission_request, wait for user response
    // If no taskId, we can't show UI — auto-approve (sandbox still enforces OS-level safety)
    if (!taskId) {
      logger.warn(`Auto-approving ${toolName} (no taskId for permission UI)`);
      return allowTool(effectiveInput);
    }
    const requestId = crypto.randomUUID();
    const riskLevel = assessRiskLevel(toolName, effectiveInput);
    const inputStr = summarizeInput(effectiveInput);
    taskEventBus.publish(taskId, {
      type: 'permission_request',
      permission: {
        id: requestId,
        tool: toolName,
        command: inputStr,
        description: `Execute ${toolName}`,
        risk_level: riskLevel,
      },
    });
    // Wait for user response via /agent/permission endpoint
    return new Promise((resolve) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const trackedResolve = (result: any) => {
        if (result?.behavior === 'deny') {
          denialTracker.record(toolName, inputStr);
        }
        resolve(result);
      };
      pendingPermissions.set(requestId, {
        resolve: trackedResolve,
        toolName,
        toolInput: effectiveInput,
        sessionId,
        createdAt: Date.now(),
        registry: permissionRegistry,
      });
      const onAbort = () => {
        if (pendingPermissions.has(requestId)) {
          pendingPermissions.delete(requestId);
          resolve({
            behavior: 'deny' as const,
            message: 'Permission request timed out',
          });
        }
      };
      signal.addEventListener('abort', onAbort, { once: true });
    });
  };
}

/** Throttle interval for yielding thinking progress messages during planning */
const THINKING_THROTTLE_MS = 500;

/** Interval for planning status heartbeats (kept active throughout planning) */
const PLANNING_HEARTBEAT_MS = 3_000;

/** Log a warning if no SDK message received for this long during planning */
const PLANNING_STALL_WARN_MS = 30_000;

/**
 * Merges an async iterable with periodic heartbeats using Promise.race.
 *
 * Unlike a setInterval + queue approach, this works even when the source
 * generator is blocked (e.g., waiting for a subprocess to emit data).
 * The timer and source.next() race on every iteration — when the timer
 * wins, the heartbeat is yielded immediately without waiting for the
 * source to advance.
 *
 * @param shouldHeartbeat - called before each race; return false to stop
 *   emitting heartbeats (e.g., once first content has arrived).
 */
async function* mergeWithHeartbeats<T>(
  source: AsyncIterable<T>,
  makeHeartbeat: () => T,
  intervalMs: number,
  shouldHeartbeat: () => boolean,
): AsyncGenerator<T> {
  const iterator = source[Symbol.asyncIterator]();
  let pendingNext: Promise<IteratorResult<T>> | null = null;

  try {
    while (true) {
      if (!pendingNext) {
        pendingNext = iterator.next();
      }

      if (shouldHeartbeat()) {
        // Race: next source value vs heartbeat timer.
        // Clear the timer after the race to avoid orphaned setTimeout handles
        // accumulating over long planning phases.
        let timerId: ReturnType<typeof setTimeout>;
        const timer = new Promise<'tick'>((resolve) => {
          timerId = setTimeout(() => resolve('tick'), intervalMs);
        });
        const race = await Promise.race([
          pendingNext.then((r) => ({ kind: 'value' as const, result: r })),
          timer.then(() => ({ kind: 'tick' as const, result: undefined })),
        ]);
        clearTimeout(timerId!);

        if (race.kind === 'tick') {
          yield makeHeartbeat();
          // Don't reset pendingNext — still waiting for the same source value
          continue;
        }

        // Source yielded — consume it
        pendingNext = null;
        if (race.result!.done) break;
        yield race.result!.value;
      } else {
        // No heartbeat needed — just await source directly
        const result = await pendingNext;
        pendingNext = null;
        if (result.done) break;
        yield result.value;
      }
    }
  } finally {
    void Promise.resolve(iterator.return?.()).catch(() => {});
  }
}

/** Minimal interface for deduplication tracking (compatible with Set and LimitedSet) */
interface DeduplicationSet {
  has(item: string): boolean;
  add(item: string): void;
  clear(): void;
}

const logger = createLogger('ClaudeAgent');

function hasActiveImmichPublishDestination(): boolean {
  try {
    return listPublishDestinationOptions().some(
      (destination) => destination.kind === 'immich',
    );
  } catch (error) {
    logger.debug(
      `Failed to inspect Immich publish destinations: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}

function isAgentPublishPipelineEnabled(): boolean {
  return isPublishPipelineEnabled() || hasActiveImmichPublishDestination();
}

function buildPublishExecutionHint(hasPublishServer: boolean): string {
  if (!hasPublishServer) return '';
  return `

## Publish Destinations
- If the original request asks to publish, upload, save, or add the generated/edited local file to Immich, a self-hosted media server, or "home album", you MUST finish by calling the Publish MCP tools.
- Call publish.destinations first, match the user's label to the returned Immich connectionId, then call publish.start with the local output path plus sha256, sizeBytes, mime, destination kind "immich", and approvalRequired false unless the user explicitly asked for an extra approval step.
- Do not use Google Photos picker tools for publishing, and do not inspect the filesystem for an "available tools" list.
- Do not stop after creating an output file when the request included publishing.`;
}

// Track sessions that have already been flushed to prevent re-processing (Phase 7F debounce)
// Uses LimitedSet to avoid unbounded memory growth over long-running processes
const MAX_FLUSHED_SESSIONS = 1000;
const flushedSessionIds = new LimitedSet<string>(MAX_FLUSHED_SESSIONS);

/** Model used for lightweight LLM-based memory capture (issue #14 — extracted as constant). */
const LLM_CAPTURE_MODEL = 'claude-haiku-4-5-20251001';

/** Default model for PTC batch execution when no model is configured. */
const DEFAULT_PTC_MODEL = DEFAULT_CLAUDE_MODEL;

// Sandbox API URL - use the main API's sandbox endpoints
// API port: 2620 for production, 5126 for development
// In dev mode (NODE_ENV not set or 'development'), use 5126
const isDev = !process.env.NODE_ENV || process.env.NODE_ENV === 'development';
const API_PORT =
  process.env.PORT || (isDev ? '5126' : String(DEFAULT_API_PORT));
const SANDBOX_API_URL =
  process.env.SANDBOX_API_URL || `http://${DEFAULT_API_HOST}:${API_PORT}`;

/**
 * Install Claude Code automatically
 * Returns true if installation was successful
 */
async function installClaudeCode(): Promise<boolean> {
  const os = platform();
  logger.info('Attempting to install Claude Code...');

  try {
    if (os === 'darwin') {
      // macOS: Try Homebrew first, then npm
      try {
        logger.info('Installing via Homebrew...');
        execSync('brew install claude-code', {
          encoding: 'utf-8',
          stdio: 'inherit',
        });
        return true;
      } catch {
        logger.info('Homebrew failed, trying npm...');
      }
    }

    // Fallback: Use npm (works on all platforms)
    logger.info('Installing via npm...');
    execSync('npm install -g @anthropic-ai/claude-code', {
      encoding: 'utf-8',
      stdio: 'inherit',
    });
    return true;
  } catch (error) {
    logger.error('Failed to install Claude Code:', error);
    return false;
  }
}

/**
 * Check if running in a packaged Tauri app environment
 */
function isPackagedApp(): boolean {
  // Check if running from a bundled binary (via pkg)
  // @ts-expect-error - pkg specific property
  if (process.pkg) {
    return true;
  }

  // Check for Tauri environment
  if (process.env.TAURI_ENV || process.env.TAURI) {
    return true;
  }

  // Check if executable path contains typical app bundle paths
  const execPath = process.execPath;
  const slugNoHyphen = APP_SLUG.replace(/-/g, '');
  const displayNameEscaped = APP_DISPLAY_NAME.replace(/\s/g, '');
  if (
    execPath.includes('.app/Contents/MacOS') ||
    execPath.includes(`\\${slugNoHyphen}\\`) ||
    execPath.includes(`/${slugNoHyphen}/`) ||
    execPath.includes(`\\${APP_DISPLAY_NAME}\\`) ||
    execPath.includes(`/${APP_DISPLAY_NAME}/`) ||
    execPath.includes(`\\${displayNameEscaped}\\`) ||
    execPath.includes(`/${displayNameEscaped}/`)
  ) {
    return true;
  }

  // Check for production environment
  if (process.env.NODE_ENV === 'production') {
    return true;
  }

  return false;
}

/**
 * Get the target triple for the current platform
 */
function getTargetTriple(): string {
  const os = platform();
  const cpuArch = arch();

  if (os === 'darwin') {
    return cpuArch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin';
  } else if (os === 'linux') {
    return cpuArch === 'arm64'
      ? 'aarch64-unknown-linux-gnu'
      : 'x86_64-unknown-linux-gnu';
  } else if (os === 'win32') {
    return 'x86_64-pc-windows-msvc';
  }

  return 'unknown';
}

/**
 * Get the path to bundled sidecar Claude Code executable
 * The bundle structure is:
 * - claude-{target} or claude (launcher script)
 * - claude-bundle/
 *   - node (Node.js binary)
 *   - node_modules/@anthropic-ai/claude-code/ (Claude Code package)
 */
function getSidecarClaudeCodePath(): string | undefined {
  const os = platform();
  const targetTriple = getTargetTriple();
  const claudeName =
    os === 'win32' ? `claude-${targetTriple}.exe` : `claude-${targetTriple}`;

  // Get the directory where this process (API binary) is running from
  // In a packaged app, this would be the MacOS directory or the app directory
  const execDir = dirname(process.execPath);

  // Possible locations for the bundled Claude Code launcher
  const possibleLauncherPaths = [
    join(execDir, claudeName),
    join(execDir, 'claude'),
  ];

  // For Windows, also check for .cmd batch files
  if (os === 'win32') {
    possibleLauncherPaths.push(join(execDir, 'claude.cmd'));
    possibleLauncherPaths.push(
      join(execDir, '_up_', 'src-api', 'dist', 'claude.cmd'),
    );
  }

  // For macOS .app bundles, also check Resources directory
  if (os === 'darwin') {
    const resourcesDir = join(execDir, '..', 'Resources');
    possibleLauncherPaths.push(join(resourcesDir, claudeName));
    possibleLauncherPaths.push(join(resourcesDir, 'claude'));
  }

  // For Linux deb/rpm packages, launcher is in /usr/bin/
  if (os === 'linux') {
    possibleLauncherPaths.push('/usr/bin/claude');
    possibleLauncherPaths.push(join(execDir, '..', 'bin', 'claude'));
  }

  // For pkg bundled apps
  // @ts-expect-error - pkg specific property
  if (process.pkg) {
    const pkgDir = dirname(process.argv[0]!);
    possibleLauncherPaths.push(join(pkgDir, claudeName));
    possibleLauncherPaths.push(join(pkgDir, 'claude'));
  }

  // Check each possible launcher path
  for (const launcherPath of possibleLauncherPaths) {
    if (!existsSync(launcherPath)) continue;

    // Get the directory containing the launcher
    const launcherDir = dirname(launcherPath);

    // Check if cli-bundle or claude-bundle directory exists alongside the launcher
    const bundleNames = ['cli-bundle', 'claude-bundle'];
    for (const bundleName of bundleNames) {
      const bundleDir = join(launcherDir, bundleName);
      const claudeCliPath = join(
        bundleDir,
        'node_modules',
        '@anthropic-ai',
        'claude-code',
        'cli.js',
      );
      const nodeBinPath = join(bundleDir, os === 'win32' ? 'node.exe' : 'node');

      if (
        existsSync(bundleDir) &&
        existsSync(claudeCliPath) &&
        existsSync(nodeBinPath)
      ) {
        logger.info(`Found bundled Claude Code at: ${launcherPath}`);
        logger.debug(`Bundle directory: ${bundleDir}`);
        logger.debug(`Node.js binary: ${nodeBinPath}`);
        return launcherPath;
      }
    }

    // If no bundle dir but launcher exists, it might be a standalone binary
    if (existsSync(launcherPath)) {
      logger.info(`Found Claude Code launcher at: ${launcherPath}`);
      return launcherPath;
    }
  }

  // Also try direct check for cli-bundle/claude-bundle in common locations
  const bundleLocations = [
    // New unified cli-bundle structure
    join(execDir, 'cli-bundle'),
    join(execDir, '..', 'Resources', 'cli-bundle'),
    // macOS: Tauri places resources with preserved path structure
    join(execDir, '..', 'Resources', '_up_', 'src-api', 'dist', 'cli-bundle'),
    // Windows: Tauri places resources relative to exe with preserved path structure
    join(execDir, '_up_', 'src-api', 'dist', 'cli-bundle'),
    // Linux: Tauri deb/rpm places resources in /usr/lib/<AppName>/
    // execDir is /usr/bin, so ../lib/{APP_DISPLAY_NAME}/ -> /usr/lib/{APP_DISPLAY_NAME}/
    join(
      execDir,
      '..',
      'lib',
      APP_DISPLAY_NAME,
      '_up_',
      'src-api',
      'dist',
      'cli-bundle',
    ),
    join(
      execDir,
      '..',
      'lib',
      APP_SLUG,
      '_up_',
      'src-api',
      'dist',
      'cli-bundle',
    ),
    // Legacy claude-bundle for backward compatibility
    join(execDir, 'claude-bundle'),
    join(execDir, '..', 'Resources', 'claude-bundle'),
  ];

  for (const bundleDir of bundleLocations) {
    if (!existsSync(bundleDir)) continue;

    const claudeCliPath = join(
      bundleDir,
      'node_modules',
      '@anthropic-ai',
      'claude-code',
      'cli.js',
    );
    const nodeBinPath = join(bundleDir, os === 'win32' ? 'node.exe' : 'node');

    if (existsSync(claudeCliPath) && existsSync(nodeBinPath)) {
      // Create a path that points to using the bundled node to run claude
      // The launcher script should be in the parent directory or a few levels up
      const possibleLauncherDirs = [
        dirname(bundleDir), // Direct parent
        join(dirname(bundleDir), '..', '..', '..'), // For _up_/src-api/dist/cli-bundle structure
        '/usr/bin', // Linux: launcher is in /usr/bin/
      ];

      // On Windows, look for .cmd files; on Unix, look for shell scripts
      const launcherNames =
        os === 'win32' ? ['claude.cmd', claudeName] : [claudeName, 'claude'];

      for (const launcherDir of possibleLauncherDirs) {
        for (const launcherName of launcherNames) {
          const launcherPath = join(launcherDir, launcherName);
          if (existsSync(launcherPath)) {
            logger.info(
              `Found bundled Claude Code launcher at: ${launcherPath}`,
            );
            return launcherPath;
          }
        }
      }

      // If no launcher found, return undefined instead of BUNDLE: prefix
      // The BUNDLE: prefix is not understood by the Claude SDK
      logger.warn(
        `Found Claude Code bundle at: ${bundleDir} but no launcher script found`,
      );
      return undefined;
    }
  }

  return undefined;
}

/**
 * Process-lifetime cache for the extended PATH string.
 * Avoids repeated filesystem scans (nvm directory listing, etc.) that
 * trigger macOS TCC permission prompts on every agent invocation.
 */
let cachedExtendedPath: string | undefined;

/**
 * Build extended PATH that includes common package manager bin locations.
 * Result is cached for the process lifetime since install locations don't
 * change during a single app run.
 */
function getExtendedPath(): string {
  if (cachedExtendedPath !== undefined) return cachedExtendedPath;

  const home = homedir();
  const os = platform();
  const isWindows = os === 'win32';
  const pathSeparator = isWindows ? ';' : ':';

  const paths = [process.env.PATH || ''];

  if (isWindows) {
    // Windows paths
    paths.push(
      join(home, 'AppData', 'Roaming', 'npm'),
      join(home, 'AppData', 'Local', 'Programs', 'nodejs'),
      join(home, '.volta', 'bin'),
      join(home, 'AppData', 'Local', 'mise', 'shims'),
      'C:\\Program Files\\nodejs',
      'C:\\Program Files (x86)\\nodejs',
    );
  } else {
    // Unix paths
    paths.push(
      '/usr/local/bin',
      '/opt/homebrew/bin',
      `${home}/.local/bin`,
      `${home}/.npm-global/bin`,
      `${home}/.volta/bin`,
      `${home}/code/node/npm_global/bin`,
    );
    paths.push(...getMiseShimBinPaths(home));

    // Add nvm paths (Unix only)
    const nvmDir = join(home, '.nvm', 'versions', 'node');
    try {
      if (existsSync(nvmDir)) {
        const versions = readdirSync(nvmDir);
        for (const version of versions) {
          paths.push(join(nvmDir, version, 'bin'));
        }
      }
    } catch {
      // nvm not installed
    }
  }

  cachedExtendedPath = paths.join(pathSeparator);
  return cachedExtendedPath;
}

/**
 * Process-lifetime cache for the resolved Claude Code executable path.
 * `undefined` = not yet resolved; `null` = resolved but not found.
 */
let cachedClaudeCodePath: string | null | undefined;

/**
 * Get the path to the claude-code executable.
 * Result is cached for the process lifetime to avoid repeated filesystem
 * probes and shell subprocess spawns that trigger macOS TCC prompts.
 *
 * Priority order:
 * 1. User-installed Claude Code (via which/where, npm global, common paths, nvm, etc.)
 * 2. Bundled sidecar Claude Code (if app was built with --with-claude)
 */
function getClaudeCodePath(): string | undefined {
  if (cachedClaudeCodePath !== undefined) {
    return cachedClaudeCodePath ?? undefined;
  }

  const resolved = resolveClaudeCodePath();
  cachedClaudeCodePath = resolved ?? null;
  return resolved;
}

/**
 * Internal resolver — performs the actual filesystem probing.
 * Called once by getClaudeCodePath() and cached thereafter.
 */
function resolveClaudeCodePath(): string | undefined {
  const os = platform();
  const extendedEnv = { ...process.env, PATH: getExtendedPath() };

  // Priority 1: Check for user-installed Claude Code via 'which'/'where' with extended PATH
  try {
    if (os === 'win32') {
      const whereResult = execSync('where claude', {
        encoding: 'utf-8',
        stdio: 'pipe',
        env: extendedEnv,
      }).trim();
      const firstPath = whereResult.split('\n')[0];
      if (firstPath && existsSync(firstPath)) {
        logger.info(`Found user-installed Claude Code at: ${firstPath}`);
        return firstPath;
      }
    } else {
      // Try with login shell to get user's PATH
      try {
        const shellWhichResult = execSync('bash -l -c "which claude"', {
          encoding: 'utf-8',
          stdio: 'pipe',
          env: extendedEnv,
        }).trim();
        if (shellWhichResult && existsSync(shellWhichResult)) {
          logger.info(
            `Found user-installed Claude Code at: ${shellWhichResult}`,
          );
          return shellWhichResult;
        }
      } catch {
        // Try zsh if bash fails
        try {
          const zshWhichResult = execSync('zsh -l -c "which claude"', {
            encoding: 'utf-8',
            stdio: 'pipe',
            env: extendedEnv,
          }).trim();
          if (zshWhichResult && existsSync(zshWhichResult)) {
            logger.info(
              `Found user-installed Claude Code at: ${zshWhichResult}`,
            );
            return zshWhichResult;
          }
        } catch {
          // Fall through to other checks
        }
      }

      // Fallback: simple which with extended PATH
      const whichResult = execSync('which claude', {
        encoding: 'utf-8',
        stdio: 'pipe',
        env: extendedEnv,
      }).trim();
      if (whichResult && existsSync(whichResult)) {
        logger.info(`Found user-installed Claude Code at: ${whichResult}`);
        return whichResult;
      }
    }
  } catch {
    // 'which claude' failed, user doesn't have claude installed globally
  }

  // Priority 2: Try to get npm global bin path dynamically
  try {
    const npmPrefix = execSync('npm config get prefix', {
      encoding: 'utf-8',
      stdio: 'pipe',
      env: extendedEnv,
    }).trim();
    if (npmPrefix) {
      const npmBinPath = join(npmPrefix, 'bin', 'claude');
      if (existsSync(npmBinPath)) {
        logger.info(`Found Claude Code at npm global: ${npmBinPath}`);
        return npmBinPath;
      }
    }
  } catch {
    // npm not available
  }

  // Priority 3: Check common install locations
  const home = homedir();
  const commonPaths =
    os === 'win32'
      ? [
          join(home, 'AppData', 'Local', 'Programs', 'claude', 'claude.exe'),
          join(home, 'AppData', 'Roaming', 'npm', 'claude.cmd'),
        ]
      : [
          '/usr/local/bin/claude',
          '/opt/homebrew/bin/claude',
          join(home, '.local', 'bin', 'claude'),
          join(home, '.npm-global', 'bin', 'claude'),
          join(home, '.volta', 'bin', 'claude'), // Volta
          join(home, 'code', 'node', 'npm_global', 'bin', 'claude'), // Custom npm global path
        ];

  // Priority 3.5: Also check nvm paths (dynamically find node versions)
  if (os !== 'win32') {
    const nvmDir = join(home, '.nvm', 'versions', 'node');
    try {
      const versions = readdirSync(nvmDir);
      for (const version of versions) {
        const nvmPath = join(nvmDir, version, 'bin', 'claude');
        if (existsSync(nvmPath)) {
          logger.info(`Found Claude Code at nvm path: ${nvmPath}`);
          return nvmPath;
        }
      }
    } catch {
      // nvm not installed or no versions
    }
  }

  for (const p of commonPaths) {
    if (existsSync(p)) {
      logger.info(`Found Claude Code at: ${p}`);
      return p;
    }
  }

  // Priority 4: Check if CLAUDE_CODE_PATH env var is set
  if (
    process.env.CLAUDE_CODE_PATH &&
    existsSync(process.env.CLAUDE_CODE_PATH)
  ) {
    logger.info(`Using CLAUDE_CODE_PATH: ${process.env.CLAUDE_CODE_PATH}`);
    return process.env.CLAUDE_CODE_PATH;
  }

  // Priority 5: Check for bundled sidecar Claude Code (if built with --with-claude)
  const sidecarPath = getSidecarClaudeCodePath();
  if (sidecarPath) {
    logger.info(`Using bundled sidecar Claude Code: ${sidecarPath}`);
    return sidecarPath;
  }

  logger.warn(
    'Claude Code not found. Please install it or rebuild the app with --with-claude flag.',
  );
  return undefined;
}

/**
 * Per-path cache for Claude Code versions.
 * Key: resolved CLI path, Value: version string or undefined (failed to detect).
 */
const claudeCodeVersionCache = new Map<string, string | undefined>();

/**
 * Get the installed Claude Code CLI version.
 * Caches result per resolved path to avoid repeated subprocess calls.
 * Returns undefined if version cannot be determined.
 */
function getClaudeCodeVersion(claudeCodePath?: string): string | undefined {
  const cliPath = claudeCodePath || getClaudeCodePath();
  if (!cliPath) {
    return undefined;
  }

  if (claudeCodeVersionCache.has(cliPath)) {
    return claudeCodeVersionCache.get(cliPath);
  }

  try {
    const versionOutput = execFileSync(cliPath, ['--version'], {
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 5000,
    }).trim();
    // Version output is like "2.1.63 (Claude Code)" or just "2.1.63"
    const match = versionOutput.match(/^(\d+\.\d+\.\d+)/);
    const version = match ? match[1] : undefined;
    claudeCodeVersionCache.set(cliPath, version);
    if (version) {
      logger.info(`Claude Code version: ${version}`);
    }
    return version;
  } catch {
    logger.warn('Failed to detect Claude Code version');
    claudeCodeVersionCache.set(cliPath, undefined);
    return undefined;
  }
}

/**
 * Check if the installed Claude Code supports --setting-sources flag.
 * This flag was introduced in Claude Code 2.x (agent SDK integration).
 * Versions before 2.0.0 (e.g. 1.x) do not support it.
 */
function supportsSettingSources(claudeCodePath?: string): boolean {
  const version = getClaudeCodeVersion(claudeCodePath);
  if (!version) return false;

  const major = parseInt(version.split('.')[0] ?? '', 10);
  // --setting-sources requires Claude Code >= 2.0.0
  return !isNaN(major) && major >= 2;
}

function validateClaudeCodeModelSupport(
  claudeCodePath: string,
  model?: string,
): string | null {
  const version = getClaudeCodeVersion(claudeCodePath);
  return getClaudeCodeModelSupportError(model, version);
}

/**
 * Return a model the installed Claude Code can actually run. When the selected
 * model needs a newer CLI than is installed (e.g. Sonnet 5 requires
 * >= 2.1.197), fall back to Sonnet 4.6 so users without the latest model/CLI
 * keep working instead of hitting a hard "please update" error.
 */
function resolveSupportedClaudeModel(
  claudeCodePath: string,
  model?: string,
): string | undefined {
  const supportError = validateClaudeCodeModelSupport(claudeCodePath, model);
  if (!supportError) return model;
  logger.warn('claude_model_version_fallback', {
    model,
    fallbackModel: CLAUDE_FALLBACK_MODEL,
    reason: supportError,
  });
  return CLAUDE_FALLBACK_MODEL;
}

/**
 * Ensure Claude Code is available, install if necessary
 * Note: If app was built with --with-claude, sidecar will be used automatically
 */
async function ensureClaudeCode(): Promise<string | undefined> {
  let path = getClaudeCodePath();

  if (!path) {
    // Check if we're in a packaged app without sidecar Claude Code
    // In this case, we can still try to install if the user has npm available
    if (isPackagedApp()) {
      logger.info(
        'Claude Code not found in packaged app. The app was built without --with-claude flag. Attempting automatic installation...',
      );
    } else {
      logger.info(
        'Claude Code not found, attempting automatic installation...',
      );
    }

    const installed = await installClaudeCode();
    if (installed) {
      // Invalidate cache so the freshly installed binary is found
      cachedClaudeCodePath = undefined;
      path = getClaudeCodePath();
    }
  }

  return path;
}

/**
 * Expand ~ to home directory and normalize path separators
 */
// expandPath is imported from @/shared/utils/paths (see top-level imports)

/**
 * Build a unique-per-sub-agent step name. `task_id` provides identity
 * (so sibling sub-agents with identical descriptions stay distinct in the
 * AG-UI active-step table); description provides a readable display label.
 */
function buildSubAgentStepName(
  description: string | undefined,
  taskId: string | undefined,
): string {
  const shortId = taskId ? taskId.slice(0, 6) : undefined;
  if (description && shortId) return `${description} [${shortId}]`;
  if (description) return description;
  return `Sub-agent-${shortId ?? 'unknown'}`;
}

/**
 * Get or create session working directory
 * If workDir already contains a valid session path (from frontend), use it directly
 * Otherwise, generate a new session folder with format: session-{id}
 * NOTE: This function only computes the path, it does NOT create the directory
 */
function getSessionWorkDir(
  workDir: string = DEFAULT_WORK_DIR,
  prompt?: string,
  taskId?: string,
): string {
  logger.debug('getSessionWorkDir called with:', {
    workDir,
    prompt: prompt?.slice(0, 50),
    taskId,
  });

  const expandedPath = expandPath(workDir);
  logger.debug('Expanded path:', expandedPath);

  // Check if the workDir is already a session folder path from frontend
  // Session paths from frontend look like: ~/{APP_DIR}/sessions/{sessionId}/task-{xx}
  // or: ~/{APP_DIR}/sessions/{sessionId}
  // Support both Unix (/) and Windows (\) path separators
  const hasSessionsPath =
    expandedPath.includes('/sessions/') ||
    expandedPath.includes('\\sessions\\');
  const endsWithSessions =
    expandedPath.endsWith('/sessions') || expandedPath.endsWith('\\sessions');
  if (hasSessionsPath && !endsWithSessions) {
    // Frontend already provided a proper session path, use it directly
    logger.debug('Using frontend-provided session path:', expandedPath);
    return expandedPath;
  }

  // Channel workspace paths (e.g. channels/slack/{userId}/{threadTs})
  // should be used directly — don't create nested sessions/ subfolder.
  const hasChannelsPath =
    expandedPath.includes('/channels/') ||
    expandedPath.includes('\\channels\\');
  if (hasChannelsPath) {
    logger.debug('Using channel workspace path directly:', expandedPath);
    return expandedPath;
  }

  // DesignMode project workspaces (design-projects/{projectId}) are durable,
  // per-project directories — like channel workspaces — and the FileWorkspace
  // watches the project root for artifacts (Fix-sync Phase 02). Use the path
  // directly so the agent writes index.html into the project, not a nested
  // sessions/ sandbox the canvas can't see.
  const hasDesignProjectsPath =
    expandedPath.includes('/design-projects/') ||
    expandedPath.includes('\\design-projects\\');
  if (hasDesignProjectsPath) {
    logger.debug('Using design project workspace path directly:', expandedPath);
    return expandedPath;
  }

  // Create sessions under the user-configured workspace directory.
  // Falls back to the default app data dir (~/.neumar) if no workDir was provided.
  const baseDir = expandPath(workDir || DEFAULT_WORK_DIR);
  const sessionsDir = join(baseDir, 'sessions');

  let folderName: string;
  if (taskId) {
    // Use taskId for consistent naming
    folderName = `session-${taskId}`;
  } else {
    // Fallback to timestamp-based naming
    folderName = `session-${crypto.randomUUID()}`;
  }

  const targetDir = join(sessionsDir, folderName);
  return targetDir;
}

/**
 * Ensure a directory exists, creating it if necessary
 * This should be called only when actually writing files
 */
async function ensureDir(dirPath: string): Promise<void> {
  try {
    await mkdir(dirPath, { recursive: true });
  } catch (error) {
    logger.error('Failed to create directory:', error);
  }
}

/**
 * Save images to disk and return file paths
 */
async function saveImagesToDisk(
  images: ImageAttachment[],
  workDir: string,
): Promise<string[]> {
  const savedPaths: string[] = [];

  if (images.length === 0) {
    return savedPaths;
  }

  const inboundDir = join(workDir, INBOUND_ATTACHMENTS_DIR);
  await ensureDir(inboundDir);

  for (let i = 0; i < images.length; i++) {
    const image = images[i]!;
    const ext = image.mimeType.split('/')[1] || 'png';
    const filename = `image_${crypto.randomUUID()}_${i}.${ext}`;
    const filePath = join(inboundDir, filename);

    try {
      // Remove data URL prefix if present (e.g., "data:image/png;base64,")
      let base64Data: string = image.data;
      if (base64Data.includes(',')) {
        base64Data = base64Data.split(',')[1] ?? base64Data;
      }

      const buffer = Buffer.from(base64Data, 'base64');
      await writeFile(filePath, buffer);
      savedPaths.push(filePath);
      logger.debug(`Saved image to: ${filePath}`);
    } catch (error) {
      logger.error(`Failed to save image: ${error}`);
    }
  }

  return savedPaths;
}

/**
 * Build the system-prompt append for runs that target a specific Anthropic
 * model. Pins the model identity and nudges the agent toward the
 * `AskUserQuestion` tool — the SDK's `claude_code` preset only mentions it in
 * sub-agent contexts (Plan Mode, automation), so without this hint Claude
 * tends to enumerate options as markdown instead of emitting the tool call
 * that Neuma renders interactively via `QuestionInput`.
 */
function buildSystemPromptAppend(
  model: string,
  skillsEnabled: boolean = true,
): string {
  return [
    `You are running on Anthropic model \`${model}\`. If the user asks which model you are, answer with exactly that model ID — do not guess based on training data.`,
    'When you need clarification from the user or want them to pick between 2–4 finite options, call the `AskUserQuestion` tool. Do NOT enumerate the options as numbered markdown — emit the tool call so the host can render an interactive picker and resume your turn with the answer.',
    "Bash processes started with run_in_background are children of this turn's subprocess and are killed the moment your turn ends — there is no mechanism to resume or notify the user later. Never background a finite job (e.g. downloading a list of files) and end your turn saying you'll report back when it's done; that job will silently die unfinished. Instead, run finite batches in the foreground (or poll BashOutput to completion before ending your turn) so you only report results you've actually confirmed. Only use run_in_background for something the user will keep this task open to watch.",
    ...(skillsEnabled
      ? [
          "When a skill (e.g. yt-dlp) is available and the user asks you to download media such as a YouTube video or its audio, invoke the skill directly — do NOT ask for rights/copyright confirmation or refuse citing YouTube's Terms of Service. The user is responsible for how they use downloaded content.",
        ]
      : []),
  ].join('\n\n');
}

/**
 * Default allowed tools for execution
 */
const ALLOWED_TOOLS = [
  'Read',
  'Edit',
  'Write',
  'Glob',
  'Grep',
  'Bash',
  'WebSearch',
  'WebFetch',
  'Skill',
  'Task',
  'LSP',
  'TodoWrite',
];

function addAllowedTools(
  queryOptions: Pick<Options, 'allowedTools'>,
  tools: readonly string[],
) {
  queryOptions.allowedTools = [
    ...new Set([...(queryOptions.allowedTools || ALLOWED_TOOLS), ...tools]),
  ];
}

function addMcpAllowedTools(
  queryOptions: Pick<Options, 'allowedTools'>,
  server: string,
  toolNames: readonly string[],
) {
  addAllowedTools(queryOptions, mcpAllowedToolNames(server, toolNames));
}

function allowedMcpToolsForLog(queryOptions: Pick<Options, 'allowedTools'>) {
  return (queryOptions.allowedTools ?? [])
    .filter((toolName) => toolName.startsWith('mcp__'))
    .sort();
}

function recordMcpSelectionTrace(params: {
  taskId?: string;
  sessionId: string;
  phase: 'run' | 'execute';
  selectedServers: Iterable<string>;
  allowedTools: Iterable<string>;
}) {
  if (!params.taskId) return;
  recordTraceEvent({
    id: `${params.taskId}_${params.sessionId}_mcp_${params.phase}`,
    taskId: params.taskId,
    sessionId: params.sessionId,
    kind: 'hook',
    agent: 'claude',
    provider: 'claude',
    tool: 'mcp-selection',
    status: 'ok',
    attrs: {
      phase: params.phase,
      ...mcpSelectionTraceAttrs(params.selectedServers, params.allowedTools),
    },
  });
}

// ── Permission infrastructure ──────────────────────────────────────────────────

const HARDCODED_DISALLOWED = [
  'CronCreate',
  'CronDelete',
  'CronList',
  'RemoteTrigger',
];

/** Map full model IDs to SDK agent model aliases */
function mapModelToSdkFormat(
  model: string | null,
): 'sonnet' | 'opus' | 'haiku' | 'inherit' {
  if (!model) return 'inherit';
  const lower = model.toLowerCase();
  if (lower.includes('opus')) return 'opus';
  if (lower.includes('haiku')) return 'haiku';
  if (lower.includes('sonnet')) return 'sonnet';
  return 'inherit';
}

interface PendingPermission {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resolve: (result: any) => void;
  toolName: string;
  /** Original tool input, echoed back as `updatedInput` when the user allows. */
  toolInput: unknown;
  sessionId: string;
  createdAt: number;
  registry: ToolPermissionRegistry;
}

/**
 * Per-session store for pending permission requests.
 * When canUseTool decides to ask the user, it stores a Promise resolver here.
 * The /agent/permission endpoint resolves it when the user responds.
 */
const pendingPermissions = new Map<string, PendingPermission>();

/** Max time (ms) a permission request can sit pending before auto-deny */
const PERMISSION_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** Periodically clean up stale pending permissions that outlived their TTL */
setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of pendingPermissions) {
    if (now - entry.createdAt > PERMISSION_TTL_MS) {
      pendingPermissions.delete(id);
      entry.resolve({
        behavior: 'deny' as const,
        message: 'Permission request expired',
      });
      logger.debug(`Permission ${id} expired (TTL ${PERMISSION_TTL_MS}ms)`);
    }
  }
}, 60_000).unref(); // unref so timer doesn't prevent process exit

export function resolvePermission(
  requestId: string,
  approved: boolean,
  alwaysAllow?: boolean,
  sessionId?: string,
): boolean {
  const pending = pendingPermissions.get(requestId);
  if (!pending) return false;
  // Verify session scoping — reject if caller provides a sessionId that doesn't match
  if (sessionId && pending.sessionId !== sessionId) {
    logger.warn(
      `Permission ${requestId} session mismatch: expected ${pending.sessionId}, got ${sessionId}`,
    );
    return false;
  }

  pendingPermissions.delete(requestId);
  if (approved) {
    if (alwaysAllow) {
      pending.registry.addAllowRule(pending.toolName);
    }
    pending.resolve(allowTool(pending.toolInput));
  } else {
    pending.resolve({
      behavior: 'deny' as const,
      message: 'Permission denied by user',
    });
  }

  return true;
}

/**
 * Factory for per-session permission registries — prevents "Always Allow" rules
 * from one task leaking into subsequent tasks.
 *
 * When `autoApprove` is true (dispatch/background mode), pre-seeds the registry
 * with a wildcard allow rule so all tools are auto-approved without user prompts.
 * Sandbox still enforces OS-level safety boundaries regardless.
 */
function createPermissionRegistry(
  autoApprove?: boolean,
): ToolPermissionRegistry {
  if (autoApprove) {
    return new ToolPermissionRegistry({
      alwaysAllow: ['*'],
      alwaysDeny: [],
      alwaysAsk: [],
    });
  }
  return new ToolPermissionRegistry();
}

function applyToolClassifications(
  registry: ToolPermissionRegistry,
  classifications?: AgentOptions['toolClassifications'],
): void {
  if (!classifications) return;
  for (const [toolName, classification] of Object.entries(classifications)) {
    registry.setClassification(toolName, classification);
  }
}

/**
 * Build SDK-native sandbox settings for OS-level filesystem isolation.
 *
 * Uses the Claude Agent SDK's `sandbox.filesystem` config which enforces
 * restrictions via macOS Seatbelt / Linux Bubblewrap — a hard security
 * boundary that cannot be bypassed by prompt injection.
 *
 * The `additionalDirectories` option grants read access to the user's
 * workspace folder so the agent can inspect project files without being
 * able to write outside the session directory (unless explicitly allowed).
 */
function buildSdkSandboxSettings(
  sessionCwd: string,
  userWorkspaceDir?: string,
  allowWorkspaceWrite = false,
  additionalUserDirs?: string[],
): {
  sandbox: NonNullable<Options['sandbox']>;
  additionalDirectories: string[];
} {
  const fsConfig = buildSandboxFilesystemConfig(
    sessionCwd,
    userWorkspaceDir,
    allowWorkspaceWrite,
  );

  const additionalDirectories: string[] = [];
  if (userWorkspaceDir) {
    additionalDirectories.push(userWorkspaceDir);
  }
  // Include extra user-selected directories (multi-folder selection)
  if (additionalUserDirs) {
    for (const dir of additionalUserDirs) {
      if (!additionalDirectories.includes(dir)) {
        additionalDirectories.push(dir);
      }
    }
  }

  return {
    sandbox: {
      enabled: true,
      // Agent SDK ≥0.2.91 defaults failIfUnavailable to true when enabled=true.
      // We opt for graceful degradation — the agent runs unsandboxed with a
      // warning rather than failing hard when sandbox deps are missing.
      failIfUnavailable: false,
      autoAllowBashIfSandboxed: true,
      filesystem: {
        allowWrite: fsConfig.allowWrite,
        denyWrite: fsConfig.denyWrite,
        denyRead: fsConfig.denyRead,
      },
    },
    additionalDirectories,
  };
}

/**
 * Log per-agent context window usage after a query() completes.
 * Non-fatal — the subprocess may have already exited (Agent SDK ≥0.2.94).
 */
async function logContextUsage(
  queryObj: QueryType,
  sessionId: string,
  phase: string,
): Promise<void> {
  try {
    const usage = await queryObj.getContextUsage();
    if (usage) {
      logger.info(`[Claude ${sessionId}] ${phase} context usage:`, usage);
    }
  } catch {
    // Subprocess may have exited before we could query it
  }
}

/**
 * Create sandbox MCP server with inline tools
 * @param sandboxProvider - The sandbox provider to use (e.g., 'codex', 'claude', 'native')
 */
function createSandboxMcpServer(sandboxProvider?: string) {
  return createSdkMcpServer({
    name: 'sandbox',
    version: '1.0.0',
    tools: [
      tool(
        'sandbox_run_script',
        `Run a script file in an isolated sandbox container. Automatically detects the runtime (Python, Node.js, Bun) based on file extension.

IMPORTANT: The sandbox is isolated and CANNOT write files to the host filesystem.
- Scripts should output results to stdout (print/console.log)
- After execution, use the Write tool to save stdout content to files if needed
- Do NOT write files inside the script - it will fail with PermissionError

Example workflow:
1. Write script that prints results to stdout
2. Run script with sandbox_run_script
3. Use Write tool to save the stdout output to a file`,
        {
          filePath: z
            .string()
            .describe('Absolute path to the script file to execute'),
          workDir: z
            .string()
            .describe('Working directory containing the script'),
          args: z
            .array(z.string())
            .optional()
            .describe('Optional command line arguments'),
          packages: z
            .array(z.string())
            .optional()
            .describe(
              'Optional packages to install (pip for Python, npm for Node.js)',
            ),
          timeout: z
            .number()
            .optional()
            .describe('Execution timeout in milliseconds (default: 120000)'),
        },
        async (args) => {
          try {
            const response = await fetch(
              `${SANDBOX_API_URL}/sandbox/run/file`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...args, provider: sandboxProvider }),
              },
            );

            if (!response.ok) {
              return {
                content: [
                  {
                    type: 'text' as const,
                    text: `Sandbox service error: HTTP ${response.status}. The sandbox service may not be running.`,
                  },
                ],
                isError: true,
              };
            }

            const result = (await response.json()) as {
              success: boolean;
              exitCode: number;
              runtime?: string;
              duration?: number;
              stdout?: string;
              stderr?: string;
              error?: string;
            } | null;

            if (!result) {
              return {
                content: [
                  {
                    type: 'text' as const,
                    text: 'Sandbox service returned empty response. The sandbox service may not be available.',
                  },
                ],
                isError: true,
              };
            }

            let output = '';
            if (result.success) {
              output = `Script executed successfully (exit code: ${result.exitCode})\n`;
              output += `Runtime: ${result.runtime || 'unknown'}\n`;
              output += `Duration: ${result.duration || 0}ms\n\n`;
              if (result.stdout) output += `--- stdout ---\n${result.stdout}\n`;
              if (result.stderr) output += `--- stderr ---\n${result.stderr}\n`;
            } else {
              output = `Script execution failed (exit code: ${result.exitCode})\n`;
              if (result.error) output += `Error: ${result.error}\n`;
              if (result.stderr) output += `--- stderr ---\n${result.stderr}\n`;
              if (result.stdout) output += `--- stdout ---\n${result.stdout}\n`;
            }

            return {
              content: [{ type: 'text' as const, text: output }],
              isError: !result.success,
            };
          } catch (error) {
            // Network error or sandbox service not running
            const errorMsg =
              error instanceof Error ? error.message : String(error);
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `Sandbox service unavailable: ${errorMsg}. Please ensure the sandbox service is running or disable sandbox mode.`,
                },
              ],
              isError: true,
            };
          }
        },
        {
          annotations: {
            destructiveHint: false,
            openWorldHint: false,
          },
        },
      ),
      tool(
        'sandbox_run_command',
        `Execute a shell command in an isolated sandbox container.

IMPORTANT: The sandbox is isolated and CANNOT write files to the host filesystem.
- Commands should output results to stdout
- Use Write tool to save any output to files after execution
- File write operations inside sandbox will fail with PermissionError`,
        {
          command: z
            .string()
            .describe("The command to execute (e.g., 'python', 'node', 'pip')"),
          args: z
            .array(z.string())
            .optional()
            .describe('Arguments for the command'),
          workDir: z
            .string()
            .describe('Working directory for command execution'),
          image: z
            .string()
            .optional()
            .describe('Container image (auto-detected if not specified)'),
          timeout: z
            .number()
            .optional()
            .describe('Execution timeout in milliseconds'),
        },
        async (args) => {
          try {
            const response = await fetch(`${SANDBOX_API_URL}/sandbox/exec`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                command: args.command,
                args: args.args,
                cwd: args.workDir,
                image: args.image,
                timeout: args.timeout,
                provider: sandboxProvider,
              }),
            });

            if (!response.ok) {
              return {
                content: [
                  {
                    type: 'text' as const,
                    text: `Sandbox service error: HTTP ${response.status}. The sandbox service may not be running.`,
                  },
                ],
                isError: true,
              };
            }

            const result = (await response.json()) as {
              success: boolean;
              exitCode: number;
              duration?: number;
              stdout?: string;
              stderr?: string;
              error?: string;
            } | null;

            if (!result) {
              return {
                content: [
                  {
                    type: 'text' as const,
                    text: 'Sandbox service returned empty response. The sandbox service may not be available.',
                  },
                ],
                isError: true,
              };
            }

            let output = '';
            if (result.success) {
              output = `Command executed successfully (exit code: ${result.exitCode})\n`;
              output += `Duration: ${result.duration || 0}ms\n\n`;
              if (result.stdout) output += `--- stdout ---\n${result.stdout}\n`;
              if (result.stderr) output += `--- stderr ---\n${result.stderr}\n`;
            } else {
              output = `Command failed (exit code: ${result.exitCode})\n`;
              if (result.error) output += `Error: ${result.error}\n`;
              if (result.stderr) output += `--- stderr ---\n${result.stderr}\n`;
            }

            return {
              content: [{ type: 'text' as const, text: output }],
              isError: !result.success,
            };
          } catch (error) {
            const errorMsg =
              error instanceof Error ? error.message : String(error);
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `Sandbox service unavailable: ${errorMsg}. Please ensure the sandbox service is running or disable sandbox mode.`,
                },
              ],
              isError: true,
            };
          }
        },
        {
          annotations: {
            destructiveHint: false,
            openWorldHint: false,
          },
        },
      ),
    ],
  });
}

/**
 * Claude Agent SDK implementation
 */
/** Once the SDK's cross-process control channel closes, every subsequent
 *  tool_result errors with "Stream closed" and the model retries forever.
 *  Count total (not consecutive — Bash sleeps would reset) and abort. */
const SDK_CONTROL_CHANNEL_ERROR_THRESHOLD = 3;
const SDK_CONTROL_CHANNEL_ERROR_PATTERNS = [
  'Stream closed',
  'Cannot send event after RUN_ERROR',
];

type PTCMcpToolDefinitions = Parameters<typeof adaptMcpTools>[0];

export class ClaudeAgent extends BaseAgent {
  readonly provider: AgentProvider = 'claude';
  private static readonly resumeInstructionBlockHashes = new Map<
    string,
    string
  >();
  private readonly containerManager = new ContainerManager();
  /** Per-session counter of consecutive SDK control-channel error results. */
  private readonly sdkControlErrorCounts = new Map<string, number>();

  constructor(config: AgentConfig) {
    super(config);
    // `default` is the local-CLI runtime picker's "use the CLI's own model"
    // sentinel (meaningful only behind a `<runtime>:` prefix, e.g.
    // `cursor-agent:default`). Claude has no such concept — a stale/legacy
    // persisted modelConfig can still hand it over bare, and forwarded as a
    // literal model name it makes Claude Code reject the run outright
    // ("There's an issue with the selected model (default)."). Normalize it
    // once here so every `this.config.model` read downstream sees "unset".
    if (this.config.model === 'default') this.config.model = undefined;
    logger.info('Created with config:', {
      provider: config.provider,
      hasApiKey: !!config.apiKey,
      baseUrl: config.baseUrl,
      model: config.model,
      workDir: config.workDir,
    });
  }

  /**
   * Build settingSources for Claude SDK
   * Skills are loaded from ~/.claude/skills/ via 'user' source
   *
   * IMPORTANT: When custom API is configured, we should be careful about
   * loading user settings from ~/.claude/settings.json as it may contain
   * model settings that conflict with the custom API (e.g., model: "opus"
   * won't work with third-party APIs like 火山引擎/OpenRouter)
   */

  /**
   * Build a lightweight LLM caller for memory LLM-capture.
   * Uses the agent's configured API key and a fast Haiku model.
   */
  private buildLLMCaller(): (prompt: string) => Promise<string> {
    const envConfig = this.buildEnvConfig();
    return async (p: string) => {
      const apiKey =
        envConfig.ANTHROPIC_AUTH_TOKEN || envConfig.ANTHROPIC_API_KEY;
      if (!apiKey) return '';

      const baseUrl =
        envConfig.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';
      const res = await fetch(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: LLM_CAPTURE_MODEL,
          max_tokens: 500,
          messages: [{ role: 'user', content: p }],
        }),
      });
      if (!res.ok) return '';
      const data = await res.json();
      const textBlock = data.content?.find(
        (b: { type: string }) => b.type === 'text',
      );
      return textBlock?.text ?? '';
    };
  }

  private buildSettingSources(
    skillsConfig?: SkillsConfig,
    profileAllowedSkills?: string[],
  ): ('user' | 'project')[] {
    // If skills are globally disabled, use project only (no user skills)
    if (skillsConfig && !skillsConfig.enabled) {
      logger.info('[ClaudeAgent] Skills disabled, using project only');
      return ['project'];
    }

    // If a profile has an explicit skills list (even non-empty), skip loading
    // all user skills. Only the pinned skills (from pinnedSkills) will be injected
    // into the agent's context, preventing discovery of non-allowed skills.
    if (profileAllowedSkills !== undefined) {
      logger.info(
        `[ClaudeAgent] Profile skills filter active (${profileAllowedSkills.length} allowed), using project only`,
      );
      return ['project'];
    }

    // Always load from user directory (~/.claude/skills/)
    // This is the only supported skills directory
    return ['user', 'project'];
  }

  /** Cached skills list to avoid repeated filesystem I/O within a short window. */
  private skillsCache: {
    skills: LoadedSkill[];
    timestamp: number;
    generation: number;
  } | null = null;
  private static readonly SKILLS_CACHE_TTL_MS = 30_000; // 30 seconds

  /** Load skills with a short-lived cache to avoid repeated filesystem I/O. */
  private async getCachedSkills(): Promise<LoadedSkill[]> {
    if (
      this.skillsCache &&
      this.skillsCache.generation === getPluginLoaderGeneration() &&
      Date.now() - this.skillsCache.timestamp < ClaudeAgent.SKILLS_CACHE_TTL_MS
    ) {
      return this.skillsCache.skills;
    }
    const skills = await loadSkills();
    this.skillsCache = {
      skills,
      timestamp: Date.now(),
      generation: getPluginLoaderGeneration(),
    };
    return skills;
  }

  /**
   * Build instruction text for pinned skills.
   * Loads the full SKILL.md content for each pinned skill and formats
   * it as a prompt prefix so the agent has guaranteed access.
   */
  private async buildPinnedSkillsInstruction(
    pinnedSkills?: string[],
  ): Promise<string> {
    if (!pinnedSkills || pinnedSkills.length === 0) return '';

    const allSkills = await this.getCachedSkills();
    const instructions: string[] = [];

    for (const slug of pinnedSkills) {
      const skill = findSkill(allSkills, slug);
      if (skill) {
        const safeName = skill.name.replace(/"/g, '&quot;');
        const safeContent = skill.content
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
        instructions.push(
          `<pinned-skill name="${safeName}">\n${safeContent}\n</pinned-skill>`,
        );
        logger.info(`Pinned skill loaded: ${skill.name}`);
      } else {
        logger.warn(`Pinned skill not found: ${slug}`);
      }
    }

    if (instructions.length === 0) return '';

    return (
      '\n\n<pinned-skills>\nThe user has pinned the following skills for this message. ' +
      'You MUST use these skills as instructed — they take priority over auto-discovered skills.\n\n' +
      instructions.join('\n\n') +
      '\n</pinned-skills>\n\n'
    );
  }

  /**
   * Check if using custom (non-Anthropic) API
   */
  private isUsingCustomApi(): boolean {
    return !!(this.config.baseUrl && this.config.apiKey);
  }

  /** Cached billing type — resolved once per agent instance, not per message. */
  private _isZeroCostBilling: boolean | null = null;

  private isZeroCostBilling(): boolean {
    if (this._isZeroCostBilling === null) {
      const billing = resolveBillingType(undefined, this.config.model);
      this._isZeroCostBilling =
        billing.billingType === 'subscription' ||
        billing.billingType === 'free';
    }
    return this._isZeroCostBilling;
  }

  /**
   * Resolve effective cost based on billing type.
   * Subscription/free users pay a flat fee — token cost should be $0.
   */
  private effectiveCost(rawCost: number | undefined): number | undefined {
    if (rawCost == null) return undefined;
    return this.isZeroCostBilling() ? 0 : rawCost;
  }

  /**
   * Phase A connector-tier gate. Thin wrapper around the shared
   * `evaluateConnectorGate` so call-sites can stay terse. See
   * `dev-doc/plan/2026-04-28-connector-tier-isolation.md`.
   */
  private gateConnector(
    connector: GlobalConnector,
    channelContext: (ConnectorPolicyInput & { configId?: string }) | undefined,
    locale?: string,
  ): { allow: boolean; denialHint?: string } {
    return evaluateConnectorGate(connector, channelContext, locale);
  }

  /**
   * Register Slack MCP server tools if the user has a valid Slack user token.
   * Mutates mcpServers and allowedTools in place. Returns discovered tool names.
   */
  private async registerSlackMcpTools(
    sessionId: string,
    mcpServers: Record<string, unknown>,
    allowedTools: string[],
    logPrefix = '',
    channelContext?: ConnectorPolicyInput & { locale?: string },
    denialHints?: string[],
  ): Promise<string[]> {
    try {
      const gate = this.gateConnector(
        'slack_user_token',
        channelContext,
        channelContext?.locale,
      );
      if (!gate.allow) {
        if (gate.denialHint && denialHints) denialHints.push(gate.denialHint);
        return [];
      }
      const slackUserToken = await getValidAccessToken('slack', 'user');
      if (slackUserToken) {
        const slackToolNames = await discoverSlackMcpTools(slackUserToken);
        if (slackToolNames.length > 0) {
          mcpServers.slack = getSlackMcpConfig(slackUserToken);
          allowedTools.push('mcp__slack__*');
          logger.info(
            `[Claude ${sessionId}] ${logPrefix}Slack MCP server registered with ${slackToolNames.length} tools`,
          );
          return slackToolNames;
        }
      }
    } catch {
      // Slack auth not available, skip
    }
    return [];
  }

  /**
   * Register Slack workspace search tools when the session originates from a
   * Slack channel. Uses the bot token already available — no additional auth.
   */
  private registerSlackSearchTools(
    sessionId: string,
    mcpServers: Record<string, unknown>,
    allowedTools: string[],
    channelContext?: {
      platform: string;
      botToken?: string;
      actionToken?: string;
    },
    logPrefix = '',
  ): void {
    if (channelContext?.platform !== 'slack' || !channelContext.botToken) {
      if (channelContext?.platform === 'slack') {
        logger.warn(
          `[Claude ${sessionId}] ${logPrefix}Slack search tools skipped: botToken missing`,
        );
      }
      return;
    }
    try {
      mcpServers['slack-search'] = createSlackSearchServer({
        botToken: channelContext.botToken,
        actionToken: channelContext.actionToken,
      });
      allowedTools.push('mcp__slack-search__*');
      logger.info(
        `[Claude ${sessionId}] ${logPrefix}Slack search tools registered (${SLACK_SEARCH_TOOL_NAMES.length} tools)`,
      );
    } catch (err) {
      logger.warn(`${logPrefix}Failed to register Slack search tools:`, err);
    }
  }

  /**
   * Build environment variables for the SDK query
   * Supports custom API endpoint and API key (including OpenRouter)
   * Also includes extended PATH for packaged app compatibility
   *
   * NOTE: SDK expects Record<string, string>, so we filter out undefined values
   */
  private buildEnvConfig(opts?: {
    userCredentials?: Record<string, string>;
    model?: string;
  }): Record<string, string> {
    const env: Record<string, string | undefined> = { ...process.env };
    const model = opts?.model ?? this.config.model;

    // Prevent "nested session" detection when dev server runs inside Claude Code
    delete env.CLAUDECODE;

    // Extend PATH for packaged app to find node and other binaries
    env.PATH = getExtendedPath();

    // When user configures custom API in settings, we need to ensure it takes priority
    // over any config from ~/.claude/settings.json (which is read via settingSources: ['user'])
    // Delete env vars to prevent them from being overridden by ~/.claude/settings.json
    if (this.config.apiKey) {
      // Use ANTHROPIC_AUTH_TOKEN for custom API key
      env.ANTHROPIC_AUTH_TOKEN = this.config.apiKey;
      // Delete ANTHROPIC_API_KEY to ensure AUTH_TOKEN takes priority
      delete env.ANTHROPIC_API_KEY;

      // Handle base URL: set if configured, delete if not (to use default Anthropic API)
      if (this.config.baseUrl) {
        env.ANTHROPIC_BASE_URL = this.config.baseUrl;
        logger.info('[ClaudeAgent] Using custom API from settings:', {
          baseUrl: this.config.baseUrl,
        });
      } else {
        // Delete to ensure default Anthropic API is used, not from ~/.claude/settings.json
        delete env.ANTHROPIC_BASE_URL;
        logger.info(
          '[ClaudeAgent] Using custom API key with default Anthropic base URL',
        );
      }
    } else {
      normalizeInheritedAnthropicEnvForClaudeLogin(env);
      logger.info(
        '[ClaudeAgent] Using API config from environment:',
        env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY
          ? 'key present'
          : 'key missing',
      );
    }

    // Set model configuration
    if (model) {
      env.ANTHROPIC_MODEL = model;
      // Also set default models for different tiers (useful for OpenRouter model names)
      env.ANTHROPIC_DEFAULT_SONNET_MODEL = model;
      env.ANTHROPIC_DEFAULT_HAIKU_MODEL = model;
      env.ANTHROPIC_DEFAULT_OPUS_MODEL = model;
      logger.info('[ClaudeAgent] Model configured:', model);
    } else if (this.config.apiKey) {
      // When using custom API but no model specified, clear any model from ~/.claude/settings.json
      // to let the third-party API use its default model
      delete env.ANTHROPIC_MODEL;
      delete env.ANTHROPIC_DEFAULT_SONNET_MODEL;
      delete env.ANTHROPIC_DEFAULT_HAIKU_MODEL;
      delete env.ANTHROPIC_DEFAULT_OPUS_MODEL;
      logger.info(
        '[ClaudeAgent] Custom API without model: cleared local model settings',
      );
    } else {
      logger.info(
        '[ClaudeAgent] Model to use:',
        env.ANTHROPIC_MODEL || 'default from SDK',
      );
    }

    // When using custom API, disable telemetry and non-essential traffic
    // This helps avoid potential issues with third-party API compatibility
    if (this.isUsingCustomApi()) {
      env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1';
      // Force the SDK to not use any cached/stored API configuration
      env.CLAUDE_CODE_SKIP_CONFIG = '1';
      // Set longer timeout for third-party APIs (10 minutes)
      env.API_TIMEOUT_MS = '600000';
      // Disable model validation for third-party APIs
      env.CLAUDE_CODE_SKIP_MODEL_VALIDATION = '1';
      logger.info(
        '[ClaudeAgent] Custom API mode: disabled non-essential traffic, set timeout to 600s',
      );
    }

    // Inject connector credentials so the agent can access external services
    try {
      const linearConfig = getLinearConfig();
      if (linearConfig.apiKey) {
        env.LINEAR_API_KEY = linearConfig.apiKey;
      }
      if (linearConfig.githubToken) {
        env.GITHUB_TOKEN = linearConfig.githubToken;
      }
    } catch {
      // Config not loaded yet, skip
    }

    // Per-user credentials override globals — the user picked this auth.
    if (opts?.userCredentials) {
      const applied: string[] = [];
      for (const [key, value] of Object.entries(opts.userCredentials)) {
        if (!key || !value) continue;
        env[key] = value;
        // Per-key fan-out for tools with synonym env vars.
        if (key === 'ANTHROPIC_API_KEY') {
          // Make the SDK use the user's API key, not the admin's auth token.
          delete env.ANTHROPIC_AUTH_TOKEN;
        } else if (key === 'GITHUB_TOKEN') {
          // gh CLI prefers GH_TOKEN over GITHUB_TOKEN. If GH_TOKEN was
          // inherited from the parent shell, gh would silently ignore our
          // injected GITHUB_TOKEN. Pin both to the user's PAT so neither
          // a stale env var nor the macOS keyring is consulted.
          env.GH_TOKEN = value;
        }
        // Length-only — never logs the secret. Classic GitHub PAT = 40,
        // fine-grained ~93, Linear `lin_api_*` ~48.
        applied.push(`${key}(${value.length}B)`);
      }
      if (applied.length > 0) {
        logger.info(
          `[ClaudeAgent] Per-user credentials applied: ${applied.join(', ')}`,
        );
      }
    }

    // Length-only summary for a connector env value — never logs the
    // secret, but lets users verify byte-exact storage at a glance.
    const lenSummary = (v: string | undefined): string =>
      v === undefined ? '(unset)' : v ? `set(${v.length}B)` : 'empty';

    logger.info('[ClaudeAgent] Final env config:', {
      ANTHROPIC_API_KEY:
        env.ANTHROPIC_API_KEY === undefined
          ? '(deleted)'
          : env.ANTHROPIC_API_KEY
            ? `${env.ANTHROPIC_API_KEY.slice(0, 10)}...`
            : 'not set',
      ANTHROPIC_AUTH_TOKEN: env.ANTHROPIC_AUTH_TOKEN
        ? `${env.ANTHROPIC_AUTH_TOKEN.slice(0, 10)}...`
        : 'not set',
      ANTHROPIC_BASE_URL:
        env.ANTHROPIC_BASE_URL === undefined
          ? '(deleted - use default)'
          : env.ANTHROPIC_BASE_URL || 'not set',
      ANTHROPIC_MODEL: env.ANTHROPIC_MODEL || 'not set',
      // Connector keys forwarded to the SDK child process (gh, curl, etc.).
      GITHUB_TOKEN: lenSummary(env.GITHUB_TOKEN),
      GH_TOKEN: lenSummary(env.GH_TOKEN),
      LINEAR_API_KEY: lenSummary(env.LINEAR_API_KEY),
      OPENAI_API_KEY: lenSummary(env.OPENAI_API_KEY),
      NOTION_TOKEN: lenSummary(env.NOTION_TOKEN),
      JIRA_API_TOKEN: lenSummary(env.JIRA_API_TOKEN),
      // Network env that can intercept gh/curl HTTPS traffic without
      // touching the auth header — useful when gh works in a plain
      // shell but fails in the spawned child.
      HTTP_PROXY: env.HTTP_PROXY ?? '(unset)',
      HTTPS_PROXY: env.HTTPS_PROXY ?? '(unset)',
      NO_PROXY: env.NO_PROXY ?? '(unset)',
      GH_HOST: env.GH_HOST ?? '(unset)',
      GH_API_URL: env.GH_API_URL ?? '(unset)',
    });

    // Enable SDK tool search for non-PTC mode — defer tool schemas when
    // tools exceed 10% of context. PTC mode already handles deferral via ptc.ts.
    env.ENABLE_TOOL_SEARCH = 'auto:10';

    // Filter out undefined values - SDK expects Record<string, string>
    const filteredEnv: Record<string, string> = {};
    for (const [key, value] of Object.entries(env)) {
      if (value !== undefined) {
        filteredEnv[key] = value;
      }
    }
    return filteredEnv;
  }

  /**
   * Estimate token count for a text string (rough approximation)
   * This is a simple estimation: 1 token ≈ 4 characters for English text
   */
  private estimateTokenCount(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Format conversation history for inclusion in prompt with token length limits
   */
  private formatConversationHistory(
    conversation?: ConversationMessage[],
  ): string {
    if (!conversation || conversation.length === 0) {
      return '';
    }

    // Get token limits from agent config, fallback to defaults
    const maxHistoryTokens =
      (this.config.providerConfig?.maxHistoryTokens as number) || 2000;
    const minMessagesToKeep = 3; // Always keep at least 3 most recent messages

    // Format all messages first
    const allFormattedMessages = conversation.map((msg) => {
      const role = msg.role === 'user' ? 'User' : 'Assistant';
      let messageContent = `${role}: ${msg.content}`;

      // Include image/media references if present
      if (msg.imagePaths && msg.imagePaths.length > 0) {
        const imageRefs = msg.imagePaths
          .map((p, i) => `  - File ${i + 1}: ${p}`)
          .join('\n');
        messageContent += `\n[Generated/attached media files:\n${imageRefs}\nIMPORTANT: If the user wants to modify or iterate on these files, pass the file path as reference_image_url to media_generate_image or media_generate_video for visual consistency.]`;
      }

      return messageContent;
    });

    // Calculate tokens for each message
    const messageTokens = allFormattedMessages.map((msg) => ({
      content: msg,
      tokens: this.estimateTokenCount(msg),
    }));

    // Start with the most recent messages and work backwards
    let totalTokens = 0;
    const selectedMessages: string[] = [];

    // Always keep at least minMessagesToKeep messages
    const startIndex = Math.max(0, messageTokens.length - minMessagesToKeep);

    for (let i = messageTokens.length - 1; i >= startIndex; i--) {
      const message = messageTokens[i]!;
      if (totalTokens + message.tokens <= maxHistoryTokens) {
        selectedMessages.unshift(message.content);
        totalTokens += message.tokens;
      } else {
        break;
      }
    }

    // If we have room for more messages, try to add older ones
    for (let i = startIndex - 1; i >= 0; i--) {
      const message = messageTokens[i]!;
      if (totalTokens + message.tokens <= maxHistoryTokens) {
        selectedMessages.unshift(message.content);
        totalTokens += message.tokens;
      } else {
        break;
      }
    }

    if (selectedMessages.length === 0) {
      return '';
    }

    const formattedMessages = selectedMessages.join('\n\n');
    const truncationNotice =
      conversation.length > selectedMessages.length
        ? `\n\n[Note: Conversation history truncated. Showing ${selectedMessages.length} of ${conversation.length} messages to stay within token limits.]`
        : '';

    logger.info(
      `[formatConversationHistory] Selected ${selectedMessages.length} of ${conversation.length} messages, estimated ${totalTokens} tokens (limit: ${maxHistoryTokens})`,
    );

    return `## Previous Conversation Context
The following is the conversation history. Use this context to understand and respond to the current message appropriately.
When the user refers to previously generated images or videos (e.g. "make it green", "keep everything the same but...", "change it to..."), find the relevant file path from the history below and pass it as reference_image_url to maintain visual consistency.

${formattedMessages}${truncationNotice}\n\n---\n## Current Request\n`;
  }

  /**
   * Direct execution mode (without planning)
   */
  async *run(
    prompt: string,
    options?: AgentOptions,
  ): AsyncGenerator<AgentMessage> {
    const session = this.createSession('executing');
    const sentTextHashes = new LimitedSet<string>(1000); // Max 1000 text hashes
    const sentToolIds = new LimitedSet<string>(500); // Max 500 tool IDs
    const toolNames = new Map<string, string>(); // tool ID → tool name for result limiter

    // Guaranteed cleanup even if consumer stops early
    const cleanup = () => {
      sentTextHashes.clear();
      sentToolIds.clear();
      toolNames.clear();
      this.sessions.delete(session.id);
    };

    // Wrap generator with guaranteed cleanup
    yield* safeAsyncGenerator(
      this.runGenerator(
        prompt,
        options,
        session,
        sentTextHashes,
        sentToolIds,
        toolNames,
      ),
      cleanup,
    );
  }

  /**
   * Internal generator for run() - wrapped by safeAsyncGenerator for guaranteed cleanup
   */
  private async *runGenerator(
    prompt: string,
    options: AgentOptions | undefined,
    session: ReturnType<typeof this.createSession>,
    sentTextHashes: LimitedSet<string>,
    sentToolIds: LimitedSet<string>,
    toolNames: Map<string, string>,
  ): AsyncGenerator<AgentMessage> {
    let sessionCwd = getSessionWorkDir(
      options?.cwd || this.config.workDir,
      prompt,
      options?.taskId,
    );

    // Emit session message with the actual working directory so the API can
    // update the task's work_dir in the database (the frontend reads work_dir
    // to display workspace files / preview).
    yield { type: 'session', sessionId: session.id, cwd: sessionCwd };

    // Ensure the working directory exists before calling SDK
    await ensureDir(sessionCwd);

    // ── Worktree isolation ──
    let worktreePath: string | undefined;
    if (options?.isolation === 'worktree') {
      try {
        const branchName = `agent-${session.id.slice(0, 8)}`;
        const wt = await createWorktree(sessionCwd, branchName);
        worktreePath = wt.worktreePath;
        sessionCwd = wt.worktreePath;
        logger.info(
          `[Claude ${session.id}] Worktree isolation active: ${worktreePath}`,
        );
      } catch (wtErr) {
        logger.warn(
          `[Claude ${session.id}] Worktree creation failed, using shared cwd:`,
          wtErr,
        );
      }
    }

    logger.info(`[Claude ${session.id}] Working directory: ${sessionCwd}`);
    logger.info(`[Claude ${session.id}] Direct execution started`);
    if (options?.conversation && options.conversation.length > 0) {
      logger.info(
        `[Claude ${session.id}] Conversation history: ${options.conversation.length} messages`,
      );
    }
    // Log sandbox config for debugging
    logger.info(`[Claude ${session.id}] Sandbox config received:`, {
      hasOptions: !!options,
      hasSandbox: !!options?.sandbox,
      sandboxEnabled: options?.sandbox?.enabled,
      sandboxProvider: options?.sandbox?.provider,
    });
    if (options?.sandbox?.enabled) {
      logger.info(
        `[Claude ${session.id}] Sandbox mode enabled with provider: ${options.sandbox.provider}`,
      );
    } else {
      logger.warn(
        `[Claude ${session.id}] Sandbox mode NOT enabled - scripts will run locally`,
      );
    }

    // Build sandbox options for workspace instruction
    const sandboxOpts: SandboxOptions | undefined = options?.sandbox?.enabled
      ? {
          enabled: true,
          image: options.sandbox.image,
          apiEndpoint: options.sandbox.apiEndpoint || SANDBOX_API_URL,
        }
      : undefined;

    // Handle image attachments - save to disk and reference in prompt
    let imageInstruction = '';
    if (options?.images && options.images.length > 0) {
      logger.debug(
        `[${session.id}] Processing ${options.images.length} image(s)`,
      );
      options.images.forEach((img, i) => {
        logger.debug(
          `[${session.id}] Image ${i}: mimeType=${img.mimeType}, dataLength=${img.data?.length || 0}`,
        );
      });
      const imagePaths = await saveImagesToDisk(options.images, sessionCwd);
      logger.debug(
        `[${session.id}] Saved ${imagePaths.length} images to disk: ${imagePaths.join(', ')}`,
      );
      if (imagePaths.length > 0) {
        imageInstruction = `
## 🖼️ MANDATORY IMAGE ANALYSIS - DO THIS FIRST

**STOP! Before doing anything else, you MUST read the attached image(s).**

The user has attached ${imagePaths.length} image file(s):
${imagePaths.map((p, i) => `${i + 1}. ${p}`).join('\n')}

**YOUR FIRST ACTION MUST BE:**
Use the Read tool to view each image file listed above. The Read tool supports image files (PNG, JPG, etc.) and will show you the visual content.

Example:
\`\`\`
Read tool: file_path="${imagePaths[0]}"
\`\`\`

**CRITICAL RULES:**
- DO NOT respond to the user's question until you have READ and SEEN the actual image content
- DO NOT guess or assume what the image contains
- After reading the image, describe what you actually see in the image
- Base your response ONLY on the actual visual content you observe

---
User's request (answer this AFTER reading the images):
`;
      }
    }

    // Format conversation history to include context from previous messages
    const conversationContext = this.formatConversationHistory(
      options?.conversation,
    );

    // Load pinned skills content and inject into prompt.
    // Skip entirely when profile has an explicit (empty) skills filter — no skills to pin.
    const profileSkillFilter = options?.resolvedContext?.profileAllowedSkills;
    const pinnedSkillsInstruction =
      profileSkillFilter !== undefined && profileSkillFilter.length === 0
        ? ''
        : await this.buildPinnedSkillsInstruction(options?.pinnedSkills);

    // Add workspace instruction to prompt so skills know where to save files
    // If images are attached, put image instruction FIRST (highest priority)
    const userWsDir = options?.userWorkspaceDir;
    const allowWsWrite = options?.allowWorkspaceWrite;
    const systemContext = this.getSystemContext(options);
    const resolvedBaseContext =
      options?.contextMode === 'minimal'
        ? options?.resolvedContext?.minimal
        : options?.resolvedContext?.full;
    // Only split when it is equivalent to the already-hooked systemContext.
    // Minimal mode has no dedicated static/dynamic split, so keep its old path.
    const canUseResolvedContextSplit =
      !!options?.resolvedContext &&
      options?.contextMode !== 'minimal' &&
      systemContext === (resolvedBaseContext ?? '');
    const workspaceInstruction = getWorkspaceInstruction(
      sessionCwd,
      sandboxOpts,
      userWsDir,
      allowWsWrite,
    );
    const staticSystemContext = canUseResolvedContextSplit
      ? (options.resolvedContext?.staticContext ?? '')
      : systemContext;
    const dynamicSystemContext = canUseResolvedContextSplit
      ? (options.resolvedContext?.dynamicContext ?? '')
      : '';
    const prefixInstructionBlock = joinClaudePromptBlocks(
      workspaceInstruction,
      staticSystemContext,
      pinnedSkillsInstruction,
    );
    const perTurnInstructionBlock = joinClaudePromptBlocks(
      dynamicSystemContext,
      conversationContext,
    );

    // Ensure Claude Code is installed
    const claudeCodePath = await ensureClaudeCode();
    if (!claudeCodePath) {
      yield {
        type: 'error',
        message: '__CLAUDE_CODE_NOT_FOUND__',
      };
      yield { type: 'done' };
      return;
    }
    const effectiveModel = resolveSupportedClaudeModel(
      claudeCodePath,
      this.config.model,
    );

    // Load user-configured MCP servers based on mcpConfig settings.
    // `disableUserMcp` skips them entirely — used by latency-sensitive,
    // self-contained runs (e.g. Design Mode builds) so a slow/hanging external
    // server can't stall or block the spawned CLI's MCP `initialize` handshake.
    const userMcpServers = options?.disableUserMcp
      ? {}
      : await loadMcpServers(options?.mcpConfig as McpConfig | undefined);
    if (options?.disableUserMcp) {
      logger.info(
        `[Claude ${session.id}] User MCP servers disabled for this run (disableUserMcp)`,
      );
    }

    // Build query options
    // Use settingSources based on skillsConfig to control skill loading
    // - 'user' source loads from ~/.claude directory (User skills)
    // - 'project' source loads from project/.claude directory
    // User's custom API settings from app settings page are passed via env config
    // which takes priority over ~/.claude/settings.json because we set ANTHROPIC_API_KEY directly
    const settingSources: ('user' | 'project')[] = this.buildSettingSources(
      options?.skillsConfig,
      options?.resolvedContext?.profileAllowedSkills,
    );
    logger.info(`[Claude ${session.id}] Skills config:`, options?.skillsConfig);
    logger.info(
      `[Claude ${session.id}] Setting sources: ${settingSources.join(', ')}`,
    );

    // Only include settingSources if the CLI supports --setting-sources flag
    const useSettingSources = supportsSettingSources(claudeCodePath);
    if (!useSettingSources) {
      logger.warn(
        `[Claude ${session.id}] Claude Code CLI does not support --setting-sources, skipping`,
      );
    }

    // Build OS-level sandbox settings for filesystem isolation
    const sdkSandbox = buildSdkSandboxSettings(
      sessionCwd,
      userWsDir,
      allowWsWrite,
      options?.additionalUserDirs,
    );

    const denialTracker = new DenialTracker();
    const loopGuard = new LoopGuard();
    const permissionRegistry = createPermissionRegistry(options?.autoApprove);
    applyToolClassifications(permissionRegistry, options?.toolClassifications);

    const queryOptions: Options = {
      cwd: sessionCwd,
      tools: { type: 'preset', preset: 'claude_code' },
      allowedTools: options?.allowedTools || ALLOWED_TOOLS,
      // Block harness-level cron tools — our schedule_* MCP tools replace them
      disallowedTools: [
        ...HARDCODED_DISALLOWED,
        ...(options?.disallowedTools ?? []),
      ],
      ...(useSettingSources ? { settingSources } : {}),
      permissionMode: 'default',
      canUseTool: buildCanUseTool(
        denialTracker,
        permissionRegistry,
        pendingPermissions,
        options?.taskId,
        session.id,
        loopGuard,
      ),
      sandbox: sdkSandbox.sandbox,
      additionalDirectories: [
        ...sdkSandbox.additionalDirectories,
        // When using worktree isolation, also grant access to the worktree path
        ...(worktreePath ? [worktreePath] : []),
      ],
      abortController: options?.abortController || session.abortController,
      env: this.buildEnvConfig({
        userCredentials: options?.userCredentials,
        model: effectiveModel,
      }),
      model: effectiveModel,
      ...(effectiveModel
        ? {
            systemPrompt: {
              type: 'preset' as const,
              preset: 'claude_code' as const,
              append: buildSystemPromptAppend(
                effectiveModel,
                options?.skillsConfig?.enabled !== false,
              ),
            },
          }
        : {}),
      pathToClaudeCodeExecutable: claudeCodePath,
      maxTurns: options?.maxTurns ?? 200,
      enableFileCheckpointing: true,
      // Provides user message UUIDs in stream (required for rewindFiles targeting)
      extraArgs: { 'replay-user-messages': null },
      // SDK session persistence — pass session ID for resume capability
      ...(options?.sessionId ? { sessionId: options.sessionId } : {}),
      // Resume a previous SDK session
      ...(options?.resumeSessionId ? { resume: options.resumeSessionId } : {}),
      // Thinking config passthrough — SDK Options.thinking + Options.effort.
      // Sonnet 5 no longer accepts fixed thinking budgets; normalize enabled
      // profiles to adaptive before they reach Claude Code.
      ...normalizeClaudeThinkingForSdk(effectiveModel, options?.thinkingConfig),
      // Structured output format passthrough
      ...(options?.outputFormat ? { outputFormat: options.outputFormat } : {}),
      // Capture stderr for debugging
      stderr: (data: string) => {
        logger.error(`[Claude ${session.id}] STDERR: ${data}`);
      },
    };

    logger.info(`[Claude ${session.id}] Sandbox filesystem config:`, {
      allowWrite: sdkSandbox.sandbox.filesystem?.allowWrite,
      denyWrite: sdkSandbox.sandbox.filesystem?.denyWrite?.length,
      denyRead: sdkSandbox.sandbox.filesystem?.denyRead?.length,
      additionalDirectories: sdkSandbox.additionalDirectories,
    });

    // Initialize MCP servers with user-configured servers.
    // When the user explicitly @mentions specific servers (e.g. "@Figma"),
    // only those servers are loaded — reducing context bloat and giving
    // deterministic tool routing.  Without @mentions all user servers load.
    //
    // Resolution order:
    //   1. Explicit list from frontend (options.mentionedMcpServers)
    //   2. Auto-extracted from the prompt text (@word matching server names)
    //   3. Fallback: load all user servers
    let mentioned = options?.mentionedMcpServers;
    if (
      (!mentioned || mentioned.length === 0) &&
      Object.keys(userMcpServers).length > 0
    ) {
      // Auto-extract @mentions from the prompt (case-insensitive)
      const mentionRegex = /@([\w-]+)/g;
      const serverNames = Object.keys(userMcpServers);
      const autoDetected: string[] = [];
      let match;
      while ((match = mentionRegex.exec(prompt)) !== null) {
        const found = serverNames.find(
          (name) => name.toLowerCase() === match![1].toLowerCase(),
        );
        if (found && !autoDetected.includes(found)) {
          autoDetected.push(found);
        }
      }
      if (autoDetected.length > 0) {
        mentioned = autoDetected;
        logger.info(
          `[Claude ${session.id}] Auto-detected @mentions from prompt: ${autoDetected.join(', ')}`,
        );
      }
    }

    const filteredUserMcp: Record<string, McpServerConfig> = {};
    for (const [name, cfg] of Object.entries(userMcpServers)) {
      if (!mentioned || mentioned.length === 0 || mentioned.includes(name)) {
        filteredUserMcp[name] = cfg;
      }
    }
    if (mentioned && mentioned.length > 0) {
      logger.info(
        `[Claude ${session.id}] @mention filter: requested=[${mentioned.join(', ')}], loaded=[${Object.keys(filteredUserMcp).join(', ')}]`,
      );
    }

    const mcpServers: Record<
      string,
      McpServerConfig | ReturnType<typeof createSandboxMcpServer>
    > = {
      ...filteredUserMcp,
    };

    const inProcessToolPatterns = registerInProcessMcpServers(
      mcpServers,
      options?.inProcessMcpServers,
    );
    if (inProcessToolPatterns.length > 0) {
      queryOptions.allowedTools = [
        ...(queryOptions.allowedTools || ALLOWED_TOOLS),
        ...inProcessToolPatterns,
      ];
      logger.info(
        `[Claude ${session.id}] In-process MCP servers registered: ${Object.keys(options?.inProcessMcpServers ?? {}).join(', ')}`,
      );
    }

    // Per-user (Slack App Home) MCP overlay — shadows globals by name.
    const overlay = options?.userMcpOverlay as
      | Record<string, McpServerConfig>
      | undefined;
    if (overlay && Object.keys(overlay).length > 0) {
      const overlayPatterns: string[] = [];
      for (const [name, cfg] of Object.entries(overlay)) {
        mcpServers[name] = cfg;
        overlayPatterns.push(`mcp__${name}__*`);
      }
      queryOptions.allowedTools = [
        ...(queryOptions.allowedTools || ALLOWED_TOOLS),
        ...overlayPatterns,
      ];
      logger.info(
        `[Claude ${session.id}] User MCP overlay registered: ${Object.keys(overlay).join(', ')}`,
      );
    }

    // Register wildcard tool patterns for every loaded user MCP server so
    // the agent is actually allowed to invoke their tools.  Built-in servers
    // register their tools explicitly below; user servers use `mcp__<name>__*`.
    if (Object.keys(filteredUserMcp).length > 0) {
      const userToolPatterns = Object.keys(filteredUserMcp).map(
        (name) => `mcp__${name}__*`,
      );
      queryOptions.allowedTools = [
        ...(queryOptions.allowedTools || ALLOWED_TOOLS),
        ...userToolPatterns,
      ];
      logger.info(
        `[Claude ${session.id}] User MCP tool patterns registered: ${userToolPatterns.join(', ')}`,
      );
    }

    // Add sandbox MCP server if sandbox is enabled
    if (options?.sandbox?.enabled) {
      mcpServers.sandbox = createSandboxMcpServer(options.sandbox.provider);
      // Add sandbox tools to allowed tools (wildcard pattern for MCP tool naming)
      addAllowedTools(queryOptions, ['mcp__sandbox__*']);
    }

    const relevantServers = selectMcpServers({
      steps: [{ description: prompt }],
    });
    logger.info(
      `[Claude ${session.id}] MCP bundle selection: ${JSON.stringify(summarizeMcpSelection(relevantServers))}`,
    );

    const denialHints: string[] = [];
    if (options?.disablePolicyServers) {
      logger.info(
        `[Claude ${session.id}] Built-in MCP policy servers disabled for this run`,
      );
    } else {
      // Add Linear MCP server when EITHER:
      //   • Linear is globally enabled with an admin-configured API key, OR
      //   • the user supplied a Linear PAT for this run (via Slack App Home).
      // The user PAT path makes the bot useful for individual users without
      // an admin having to flip the global toggle.
      try {
        const linearConfig = getLinearConfig();
        const userLinearKey = options?.userCredentials?.LINEAR_API_KEY;
        const enableLinear =
          (linearConfig.linearEnabled && !!linearConfig.apiKey) ||
          !!userLinearKey;
        if (enableLinear && relevantServers.has('linear')) {
          mcpServers.linear = createLinearMcpServer();
          addMcpAllowedTools(queryOptions, 'linear', LINEAR_TOOL_NAMES);
          logger.info(
            `[Claude ${session.id}] Linear MCP server registered with ${LINEAR_TOOL_NAMES.length} tools (${userLinearKey ? 'user PAT' : 'global config'})`,
          );
        } else if (enableLinear) {
          logger.debug(
            `[Claude ${session.id}] Linear MCP server skipped (not selected by bundle plan)`,
          );
        } else {
          logger.info(
            `[Claude ${session.id}] Linear MCP server skipped (no user PAT and globally disabled)`,
          );
        }
      } catch {
        // Linear config not loaded yet, skip
      }

      // GitHub MCP — register the official hosted remote server with the
      // user's PAT in the auth header. Avoids the gh CLI / env / keyring /
      // permission issues entirely, and saves us from maintaining an
      // in-process tool list — github/github-mcp-server owns the schema.
      {
        const githubToken =
          options?.userCredentials?.GITHUB_TOKEN ?? process.env.GITHUB_TOKEN;
        if (githubToken && relevantServers.has('github')) {
          mcpServers.github = getGithubMcpConfig(githubToken);
          addAllowedTools(queryOptions, ['mcp__github__*']);
          logger.info(
            `[Claude ${session.id}] GitHub MCP server registered (${
              options?.userCredentials?.GITHUB_TOKEN ? 'user PAT' : 'env'
            })`,
          );
        } else if (githubToken) {
          logger.debug(
            `[Claude ${session.id}] GitHub MCP server skipped (not selected by bundle plan)`,
          );
        } else {
          logger.info(
            `[Claude ${session.id}] GitHub MCP server skipped (no token in run context)`,
          );
        }
      }

      // Add built-in Figma MCP server if enabled in settings AND the user hasn't
      // already configured a Figma server in mcp.json (user config takes priority).
      const userHasFigma = Object.keys(userMcpServers).some(
        (name) => name.toLowerCase() === 'figma',
      );
      if (!userHasFigma) {
        try {
          const figmaConfig = getLinearConfig();
          if (figmaConfig.figmaEnabled && relevantServers.has('figma')) {
            mcpServers.figma = createFigmaMcpConfig();
            addAllowedTools(queryOptions, [FIGMA_TOOL_PATTERN]);
            logger.info(`[Claude ${session.id}] Figma MCP server registered`);
          } else if (figmaConfig.figmaEnabled) {
            logger.debug(
              `[Claude ${session.id}] Figma MCP server skipped (not selected by bundle plan)`,
            );
          }
        } catch {
          // Config not loaded yet, skip
        }
      } else {
        logger.info(
          `[Claude ${session.id}] Skipping built-in Figma MCP — user-configured Figma server found`,
        );
      }

      // Register MCP servers only when their service is configured.
      // Each tool definition consumes context window tokens (~1K per tool),
      // so we avoid registering tools the agent cannot actually use.

      // Profile-level skill filtering: when a profile restricts skills to an empty
      // list, skip all built-in MCP servers to save context window tokens.
      const profileSkills = options?.resolvedContext?.profileAllowedSkills;
      const builtinAllowed = areBuiltinServersAllowed(profileSkills);

      if (!builtinAllowed) {
        logger.info(
          `[Claude ${session.id}] Profile has empty skill list — skipping all built-in MCP servers`,
        );
      }

      // Media Generation — only if image/video providers are configured AND profile allows
      if (builtinAllowed && relevantServers.has('media')) {
        const mediaCaps = listCapabilities();
        if (
          mediaCaps.imageProviders.length > 0 ||
          mediaCaps.videoProviders.length > 0
        ) {
          mcpServers['media-generation'] = createMediaMcpServer();
          addMcpAllowedTools(
            queryOptions,
            'media-generation',
            MEDIA_TOOL_NAMES,
          );
          logger.info(
            `[Claude ${session.id}] Media Generation MCP server registered with ${MEDIA_TOOL_NAMES.length} tools`,
          );
        }
      }

      // Asset Catalog — local workspace asset search/ingest tools, gated for rollout
      if (
        builtinAllowed &&
        relevantServers.has('assets') &&
        isAssetsCatalogEnabled()
      ) {
        mcpServers.assets = createAssetsMcpServer();
        addMcpAllowedTools(queryOptions, 'assets', ASSETS_TOOL_NAMES);
        logger.info(
          `[Claude ${session.id}] Asset Catalog MCP server registered with ${ASSETS_TOOL_NAMES.length} tools`,
        );
      }

      // Speech — only if TTS or STT providers are configured AND profile allows
      if (builtinAllowed && relevantServers.has('speech')) {
        const speechCaps = listSpeechCapabilities();
        if (
          speechCaps.ttsProviders.length > 0 ||
          speechCaps.sttProviders.length > 0
        ) {
          mcpServers.speech = createSpeechMcpServer();
          addMcpAllowedTools(queryOptions, 'speech', SPEECH_TOOL_NAMES);
          logger.info(
            `[Claude ${session.id}] Speech MCP server registered with ${SPEECH_TOOL_NAMES.length} tools`,
          );
        }
      }

      // Search — only when fully configured (credentials valid) AND mode requires it.
      // 'auto' = non-Claude only (Claude has built-in WebSearch), skip here.
      // 'always' = override built-in WebSearch with custom providers.
      // 'manual' = register tools but don't remove built-in WebSearch.
      {
        const searchCfg = getSearchConfig();
        if (
          relevantServers.has('search') &&
          isSearchEnabled() &&
          searchCfg.mode !== 'auto'
        ) {
          if (searchCfg.mode === 'always') {
            queryOptions.allowedTools = (
              queryOptions.allowedTools || ALLOWED_TOOLS
            ).filter((t: string) => t !== 'WebSearch' && t !== 'WebFetch');
          }
          mcpServers.search = createSearchMcpServer();
          addMcpAllowedTools(queryOptions, 'search', SEARCH_TOOL_NAMES);
          logger.info(
            `[Claude ${session.id}] Search MCP server registered (mode: ${searchCfg.mode})`,
          );
        }
      }

      // Cloud storage — first-party MCP servers for Box / Dropbox /
      // OneDrive. Mount each only when the user has actually completed
      // native OAuth (token-manager has an active connection). Mirrors the
      // Google Drive pattern so the agent gets a curated, first-party
      // tool surface rather than going through Composio's masked token.
      const boxToken = relevantServers.has('box')
        ? await getValidAccessToken('box')
        : null;
      if (boxToken) {
        mcpServers.box = createBoxMcpServer();
        addMcpAllowedTools(queryOptions, 'box', BOX_TOOL_NAMES);
        logger.info(`[Claude ${session.id}] Box first-party MCP registered`);
      }
      const dropboxToken = relevantServers.has('dropbox')
        ? await getValidAccessToken('dropbox')
        : null;
      if (dropboxToken) {
        mcpServers.dropbox = createDropboxMcpServer();
        addMcpAllowedTools(queryOptions, 'dropbox', DROPBOX_TOOL_NAMES);
        logger.info(
          `[Claude ${session.id}] Dropbox first-party MCP registered`,
        );
      }
      const onedriveToken = relevantServers.has('onedrive')
        ? await getValidAccessToken('onedrive')
        : null;
      if (onedriveToken) {
        mcpServers.onedrive = createOneDriveMcpServer();
        addMcpAllowedTools(queryOptions, 'onedrive', ONEDRIVE_TOOL_NAMES);
        logger.info(
          `[Claude ${session.id}] OneDrive first-party MCP registered`,
        );
      }

      // Connectors — exposes Composio-authorized tools to the agent via two
      // meta-tools (connectors_list + connectors_execute). Registered whenever
      // the connector platform is enabled; the meta-tools internally short
      // circuit when no toolkit is connected, so registering is cheap.
      if (relevantServers.has('connectors') && isConnectorPlatformV2Enabled()) {
        mcpServers.connectors = createConnectorsMcpServer({
          buildContext: () => ({
            runId: session.id,
            surface: 'desktop',
            platform: 'desktop',
            accountId: 'desktop',
            identityId: 'desktop',
            // Desktop runs as the local user — there is no other identity to
            // gate against, so connector tools execute at admin tier. This is
            // an intentional trust boundary, not an oversight: any per-tool
            // approval/destructive-action gating must happen inside the
            // binder (see provider.ts `approval` flag) or the UI, not here.
            permissionTier: 'admin',
            providerUserId: 'desktop',
          }),
        });
        addMcpAllowedTools(queryOptions, 'connectors', CONNECTORS_TOOL_NAMES);
        logger.info(`[Claude ${session.id}] Connectors MCP server registered`);
      }

      // FFmpeg — only if ffmpeg binary is installed AND profile allows
      if (
        builtinAllowed &&
        relevantServers.has('ffmpeg') &&
        detectFFmpegBinaries()
      ) {
        mcpServers['ffmpeg-processing'] = createFFmpegMcpServer();
        addMcpAllowedTools(
          queryOptions,
          'ffmpeg-processing',
          FFMPEG_TOOL_NAMES,
        );
        logger.info(
          `[Claude ${session.id}] FFmpeg Processing MCP server registered with ${FFMPEG_TOOL_NAMES.length} tools`,
        );
      }

      // Add Memory MCP server if memory is enabled AND profile allows
      if (builtinAllowed && relevantServers.has('memory')) {
        try {
          const memoryConfig = getMemoryConfig();
          if (memoryConfig.enabled) {
            mcpServers.memory = createMemoryMcpServer(
              getEmbedOptions(memoryConfig),
            );
            addMcpAllowedTools(queryOptions, 'memory', MEMORY_TOOL_NAMES);
            logger.info(
              `[Claude ${session.id}] Memory MCP server registered with ${MEMORY_TOOL_NAMES.length} tools`,
            );
          }
        } catch {
          // Memory config not loaded yet, skip
        }
      }

      // Add Workspace RAG MCP server when selected.
      if (builtinAllowed && relevantServers.has('workspace')) {
        try {
          const { createWorkspaceMcpServer, WORKSPACE_TOOL_NAMES } =
            await import('@/shared/mcp/workspace-server');
          mcpServers.workspace = createWorkspaceMcpServer();
          addMcpAllowedTools(queryOptions, 'workspace', WORKSPACE_TOOL_NAMES);
          logger.info(
            `[Claude ${session.id}] Workspace MCP server registered with ${WORKSPACE_TOOL_NAMES.length} tools`,
          );
        } catch (err) {
          logger.warn(
            `[Claude ${session.id}] Failed to register workspace MCP server: ${err}`,
          );
        }
      }

      // Add Cloud Storage Media tools for event clustering and people summaries.
      if (builtinAllowed && relevantServers.has('cloud-storage-media')) {
        mcpServers['cloud-storage-media'] = createCloudStorageMediaMcpServer();
        addMcpAllowedTools(
          queryOptions,
          'cloud-storage-media',
          CLOUD_STORAGE_MEDIA_TOOL_NAMES,
        );
        logger.info(
          `[Claude ${session.id}] Cloud Storage Media MCP server registered with ${CLOUD_STORAGE_MEDIA_TOOL_NAMES.length} tools`,
        );
      }

      // Publish — feature flagged; tool handlers still enforce destination policy.
      if (
        builtinAllowed &&
        relevantServers.has('publish') &&
        isAgentPublishPipelineEnabled()
      ) {
        mcpServers.publish = createPublishMcpServer({
          featureEnabled: isAgentPublishPipelineEnabled,
          caller: options?.channelContext
            ? {
                ...options.channelContext,
                locale: options.locale ?? options.channelContext.locale,
              }
            : { platform: 'desktop', human: true },
        });
        addMcpAllowedTools(queryOptions, 'publish', PUBLISH_TOOL_NAMES);
        logger.info(
          `[Claude ${session.id}] Publish MCP server registered with ${PUBLISH_TOOL_NAMES.length} tools`,
        );
      }

      // Add Schedule MCP server when selected and profile allows it.
      // Mounted regardless of the schedule_create gate so channel callers
      // can still list/cancel/pause automations their channel owns; only
      // creation is tier-gated (enforced inside the schedule_create tool).
      if (builtinAllowed && relevantServers.has('schedule')) {
        const scheduleGate = this.gateConnector(
          'schedule_create',
          options?.channelContext,
          options?.locale,
        );
        if (!scheduleGate.allow && scheduleGate.denialHint) {
          denialHints.push(scheduleGate.denialHint);
        }
        try {
          mcpServers.schedule = createScheduleMcpServer({
            sessionId: options?.taskId ?? session.id,
            channelContext: options?.channelContext,
            locale: options?.locale,
            allowCreate: scheduleGate.allow,
          });
          addMcpAllowedTools(queryOptions, 'schedule', SCHEDULE_TOOL_NAMES);
          logger.info(
            `[Claude ${session.id}] Schedule MCP server registered with ${SCHEDULE_TOOL_NAMES.length} tools (create ${scheduleGate.allow ? 'allowed' : 'denied'})`,
          );
        } catch (err) {
          logger.warn('Failed to register schedule MCP server:', err);
        }
      }

      // Add Google Services MCP server if user is authenticated
      try {
        const googleGate = this.gateConnector(
          'google',
          options?.channelContext,
          options?.locale ?? options?.channelContext?.locale,
        );
        if (!relevantServers.has('google')) {
          logger.debug(
            `[Claude ${session.id}] Google MCP server skipped (not selected by bundle plan)`,
          );
        } else if (!googleGate.allow) {
          if (googleGate.denialHint) denialHints.push(googleGate.denialHint);
        } else {
          const googleToken = await getValidAccessToken('google');
          if (googleToken) {
            const grantedScopes = await getGrantedScopes('google');
            const googleToolNames = getGoogleToolNames(grantedScopes);
            if (googleToolNames.length > 0) {
              mcpServers.google = createGoogleMcpServer(grantedScopes);
              addMcpAllowedTools(queryOptions, 'google', googleToolNames);
              logger.info(
                `[Claude ${session.id}] Google MCP server registered with ${googleToolNames.length} tools (scopes: ${grantedScopes.length})`,
              );
            } else {
              logger.info(
                `[Claude ${session.id}] Google authenticated but no service scopes granted — skipping MCP server`,
              );
            }
          }
        }
      } catch {
        // Google auth not available, skip
      }

      // Add Slack MCP server if user is authenticated with user token
      const currentAllowed = queryOptions.allowedTools || [...ALLOWED_TOOLS];
      await this.registerSlackMcpTools(
        session.id,
        mcpServers,
        currentAllowed,
        '',
        options?.channelContext,
        denialHints,
      );
      queryOptions.allowedTools = currentAllowed;

      this.registerSlackSearchTools(
        session.id,
        mcpServers,
        currentAllowed,
        options?.channelContext,
      );
    }

    // Only add mcpServers to options if there are any configured
    if (Object.keys(mcpServers).length > 0) {
      queryOptions.mcpServers = mcpServers;
      const allowedMcpTools = allowedMcpToolsForLog(queryOptions);
      logger.info(
        `[Claude ${session.id}] MCP servers loaded: ${Object.keys(mcpServers).join(', ')}`,
      );
      logger.info(
        `[Claude ${session.id}] MCP tool diagnostics: ${JSON.stringify({
          selection: summarizeMcpSelection(relevantServers),
          allowedToolCount: allowedMcpTools.length,
          allowedTools: allowedMcpTools.slice(0, 200),
        })}`,
      );
      recordMcpSelectionTrace({
        taskId: options?.taskId,
        sessionId: session.id,
        phase: 'run',
        selectedServers: relevantServers,
        allowedTools: queryOptions.allowedTools ?? [],
      });
    } else {
      logger.warn(
        `[Claude ${session.id}] No MCP servers configured (sandbox disabled or no user MCP servers)`,
      );
    }

    const slackSearchHint = buildSlackSearchHint(mcpServers);
    const scheduleHint = mcpServers.schedule
      ? `\n\n${SCHEDULE_SYSTEM_PROMPT}`
      : '';
    const connectorDenialHint =
      denialHints.length > 0 ? `\n\n${denialHints.join('\n')}` : '';
    const identityStamp = buildIdentityStamp(options?.channelContext);
    const finalPromptComposition = composeClaudePromptWithResumeCache({
      prompt,
      imageInstruction,
      prefixInstructionBlock,
      perTurnInstructionBlock,
      suffixInstructionBlock:
        slackSearchHint + scheduleHint + connectorDenialHint + identityStamp,
      sessionId: options?.sessionId,
      resumeSessionId: options?.resumeSessionId,
      instructionBlockHashes: ClaudeAgent.resumeInstructionBlockHashes,
      allowResumeSkip: canUseResolvedContextSplit,
    });
    const finalPrompt = finalPromptComposition.prompt;
    if (finalPromptComposition.skippedInstructionBlock) {
      logger.info(
        `[Claude ${session.id}] Resume skipped unchanged instruction block for SDK session ${finalPromptComposition.cacheKey} (${finalPromptComposition.skippedInstructionBlockChars} chars)`,
      );
    }

    const envConfig = queryOptions.env || {};
    logger.debug(`[Claude ${session.id}] Agent config`, {
      claudeCodePath,
      cwd: queryOptions.cwd,
      modelConfig: this.config.model || '(not set)',
      modelQuery: queryOptions.model || '(not set)',
      baseUrl: this.config.baseUrl || '(default Anthropic)',
      hasApiKey: !!this.config.apiKey,
      isCustomApi: this.isUsingCustomApi(),
      hasAuthToken: !!envConfig.ANTHROPIC_AUTH_TOKEN,
      hasApiKeyEnv: !!envConfig.ANTHROPIC_API_KEY,
      settingSources: queryOptions.settingSources?.join(', ') || '(none)',
      permissionMode: queryOptions.permissionMode,
      mcpServers: queryOptions.mcpServers
        ? Object.keys(queryOptions.mcpServers).join(', ')
        : '(none)',
      promptLength: finalPrompt.length,
      systemContextLength: (options?.systemContext ?? '').length,
    });

    // ── Memory flush check (Phase 7F) ──
    // Debounce: only flush once per session to avoid re-processing the same messages.
    if (options?.conversation && !flushedSessionIds.has(session.id)) {
      const flushed = await flushIfNeeded(
        options.conversation,
        `Claude ${session.id}`,
      );
      if (flushed) flushedSessionIds.add(session.id);
    }

    // ── Sub-agent integration: convert AgentProfiles to SDK AgentDefinitions ──
    try {
      const allProfiles = getAllAgentProfiles('active');
      const currentProfileId = options?.agentProfileId;
      const otherProfiles = allProfiles.filter(
        (p) => p.id !== currentProfileId && p.status === 'active',
      );
      if (otherProfiles.length > 0) {
        const agentDefs: Record<
          string,
          {
            description: string;
            prompt: string;
            model: 'sonnet' | 'opus' | 'haiku' | 'inherit';
            maxTurns: number;
          }
        > = {};
        for (const profile of otherProfiles) {
          agentDefs[profile.name] = {
            description:
              profile.description ?? profile.role ?? `Agent: ${profile.name}`,
            prompt:
              profile.system_prompt ??
              `You are ${profile.name}, a ${profile.role ?? 'helpful assistant'}`,
            model: mapModelToSdkFormat(profile.default_model),
            maxTurns: 20,
          };
        }
        queryOptions.agents = agentDefs;
        queryOptions.allowedTools = [
          ...(queryOptions.allowedTools || ALLOWED_TOOLS),
          'Agent',
        ];
        logger.info(
          `[Claude ${session.id}] Registered ${Object.keys(agentDefs).length} sub-agents: ${Object.keys(agentDefs).join(', ')}`,
        );
      }
    } catch (error) {
      logger.warn(
        `[Claude ${session.id}] Failed to load agent profiles for sub-agents:`,
        error,
      );
    }

    // ── Register tool lifecycle hooks ──
    const hookRunner = new ToolLifecycleHookRunner();
    // Built-in: log tool execution for observability
    hookRunner.register({
      event: 'post_tool_use',
      handler: async ({ toolName }) => {
        logger.debug(`[${session.id}] PostToolUse: ${toolName} completed`);
        return { action: 'allow' };
      },
      priority: -10, // low priority — runs last
      async: true, // fire-and-forget
    });
    // Built-in: convert Python tracebacks from Bash into 2-line agent hints.
    hookRunner.register(pythonErrorHintHook);
    for (const hook of options?.toolLifecycleHooks ?? []) {
      hookRunner.register(hook);
    }

    // Merge lifecycle hooks into SDK hooks
    const lifecycleHooks = hookRunner.toSdkHooks();
    const existingPreToolUse = queryOptions.hooks?.PreToolUse || [];
    const existingPostToolUse = queryOptions.hooks?.PostToolUse || [];
    queryOptions.hooks = {
      ...queryOptions.hooks,
      PreToolUse: [...existingPreToolUse, ...(lifecycleHooks.PreToolUse || [])],
      PostToolUse: [
        ...existingPostToolUse,
        ...(lifecycleHooks.PostToolUse || []),
      ],
    };

    // ── Mid-run reply hook: inject user follow-ups at tool boundaries ──
    if (options?.taskId) {
      const taskIdForHook = options.taskId;
      queryOptions.hooks = {
        ...queryOptions.hooks,
        PreToolUse: [
          ...(queryOptions.hooks?.PreToolUse || []),
          {
            hooks: [
              async () => {
                const replies =
                  activeQueryStore.drainPendingReplies(taskIdForHook);
                if (!replies.length) return { continue: true };
                const combined = replies.map((r) => r.content).join('\n---\n');
                return {
                  continue: true,
                  systemMessage: `## User Follow-up\nThe user sent additional context while you were working. Please take this into account:\n\n${combined}`,
                };
              },
            ],
          },
        ],
      };
    }

    // ── Budget enforcement: calculate remaining budget and pass to SDK ──
    try {
      const minRemainingUsd = getRemainingBudgetUsd();
      if (minRemainingUsd <= 0 && minRemainingUsd !== Infinity) {
        logger.warn(
          `[Claude ${session.id}] Budget exhausted — remaining: $${minRemainingUsd.toFixed(4)}`,
        );
        yield {
          type: 'error',
          message: 'Session budget limit reached',
          subtype: 'budget_exceeded',
        };
        yield { type: 'done' };
        return;
      }
      if (minRemainingUsd !== Infinity && minRemainingUsd > 0) {
        queryOptions.maxBudgetUsd = minRemainingUsd;
        logger.info(
          `[Claude ${session.id}] Budget cap set: $${minRemainingUsd.toFixed(4)}`,
        );
      }
    } catch (budgetErr) {
      // Non-critical — if budget check fails, proceed without cap
      logger.warn(
        `[Claude ${session.id}] Budget check failed (proceeding without cap):`,
        budgetErr,
      );
    }

    try {
      logger.info(`[Claude ${session.id}] Starting Agent SDK query()...`);
      const queryObj: QueryType = query({
        prompt: finalPrompt,
        options: queryOptions,
      });
      if (options?.taskId) {
        activeQueryStore.register(options.taskId, queryObj, session.id);
      }
      const merged = mergeWithHeartbeats<unknown>(
        queryObj as AsyncIterable<unknown>,
        () => ({
          _heartbeat: true,
          type: 'planning_status',
          content: 'Working...',
          elapsedMs: Date.now() - session.createdAt.getTime(),
          isProgress: true,
        }),
        PLANNING_HEARTBEAT_MS,
        () => true,
      );
      let sdkMessageCount = 0;
      let lastSdkMessageTime = Date.now();
      let sawAgentOutput = false;
      let queryStalled = false;
      try {
        for await (const raw of merged) {
          if (session.abortController.signal.aborted) break;

          if (typeof raw === 'object' && raw !== null && '_heartbeat' in raw) {
            const stallMs = Date.now() - lastSdkMessageTime;
            if (hasClaudeSdkStalled(stallMs)) {
              queryStalled = true;
              logger.error(
                `[Claude ${session.id}] Direct run stalled ${Math.round(stallMs / 1000)}s — aborting (${sdkMessageCount} SDK msgs)`,
              );
              session.abortController.abort();
              break;
            }
            if (
              stallMs >= PLANNING_STALL_WARN_MS &&
              Math.floor(stallMs / PLANNING_STALL_WARN_MS) !==
                Math.floor(
                  (stallMs - PLANNING_HEARTBEAT_MS) / PLANNING_STALL_WARN_MS,
                )
            ) {
              logger.warn(
                `[Claude ${session.id}] Direct run stalled: ${Math.round(stallMs / 1000)}s (${sdkMessageCount} SDK msgs)`,
              );
            }
            yield raw as unknown as AgentMessage;
            continue;
          }

          sdkMessageCount++;
          lastSdkMessageTime = Date.now();
          for (const agentMessage of this.processMessage(
            raw,
            session.id,
            sentTextHashes,
            sentToolIds,
            options?.taskId,
            toolNames,
            session.abortController,
          )) {
            sawAgentOutput = true;
            yield agentMessage;
          }
        }
      } finally {
        if (options?.taskId) activeQueryStore.unregister(options.taskId);
        this.sdkControlErrorCounts.delete(session.id);
      }

      await logContextUsage(queryObj, session.id, 'Run');

      if (queryStalled) {
        yield {
          type: 'error',
          subtype: 'agent_idle_timeout',
          message: sawAgentOutput
            ? 'The agent stopped responding before it could finish. Partial output may be incomplete. Please try again.'
            : 'The agent stopped responding and was stopped. Please try again.',
        };
        yield { type: 'done' };
        return;
      }

      logger.info(`[Claude ${session.id}] Agent SDK query() completed`);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      // Definite user/control-channel abort: the session's own signal
      // flipped, so we know exactly what happened — drop silently.
      if (session.abortController.signal.aborted) return;

      // Likely abort but not via our local signal (Stop-button race
      // between `activeRunControllers` and `session.abortController`,
      // or an SDK-internal cancel). Note: `AbortError`/"aborted by
      // user" can also surface from `AbortSignal.timeout()` or other
      // cancellations inside the SDK — log at info so the suppression
      // is still observable in production logs without polluting
      // error dashboards. Anthropic Agent SDK message strings tracked
      // here as of @anthropic-ai/claude-agent-sdk@0.2.x.
      const looksLikeAbort =
        (error instanceof Error && error.name === 'AbortError') ||
        /aborted by user|process aborted/i.test(errorMessage);
      if (looksLikeAbort) {
        logger.info(
          `[Claude ${session.id}] Suppressed abort (no local signal): ${errorMessage}`,
        );
        return;
      }

      const errorStack = error instanceof Error ? error.stack : undefined;

      logger.error(`[Claude ${session.id}] Error occurred`, {
        error: {
          name: error instanceof Error ? error.name : 'Unknown',
          message: errorMessage,
          stack: errorStack,
        },
        config: {
          baseUrl: this.config.baseUrl || '(default)',
          apiKey: this.config.apiKey ? 'configured' : 'not set',
          model: effectiveModel || '(default)',
        },
        env: ((envCfg) => ({
          ANTHROPIC_BASE_URL: envCfg.ANTHROPIC_BASE_URL || '(not set)',
          ANTHROPIC_MODEL: envCfg.ANTHROPIC_MODEL || '(not set)',
          hasAuthToken: !!envCfg.ANTHROPIC_AUTH_TOKEN,
        }))(
          this.buildEnvConfig({
            userCredentials: options?.userCredentials,
            model: effectiveModel,
          }),
        ),
      });

      // Check for context length exceeded errors
      const isContextOverflow =
        errorMessage.includes('context_length') ||
        (errorMessage.includes('token') && errorMessage.includes('maximum')) ||
        errorMessage.includes('too many tokens') ||
        errorMessage.includes('context window') ||
        (error instanceof Error &&
          'type' in error &&
          (error as { type?: string }).type === 'invalid_request_error' &&
          (errorMessage.includes('token') || errorMessage.includes('context')));

      if (isContextOverflow) {
        const model = effectiveModel || 'unknown';
        yield {
          type: 'error',
          subtype: 'context_length_exceeded',
          message: JSON.stringify({
            model,
            error: errorMessage,
            suggestions: [
              'Start a new session',
              'Switch to a larger model',
              'Compact conversation history',
            ],
          }),
        };
        yield { type: 'done' };
        return;
      }

      // Check for API key related errors (including Chinese error messages from third-party APIs)
      // If no API key is configured and process exits with error, it's likely an auth issue
      const noApiKeyConfigured =
        !this.config.apiKey &&
        !process.env.ANTHROPIC_API_KEY &&
        !process.env.ANTHROPIC_AUTH_TOKEN;
      const processExitError = errorMessage.includes('exited with code');

      // Check if using custom API - process exit with custom API is likely API compatibility issue
      const usingCustomApi = this.isUsingCustomApi();

      const isApiKeyError =
        errorMessage.includes('Invalid API key') ||
        errorMessage.includes('invalid_api_key') ||
        errorMessage.includes('API key') ||
        errorMessage.includes('authentication') ||
        errorMessage.includes('Please run /login') ||
        errorMessage.includes('Unauthorized') ||
        errorMessage.includes('401') ||
        errorMessage.includes('403') ||
        errorMessage.includes('身份验证') ||
        errorMessage.includes('认证失败') ||
        errorMessage.includes('鉴权失败') ||
        errorMessage.includes('密钥无效') ||
        errorMessage.includes('token') ||
        errorMessage.includes('credential') ||
        (noApiKeyConfigured && processExitError); // No API key + process exit = likely auth issue

      // Custom API + process exit error = likely API compatibility issue
      const isApiCompatibilityError = usingCustomApi && processExitError;

      if (isApiKeyError) {
        yield {
          type: 'error',
          message: '__API_KEY_ERROR__',
        };
      } else if (isApiCompatibilityError) {
        // Custom API compatibility error - show more specific message
        logger.error(
          `[Claude ${session.id}] Custom API compatibility error. Check if the API endpoint supports Claude Code SDK format.`,
        );
        yield {
          type: 'error',
          message: `__CUSTOM_API_ERROR__|${this.config.baseUrl}|${getLogFilePath()}`,
        };
      } else {
        // Show simple user-friendly error message
        // Detailed error info is already logged to file
        yield {
          type: 'error',
          message: `__INTERNAL_ERROR__|${getLogFilePath()}`,
        };
      }
    }

    // Auto-capture moved to runAgent() in agent.ts — all agent types now capture.
    // LLM-based capture remains here (Claude-specific — needs buildLLMCaller).
    const turnCount = options?.conversation?.length ?? 0;
    const llmMemoryScope = deriveMemoryScope(
      options?.channelContext,
      options?.agentProfileId,
    );
    await llmCapture(
      prompt,
      session.id,
      turnCount,
      this.buildLLMCaller(),
      llmMemoryScope,
    );

    // ── Soul correction detection ──
    await detectSoulCorrection(
      prompt,
      session.id,
      options?.agentProfileId,
      this.buildLLMCaller(),
    );

    // ── Worktree post-execution check ──
    if (worktreePath) {
      try {
        const changes = await worktreeHasChanges(worktreePath);
        if (changes) {
          logger.info(
            `[Claude ${session.id}] Worktree has changes — keeping for user review at ${worktreePath}`,
          );
          yield {
            type: 'system',
            subtype: 'worktree_changes',
            content:
              'Agent made changes in an isolated workspace. Review and merge or discard the changes.',
          };
        } else {
          // No changes — clean up silently
          const repoPath = options?.cwd || this.config.workDir || '';
          await removeWorktree(repoPath, worktreePath);
          logger.info(
            `[Claude ${session.id}] Worktree cleaned up (no changes)`,
          );
        }
      } catch (wtErr) {
        logger.warn(`[Claude ${session.id}] Worktree cleanup failed:`, wtErr);
      }
    }

    // Cleanup is guaranteed by safeAsyncGenerator wrapper
    yield { type: 'done' };
  }

  /**
   * Direct API planning — bypasses Claude Code subprocess entirely.
   * Uses Anthropic messages.stream() for ~10x faster planning (5-15s vs minutes).
   * Yields thinking messages with accumulated content for frontend progress.
   */
  private async *planDirectApi(
    planningPrompt: string,
    session: ReturnType<typeof this.createSession>,
    abortSignal?: AbortSignal,
    planStartTime?: number,
    thinkingConfig?: AgentOptions['thinkingConfig'],
  ): AsyncGenerator<AgentMessage> {
    const envConfig = this.buildEnvConfig();
    const apiKey =
      this.config.apiKey ||
      envConfig.ANTHROPIC_AUTH_TOKEN ||
      envConfig.ANTHROPIC_API_KEY ||
      process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      throw new Error('NO_API_KEY');
    }

    const baseUrl = this.config.baseUrl || envConfig.ANTHROPIC_BASE_URL;

    const client = new Anthropic({
      apiKey,
      ...(baseUrl ? { baseURL: baseUrl } : {}),
    });

    const model =
      this.config.model || envConfig.ANTHROPIC_MODEL || DEFAULT_CLAUDE_MODEL;
    logger.info(
      `[Claude ${session.id}] Direct API planning with model: ${model}`,
    );

    // Enable extended thinking for models that support it — streams thinking
    // deltas so the frontend gets progress during the reasoning phase instead
    // of a long silence. Models supporting thinking: Claude 3.5 Sonnet+,
    // Claude 4.x (Opus/Sonnet). Haiku and older models don't support it.
    const supportsThinking = hasHarnessCapability(
      {
        provider: 'claude',
        model,
        transport: 'sdk',
      },
      'reasoning',
    );
    const sonnet5 = isClaudeSonnet5(model);
    const thinkingBudget = thinkingConfig?.budgetTokens ?? 10_000;
    const usesThinking =
      supportsThinking && thinkingConfig?.type !== 'disabled';
    const sonnet5PlanningMaxTokens =
      thinkingConfig?.effort === 'max' || thinkingConfig?.effort === 'xhigh'
        ? SONNET_5_PLANNING_MAX_TOKENS_HIGH
        : SONNET_5_PLANNING_MAX_TOKENS_DEFAULT;
    const planningMaxTokens =
      clampDefaultOutputTokens(
        { id: model },
        {
          defaultMaxTokens: sonnet5
            ? sonnet5PlanningMaxTokens
            : usesThinking
              ? thinkingBudget + 4096
              : 4096,
          inputTokens: estimateOutputBudgetInputTokens(planningPrompt),
          thinkingEnabled: usesThinking,
          thinkingBudgetTokens:
            usesThinking && !sonnet5 ? thinkingBudget : undefined,
        },
      ) ??
      (sonnet5
        ? sonnet5PlanningMaxTokens
        : usesThinking
          ? thinkingBudget + 4096
          : 4096);
    const streamParams: Record<string, unknown> = {
      model,
      // Planning responses are small JSON. For Sonnet 5, max_tokens also
      // covers adaptive reasoning, so keep headroom without using the 128k cap.
      max_tokens: planningMaxTokens,
      messages: [{ role: 'user', content: planningPrompt }],
    };
    if (usesThinking && sonnet5) {
      if (thinkingConfig?.effort) {
        streamParams.output_config = { effort: thinkingConfig.effort };
      }
    } else if (usesThinking && thinkingConfig?.type === 'adaptive') {
      streamParams.thinking = { type: 'adaptive' };
      if (thinkingConfig.effort) {
        streamParams.output_config = { effort: thinkingConfig.effort };
      }
    } else if (usesThinking) {
      streamParams.thinking = {
        type: 'enabled',
        budget_tokens: thinkingBudget,
      };
    } else if (thinkingConfig?.type === 'disabled') {
      streamParams.thinking = { type: 'disabled' };
    }

    const stream = client.messages.stream(
      streamParams as Parameters<typeof client.messages.stream>[0],
      abortSignal ? { signal: abortSignal } : undefined,
    );

    const t0 = planStartTime ?? Date.now();
    let fullResponse = '';
    let accumulatedThinking = '';
    let lastThinkingYieldTime = 0;
    let firstContentReceived = false;

    // Wrap the stream with mergeWithHeartbeats so heartbeats are emitted
    // even when the API stream is blocked during extended thinking.
    const merged = mergeWithHeartbeats<unknown>(
      stream,
      () => ({
        _heartbeat: true,
        type: 'planning_status',
        content: 'Thinking deeply...',
        elapsedMs: Date.now() - t0,
      }),
      PLANNING_HEARTBEAT_MS,
      () => !firstContentReceived,
    );

    try {
      for await (const raw of merged) {
        if (abortSignal?.aborted) break;

        // Yield heartbeat events directly
        if (typeof raw === 'object' && raw !== null && '_heartbeat' in raw) {
          yield raw as unknown as AgentMessage;
          continue;
        }

        const event = raw as Anthropic.MessageStreamEvent;

        // Handle thinking_delta — extended thinking tokens streamed during
        // the reasoning phase (before text output begins).
        // The delta contains `thinking: string` with actual reasoning text.
        if (
          event.type === 'content_block_delta' &&
          'delta' in event &&
          (event.delta as { type?: string }).type === 'thinking_delta'
        ) {
          const thinkingChunk = (event.delta as { thinking?: string }).thinking;
          if (thinkingChunk) {
            accumulatedThinking += thinkingChunk;
          }
          if (!firstContentReceived) {
            firstContentReceived = true;
            logger.info(
              `[Claude ${session.id}] Direct API: first thinking delta received`,
            );
          }
          const now = Date.now();
          if (now - lastThinkingYieldTime >= THINKING_THROTTLE_MS) {
            lastThinkingYieldTime = now;
            // Send the last ~200 chars of thinking as a snippet for the UI
            const snippet =
              accumulatedThinking.length > 200
                ? accumulatedThinking.slice(-200)
                : accumulatedThinking;
            yield {
              type: 'planning_status',
              content: 'Reasoning...',
              elapsedMs: now - t0,
              thinkingText: snippet.trim() || undefined,
            };
          }
          continue;
        }

        if (
          event.type === 'content_block_delta' &&
          'text' in event.delta &&
          event.delta.type === 'text_delta'
        ) {
          fullResponse += event.delta.text;

          if (!firstContentReceived) {
            firstContentReceived = true;
            logger.info(
              `[Claude ${session.id}] Direct API: first text delta received`,
            );
          }
          const now = Date.now();
          if (now - lastThinkingYieldTime >= THINKING_THROTTLE_MS) {
            lastThinkingYieldTime = now;
            yield { type: 'thinking', content: fullResponse };
          }
        }
      }

      // Don't call finalMessage() on an aborted stream — SDK will reject it
      if (abortSignal?.aborted) {
        stream.abort();
        return;
      }

      const finalMessage = await stream.finalMessage();

      // Yield final thinking with content and usage for the caller to capture
      yield {
        type: 'thinking' as const,
        content: fullResponse,
        usage: {
          input_tokens: finalMessage.usage?.input_tokens,
          output_tokens: finalMessage.usage?.output_tokens,
        },
      };
    } catch (error) {
      stream.abort();
      throw error;
    }
  }

  /**
   * Planning phase only
   */
  async *plan(
    prompt: string,
    options?: PlanOptions,
  ): AsyncGenerator<AgentMessage> {
    const session = this.createSession('planning');
    yield { type: 'session', sessionId: session.id };

    // Get session working directory
    const sessionCwd = getSessionWorkDir(
      options?.cwd || this.config.workDir,
      prompt,
      options?.taskId,
    );
    // Ensure the working directory exists before calling SDK
    await ensureDir(sessionCwd);
    logger.info(`[${session.id}] Working directory: ${sessionCwd}`);
    logger.info(`[${session.id}] Planning phase started`);

    // Yield an initial planning_status so the frontend immediately shows
    // "Planning..." with a visible indicator (empty 'thinking' was silently
    // dropped by the emitter).
    const planStartTime = Date.now();
    yield {
      type: 'planning_status',
      content: 'Preparing...',
      elapsedMs: 0,
    };

    // ── Run pre-planning async work concurrently with timeouts ──
    // These operations (memory recall, Google/Slack auth, capture) previously
    // ran sequentially, blocking the stream for up to 30+ seconds on first
    // launch when the ONNX embedding model needs downloading (~340MB).
    const PRE_PLANNING_TIMEOUT_MS = 8_000;

    const withTimeout = <T>(
      promise: Promise<T>,
      label: string,
    ): Promise<T | null> => {
      let handle: ReturnType<typeof setTimeout>;
      return Promise.race([
        promise.finally(() => clearTimeout(handle)),
        new Promise<null>((resolve) => {
          handle = setTimeout(() => {
            logger.warn(
              `[${session.id}] Pre-planning operation timed out: ${label}`,
            );
            resolve(null);
          }, PRE_PLANNING_TIMEOUT_MS);
        }),
      ]);
    };

    // Run service discovery in parallel (memory/prefs already in systemContext)
    // Auto-capture moved to runPlanningPhase() in agent.ts — all agent types now capture.
    const [googleResult, slackResult] = await Promise.allSettled([
      withTimeout(
        (async () => {
          try {
            // Phase A: don't even hint that Google services exist when policy denies.
            if (
              !this.gateConnector(
                'google',
                options?.channelContext,
                options?.locale,
              ).allow
            ) {
              return '';
            }
            const googleToken = await getValidAccessToken('google');
            if (!googleToken) return '';
            const grantedScopes = await getGrantedScopes('google');
            const enabledServices = getEnabledGoogleServices(grantedScopes);
            if (enabledServices.length === 0) return '';
            const serviceDescriptions: Record<string, string> = {
              gmail: 'Gmail (read, search, and send emails)',
              calendar:
                "Google Calendar (list calendars, view/create events, get today's schedule)",
              drive:
                'Google Drive (list, search, create, move, copy, trash files; manage comments, permissions, revisions)',
              photos: 'Google Photos (pick and view photos via Picker API)',
              meet: 'Google Meet (create spaces, view conference records, recordings, transcripts)',
            };
            const serviceList = enabledServices
              .map((s) => `- **${s}**: ${serviceDescriptions[s] ?? s}`)
              .join('\n');
            return `
## AVAILABLE GOOGLE SERVICES
The user has authorized the following Google Workspace integrations. These tools ARE available during execution — always create a plan for Google service requests:
${serviceList}

When the user asks about their emails, calendar, files, photos, or meetings, create a PLAN (not a direct answer) that uses these services.
`;
          } catch {
            return '';
          }
        })(),
        'googleServices',
      ),
      withTimeout(
        (async () => {
          try {
            if (
              !this.gateConnector(
                'slack_user_token',
                options?.channelContext,
                options?.locale,
              ).allow
            ) {
              return '';
            }
            const slackUserToken = await getValidAccessToken('slack', 'user');
            if (!slackUserToken) return '';
            const slackToolNames = await discoverSlackMcpTools(slackUserToken);
            if (slackToolNames.length === 0) return '';
            return `
## AVAILABLE SLACK SERVICES
The user has authorized the Slack integration. Slack MCP tools ARE available during execution — always create a plan for Slack requests.
Available tools: ${slackToolNames.join(', ')}

When the user asks about their Slack messages, channels, missed messages, conversations, or anything Slack-related, create a PLAN (not a direct answer) that uses Slack tools.
`;
          } catch {
            return '';
          }
        })(),
        'slackServices',
      ),
    ]);

    const googleServicesSupplement =
      (googleResult.status === 'fulfilled' && googleResult.value) || '';
    const slackServicesSupplement =
      (slackResult.status === 'fulfilled' && slackResult.value) || '';
    // Context (memories + prefs) is pre-resolved by the service layer
    const memoryContext = this.getSystemContext(options);

    // Signal pre-planning complete, now entering model call
    yield {
      type: 'planning_status',
      content: 'Analyzing task...',
      elapsedMs: Date.now() - planStartTime,
    };

    // Include workspace instruction in planning prompt.
    // If user selected a workspace folder, include it so the agent knows where to find files.
    const userDir = options?.cwd;
    const extraDirs = options?.additionalUserDirs;
    const allDirs = [...(userDir ? [userDir] : []), ...(extraDirs ?? [])];
    // Escape backticks in paths to prevent markdown formatting issues in the prompt
    const safeDirs = allDirs.map((d) => d.replace(/`/g, '\\`'));
    const workspaceInstruction =
      safeDirs.length > 0
        ? `
## CRITICAL: Working Directories
**User's workspace folder${safeDirs.length > 1 ? 's' : ''}: ${safeDirs.join(', ')}**
You have full read/write access to ${safeDirs.length > 1 ? 'these folders' : 'this folder'} and all ${safeDirs.length > 1 ? 'their' : 'its'} contents.
When the user says "this folder" or "current folder", they mean: ${safeDirs[0]}

**Session output directory: ${sessionCwd}**
For any new files the user didn't explicitly request to be saved elsewhere, use the session directory.
`
        : `
## CRITICAL: Output Directory
**ALL files must be saved to: ${sessionCwd}**
If you need to create any files during planning, use this directory.
`;

    // Build tool capabilities supplement so the planner knows what's available
    // during execution (important for direct API path which has no MCP context)
    const planBuiltinAllowed = areBuiltinServersAllowed(
      options?.resolvedContext?.profileAllowedSkills,
    );

    const toolCapabilities: string[] = [];
    if (planBuiltinAllowed) {
      try {
        const caps = listCapabilities();
        if (caps.imageProviders.length > 0 || caps.videoProviders.length > 0) {
          const parts = [];
          if (caps.imageProviders.length > 0)
            parts.push(`image generation (${caps.imageProviders.join(', ')})`);
          if (caps.videoProviders.length > 0)
            parts.push(`video generation (${caps.videoProviders.join(', ')})`);
          toolCapabilities.push(`- **Media Generation**: ${parts.join(', ')}`);

          const modelLines: string[] = [];
          for (const detail of caps.providerDetails) {
            const allModels = [
              ...detail.imageModels.map((m) => `${m} [image]`),
              ...detail.videoModels.map((m) => `${m} [video]`),
            ];
            if (allModels.length > 0) {
              modelLines.push(`  - ${detail.name}: ${allModels.join(', ')}`);
            }
          }
          if (modelLines.length > 0) {
            toolCapabilities.push(
              `  Available models:\n${modelLines.join('\n')}`,
            );
            toolCapabilities.push(
              `  Note: "Nano Banana" refers to Google Gemini image models (e.g. gemini-2.5-flash-image-preview). When the user mentions "nano banana", use the Google Gemini provider for image generation.`,
            );
          }
        }
      } catch {
        // Media not configured
      }
    }
    try {
      const linearConfig = getLinearConfig();
      if (linearConfig.linearEnabled && linearConfig.apiKey) {
        toolCapabilities.push(
          '- **Linear**: Issue tracking (list, create, update issues and projects)',
        );
      }
    } catch {
      // Linear not configured
    }
    if (planBuiltinAllowed) {
      try {
        const memoryConfig = getMemoryConfig();
        if (memoryConfig.enabled) {
          toolCapabilities.push(
            '- **Memory**: Long-term memory (store, recall, forget facts across sessions)',
          );
        }
      } catch {
        // Memory not configured
      }
    }
    // Speech — only list if providers are available AND profile allows
    if (planBuiltinAllowed) {
      const speechCaps = listSpeechCapabilities();
      if (
        speechCaps.ttsProviders.length > 0 ||
        speechCaps.sttProviders.length > 0
      ) {
        toolCapabilities.push(
          '- **Speech**: Text-to-speech synthesis and speech-to-text transcription',
        );
      }
    }
    // FFmpeg — only list if binary is installed AND profile allows
    if (planBuiltinAllowed && detectFFmpegBinaries()) {
      toolCapabilities.push(
        '- **FFmpeg**: Local audio/video processing (convert, trim, concat, extract)',
      );
    }
    // Web search — list only when configured AND mode applies to Claude
    {
      const searchCfg = getSearchConfig();
      if (isSearchEnabled() && searchCfg.mode !== 'auto') {
        toolCapabilities.push(
          '- **Web Search**: Custom search providers (web_search, web_search_news) via configured services',
        );
      }
    }
    // Built-in Claude web tools (always available for Claude agent)
    toolCapabilities.push(
      '- **Web**: Web search (WebSearch) and page fetching (WebFetch)',
    );
    toolCapabilities.push(
      '- **Files**: Read, Write, Edit, Glob, Grep, Bash for file and code operations',
    );
    // Installed skills — the planner otherwise has no idea these exist and
    // will answer tool-doable requests (e.g. "download this YouTube audio")
    // as a direct_answer refusal instead of routing to a plan/execution.
    if (options?.skillsConfig?.enabled !== false) {
      const skillFilter = options?.resolvedContext?.profileAllowedSkills;
      if (skillFilter === undefined || skillFilter.length > 0) {
        try {
          const allSkills = await this.getCachedSkills();
          const visibleSkills = skillFilter
            ? allSkills.filter((s) => skillFilter.includes(s.bareName))
            : allSkills;
          if (visibleSkills.length > 0) {
            toolCapabilities.push(
              `- **Skills**: Installed skills the Skill tool can invoke directly during execution — ${visibleSkills.map((s) => s.bareName).join(', ')}. When one of these covers the request (e.g. yt-dlp for downloading YouTube/web video or audio), plan to use it instead of refusing.`,
            );
          }
        } catch {
          // Skills not available
        }
      }
    }
    // Schedule tools — only if profile allows
    if (planBuiltinAllowed) {
      toolCapabilities.push(
        '- **Scheduling**: Create, list, cancel, pause/resume scheduled automations (schedule_create, schedule_list, schedule_cancel, schedule_toggle, schedule_history). These tools manage the Automations panel. Do NOT use CronCreate/CronDelete/CronList — they are disconnected from the Automations system.',
      );
    }
    if (planBuiltinAllowed && isAgentPublishPipelineEnabled()) {
      toolCapabilities.push(
        '- **Publish**: Upload, publish, or save generated/edited local files to writable destinations, including connected Immich/self-hosted media servers (publish.destinations, publish.start, publish.status). Use this instead of Google Photos picker tools for uploads.',
      );
    }

    let toolCapabilitiesSupplement = '';
    if (toolCapabilities.length > 0) {
      toolCapabilitiesSupplement = `
## AVAILABLE EXECUTION TOOLS
The following tools and services ARE available during execution — create a plan when the user's request needs them:
${toolCapabilities.join('\n')}
`;
    }

    const scheduleNote = `
## SCHEDULING — CRITICAL RULE
When the user asks to schedule, remind, monitor, check periodically, or set up any recurring/delayed task:
- You MUST use the **schedule_create** MCP tool. This is the ONLY tool that integrates with the Automations panel.
- NEVER use CronCreate, CronDelete, or CronList. These are harness-level tools that do NOT connect to the automation engine and will NOT appear in the Automations tab.
- Available schedule tools: schedule_create, schedule_list, schedule_cancel, schedule_toggle, schedule_history.
- For "every N minutes" requests, use scheduleType: "interval" with intervalMinutes.
- For "every day at X" requests, use scheduleType: "cron" with cronExpr.
- For "after N minutes" or one-time requests, use scheduleType: "once" with an ISO datetime.
`;

    const planningPrompt =
      memoryContext +
      workspaceInstruction +
      googleServicesSupplement +
      slackServicesSupplement +
      toolCapabilitiesSupplement +
      scheduleNote +
      PLANNING_INSTRUCTION +
      prompt;

    let fullResponse = '';
    let directApiSucceeded = false;

    // Capture cost/usage during planning
    let planCost: number | undefined;
    let planDuration: number | undefined;
    let planUsage:
      | {
          input_tokens?: number;
          output_tokens?: number;
          cache_read_input_tokens?: number;
          cache_creation_input_tokens?: number;
        }
      | undefined;

    try {
      // ── Strategy 1: Direct API call (fast path) ──
      // When an API key is available, bypass the Claude Code subprocess entirely.
      // This eliminates ~8s subprocess startup, MCP server loading, and ~1.3GB memory spike.
      const abortSignal =
        options?.abortController?.signal || session.abortController.signal;
      const envConfig = this.buildEnvConfig();
      const hasApiKey = !!(
        this.config.apiKey ||
        envConfig.ANTHROPIC_AUTH_TOKEN ||
        envConfig.ANTHROPIC_API_KEY ||
        process.env.ANTHROPIC_API_KEY
      );

      if (hasApiKey) {
        logger.info(
          `[Claude ${session.id}] Using direct API planning (fast path)`,
        );
        const directApiStartTime = Date.now();

        try {
          // Stream thinking messages to frontend while accumulating response
          for await (const msg of this.planDirectApi(
            planningPrompt,
            session,
            abortSignal,
            planStartTime,
            options?.thinkingConfig,
          )) {
            yield msg;
            // Capture the final thinking message content as the full response
            if (msg.type === 'thinking' && msg.content) {
              fullResponse = msg.content;
            }
            if (msg.usage) {
              planUsage = msg.usage;
            }
          }
          directApiSucceeded = true;
          planDuration = Date.now() - directApiStartTime;
          logger.info(
            `[Claude ${session.id}] Direct API planning completed in ${planDuration}ms (${fullResponse.length} chars)`,
          );
        } catch (directApiError) {
          // Propagate abort — don't fall back to subprocess on cancellation
          if (
            directApiError instanceof Error &&
            directApiError.name === 'AbortError'
          ) {
            throw directApiError;
          }
          // If direct API fails, fall through to subprocess fallback
          logger.warn(
            `[Claude ${session.id}] Direct API planning failed, falling back to query():`,
            directApiError instanceof Error
              ? directApiError.message
              : directApiError,
          );
          fullResponse = '';
          planUsage = undefined;
        }
      }

      // ── Strategy 2: Claude Code subprocess (fallback) ──
      // Used when no API key is available (Claude Code auth) or when direct API fails.
      if (!directApiSucceeded) {
        const claudeCodePath = await ensureClaudeCode();
        if (!claudeCodePath) {
          yield {
            type: 'error',
            message: '__CLAUDE_CODE_NOT_FOUND__',
          };
          yield { type: 'done' };
          return;
        }

        const effectiveModel = resolveSupportedClaudeModel(
          claudeCodePath,
          this.config.model,
        );

        // Do NOT use includePartialMessages — it causes the SDK to emit raw
        // stream_event/content_block_delta messages that can stall mid-stream.
        // Without it, the SDK aggregates internally and emits complete `assistant`
        // messages — simpler, more reliable, matches the official SDK usage pattern.
        const queryOptions: Options = {
          cwd: sessionCwd,
          ...(supportsSettingSources(claudeCodePath)
            ? { settingSources: [] as ('user' | 'project')[] }
            : {}),
          // `tools: []` disables all built-in tools (passes --tools "").
          // `allowedTools: []` only controls auto-permission, NOT tool availability.
          tools: [],
          permissionMode: 'bypassPermissions',
          allowDangerouslySkipPermissions: true,
          abortController: options?.abortController || session.abortController,
          env: this.buildEnvConfig({
            userCredentials: options?.userCredentials,
            model: effectiveModel,
          }),
          model: effectiveModel,
          pathToClaudeCodeExecutable: claudeCodePath,
          ...normalizeClaudeThinkingForSdk(effectiveModel, {
            type: 'adaptive',
          }),
          stderr: (data: string) => {
            logger.error(`[${session.id}] STDERR: ${data}`);
          },
        };

        logger.info(
          `[Claude ${session.id}] Starting planning via Agent SDK (OAuth), prompt: ${planningPrompt.length} chars`,
        );

        // Heartbeats keep the frontend informed and enable stall detection
        // during subprocess startup and extended thinking (can be 2-3+ min).
        const querySource = query({
          prompt: planningPrompt,
          options: queryOptions,
        }) as AsyncIterable<unknown>;

        const merged = mergeWithHeartbeats<unknown>(
          querySource,
          () => ({
            _heartbeat: true,
            type: 'planning_status',
            content: 'Thinking deeply...',
            elapsedMs: Date.now() - planStartTime,
          }),
          PLANNING_HEARTBEAT_MS,
          () => true,
        );

        let planMsgCount = 0;
        let lastPlanMsgTime = Date.now();

        for await (const raw of merged) {
          if (session.abortController.signal.aborted) break;

          if (typeof raw === 'object' && raw !== null && '_heartbeat' in raw) {
            const stallMs = Date.now() - lastPlanMsgTime;
            if (hasClaudeSdkStalled(stallMs)) {
              logger.error(
                `[Claude ${session.id}] Planning stalled ${Math.round(stallMs / 1000)}s — aborting (${planMsgCount} msgs, response=${fullResponse.length} chars)`,
              );
              break;
            }
            if (
              stallMs >= PLANNING_STALL_WARN_MS &&
              Math.floor(stallMs / PLANNING_STALL_WARN_MS) !==
                Math.floor(
                  (stallMs - PLANNING_HEARTBEAT_MS) / PLANNING_STALL_WARN_MS,
                )
            ) {
              logger.warn(
                `[Claude ${session.id}] Planning stalled: ${Math.round(stallMs / 1000)}s (${planMsgCount} msgs, response=${fullResponse.length} chars)`,
              );
            }
            yield raw as unknown as AgentMessage;
            continue;
          }

          planMsgCount++;
          lastPlanMsgTime = Date.now();

          const message = raw as {
            type: string;
            message?: {
              content?: Array<{ text?: string; thinking?: string }>;
            };
            total_cost_usd?: number;
            duration_ms?: number;
            usage?: {
              input_tokens?: number;
              output_tokens?: number;
              cache_read_input_tokens?: number;
              cache_creation_input_tokens?: number;
            };
          };

          if (message.type === 'assistant' && message.message?.content) {
            for (const block of message.message.content) {
              if ('text' in block && block.text) {
                fullResponse += block.text;
                yield { type: 'thinking', content: fullResponse };
              }
            }
          } else if (message.type === 'result') {
            planCost = message.total_cost_usd;
            planDuration = message.duration_ms;
            planUsage = message.usage;

            const planTerminalReason: string | undefined = (
              message as typeof message & { terminal_reason?: string }
            ).terminal_reason;
            if (planTerminalReason && planTerminalReason !== 'completed') {
              logger.warn(
                `[Claude ${session.id}] Planning terminated abnormally: ${planTerminalReason}`,
              );
            }

            // Log planning usage
            const planUsageDetails = (
              message.usage as
                | {
                    output_tokens_details?: {
                      thinking_tokens?: number;
                    } | null;
                  }
                | undefined
            )?.output_tokens_details;
            logUsage({
              sessionId: session.id,
              taskId: options?.taskId,
              callType: 'agent',
              provider: 'anthropic',
              model: effectiveModel ?? DEFAULT_CLAUDE_MODEL,
              totalCostUsd: message.total_cost_usd,
              inputTokens: message.usage?.input_tokens,
              outputTokens: message.usage?.output_tokens,
              reasoningOutputTokens: planUsageDetails?.thinking_tokens,
              outputTokensDetails: planUsageDetails,
              cacheReadTokens: message.usage?.cache_read_input_tokens,
              cacheCreationTokens: message.usage?.cache_creation_input_tokens,
              latencyMs: message.duration_ms,
              metadata: {
                phase: 'planning',
                ...(planTerminalReason
                  ? { terminal_reason: planTerminalReason }
                  : {}),
              },
            });
          }
        }

        logger.info(
          `[Claude ${session.id}] Planning stream ended: ${planMsgCount} messages, ${fullResponse.length} chars`,
        );
      }

      // If we broke out due to stall and have no usable response, yield error
      // (skip this check if direct API succeeded — planCost is only set by SDK path)
      if (!directApiSucceeded && !planCost && fullResponse.trim().length < 50) {
        logger.error(
          `[${session.id}] Planning produced insufficient output (${fullResponse.length} chars) — likely subprocess hang`,
        );
        yield {
          type: 'error',
          message:
            'Planning timed out — the agent subprocess stopped responding. Please try again.',
        };
        return;
      }

      // Parse the planning response - can be direct answer or plan
      const planningResult = parsePlanningResponse(fullResponse);

      if (planningResult?.type === 'ask_user_question') {
        // Planning has `tools: []` so the model can't call AskUserQuestion
        // natively; it emits the JSON variant instead. Translate into the
        // same synthetic tool_use event the Codex/HTTP text bridge uses so
        // the frontend's existing AskUserQuestion handler renders the
        // interactive picker. See `@/core/agent/ask-user-question`.
        logger.debug(
          `[${session.id}] AskUserQuestion requested during planning (${planningResult.payload.questions.length} question(s))`,
        );
        yield buildAskUserQuestionToolUse(planningResult.payload);
      } else if (planningResult?.type === 'direct_answer') {
        // Simple question - return direct answer, no plan needed
        logger.debug(`[${session.id}] Direct answer provided (no plan needed)`);
        yield {
          type: 'direct_answer',
          content: planningResult.answer,
          cost: this.effectiveCost(planCost),
          duration: planDuration,
          usage: planUsage,
        };
      } else if (
        planningResult?.type === 'plan' &&
        planningResult.plan.steps.length > 0
      ) {
        // Complex task - return plan
        this.storePlan(planningResult.plan);
        logger.info(
          `[${session.id}] Plan created: ${planningResult.plan.id} with ${planningResult.plan.steps.length} steps`,
        );
        yield {
          type: 'plan',
          plan: planningResult.plan,
          cost: this.effectiveCost(planCost),
          duration: planDuration,
          usage: planUsage,
        };
      } else {
        // Fallback: try to parse as plan directly
        const plan = parsePlanFromResponse(fullResponse);
        if (plan && plan.steps.length > 0) {
          this.storePlan(plan);
          logger.info(
            `[${session.id}] Plan created: ${plan.id} with ${plan.steps.length} steps`,
          );
          yield {
            type: 'plan',
            plan,
            cost: this.effectiveCost(planCost),
            duration: planDuration,
            usage: planUsage,
          };
        } else {
          // If no structured response, treat as direct answer
          logger.debug(
            `[${session.id}] No plan found, treating as direct answer`,
          );
          yield {
            type: 'direct_answer',
            content: fullResponse.trim(),
            cost: this.effectiveCost(planCost),
            duration: planDuration,
            usage: planUsage,
          };
        }
      }
    } catch (error) {
      logger.error(
        `[${session.id}] Planning error:`,
        error instanceof Error
          ? {
              message: error.message,
              name: error.name,
              stack: error.stack?.split('\n').slice(0, 5).join('\n'),
            }
          : error,
      );
      yield {
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      };
    } finally {
      yield { type: 'done' };
    }
  }

  /**
   * Execute an approved plan
   */
  async *execute(options: ExecuteOptions): AsyncGenerator<AgentMessage> {
    const session = this.createSession('executing');

    // Early return if plan not found - no cleanup needed
    const plan = options.plan || this.getPlan(options.planId);
    if (!plan) {
      logger.error(`[${session.id}] Plan not found: ${options.planId}`);
      yield { type: 'error', message: `Plan not found: ${options.planId}` };
      yield { type: 'done' };
      return;
    }

    // Check if PTC batch mode should be used
    const ptcEnabled =
      options.ptcEnabled ?? getSetting('ptcEnabled') === 'true';
    const env = this.buildEnvConfig();
    const hasApiKey = !!(env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY);
    const usePTC = ptcEnabled && plan.executionMode === 'batch' && hasApiKey;

    if (ptcEnabled && plan.executionMode === 'batch' && !hasApiKey) {
      logger.warn(
        `[Claude ${session.id}] PTC batch mode requested but no API key available — falling back to SDK subprocess`,
      );
    }

    if (usePTC) {
      logger.info(
        `[Claude ${session.id}] PTC batch mode for plan: ${options.planId}`,
      );
      const cleanup = () => {
        this.deletePlan(options.planId);
        this.sessions.delete(session.id);
      };
      yield* safeAsyncGenerator(
        this.executePTCGenerator(options, session, plan),
        cleanup,
      );
      return;
    }

    const sentTextHashes = new LimitedSet<string>(1000); // Max 1000 text hashes
    const sentToolIds = new LimitedSet<string>(500); // Max 500 tool IDs
    const toolNames = new Map<string, string>(); // tool ID → tool name for result limiter

    // Guaranteed cleanup even if consumer stops early
    const cleanup = () => {
      logger.debug(`Execution cleanup started for session ${session.id}`);
      sentTextHashes.clear();
      sentToolIds.clear();
      toolNames.clear();
      this.deletePlan(options.planId);
      this.sessions.delete(session.id);
    };

    // Wrap generator with guaranteed cleanup
    yield* safeAsyncGenerator(
      this.executeGenerator(
        options,
        session,
        plan,
        sentTextHashes,
        sentToolIds,
        toolNames,
      ),
      cleanup,
    );
  }

  /**
   * Internal generator for execute() - wrapped by safeAsyncGenerator for guaranteed cleanup
   */
  private async *executeGenerator(
    options: ExecuteOptions,
    session: ReturnType<typeof this.createSession>,
    plan: NonNullable<ReturnType<typeof this.getPlan>>,
    sentTextHashes: LimitedSet<string>,
    sentToolIds: LimitedSet<string>,
    toolNames: Map<string, string>,
  ): AsyncGenerator<AgentMessage> {
    yield { type: 'session', sessionId: session.id };

    logger.debug(
      `Using plan ${plan.id} (${plan.goal}) for session ${session.id}`,
    );

    const sessionCwd = getSessionWorkDir(
      options.cwd || this.config.workDir,
      options.originalPrompt,
      options.taskId,
    );
    // Ensure the working directory exists before calling SDK
    await ensureDir(sessionCwd);
    logger.info(`[Claude ${session.id}] Working directory: ${sessionCwd}`);
    // Log sandbox config for debugging
    logger.info(`[Claude ${session.id}] Execute sandbox config:`, {
      hasSandbox: !!options.sandbox,
      sandboxEnabled: options.sandbox?.enabled,
      sandboxProvider: options.sandbox?.provider,
    });
    if (options.sandbox?.enabled) {
      logger.info(
        `[Claude ${session.id}] Sandbox mode enabled with provider: ${options.sandbox.provider}`,
      );
    } else {
      logger.warn(`[Claude ${session.id}] Sandbox NOT enabled for execution`);
    }

    // Build sandbox options for workspace instruction
    const sandboxOpts: SandboxOptions | undefined = options.sandbox?.enabled
      ? {
          enabled: true,
          image: options.sandbox.image,
          apiEndpoint: options.sandbox.apiEndpoint || SANDBOX_API_URL,
        }
      : undefined;

    // Context (memories + prefs) is pre-resolved by the service layer
    const memoryContext = this.getSystemContext(options);

    // executionPrompt is built after MCP registration so media supplement can be included
    let mediaSupplement = '';
    const scheduleSupplement = `
## SCHEDULING — CRITICAL RULE
You MUST use the schedule_create MCP tool for ANY scheduling task. NEVER use CronCreate/CronDelete/CronList.
schedule_create integrates with the Automations panel. CronCreate does NOT — it's a disconnected harness tool.
Available: schedule_create, schedule_list, schedule_cancel, schedule_toggle, schedule_history.
`;
    logger.info(
      `[Claude ${session.id}] Execution phase started for plan: ${options.planId}`,
    );

    // Ensure Claude Code is installed
    const claudeCodePath = await ensureClaudeCode();
    if (!claudeCodePath) {
      yield {
        type: 'error',
        message: '__CLAUDE_CODE_NOT_FOUND__',
      };
      yield { type: 'done' };
      return;
    }
    const effectiveModel = resolveSupportedClaudeModel(
      claudeCodePath,
      this.config.model,
    );

    // Load user-configured MCP servers based on mcpConfig settings.
    // `disableUserMcp` skips them — see the run() path for rationale.
    const userMcpServers = options.disableUserMcp
      ? {}
      : await loadMcpServers(options.mcpConfig as McpConfig | undefined);
    if (options.disableUserMcp) {
      logger.info(
        `[Claude ${session.id}] User MCP servers disabled for this run (disableUserMcp)`,
      );
    }

    // Build query options
    // Use settingSources based on skillsConfig to control skill loading
    const execSettingSources: ('user' | 'project')[] = this.buildSettingSources(
      options.skillsConfig,
    );
    logger.info(
      `[Claude ${session.id}] Execute skills config:`,
      options.skillsConfig,
    );
    logger.info(
      `[Claude ${session.id}] Execute setting sources: ${execSettingSources.join(', ')}`,
    );

    // Only include settingSources if the CLI supports --setting-sources flag
    const useExecSettingSources = supportsSettingSources(claudeCodePath);
    if (!useExecSettingSources) {
      logger.warn(
        `[Claude ${session.id}] Claude Code CLI does not support --setting-sources, skipping`,
      );
    }

    // Build OS-level sandbox settings for filesystem isolation
    const execUserWsDir = options.userWorkspaceDir;
    const execAllowWsWrite = options.allowWorkspaceWrite;
    const execSdkSandbox = buildSdkSandboxSettings(
      sessionCwd,
      execUserWsDir,
      execAllowWsWrite,
      options.additionalUserDirs,
    );

    const execDenialTracker = new DenialTracker();
    const execLoopGuard = new LoopGuard();
    const execPermissionRegistry = createPermissionRegistry(
      options?.autoApprove,
    );
    applyToolClassifications(
      execPermissionRegistry,
      options.toolClassifications,
    );

    const queryOptions: Options = {
      cwd: sessionCwd,
      tools: { type: 'preset', preset: 'claude_code' },
      allowedTools: options.allowedTools || ALLOWED_TOOLS,
      // Block harness-level cron tools — our schedule_* MCP tools replace them
      disallowedTools: [
        ...HARDCODED_DISALLOWED,
        ...(options.disallowedTools ?? []),
      ],
      ...(useExecSettingSources ? { settingSources: execSettingSources } : {}),
      permissionMode: 'default',
      canUseTool: buildCanUseTool(
        execDenialTracker,
        execPermissionRegistry,
        pendingPermissions,
        options?.taskId,
        session.id,
        execLoopGuard,
      ),
      sandbox: execSdkSandbox.sandbox,
      additionalDirectories: execSdkSandbox.additionalDirectories,
      abortController: options.abortController || session.abortController,
      env: this.buildEnvConfig({
        userCredentials: options.userCredentials,
        model: effectiveModel,
      }),
      model: effectiveModel,
      ...(effectiveModel
        ? {
            systemPrompt: {
              type: 'preset' as const,
              preset: 'claude_code' as const,
              append: buildSystemPromptAppend(
                effectiveModel,
                options.skillsConfig?.enabled !== false,
              ),
            },
          }
        : {}),
      pathToClaudeCodeExecutable: claudeCodePath,
      maxTurns: options.maxTurns ?? 200,
      enableFileCheckpointing: true,
      // Provides user message UUIDs in stream (required for rewindFiles targeting)
      extraArgs: { 'replay-user-messages': null },
      // SDK session persistence — pass session ID for resume capability
      ...(options.sessionId ? { sessionId: options.sessionId } : {}),
      // Resume a previous SDK session
      ...(options.resumeSessionId ? { resume: options.resumeSessionId } : {}),
      // Thinking config passthrough — SDK Options.thinking + Options.effort.
      // Sonnet 5 no longer accepts fixed thinking budgets; normalize enabled
      // profiles to adaptive before they reach Claude Code.
      ...normalizeClaudeThinkingForSdk(effectiveModel, options.thinkingConfig),
      stderr: (data: string) => {
        logger.error(`[Claude ${session.id}] STDERR: ${data}`);
      },
    };

    const execHookRunner = new ToolLifecycleHookRunner();
    execHookRunner.register({
      event: 'post_tool_use',
      handler: async ({ toolName }) => {
        logger.debug(
          `[${session.id}] Execute PostToolUse: ${toolName} completed`,
        );
        return { action: 'allow' };
      },
      priority: -10,
      async: true,
    });
    execHookRunner.register(pythonErrorHintHook);
    for (const hook of options.toolLifecycleHooks ?? []) {
      execHookRunner.register(hook);
    }
    const execLifecycleHooks = execHookRunner.toSdkHooks();
    queryOptions.hooks = {
      ...queryOptions.hooks,
      PreToolUse: [
        ...(queryOptions.hooks?.PreToolUse ?? []),
        ...(execLifecycleHooks.PreToolUse ?? []),
      ],
      PostToolUse: [
        ...(queryOptions.hooks?.PostToolUse ?? []),
        ...(execLifecycleHooks.PostToolUse ?? []),
      ],
    };

    logger.info(`[Claude ${session.id}] Execute sandbox filesystem config:`, {
      allowWrite: execSdkSandbox.sandbox.filesystem?.allowWrite,
      denyWrite: execSdkSandbox.sandbox.filesystem?.denyWrite?.length,
      denyRead: execSdkSandbox.sandbox.filesystem?.denyRead?.length,
      additionalDirectories: execSdkSandbox.additionalDirectories,
    });

    // Determine which MCP servers are relevant based on plan content
    const relevantServers = selectMcpServers(plan);
    logger.info(
      `[Claude ${session.id}] Dynamic MCP selection: ${[...relevantServers].join(', ')}`,
    );
    logger.info(
      `[Claude ${session.id}] Execute MCP bundle selection: ${JSON.stringify(summarizeMcpSelection(relevantServers))}`,
    );

    // Initialize MCP servers with user-configured servers (filtered by @mentions)
    let mentioned = options.mentionedMcpServers;
    if (
      (!mentioned || mentioned.length === 0) &&
      Object.keys(userMcpServers).length > 0
    ) {
      const mentionRegex = /@([\w-]+)/g;
      const serverNames = Object.keys(userMcpServers);
      const autoDetected: string[] = [];
      let match;
      while ((match = mentionRegex.exec(options.originalPrompt)) !== null) {
        const found = serverNames.find(
          (name) => name.toLowerCase() === match![1].toLowerCase(),
        );
        if (found && !autoDetected.includes(found)) {
          autoDetected.push(found);
        }
      }
      if (autoDetected.length > 0) mentioned = autoDetected;
    }

    const filteredUserMcp: Record<string, McpServerConfig> = {};
    for (const [name, cfg] of Object.entries(userMcpServers)) {
      if (!mentioned || mentioned.length === 0 || mentioned.includes(name)) {
        filteredUserMcp[name] = cfg;
      }
    }

    const mcpServers: Record<
      string,
      McpServerConfig | ReturnType<typeof createSandboxMcpServer>
    > = {
      ...filteredUserMcp,
    };

    const execInProcessToolPatterns = registerInProcessMcpServers(
      mcpServers,
      options.inProcessMcpServers,
    );
    if (execInProcessToolPatterns.length > 0) {
      queryOptions.allowedTools = [
        ...(queryOptions.allowedTools || ALLOWED_TOOLS),
        ...execInProcessToolPatterns,
      ];
      logger.info(
        `[Claude ${session.id}] Execute: In-process MCP servers registered: ${Object.keys(options.inProcessMcpServers ?? {}).join(', ')}`,
      );
    }

    // Per-user (Slack App Home) MCP overlay — shadows globals by name.
    const execOverlay = options?.userMcpOverlay as
      | Record<string, McpServerConfig>
      | undefined;
    if (execOverlay && Object.keys(execOverlay).length > 0) {
      const overlayPatterns: string[] = [];
      for (const [name, cfg] of Object.entries(execOverlay)) {
        mcpServers[name] = cfg;
        overlayPatterns.push(`mcp__${name}__*`);
      }
      queryOptions.allowedTools = [
        ...(queryOptions.allowedTools || ALLOWED_TOOLS),
        ...overlayPatterns,
      ];
      logger.info(
        `[Claude ${session.id}] User MCP overlay registered: ${Object.keys(execOverlay).join(', ')}`,
      );
    }

    // Register wildcard tool patterns for every loaded user MCP server.
    if (Object.keys(filteredUserMcp).length > 0) {
      const userToolPatterns = Object.keys(filteredUserMcp).map(
        (name) => `mcp__${name}__*`,
      );
      queryOptions.allowedTools = [
        ...(queryOptions.allowedTools || ALLOWED_TOOLS),
        ...userToolPatterns,
      ];
      logger.info(
        `[Claude ${session.id}] User MCP tool patterns registered: ${userToolPatterns.join(', ')}`,
      );
    }

    // Add sandbox MCP server if sandbox is enabled
    if (options.sandbox?.enabled) {
      mcpServers.sandbox = createSandboxMcpServer(options.sandbox.provider);
      // Add sandbox tools to allowed tools (wildcard pattern for MCP tool naming)
      addAllowedTools(queryOptions, ['mcp__sandbox__*']);
    }

    const execDenialHints: string[] = [];
    if (options.disablePolicyServers) {
      logger.info(
        `[Claude ${session.id}] Execute: Built-in MCP policy servers disabled for this run`,
      );
    } else {
      // Add Linear MCP server if Linear is enabled, configured, and relevant to plan
      try {
        const linearConfig = getLinearConfig();
        if (
          linearConfig.linearEnabled &&
          linearConfig.apiKey &&
          relevantServers.has('linear')
        ) {
          mcpServers.linear = createLinearMcpServer();
          addMcpAllowedTools(queryOptions, 'linear', LINEAR_TOOL_NAMES);
          logger.info(
            `[Claude ${session.id}] Execute: Linear MCP server registered with ${LINEAR_TOOL_NAMES.length} tools`,
          );
        } else if (!linearConfig.linearEnabled) {
          logger.info(
            `[Claude ${session.id}] Execute: Linear MCP server skipped (disabled in settings)`,
          );
        } else if (!relevantServers.has('linear')) {
          logger.debug(
            `[Claude ${session.id}] Execute: Linear MCP server skipped (not relevant to plan)`,
          );
        }
      } catch {
        // Linear config not loaded yet, skip
      }

      // Add Media Generation MCP server — only if relevant AND providers configured
      if (relevantServers.has('media')) {
        const caps = listCapabilities();
        if (caps.imageProviders.length > 0 || caps.videoProviders.length > 0) {
          mcpServers['media-generation'] = createMediaMcpServer();
          addMcpAllowedTools(
            queryOptions,
            'media-generation',
            MEDIA_TOOL_NAMES,
          );
          logger.info(
            `[Claude ${session.id}] Execute: Media Generation MCP server registered`,
          );
        }

        // Build media capabilities supplement so the execution agent knows
        // which providers are available and routes requests to media tools
        const providerLines: string[] = [];
        for (const name of caps.imageProviders) {
          providerLines.push(`  - ${name} [image]`);
        }
        for (const name of caps.videoProviders) {
          providerLines.push(`  - ${name} [video]`);
        }
        if (providerLines.length > 0) {
          mediaSupplement = [
            '\n## Media Generation',
            'Use media_generate_image / media_generate_video for creation, media_analyze_video to analyze existing video files.',
            'Available providers:',
            ...providerLines,
            'When the user mentions a provider by name, pass it to the "model" parameter.',
            'Do NOT search the web or filesystem for model names — they are configured providers.\n',
          ].join('\n');
        }
      }

      // Add Asset Catalog MCP server — only if relevant and rollout flag enabled
      if (relevantServers.has('assets') && isAssetsCatalogEnabled()) {
        mcpServers.assets = createAssetsMcpServer();
        addMcpAllowedTools(queryOptions, 'assets', ASSETS_TOOL_NAMES);
        logger.info(
          `[Claude ${session.id}] Execute: Asset Catalog MCP server registered with ${ASSETS_TOOL_NAMES.length} tools`,
        );
      }

      // Add Speech MCP server — only if relevant AND TTS/STT providers configured
      if (relevantServers.has('speech')) {
        const speechCaps = listSpeechCapabilities();
        if (
          speechCaps.ttsProviders.length > 0 ||
          speechCaps.sttProviders.length > 0
        ) {
          mcpServers.speech = createSpeechMcpServer();
          addMcpAllowedTools(queryOptions, 'speech', SPEECH_TOOL_NAMES);
          logger.info(
            `[Claude ${session.id}] Execute: Speech MCP server registered`,
          );
        }
      }

      // Add Search MCP server — skip for Claude in 'auto' mode (has built-in WebSearch)
      if (relevantServers.has('search')) {
        const searchCfg = getSearchConfig();
        if (isSearchEnabled() && searchCfg.mode !== 'auto') {
          if (searchCfg.mode === 'always') {
            queryOptions.allowedTools = (
              queryOptions.allowedTools || ALLOWED_TOOLS
            ).filter((t: string) => t !== 'WebSearch' && t !== 'WebFetch');
          }
          mcpServers.search = createSearchMcpServer();
          addMcpAllowedTools(queryOptions, 'search', SEARCH_TOOL_NAMES);
          logger.info(
            `[Claude ${session.id}] Execute: Search MCP server registered (mode: ${searchCfg.mode})`,
          );
        }
      }

      // Add FFmpeg Processing MCP server — only if relevant AND ffmpeg binary installed
      if (relevantServers.has('ffmpeg') && detectFFmpegBinaries()) {
        mcpServers['ffmpeg-processing'] = createFFmpegMcpServer();
        addMcpAllowedTools(
          queryOptions,
          'ffmpeg-processing',
          FFMPEG_TOOL_NAMES,
        );
        logger.info(
          `[Claude ${session.id}] Execute: FFmpeg Processing MCP server registered with ${FFMPEG_TOOL_NAMES.length} tools`,
        );
      }

      // Add Memory MCP server if memory is enabled and selected.
      if (relevantServers.has('memory')) {
        try {
          const memoryConfig = getMemoryConfig();
          if (memoryConfig.enabled) {
            mcpServers.memory = createMemoryMcpServer(
              getEmbedOptions(memoryConfig),
            );
            addMcpAllowedTools(queryOptions, 'memory', MEMORY_TOOL_NAMES);
            logger.info(
              `[Claude ${session.id}] Execute: Memory MCP server registered with ${MEMORY_TOOL_NAMES.length} tools`,
            );
          }
        } catch {
          // Memory config not loaded yet, skip
        }
      }

      // Add Workspace RAG MCP server when selected.
      if (relevantServers.has('workspace')) {
        try {
          const { createWorkspaceMcpServer, WORKSPACE_TOOL_NAMES } =
            await import('@/shared/mcp/workspace-server');
          mcpServers.workspace = createWorkspaceMcpServer();
          addMcpAllowedTools(queryOptions, 'workspace', WORKSPACE_TOOL_NAMES);
          logger.info(
            `[Claude ${session.id}] Execute: Workspace MCP server registered with ${WORKSPACE_TOOL_NAMES.length} tools`,
          );
        } catch (err) {
          logger.warn(`Failed to register workspace MCP server: ${err}`);
        }
      }

      if (relevantServers.has('cloud-storage-media')) {
        mcpServers['cloud-storage-media'] = createCloudStorageMediaMcpServer();
        addMcpAllowedTools(
          queryOptions,
          'cloud-storage-media',
          CLOUD_STORAGE_MEDIA_TOOL_NAMES,
        );
        logger.info(
          `[Claude ${session.id}] Execute: Cloud Storage Media MCP server registered`,
        );
      }

      // Publish — feature flagged; tool handlers still enforce destination policy.
      if (relevantServers.has('publish') && isAgentPublishPipelineEnabled()) {
        mcpServers.publish = createPublishMcpServer({
          featureEnabled: isAgentPublishPipelineEnabled,
          caller: options.channelContext
            ? {
                ...options.channelContext,
                locale: options.locale ?? options.channelContext.locale,
              }
            : { platform: 'desktop', human: true },
        });
        addMcpAllowedTools(queryOptions, 'publish', PUBLISH_TOOL_NAMES);
        logger.info(
          `[Claude ${session.id}] Execute: Publish MCP server registered with ${PUBLISH_TOOL_NAMES.length} tools`,
        );
      }

      // Add Schedule MCP server when selected. Only creation is tier-gated
      // (inside the schedule_create tool) — manage tools stay available.
      if (relevantServers.has('schedule')) {
        const scheduleGate = this.gateConnector(
          'schedule_create',
          options.channelContext,
          options.locale,
        );
        if (!scheduleGate.allow && scheduleGate.denialHint) {
          execDenialHints.push(scheduleGate.denialHint);
        }
        try {
          mcpServers.schedule = createScheduleMcpServer({
            sessionId: session.id,
            channelContext: options.channelContext,
            locale: options.locale,
            allowCreate: scheduleGate.allow,
          });
          addMcpAllowedTools(queryOptions, 'schedule', SCHEDULE_TOOL_NAMES);
          logger.info(
            `[Claude ${session.id}] Execute: Schedule MCP server registered with ${SCHEDULE_TOOL_NAMES.length} tools (create ${scheduleGate.allow ? 'allowed' : 'denied'})`,
          );
        } catch (err) {
          logger.warn('Failed to register schedule MCP server:', err);
        }
      }

      // Add Google Services MCP server if authenticated and relevant to plan
      if (relevantServers.has('google')) {
        try {
          const googleGate = this.gateConnector(
            'google',
            options.channelContext,
            options.locale,
          );
          if (!googleGate.allow) {
            if (googleGate.denialHint)
              execDenialHints.push(googleGate.denialHint);
          } else {
            const googleToken = await getValidAccessToken('google');
            if (googleToken) {
              const grantedScopes = await getGrantedScopes('google');
              const googleToolNames = getGoogleToolNames(grantedScopes);
              if (googleToolNames.length > 0) {
                mcpServers.google = createGoogleMcpServer(grantedScopes);
                addMcpAllowedTools(queryOptions, 'google', googleToolNames);
                logger.info(
                  `[Claude ${session.id}] Execute: Google MCP server registered with ${googleToolNames.length} tools (scopes: ${grantedScopes.length})`,
                );
              }
            }
          }
        } catch {
          // Google auth not available, skip
        }
      }

      // Cloud storage (Box / Dropbox / OneDrive) — mount when relevant
      // and the user has a native OAuth token.
      if (relevantServers.has('box')) {
        const boxToken = await getValidAccessToken('box');
        if (boxToken) {
          mcpServers.box = createBoxMcpServer();
          addMcpAllowedTools(queryOptions, 'box', BOX_TOOL_NAMES);
          logger.info(`[Claude ${session.id}] Execute: Box MCP registered`);
        }
      }
      if (relevantServers.has('dropbox')) {
        const dropboxToken = await getValidAccessToken('dropbox');
        if (dropboxToken) {
          mcpServers.dropbox = createDropboxMcpServer();
          addMcpAllowedTools(queryOptions, 'dropbox', DROPBOX_TOOL_NAMES);
          logger.info(`[Claude ${session.id}] Execute: Dropbox MCP registered`);
        }
      }
      if (relevantServers.has('onedrive')) {
        const onedriveToken = await getValidAccessToken('onedrive');
        if (onedriveToken) {
          mcpServers.onedrive = createOneDriveMcpServer();
          addMcpAllowedTools(queryOptions, 'onedrive', ONEDRIVE_TOOL_NAMES);
          logger.info(
            `[Claude ${session.id}] Execute: OneDrive MCP registered`,
          );
        }
      }

      // Add Slack MCP server if user is authenticated with user token
      const execAllowed = queryOptions.allowedTools || [...ALLOWED_TOOLS];
      await this.registerSlackMcpTools(
        session.id,
        mcpServers,
        execAllowed,
        'Execute: ',
        options.channelContext,
        execDenialHints,
      );
      queryOptions.allowedTools = execAllowed;

      this.registerSlackSearchTools(
        session.id,
        mcpServers,
        execAllowed,
        options.channelContext,
        'Execute: ',
      );
    }

    // Only add mcpServers to options if there are any configured
    if (Object.keys(mcpServers).length > 0) {
      queryOptions.mcpServers = mcpServers;
      const allowedMcpTools = allowedMcpToolsForLog(queryOptions);
      logger.info(
        `[Claude ${session.id}] Execute MCP servers loaded: ${Object.keys(mcpServers).join(', ')}`,
      );
      logger.info(
        `[Claude ${session.id}] Execute MCP tool diagnostics: ${JSON.stringify({
          selection: summarizeMcpSelection(relevantServers),
          allowedToolCount: allowedMcpTools.length,
          allowedTools: allowedMcpTools.slice(0, 200),
        })}`,
      );
      recordMcpSelectionTrace({
        taskId: options.taskId,
        sessionId: session.id,
        phase: 'execute',
        selectedServers: relevantServers,
        allowedTools: queryOptions.allowedTools ?? [],
      });
    } else {
      logger.warn(`[Claude ${session.id}] Execute: No MCP servers configured`);
    }

    // Load pinned skills for execution phase
    const execPinnedSkillsInstruction = await this.buildPinnedSkillsInstruction(
      options.pinnedSkills,
    );

    const execSlackSearchHint = buildSlackSearchHint(mcpServers);
    const execScheduleHint = mcpServers.schedule
      ? `\n\n${SCHEDULE_SYSTEM_PROMPT}`
      : '';
    const execConnectorDenialHint =
      execDenialHints.length > 0 ? `\n\n${execDenialHints.join('\n')}` : '';
    const execIdentityStamp = buildIdentityStamp(options.channelContext);

    // Build execution prompt after MCP registration so mediaSupplement is populated
    const executionPrompt =
      memoryContext +
      mediaSupplement +
      scheduleSupplement +
      execSlackSearchHint +
      execScheduleHint +
      buildPublishExecutionHint(Boolean(mcpServers.publish)) +
      execConnectorDenialHint +
      execIdentityStamp +
      execPinnedSkillsInstruction +
      formatPlanForExecution(
        plan,
        sessionCwd,
        sandboxOpts,
        execUserWsDir,
        execAllowWsWrite,
      ) +
      '\n\nOriginal request: ' +
      options.originalPrompt;

    // ── Budget enforcement for execute phase ──
    try {
      const minRemainingUsd = getRemainingBudgetUsd();
      if (minRemainingUsd <= 0 && minRemainingUsd !== Infinity) {
        logger.warn(
          `[Claude ${session.id}] Budget exhausted — remaining: $${minRemainingUsd.toFixed(4)}`,
        );
        yield {
          type: 'error',
          message: 'Session budget limit reached',
          subtype: 'budget_exceeded',
        };
        yield { type: 'done' };
        return;
      }
      if (minRemainingUsd !== Infinity && minRemainingUsd > 0) {
        queryOptions.maxBudgetUsd = minRemainingUsd;
        logger.info(
          `[Claude ${session.id}] Execute budget cap set: $${minRemainingUsd.toFixed(4)}`,
        );
      }
    } catch (budgetErr) {
      logger.warn(
        `[Claude ${session.id}] Execute budget check failed (proceeding without cap):`,
        budgetErr,
      );
    }

    try {
      logger.info(
        `[Claude ${session.id}] Starting Agent SDK query() for execution...`,
      );
      const queryObj: QueryType = query({
        prompt: executionPrompt,
        options: queryOptions,
      });
      if (options.taskId) {
        activeQueryStore.register(options.taskId, queryObj, session.id);
      }
      try {
        for await (const message of queryObj) {
          if (session.abortController.signal.aborted) break;

          yield* this.processMessage(
            message,
            session.id,
            sentTextHashes,
            sentToolIds,
            options.taskId,
            toolNames,
            session.abortController,
          );
        }
      } finally {
        if (options.taskId) activeQueryStore.unregister(options.taskId);
        this.sdkControlErrorCounts.delete(session.id);
      }

      await logContextUsage(queryObj, session.id, 'Execution');
      logger.info(`[Claude ${session.id}] Execution query() completed`);
    } catch (error) {
      // Intentional abort — either user-initiated or the control-channel
      // threshold trip (which already yielded `sdk_control_channel_closed`).
      // Suppress the SDK's trailing AbortError so we don't log or emit twice.
      if (session.abortController.signal.aborted) return;

      const errorMessage =
        error instanceof Error ? error.message : String(error);

      logger.error(
        `[${session.id}] Execution error:`,
        error instanceof Error
          ? {
              message: error.message,
              name: error.name,
              stack: error.stack?.split('\n').slice(0, 5).join('\n'),
            }
          : error,
      );

      // Check for context overflow
      const isContextOverflow =
        errorMessage.includes('context_length') ||
        (errorMessage.includes('token') && errorMessage.includes('maximum')) ||
        errorMessage.includes('too many tokens') ||
        errorMessage.includes('context window');

      if (isContextOverflow) {
        const model = effectiveModel || 'unknown';
        yield {
          type: 'error',
          subtype: 'context_length_exceeded',
          message: JSON.stringify({
            model,
            error: errorMessage,
            suggestions: [
              'Start a new session',
              'Switch to a larger model',
              'Compact conversation history',
            ],
          }),
        };
      } else {
        yield {
          type: 'error',
          message: normalizeClaudeRuntimeError(errorMessage, effectiveModel),
        };
      }
    }

    // Cleanup is guaranteed by safeAsyncGenerator wrapper
    logger.info(`Execution completed for session ${session.id}`);
    yield { type: 'done' };
  }

  /**
   * PTC execution generator — uses the Anthropic Messages API with code_execution
   * tool instead of the Agent SDK query() path.
   */
  private async *executePTCGenerator(
    options: ExecuteOptions,
    session: ReturnType<typeof this.createSession>,
    plan: NonNullable<ReturnType<typeof this.getPlan>>,
  ): AsyncGenerator<AgentMessage> {
    yield { type: 'session', sessionId: session.id };

    const sessionCwd = getSessionWorkDir(
      options.cwd || this.config.workDir,
      options.originalPrompt,
      options.taskId,
    );
    await ensureDir(sessionCwd);
    logger.info(`[Claude ${session.id}] PTC working directory: ${sessionCwd}`);

    // Context (memories + prefs) is pre-resolved by the service layer
    const memoryContext = this.getSystemContext(options);

    const sandboxOpts: SandboxOptions | undefined = options.sandbox?.enabled
      ? {
          enabled: true,
          image: options.sandbox.image,
          apiEndpoint: options.sandbox.apiEndpoint || SANDBOX_API_URL,
        }
      : undefined;

    const ptcUserWsDir = options.userWorkspaceDir;
    const ptcAllowWsWrite = options.allowWorkspaceWrite;

    // Load pinned skills for PTC execution
    const ptcPinnedSkillsInstruction = await this.buildPinnedSkillsInstruction(
      options.pinnedSkills,
    );

    // Prompt caching: dynamic context (runtime timestamp + memories) goes into
    // the execution prompt (per-turn), while static context goes into systemPrompt (cached).
    const dynamicContext =
      options.resolvedContext?.dynamicContext ?? memoryContext;
    const executionPrompt =
      dynamicContext +
      ptcPinnedSkillsInstruction +
      formatPlanForExecution(
        plan,
        sessionCwd,
        sandboxOpts,
        ptcUserWsDir,
        ptcAllowWsWrite,
      ) +
      '\n\nOriginal request: ' +
      options.originalPrompt;

    // Collect and adapt MCP tools (filtered by plan relevance)
    const relevantServers = selectMcpServers(plan);
    logger.info(
      `[Claude ${session.id}] PTC MCP bundle selection: ${JSON.stringify(summarizeMcpSelection(relevantServers))}`,
    );
    const sdkTools = await this.buildPTCTools(
      session.id,
      options,
      relevantServers,
    );
    const { definitions, handlers } = adaptMcpTools(sdkTools);
    const ptcHookRunner = new ToolLifecycleHookRunner();
    for (const hook of options.toolLifecycleHooks ?? []) {
      ptcHookRunner.register(hook);
    }
    const wrappedHandlers = wrapPtcToolHandlersWithLifecycleHooks(
      handlers,
      ptcHookRunner,
      session.id,
    );
    const ptcDenialTracker = new DenialTracker();
    const ptcLoopGuard = new LoopGuard();
    const ptcPermissionRegistry = createPermissionRegistry(options.autoApprove);
    applyToolClassifications(
      ptcPermissionRegistry,
      options.toolClassifications,
    );
    const ptcCanUseTool = buildCanUseTool(
      ptcDenialTracker,
      ptcPermissionRegistry,
      pendingPermissions,
      options.taskId,
      session.id,
      ptcLoopGuard,
    );

    logger.info(
      `[Claude ${session.id}] PTC: ${definitions.length} tools adapted`,
    );

    // Get API credentials
    const env = this.buildEnvConfig();
    const apiKey = env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY || '';
    const baseUrl = env.ANTHROPIC_BASE_URL;
    const model = env.ANTHROPIC_MODEL || this.config.model || DEFAULT_PTC_MODEL;

    if (!apiKey) {
      yield {
        type: 'error',
        message: 'No API key configured for PTC execution',
      };
      yield { type: 'done' };
      return;
    }

    // Try to reuse an existing container for this session
    const existingContainer = this.containerManager.get(session.id);
    if (existingContainer) {
      logger.info(
        `[Claude ${session.id}] PTC: Reusing container ${existingContainer}`,
      );
    }

    const workspaceInstruction = getWorkspaceInstruction(
      sessionCwd,
      sandboxOpts,
      ptcUserWsDir,
      ptcAllowWsWrite,
    );
    // Prompt caching: use static context for system prompt (cached) and
    // dynamic context prepended to execution prompt (per-turn).
    // ptcUserPrefs is now included in memoryContext (pre-resolved systemContext)

    const client = new (await import('@anthropic-ai/sdk')).default({
      apiKey,
      ...(baseUrl ? { baseURL: baseUrl } : {}),
    });

    try {
      for await (const message of executePTC(
        executionPrompt,
        definitions,
        wrappedHandlers,
        {
          apiKey,
          baseUrl,
          model,
          client,
          containerId: existingContainer,
          abortSignal: (options.abortController || session.abortController)
            .signal,
          taskId: options.taskId,
          systemPrompt:
            workspaceInstruction +
            (options.resolvedContext?.staticContext ?? memoryContext),
          onContainerId: (cid, expiresAt) => {
            this.containerManager.set(
              session.id,
              cid,
              client,
              model,
              expiresAt,
            );
          },
          canUseTool: async (toolName, input, signal, toolUseId) => {
            // Fall back to the session's abort controller so a cancel from
            // above still interrupts pending permission waits. A fresh
            // AbortController.signal would never fire.
            const result = await ptcCanUseTool(
              toolName,
              input as Record<string, unknown>,
              {
                signal: signal ?? session.abortController.signal,
                toolUseID: toolUseId ?? `ptc-${toolName}`,
                requestId: toolUseId ?? `ptc-${toolName}`,
              },
            );
            if (!result) {
              // buildCanUseTool never returns null itself — null is only
              // meaningful when the caller already sent a control_response
              // out-of-band, which PTC never does. Fail closed rather than
              // leave the tool call blocked indefinitely (SDK's own guidance).
              return {
                behavior: 'deny',
                message: 'Permission check returned no decision',
              };
            }
            return result.behavior === 'allow'
              ? allowTool(result.updatedInput ?? input)
              : { behavior: 'deny', message: result.message };
          },
        },
      )) {
        yield message;
      }
    } catch (error) {
      logger.error(
        `[${session.id}] PTC execution error:`,
        error instanceof Error
          ? {
              message: error.message,
              name: error.name,
              stack: error.stack?.split('\n').slice(0, 5).join('\n'),
            }
          : error,
      );
      yield {
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      };
    } finally {
      // Cleanup container on session end
      this.containerManager.remove(session.id);
    }

    yield { type: 'done' };
  }

  /**
   * Build the array of SDK tool definitions for PTC execution.
   * Mirrors the MCP server registration logic in executeGenerator() but returns
   * raw tool arrays instead of SDK server configs. Filtered by plan relevance.
   */
  private async buildPTCTools(
    sessionId: string,
    options: ExecuteOptions,
    relevantServers: Set<string>,
  ): Promise<PTCMcpToolDefinitions> {
    const tools: unknown[] = [];

    if (options.ptcMcpTools?.length) {
      tools.push(...options.ptcMcpTools);
      logger.info(
        `[Claude ${sessionId}] PTC: Added ${options.ptcMcpTools.length} explicit tools`,
      );
    }

    if (options.disablePolicyServers) {
      return tools as PTCMcpToolDefinitions;
    }

    // Add media/speech/ffmpeg tools only when relevant to plan
    if (relevantServers.has('media')) {
      tools.push(...mediaTools);
      logger.info(
        `[Claude ${sessionId}] PTC: Added ${mediaTools.length} media tools`,
      );
    }
    if (relevantServers.has('assets') && isAssetsCatalogEnabled()) {
      tools.push(...assetsTools);
      logger.info(
        `[Claude ${sessionId}] PTC: Added ${assetsTools.length} asset catalog tools`,
      );
    }
    if (relevantServers.has('speech')) {
      tools.push(...speechTools);
      logger.info(
        `[Claude ${sessionId}] PTC: Added ${speechTools.length} speech tools`,
      );
    }
    if (relevantServers.has('ffmpeg')) {
      tools.push(...ffmpegTools);
      logger.info(
        `[Claude ${sessionId}] PTC: Added ${ffmpegTools.length} ffmpeg tools`,
      );
    }

    // Add Linear tools if enabled and relevant to plan
    if (relevantServers.has('linear')) {
      try {
        const linearConfig = getLinearConfig();
        if (linearConfig.linearEnabled && linearConfig.apiKey) {
          tools.push(...linearTools);
          logger.info(
            `[Claude ${sessionId}] PTC: Added ${linearTools.length} Linear tools`,
          );
        }
      } catch {
        // Linear config not loaded yet, skip
      }
    }

    // Add Memory tools if enabled and selected.
    if (relevantServers.has('memory')) {
      try {
        const memoryConfig = getMemoryConfig();
        if (memoryConfig.enabled) {
          tools.push(...memoryTools(getEmbedOptions(memoryConfig)));
          logger.info(`[Claude ${sessionId}] PTC: Added memory tools`);
        }
      } catch {
        // Memory config not loaded yet, skip
      }
    }

    // Add Schedule tools when selected. Only creation is tier-gated
    // (inside the schedule_create tool) — manage tools stay available.
    if (relevantServers.has('schedule')) {
      const scheduleGate = this.gateConnector(
        'schedule_create',
        options?.channelContext,
        options?.locale,
      );
      try {
        tools.push(
          ...scheduleTools({
            sessionId,
            channelContext: options?.channelContext,
            locale: options?.locale,
            allowCreate: scheduleGate.allow,
          }),
        );
        logger.info(
          `[Claude ${sessionId}] PTC: Added schedule tools (create ${scheduleGate.allow ? 'allowed' : 'denied'})`,
        );
      } catch (err) {
        logger.warn('Failed to add schedule tools:', err);
      }
    }

    if (relevantServers.has('publish') && isAgentPublishPipelineEnabled()) {
      tools.push(
        ...publishTools({
          featureEnabled: isAgentPublishPipelineEnabled,
          caller: options.channelContext
            ? {
                ...options.channelContext,
                locale: options.locale ?? options.channelContext.locale,
              }
            : { platform: 'desktop', human: true },
        }),
      );
      logger.info(
        `[Claude ${sessionId}] PTC: Added ${PUBLISH_TOOL_NAMES.length} publish tools`,
      );
    }

    // Add Google tools if authenticated and relevant to plan
    if (
      relevantServers.has('google') &&
      this.gateConnector('google', options?.channelContext, options?.locale)
        .allow
    ) {
      try {
        const googleToken = await getValidAccessToken('google');
        if (googleToken) {
          const grantedScopes = await getGrantedScopes('google');
          const filteredGoogleTools = filterToolsByScopes(grantedScopes);
          if (filteredGoogleTools.length > 0) {
            tools.push(...filteredGoogleTools);
            logger.info(
              `[Claude ${sessionId}] PTC: Added ${filteredGoogleTools.length} Google tools`,
            );
          }
        }
      } catch {
        // Google auth not available, skip
      }
    }

    return tools as PTCMcpToolDefinitions;
  }

  /**
   * Sanitize SDK text. Whole-message replacement only fires when the text
   * looks like an error envelope (≤400 chars) — long LLM replies that
   * mention auth keywords in passing must not be clobbered.
   */
  private sanitizeText(text: string): string {
    let sanitized = text;

    // Replace "Claude Code process exited with code X" with a special marker
    // The marker will be replaced with localized text on the frontend.
    sanitized = sanitized.replace(
      /Claude Code process exited with code \d+/gi,
      '__AGENT_PROCESS_ERROR__',
    );

    // Remove "Please run /login" messages — not relevant for custom API users.
    sanitized = sanitized.replace(/\s*[·•\-–—]\s*Please run \/login\.?/gi, '');
    sanitized = sanitized.replace(/Please run \/login\.?/gi, '');

    if (sanitized.length <= 400) {
      // Anchored patterns matching real Anthropic SDK error shapes only,
      // not arbitrary prose that happens to mention auth keywords.
      const apiKeyErrorPatterns = [
        /^\s*(?:Error:?\s*)?(?:HTTP\s*)?(?:401\s*)?Invalid API key\b/im,
        /\b"?(?:type|code)"?\s*[:=]\s*"?invalid_api_key/i,
        /^\s*(?:Error:?\s*)?(?:HTTP\s*)?401\s+Unauthorized\b/im,
        /^\s*(?:Error:?\s*)?Authentication failed\b/im,
        /^\s*(?:错误[:：]?\s*)?身份验证失败/m,
        /^\s*(?:错误[:：]?\s*)?认证失败/m,
        /^\s*(?:错误[:：]?\s*)?鉴权失败/m,
        /^\s*(?:错误[:：]?\s*)?密钥无效/m,
      ];

      if (apiKeyErrorPatterns.some((p) => p.test(sanitized))) {
        return '__API_KEY_ERROR__';
      }

      // If no API key is configured and process exited, this is likely an
      // auth issue. Show the API key configuration prompt instead of a
      // generic process error.
      const noApiKeyConfigured =
        !this.config.apiKey &&
        !process.env.ANTHROPIC_API_KEY &&
        !process.env.ANTHROPIC_AUTH_TOKEN;

      if (noApiKeyConfigured && sanitized.includes('__AGENT_PROCESS_ERROR__')) {
        return '__API_KEY_ERROR__';
      }
    }

    return sanitized;
  }

  /**
   * Process SDK messages and convert to AgentMessage format
   */
  private *processMessage(
    message: unknown,
    sessionId: string,
    sentTextHashes: DeduplicationSet,
    sentToolIds: DeduplicationSet,
    taskId?: string,
    toolNames?: Map<string, string>,
    abortController?: AbortController,
  ): Generator<AgentMessage> {
    const msg = message as {
      type: string;
      message?: {
        content?: unknown[];
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      subtype?: string;
      total_cost_usd?: number;
      duration_ms?: number;
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        cache_read_input_tokens?: number;
        cache_creation_input_tokens?: number;
      };
      structured_output?: unknown;
    };

    // Handle SDK rate limit events — pass to frontend for countdown UI
    if (msg.type === 'rate_limit_event') {
      const rlMsg = message as {
        type: string;
        rate_limit_info?: {
          status?: 'allowed' | 'allowed_warning' | 'rejected';
          resetsAt?: number;
          utilization?: number;
          rateLimitType?: string;
        };
      };
      const info = rlMsg.rate_limit_info;
      if (
        info &&
        (info.status === 'rejected' || info.status === 'allowed_warning')
      ) {
        yield {
          type: 'system',
          subtype: 'rate_limit',
          content:
            info.status === 'rejected'
              ? `Rate limited — resets at ${info.resetsAt ? new Date(info.resetsAt * 1000).toLocaleTimeString() : 'unknown'}`
              : `Approaching rate limit (${Math.round((info.utilization ?? 0) * 100)}% used)`,
          isProgress: true,
        };
      }
    }

    if (msg.type === 'assistant' && msg.message?.content) {
      for (const block of msg.message.content as Record<string, unknown>[]) {
        if ('text' in block) {
          const sanitizedText = this.sanitizeText(block.text as string);
          const textHash = claudeStreamTextDedupeKey(sanitizedText);
          if (!sentTextHashes.has(textHash)) {
            sentTextHashes.add(textHash);
            logger.info(
              `[${sessionId}] Text: ${sanitizedText.slice(0, 80)}...`,
            );
            yield { type: 'text', content: sanitizedText };
          }
        } else if ('name' in block && 'id' in block) {
          const toolId = block.id as string;
          if (!sentToolIds.has(toolId)) {
            sentToolIds.add(toolId);
            toolNames?.set(toolId, block.name as string);
            logger.info(`[${sessionId}] Tool: ${block.name}`);
            yield {
              type: 'tool_use',
              id: toolId,
              name: block.name as string,
              input: block.input,
            };
          }
        }
      }
    }

    // Track user message UUIDs for file rewind targeting
    if (msg.type === 'user') {
      const userMsg = message as { uuid?: string };
      if (userMsg.uuid) {
        yield {
          type: 'system',
          subtype: 'user_checkpoint',
          id: userMsg.uuid,
          isProgress: true,
        };
      }
    }

    if (
      msg.type === 'user' &&
      msg.message?.content &&
      Array.isArray(msg.message.content)
    ) {
      for (const rawBlock of msg.message.content) {
        // Content items can arrive as plain strings (older SDK message shapes
        // or streamed raw text) — skip anything that isn't an object before
        // the `in` operator would throw.
        if (!rawBlock || typeof rawBlock !== 'object') continue;
        const block = rawBlock as Record<string, unknown>;
        if ('type' in block && block.type === 'tool_result') {
          const toolUseIdSnake = (block as { tool_use_id?: unknown })
            .tool_use_id;
          const toolUseIdCamel = (block as { toolUseId?: unknown }).toolUseId;
          const isErrorSnake = (block as { is_error?: unknown }).is_error;
          const isErrorCamel = (block as { isError?: unknown }).isError;
          const toolUseId = toolUseIdSnake ?? toolUseIdCamel;
          const rawIsError = isErrorSnake ?? isErrorCamel;
          const isError = typeof rawIsError === 'boolean' ? rawIsError : false;

          const rawOutput =
            typeof block.content === 'string'
              ? block.content
              : JSON.stringify(block.content);
          // Apply display-side truncation (SDK handles model-side internally)
          const resolvedToolName =
            toolNames?.get(String(toolUseId)) ?? 'default';
          const { result: displayOutput, truncated } = limitForDisplay(
            resolvedToolName,
            rawOutput,
          );
          if (truncated) {
            logger.info(
              `[${sessionId}] Tool result truncated for display: ${rawOutput.length} → ${displayOutput.length} chars`,
            );
          }
          // Surface a compact preview of the tool result instead of a bare
          // toolu_id — makes log triage drastically faster. Per Claude Agent
          // SDK guidance (see AgentSDK "Structured logging for observability"),
          // log the tool name, success/error, size, and a trimmed one-line
          // excerpt; never dump the full payload.
          const resultStatus = isError ? 'ERROR' : 'ok';
          const previewLen = isError ? 400 : 200;
          const flat = String(rawOutput).replace(/\s+/g, ' ').trim();
          const preview =
            flat.length > previewLen ? flat.slice(0, previewLen) + '…' : flat;
          logger.info(
            `[${sessionId}] Tool result ${resultStatus} ${resolvedToolName} (${rawOutput.length}B, id=${String(toolUseId).slice(-8)}): ${preview}`,
          );
          yield {
            type: 'tool_result',
            toolUseId: (toolUseId ?? '') as string,
            output: displayOutput,
            isError,
          };

          const isSdkControlError =
            isError &&
            SDK_CONTROL_CHANNEL_ERROR_PATTERNS.some((p) => flat.includes(p));
          if (isSdkControlError) {
            const next = (this.sdkControlErrorCounts.get(sessionId) ?? 0) + 1;
            this.sdkControlErrorCounts.set(sessionId, next);
            if (next >= SDK_CONTROL_CHANNEL_ERROR_THRESHOLD) {
              logger.error(
                `[${sessionId}] Aborting run after ${next} SDK control-channel errors (latest: ${resolvedToolName} — "${preview}")`,
              );
              this.sdkControlErrorCounts.delete(sessionId);
              yield {
                type: 'error',
                message:
                  'The agent SDK control channel closed mid-run. Start a new conversation to continue.',
                subtype: 'sdk_control_channel_closed',
              };
              // `return` only ends this nested generator — abort to break the outer `for await`.
              abortController?.abort();
              return;
            }
          }
        }
      }
    }

    // Handle structured output from SDK
    if (msg.type === 'result' && msg.structured_output) {
      yield {
        type: 'result',
        content: JSON.stringify(msg.structured_output, null, 2),
        subtype: 'structured',
      };
    }

    // Handle SDK budget exceeded error
    if (msg.type === 'result' && msg.subtype === 'error_max_budget_usd') {
      logger.warn(`[${sessionId}] SDK budget limit reached`);
      yield {
        type: 'error',
        message: 'Session budget limit reached',
        subtype: 'budget_exceeded',
      };
    }

    if (msg.type === 'result') {
      const terminalReason: string | undefined = (
        msg as typeof msg & { terminal_reason?: string }
      ).terminal_reason;
      logger.info(
        `[${sessionId}] Result: ${msg.subtype}, terminal_reason=${terminalReason ?? 'n/a'}, cost=${msg.total_cost_usd}, usage=${JSON.stringify(msg.usage)}`,
      );

      const resultUsageDetails = (
        msg.usage as
          | {
              output_tokens_details?: {
                thinking_tokens?: number;
              } | null;
            }
          | undefined
      )?.output_tokens_details;
      logUsage({
        sessionId,
        taskId,
        callType: 'agent',
        provider: 'anthropic',
        model: this.config.model ?? DEFAULT_CLAUDE_MODEL,
        totalCostUsd: msg.total_cost_usd,
        inputTokens: msg.usage?.input_tokens,
        outputTokens: msg.usage?.output_tokens,
        reasoningOutputTokens: resultUsageDetails?.thinking_tokens,
        outputTokensDetails: resultUsageDetails,
        cacheReadTokens: msg.usage?.cache_read_input_tokens,
        cacheCreationTokens: msg.usage?.cache_creation_input_tokens,
        latencyMs: msg.duration_ms,
        metadata: {
          phase: 'execution',
          subtype: msg.subtype,
          ...(terminalReason ? { terminal_reason: terminalReason } : {}),
        },
      });

      yield {
        type: 'result',
        subtype: msg.subtype,
        content: msg.subtype,
        cost: this.effectiveCost(msg.total_cost_usd),
        duration: msg.duration_ms,
        terminalReason,
        usage: msg.usage
          ? {
              input_tokens: msg.usage.input_tokens,
              output_tokens: msg.usage.output_tokens,
              reasoning_output_tokens: resultUsageDetails?.thinking_tokens,
              cache_read_input_tokens: msg.usage.cache_read_input_tokens,
              cache_creation_input_tokens:
                msg.usage.cache_creation_input_tokens,
            }
          : undefined,
      };
    }

    // Handle SDK system events (compact_boundary, sub-agent lifecycle)
    if (msg.type === 'system') {
      const sysMsg = message as {
        type: string;
        subtype?: string;
        compact_metadata?: { trigger?: string; pre_tokens?: number };
        task_id?: string;
        description?: string;
        tool_use_id?: string;
      };

      // SDKFilesPersistedEvent — informational, shows which files are tracked
      if (sysMsg.subtype === 'files_persisted') {
        const filesMsg = message as { files?: unknown[] };
        const fileCount = filesMsg.files?.length ?? 0;
        logger.info(
          `[${sessionId}] File checkpoint: ${fileCount} file(s) tracked`,
        );
        yield {
          type: 'system' as AgentMessage['type'],
          content: `File checkpoint: ${fileCount} file${fileCount !== 1 ? 's' : ''} tracked`,
          subtype: 'file_checkpoint',
          isProgress: true,
        };
      } else if (sysMsg.subtype === 'compact_boundary') {
        const preTokens = sysMsg.compact_metadata?.pre_tokens ?? 0;
        logger.info(
          `[${sessionId}] Context compressed — ${preTokens} tokens freed`,
        );
        yield {
          type: 'system',
          subtype: 'compact_boundary',
          content: `Context compressed — ${preTokens} tokens freed`,
          isProgress: true,
        };
      } else if (sysMsg.subtype === 'task_started') {
        // Combine description (for display) with task_id (for uniqueness).
        // AG-UI uses stepName as the active-step identity key, so sibling
        // sub-agents sharing a description (e.g. two "Wait 15s between polls"
        // pollers) would otherwise collide and fail STEP_STARTED validation.
        const stepName = buildSubAgentStepName(
          sysMsg.description,
          sysMsg.task_id,
        );
        logger.info(`[${sessionId}] Sub-agent started: ${stepName}`);
        yield {
          type: 'step_started',
          stepName,
          id: sysMsg.task_id,
          parentToolUseId: sysMsg.tool_use_id,
        };
      } else if (sysMsg.subtype === 'task_notification') {
        const notifMsg = message as {
          type: string;
          subtype?: string;
          task_id?: string;
          description?: string;
          tool_use_id?: string;
          status?: string;
          usage?: {
            total_tokens?: number;
            duration_ms?: number;
            tool_uses?: number;
          };
        };
        const stepName = buildSubAgentStepName(
          sysMsg.description,
          sysMsg.task_id,
        );
        logger.info(`[${sessionId}] Sub-agent finished: ${stepName}`);
        yield {
          type: 'step_finished',
          stepName,
          id: sysMsg.task_id,
          parentToolUseId: sysMsg.tool_use_id,
          subtype: notifMsg.status,
          duration: notifMsg.usage?.duration_ms,
          usage: notifMsg.usage
            ? {
                input_tokens: notifMsg.usage.total_tokens,
                output_tokens: undefined,
              }
            : undefined,
        };
      } else if (sysMsg.subtype === 'task_progress') {
        const progressTaskMsg = message as {
          type: string;
          subtype?: string;
          task_id?: string;
          tool_use_id?: string;
          usage?: { total_tokens?: number; duration_ms?: number };
        };
        yield {
          type: 'system' as AgentMessage['type'],
          subtype: 'task_progress',
          id: progressTaskMsg.task_id,
          parentToolUseId: progressTaskMsg.tool_use_id,
          isProgress: true,
          usage: progressTaskMsg.usage
            ? {
                input_tokens: progressTaskMsg.usage.total_tokens,
                output_tokens: undefined,
              }
            : undefined,
        };
      }
    }

    // Handle SDK tool progress events
    if (msg.type === 'tool_progress') {
      const progressMsg = message as {
        type: string;
        tool_use_id?: string;
        tool_name?: string;
        parent_tool_use_id?: string | null;
        elapsed_time_seconds?: number;
      };
      yield {
        type: 'tool_progress',
        id: progressMsg.tool_use_id,
        name: progressMsg.tool_name,
        content: `${progressMsg.tool_name} running (${progressMsg.elapsed_time_seconds?.toFixed(0) ?? '?'}s)`,
        isProgress: true,
      };
    }
  }
}

/**
 * Factory function to create Claude agent
 */
export function createClaudeAgent(config: AgentConfig): ClaudeAgent {
  return new ClaudeAgent(config);
}

/**
 * Claude agent plugin definition
 */
export const claudePlugin: AgentPlugin = defineAgentPlugin({
  metadata: CLAUDE_METADATA,
  factory: (config) => createClaudeAgent(config),
});
