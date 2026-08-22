/**
 * Codex Agent Adapter
 *
 * Uses @openai/codex-sdk for programmatic access to the Codex CLI binary.
 * Context (user preferences, memories, profile) is pre-resolved by the
 * service layer and passed in via AgentOptions.systemContext — this adapter
 * never reads from the DB directly.
 *
 * Context injection: prepended to first user message (Codex SDK has no
 * separate systemPrompt parameter).
 */

import { existsSync } from 'fs';
import { copyFile as copyFileFn, mkdir } from 'fs/promises';
import { homedir } from 'os';
import { basename, join, resolve as resolvePath, sep } from 'path';

import { Codex } from '@openai/codex-sdk';
import type {
  ItemCompletedEvent,
  ModelReasoningEffort,
  ThreadEvent,
} from '@openai/codex-sdk';

import {
  ASK_USER_QUESTION_INSTRUCTION,
  buildAskUserQuestionToolUse,
  tryExtractAskUserQuestion,
} from '@/core/agent/ask-user-question';
import {
  BaseAgent,
  getWorkspaceInstruction,
  isConversationalPrompt,
  type SandboxOptions,
} from '@/core/agent/base';
import { CODEX_METADATA, defineAgentPlugin } from '@/core/agent/plugin';
import type { AgentPlugin } from '@/core/agent/plugin';
import type {
  AdapterEnvironmentReport,
  AgentConfig,
  AgentMessage,
  AgentOptions,
  AgentProvider,
  ConversationMessage,
  ExecuteOptions,
  PlanOptions,
  TaskPlan,
} from '@/core/agent/types';

import {
  DEFAULT_API_HOST,
  DEFAULT_API_PORT,
  DEFAULT_WORK_DIR,
} from '@/config/constants';

import {
  type SubprocessMcpConfig,
  buildSubprocessMcpConfig,
} from '@/shared/mcp/subprocess-bridge';
import { defendToolOutput } from '@/shared/security/tool-output-defense';
import { logUsage } from '@/shared/services/usage-logger';
import {
  getExtendedPath,
  resolveCodexBinaryPath,
} from '@/shared/utils/codex-binary';
import { createLogger } from '@/shared/utils/logger';
import { expandPath } from '@/shared/utils/paths';

import { resolveCodexApiKey, resolveCodexOpenAiBaseUrl } from './auth';

const logger = createLogger('Codex');

const isDev = !process.env.NODE_ENV || process.env.NODE_ENV === 'development';
const API_PORT =
  process.env.PORT || (isDev ? '5126' : String(DEFAULT_API_PORT));
const SANDBOX_API_URL = `http://${DEFAULT_API_HOST}:${API_PORT}`;

// ============================================================================
// Helpers
// ============================================================================

/**
 * Get or create a working directory for the session.
 */
async function getSessionWorkDir(
  _workDir: string | undefined,
  prompt: string,
  taskId?: string,
): Promise<string> {
  // Always create sessions under the app data directory (DEFAULT_WORK_DIR) to avoid
  // polluting user-specified work folders with session artifacts. expandPath handles
  // ~ in configured paths. The workDir argument is kept for call-site compatibility;
  // the user's project cwd is applied separately via agent options, not as this root.
  const base = expandPath(DEFAULT_WORK_DIR);

  // Use sessions/ intermediate directory for consistency with Claude adapter.
  // Prefer taskId-based naming over prompt slug for stability.
  const sessionsDir = join(base, 'sessions');
  const folderName = taskId
    ? `session-${taskId}`
    : `session-${
        prompt
          .slice(0, 40)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '') || crypto.randomUUID()
      }`;
  const resolved = resolvePath(join(sessionsDir, folderName));
  const resolvedBase = resolvePath(base);
  if (!resolved.startsWith(resolvedBase + sep)) {
    throw new Error('Invalid session path');
  }
  if (!existsSync(resolved)) {
    await mkdir(resolved, { recursive: true });
  }
  return resolved;
}

/**
 * Map our thinkingConfig effort to Codex SDK's ModelReasoningEffort.
 * Our 'max' maps to Codex 'xhigh'; others map directly.
 */
function mapReasoningEffort(
  thinkingConfig?: AgentOptions['thinkingConfig'],
): ModelReasoningEffort | undefined {
  if (!thinkingConfig || thinkingConfig.type === 'disabled') return undefined;
  const effort = thinkingConfig.effort;
  if (!effort) return undefined;
  return effort; // 'low' | 'medium' | 'high' | 'xhigh' | 'max' all map directly
}

/**
 * Extract the underlying model name from a 'codex:<model>' prefixed ID.
 * 'codex:o3' → 'o3', 'codex:gpt-5.3-codex' → 'gpt-5.3-codex', 'codex' → undefined
 */
function extractModelName(model?: string): string | undefined {
  if (!model) return undefined;
  if (model.startsWith('codex:')) return model.slice(6) || undefined;
  return undefined;
}

// Eagerly resolve at module load so the two execSync calls (login shell
// probes, up to 10 s total) run at startup rather than blocking the
// event loop on the first Codex agent request.
resolveCodexBinaryPath();

/**
 * Build a Codex client with explicit env forwarding.
 * CRITICAL: @openai/codex-sdk replaces process.env entirely when env is set.
 * We must explicitly forward PATH, HOME, and the selected API key.
 *
 * Subscription auth: when no API key is provided, the Codex CLI reads OAuth
 * tokens from ~/.codex/auth.json. Setting OPENAI_API_KEY="" in env would
 * override that flow, so we only include it when an actual key exists.
 */
function createCodexClient(
  config: AgentConfig,
  bridge?: SubprocessMcpConfig,
): Codex {
  const modelName = extractModelName(config.model);
  // Pass codexPathOverride to bypass the SDK's require.resolve() lookup,
  // which fails inside pkg binaries (vendor binaries aren't in the VFS).
  const codexPath = resolveCodexBinaryPath();
  if (!codexPath) {
    throw new Error(
      'Codex CLI binary not found. Install it with: npm install -g @openai/codex',
    );
  }
  const resolvedApiKey = resolveCodexApiKey(config);
  const openAiBaseUrl = resolveCodexOpenAiBaseUrl(config);
  // Merge model override with the subprocess MCP bridge config (Google,
  // Notion, …). The SDK flattens nested objects into `--config key=value`
  // overrides, so `mcp_servers.google.url = "..."` reaches the CLI verbatim.
  const codexConfig: Record<string, unknown> = {
    ...(modelName ? { model: modelName } : {}),
    ...(bridge?.codexConfig ?? {}),
  };
  logger.info('Creating Codex client', {
    model: modelName,
    hasApiKey: !!resolvedApiKey.apiKey,
    apiKeySource: resolvedApiKey.source,
    codexPath,
    authMode: resolvedApiKey.apiKey ? 'api-key' : 'subscription',
    bridgeConnectors: Object.keys(bridge?.codexConfig?.mcp_servers ?? {}),
  });
  return new Codex({
    ...(resolvedApiKey.apiKey ? { apiKey: resolvedApiKey.apiKey } : {}),
    codexPathOverride: codexPath,
    ...(Object.keys(codexConfig).length > 0
      ? { config: codexConfig as never }
      : {}),
    env: {
      // Only set OPENAI_API_KEY when one is actually available — an empty
      // string would block the CLI's subscription/OAuth auth flow.
      ...(resolvedApiKey.apiKey
        ? {
            CODEX_API_KEY: resolvedApiKey.apiKey,
            ...(openAiBaseUrl ? { OPENAI_API_KEY: resolvedApiKey.apiKey } : {}),
          }
        : {}),
      ...(openAiBaseUrl ? { OPENAI_BASE_URL: openAiBaseUrl } : {}),
      PATH: getExtendedPath(),
      HOME: process.env.HOME ?? homedir(),
      TMPDIR: process.env.TMPDIR ?? '/tmp',
      ...(process.env.NODE_ENV ? { NODE_ENV: process.env.NODE_ENV } : {}),
      // Pass proxy settings if configured
      ...(process.env.HTTP_PROXY ? { HTTP_PROXY: process.env.HTTP_PROXY } : {}),
      ...(process.env.HTTPS_PROXY
        ? { HTTPS_PROXY: process.env.HTTPS_PROXY }
        : {}),
      // Bridge bearer tokens for connectors the policy approved this run.
      ...(bridge?.env ?? {}),
    },
  });
}

/**
 * Fold connector-policy denial copy into the prompt so the agent emits the
 * canonical refusal verbatim if the user asks for a blocked connector
 * (mirrors the Claude adapter's denialHints behaviour).
 */
function applyDenialHints(prompt: string, denialHints: string[]): string {
  if (denialHints.length === 0) return prompt;
  return `${denialHints.join('\n')}\n\n${prompt}`;
}

/**
 * AskUserQuestion bridge wiring.
 *
 * Codex CLI has no native AskUserQuestion tool, so we route the same
 * Anthropic-style interactive question UX through a text protocol: the
 * model emits a fenced JSON block and this adapter re-emits it as a
 * synthetic `tool_use` AG-UI event. All of the parsing, instruction text,
 * and event construction lives in `@/core/agent/ask-user-question` and is
 * shared with the other adapters that have no native tool channel.
 */

/**
 * Build the thread options bag shared by run/plan-conversational/execute.
 * Centralised so the `approvalPolicy: 'never'` rationale (MCP tool calls
 * auto-cancel under exec-mode default approval — see subprocess-bridge for
 * details) lives in one place.
 */
function buildThreadOptions(args: {
  sessionCwd: string;
  sandboxEnabled: boolean;
  reasoningEffort: ModelReasoningEffort | undefined;
}): Parameters<Codex['startThread']>[0] {
  return {
    workingDirectory: args.sessionCwd,
    sandboxMode: args.sandboxEnabled ? 'danger-full-access' : 'workspace-write',
    // `workspace-write` denies outbound network by default, which fails any
    // fetching tool (yt-dlp, curl) with DNS resolution errors rather than a
    // permission error. Grant network explicitly while keeping the filesystem
    // restriction that `workspace-write` provides.
    networkAccessEnabled: true,
    skipGitRepoCheck: true,
    approvalPolicy: 'never',
    ...(args.reasoningEffort
      ? { modelReasoningEffort: args.reasoningEffort }
      : {}),
  };
}

function createCodexThread(
  codex: Codex,
  threadOptions: Parameters<Codex['startThread']>[0],
  resumeSessionId?: string,
) {
  const durableThreadId = resumeSessionId?.trim();
  if (durableThreadId) {
    return codex.resumeThread(durableThreadId, threadOptions);
  }
  return codex.startThread(threadOptions);
}

/**
 * Format conversation history + current prompt.
 * Caps history to last 20 messages to avoid exceeding context limits.
 */
function formatConversationPrompt(
  conversation: ConversationMessage[] | undefined,
  prompt: string,
): string {
  if (!conversation || conversation.length === 0) return prompt;
  const recent = conversation.slice(-20);
  const history = recent
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n');
  return `## Previous Conversation Context\n${history}\n\n## Current Request\n${prompt}`;
}

/**
 * Render an MCP tool call's result/error into the human-visible text shown
 * in the tool-result panel. Codex's internal context still receives the raw
 * structured payload — this is only for the UI stream.
 */
function formatMcpToolOutput(
  item: Extract<ItemCompletedEvent['item'], { type: 'mcp_tool_call' }>,
): string {
  if (item.error?.message) return `Error: ${item.error.message}`;
  const blocks = item.result?.content ?? [];
  if (blocks.length === 0) {
    return item.status === 'failed'
      ? 'Tool call failed'
      : 'Tool call completed';
  }
  const parts: string[] = [];
  for (const block of blocks as Array<Record<string, unknown>>) {
    if (block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text);
    } else if (block.type === 'image' && typeof block.mimeType === 'string') {
      parts.push(`[image: ${block.mimeType}]`);
    } else if (block.type === 'audio' && typeof block.mimeType === 'string') {
      parts.push(`[audio: ${block.mimeType}]`);
    } else {
      parts.push(JSON.stringify(block));
    }
  }
  return parts.join('\n');
}

/**
 * Map a Codex SDK ItemCompletedEvent item to AgentMessages.
 * @param cwd - Working directory for resolving relative file paths
 */
function* mapItemCompleted(
  event: ItemCompletedEvent,
  cwd: string,
): Iterable<AgentMessage> {
  const item = event.item;
  switch (item.type) {
    case 'agent_message': {
      if (!item.text) break;
      const askUser = tryExtractAskUserQuestion(item.text);
      if (askUser) {
        // Bridge to the existing AskUserQuestion UI: emit a synthetic tool_use
        // event so `useAgent.ts` pauses the run and renders QuestionInput.
        yield buildAskUserQuestionToolUse(askUser);
        break;
      }
      yield { type: 'text', content: item.text };
      break;
    }
    case 'reasoning':
      if (item.text) {
        yield { type: 'thinking', content: item.text };
      }
      break;
    case 'command_execution': {
      const toolId = crypto.randomUUID();
      yield {
        type: 'tool_use',
        name: 'Bash',
        id: toolId,
        input: { command: item.command },
      };
      if (item.aggregated_output) {
        // Phase 7: codex runs its own internal tool loop (re-entry happens
        // inside the codex process), so this is a display-redaction layer.
        // BLOCK still rewrites the displayed text so the user is not shown
        // raw injected content harvested through the adapter boundary.
        const defended = defendToolOutput({
          source: {
            adapter: 'codex',
            toolName: 'Bash',
            toolUseId: toolId,
          },
          content: item.aggregated_output,
          riskHint: 'high',
        });
        yield {
          type: 'tool_result',
          toolUseId: toolId,
          output: defended.displayContent,
          isError:
            (item.exit_code !== undefined && item.exit_code !== 0) ||
            defended.verdict === 'BLOCK',
          security: {
            verdict: defended.verdict,
            source: 'codex',
            payloadHash: defended.audit.payloadHash,
            redactedSnippet: defended.redactedSnippet,
            scores: defended.scores as Record<string, number>,
          },
        };
      }
      break;
    }
    case 'file_change':
      for (const change of item.changes) {
        // Resolve to absolute path and use file_path (frontend expects this key)
        const absPath = change.path.startsWith('/')
          ? change.path
          : resolvePath(join(cwd, change.path));
        // Only emit if the file actually exists (avoids phantom entries)
        if (existsSync(absPath)) {
          const fileToolId = crypto.randomUUID();
          yield {
            type: 'tool_use',
            name: change.kind === 'add' ? 'Write' : 'Edit',
            id: fileToolId,
            input: { file_path: absPath },
          };
          yield {
            type: 'tool_result',
            toolUseId: fileToolId,
            output: `${change.kind === 'add' ? 'Created' : 'Modified'}: ${absPath}`,
            isError: false,
          };
        }
      }
      break;
    case 'web_search': {
      const searchToolId = crypto.randomUUID();
      yield {
        type: 'tool_use',
        name: 'WebSearch',
        id: searchToolId,
        input: { query: item.query },
      };
      yield {
        type: 'tool_result',
        toolUseId: searchToolId,
        output: 'Search completed',
        isError: false,
      };
      break;
    }
    case 'mcp_tool_call': {
      const mcpToolId = crypto.randomUUID();
      yield {
        type: 'tool_use',
        name: item.tool,
        id: mcpToolId,
        input: item.arguments as Record<string, unknown>,
      };
      yield {
        type: 'tool_result',
        toolUseId: mcpToolId,
        output: formatMcpToolOutput(item),
        isError: item.status === 'failed',
      };
      break;
    }
  }
}

/**
 * Wrap an event generator to filter duplicate consecutive text messages.
 * Codex SDK can emit multiple identical `agent_message` items per turn.
 */
function* deduplicateTextEvents(
  events: Iterable<AgentMessage>,
): Iterable<AgentMessage> {
  let lastTextContent: string | null = null;
  for (const msg of events) {
    if (msg.type === 'text' && msg.content) {
      if (msg.content === lastTextContent) continue; // exact duplicate
      lastTextContent = msg.content;
    } else {
      // Non-text event resets tracking (tool calls, results, etc.)
      if (msg.type !== 'thinking') lastTextContent = null;
    }
    yield msg;
  }
}

/**
 * Map a Codex SDK ThreadEvent to AgentMessages.
 */
function* mapSdkEvent(
  event: ThreadEvent,
  cwd: string,
  runSessionId?: string,
): Iterable<AgentMessage> {
  switch (event.type) {
    case 'thread.started':
      yield {
        type: 'session',
        sessionId: runSessionId,
        resumeSessionId: event.thread_id,
        cwd,
      };
      break;
    case 'item.completed':
      yield* mapItemCompleted(event, cwd);
      break;
    case 'turn.completed':
      if (event.usage) {
        yield {
          type: 'result',
          usage: {
            input_tokens: event.usage.input_tokens,
            output_tokens: event.usage.output_tokens,
            reasoning_output_tokens: event.usage.reasoning_output_tokens,
          },
        };
      }
      break;
    case 'error': {
      const errEvent = event as unknown as {
        error?: { message?: string; code?: string };
        message?: string;
      };
      const errMsg =
        errEvent.error?.message ?? errEvent.message ?? 'Codex error';
      logger.error('Codex SDK error event', {
        error: errEvent.error ?? errEvent.message,
        code: errEvent.error?.code,
      });
      yield { type: 'error', message: errMsg };
      break;
    }
    case 'turn.failed':
      yield {
        type: 'error',
        message:
          (event as unknown as { error?: { message?: string } }).error
            ?.message ?? 'Codex turn failed',
      };
      break;
  }
}

// ============================================================================
// Attachment helpers
// ============================================================================

/**
 * Parse an attached-files prefix block from a prompt, copy any files that
 * live outside `sessionCwd` into `sessionCwd/attachments/` using Node.js fs
 * (not Tauri), and return the prompt with updated paths.
 *
 * Accepts both prefix flavours:
 *   - `[ATTACHED FILES — READ permission granted …:\n- name: path]\n\n…`
 *     (current frontend format, used in both V1 and V2 submit paths)
 *   - `[Attached files:\n- name: path]\n\n…`
 *     (legacy format — still recognised so messages persisted before the
 *     prefix unification keep working on replay)
 *
 * Why: Codex runs in workspace-write sandbox mode, which restricts file access
 * to the working directory. Attached files dropped from outside the workspace
 * (e.g. ~/Downloads) won't be readable. The frontend copy can also fail due to
 * macOS sandbox restrictions on `tauri-plugin-fs`. This backend relocation uses
 * the API server's unrestricted filesystem access to ensure files land inside
 * the Codex working directory before the thread starts.
 */
const ATTACHED_FILES_PREFIX_RE =
  /^\[(?:ATTACHED FILES[^\n]*|Attached files:)\n([\s\S]*?)\]\n\n/;

async function relocateAttachmentsIntoWorkDir(
  prompt: string,
  sessionCwd: string,
): Promise<string> {
  const blockMatch = prompt.match(ATTACHED_FILES_PREFIX_RE);
  if (!blockMatch) return prompt;

  const attachmentsDir = join(sessionCwd, 'attachments');
  const rawLines = blockMatch[1]!.split('\n').filter((l) => l.startsWith('- '));
  let changed = false;
  const newLines: string[] = [];

  for (const line of rawLines) {
    // Format: "- {name}: {path}"
    const colonIdx = line.indexOf(': ');
    if (colonIdx === -1) {
      newLines.push(line);
      continue;
    }
    const name = line.slice(2, colonIdx);
    const filePath = line.slice(colonIdx + 2).trim();
    const resolvedPath = resolvePath(filePath);

    // Already inside sessionCwd — no relocation needed
    if (resolvedPath.startsWith(sessionCwd + sep)) {
      newLines.push(line);
      continue;
    }

    if (existsSync(resolvedPath)) {
      try {
        await mkdir(attachmentsDir, { recursive: true });
        const prefix = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
        const safeName = basename(name);
        const destPath = join(attachmentsDir, `${prefix}_${safeName}`);
        await copyFileFn(resolvedPath, destPath);
        newLines.push(`- ${name}: ${destPath}`);
        changed = true;
        logger.info(
          `Relocated attachment into workspace: ${resolvedPath} → ${destPath}`,
        );
      } catch (err) {
        logger.warn(`Failed to relocate attachment ${filePath}: ${err}`);
        newLines.push(line);
      }
    } else {
      logger.warn(`Attached file not found at path: ${filePath}`);
      newLines.push(line);
    }
  }

  if (!changed) return prompt;

  // Preserve whatever header the caller supplied (uppercase or legacy lowercase) —
  // only rewrite the body lines so the prompt flavour round-trips.
  const headerEnd = blockMatch[0].indexOf('\n');
  const header = blockMatch[0].slice(0, headerEnd);
  const newBlock = `${header}\n${newLines.join('\n')}]\n\n`;
  return prompt.replace(blockMatch[0], newBlock);
}

// ============================================================================
// CodexAgent
// ============================================================================

export class CodexAgent extends BaseAgent {
  readonly provider: AgentProvider = 'codex';

  private getCodexModel(): string | undefined {
    return extractModelName(this.config.model);
  }

  async *run(
    prompt: string,
    options?: AgentOptions,
  ): AsyncGenerator<AgentMessage> {
    const session = this.createSession('idle');

    // Mint MCP bridge tokens before any await that could throw — captured in
    // outer scope so finally{} can always revoke them.
    let bridge: SubprocessMcpConfig | undefined;

    try {
      const sessionCwd = await getSessionWorkDir(
        options?.cwd ?? this.config.workDir,
        prompt,
        options?.taskId,
      );

      // Emit session message with actual CWD so the API can update the task's work_dir
      yield { type: 'session', sessionId: session.id, cwd: sessionCwd };

      const sandboxOpts: SandboxOptions | undefined = options?.sandbox?.enabled
        ? {
            enabled: true,
            image: options.sandbox.image,
            apiEndpoint: options.sandbox.apiEndpoint || SANDBOX_API_URL,
          }
        : undefined;

      bridge = await buildSubprocessMcpConfig({
        sessionId: session.id,
        channelContext: options?.channelContext,
        locale: options?.locale ?? options?.channelContext?.locale,
      });

      // Context MUST be prepended — Codex SDK has no systemPrompt param.
      // buildPromptWithContext() prepends options.systemContext (resolved by service layer).
      const basePrompt =
        getWorkspaceInstruction(
          sessionCwd,
          sandboxOpts,
          options?.userWorkspaceDir,
          options?.allowWorkspaceWrite,
        ) +
        ASK_USER_QUESTION_INSTRUCTION +
        '\n\n' +
        this.buildPromptWithContext(prompt, options);

      const fullPrompt = applyDenialHints(
        await relocateAttachmentsIntoWorkDir(
          formatConversationPrompt(
            options?.resumeSessionId ? undefined : options?.conversation,
            basePrompt,
          ),
          sessionCwd,
        ),
        bridge.denialHints,
      );

      const abortSignal = options?.abortController?.signal;

      const codex = createCodexClient(this.config, bridge);
      const thread = createCodexThread(
        codex,
        buildThreadOptions({
          sessionCwd,
          sandboxEnabled: !!sandboxOpts?.enabled,
          reasoningEffort: mapReasoningEffort(options?.thinkingConfig),
        }),
        options?.resumeSessionId,
      );

      logger.debug(
        `[${session.id}] Starting Codex runStreamed with prompt length: ${fullPrompt.length}`,
      );
      const { events } = await thread.runStreamed(fullPrompt, {
        signal: abortSignal,
      });
      logger.debug(
        `[${session.id}] Codex runStreamed returned, iterating events...`,
      );

      let turnStartMs = 0;
      let eventCount = 0;
      for await (const event of events) {
        eventCount++;
        if (event.type === 'error' || event.type === 'turn.failed') {
          logger.warn(`[${session.id}] Event #${eventCount}: ${event.type}`, {
            detail: JSON.stringify(event).slice(0, 500),
          });
        } else {
          logger.debug(`[${session.id}] Event #${eventCount}: ${event.type}`);
        }
        if (abortSignal?.aborted) break;
        if (event.type === 'turn.started') {
          turnStartMs = Date.now();
        } else if (event.type === 'turn.completed') {
          logUsage({
            sessionId: session.id,
            taskId: options?.taskId,
            callType: 'agent',
            provider: 'openai',
            model:
              extractModelName(this.config.model) ??
              CODEX_METADATA.defaultModel,
            inputTokens:
              event.usage.input_tokens - event.usage.cached_input_tokens,
            outputTokens: event.usage.output_tokens,
            reasoningOutputTokens: event.usage.reasoning_output_tokens,
            cacheReadTokens: event.usage.cached_input_tokens || undefined,
            latencyMs: turnStartMs ? Date.now() - turnStartMs : undefined,
          });
        }
        yield* deduplicateTextEvents(
          mapSdkEvent(event, sessionCwd, session.id),
        );
      }
      logger.debug(
        `[${session.id}] Codex event loop finished. Total events: ${eventCount}`,
      );
    } catch (err) {
      logger.error(`[${session.id}] Error: ${err}`);
      yield {
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      };
    } finally {
      bridge?.revoke();
      this.sessions.delete(session.id);
      yield { type: 'done' };
    }
  }

  async *plan(
    prompt: string,
    options?: PlanOptions,
  ): AsyncGenerator<AgentMessage> {
    const session = this.createSession('planning');

    // Conversational prompts skip plan → approve → execute and stream directly.
    if (isConversationalPrompt(prompt)) {
      logger.info(
        `[${session.id}] Conversational prompt — skipping plan approval`,
      );
      yield { type: 'direct_answer' };

      let bridge: SubprocessMcpConfig | undefined;
      try {
        const sessionCwd = await getSessionWorkDir(
          options?.cwd ?? this.config.workDir,
          prompt,
          options?.taskId,
        );
        yield { type: 'session', sessionId: session.id, cwd: sessionCwd };
        const abortSignal = options?.abortController?.signal;
        bridge = await buildSubprocessMcpConfig({
          sessionId: session.id,
          channelContext: options?.channelContext,
          locale: options?.locale ?? options?.channelContext?.locale,
        });
        const codex = createCodexClient(this.config, bridge);
        const thread = createCodexThread(
          codex,
          buildThreadOptions({
            sessionCwd,
            sandboxEnabled: false,
            reasoningEffort: mapReasoningEffort(options?.thinkingConfig),
          }),
          options?.resumeSessionId,
        );
        const conversationalPrompt = applyDenialHints(
          await relocateAttachmentsIntoWorkDir(
            ASK_USER_QUESTION_INSTRUCTION +
              '\n\n' +
              this.buildPromptWithContext(prompt, options),
            sessionCwd,
          ),
          bridge.denialHints,
        );
        const { events } = await thread.runStreamed(conversationalPrompt, {
          signal: abortSignal,
        });
        let turnStartMs = 0;
        for await (const event of events) {
          if (abortSignal?.aborted) break;
          if (event.type === 'turn.started') {
            turnStartMs = Date.now();
          } else if (event.type === 'turn.completed') {
            logUsage({
              sessionId: session.id,
              taskId: options?.taskId,
              callType: 'agent',
              provider: 'openai',
              model:
                extractModelName(this.config.model) ??
                CODEX_METADATA.defaultModel,
              inputTokens:
                event.usage.input_tokens - event.usage.cached_input_tokens,
              outputTokens: event.usage.output_tokens,
              reasoningOutputTokens: event.usage.reasoning_output_tokens,
              cacheReadTokens: event.usage.cached_input_tokens || undefined,
              latencyMs: turnStartMs ? Date.now() - turnStartMs : undefined,
              metadata: { phase: 'conversational' },
            });
          }
          yield* deduplicateTextEvents(
            mapSdkEvent(event, sessionCwd, session.id),
          );
        }
      } catch (err) {
        logger.error(`[${session.id}] Error: ${err}`);
        yield {
          type: 'error',
          message: err instanceof Error ? err.message : String(err),
        };
      } finally {
        bridge?.revoke();
        this.sessions.delete(session.id);
        yield { type: 'done' };
      }
      return;
    }

    yield { type: 'session', sessionId: session.id };

    const modelName = this.getCodexModel();
    const modelLabel = modelName ? ` (${modelName})` : '';

    // Codex handles planning internally — emit a simple plan and let execute do the work
    const plan: TaskPlan = {
      id: crypto.randomUUID(),
      goal: prompt,
      executionMode: 'standard',
      steps: [
        {
          id: '1',
          description: `Execute task with Codex${modelLabel}`,
          status: 'pending' as const,
        },
      ],
      notes: 'Codex CLI will autonomously plan and execute the task.',
      createdAt: new Date(),
    };

    try {
      this.storePlan(plan);
      yield { type: 'plan', plan };
    } finally {
      this.sessions.delete(session.id);
      yield { type: 'done' };
    }
  }

  async *execute(options: ExecuteOptions): AsyncGenerator<AgentMessage> {
    const session = this.createSession('executing');

    const plan = options.plan || this.getPlan(options.planId);
    if (!plan) {
      yield { type: 'session', sessionId: session.id };
      yield { type: 'error', message: `Plan not found: ${options.planId}` };
      yield { type: 'done' };
      return;
    }

    let bridge: SubprocessMcpConfig | undefined;

    try {
      const sessionCwd = await getSessionWorkDir(
        this.config.workDir || options.cwd,
        options.originalPrompt,
        options.taskId,
      );
      yield { type: 'session', sessionId: session.id, cwd: sessionCwd };

      const sandboxOpts: SandboxOptions | undefined = options.sandbox?.enabled
        ? {
            enabled: true,
            image: options.sandbox.image,
            apiEndpoint: options.sandbox.apiEndpoint || SANDBOX_API_URL,
          }
        : undefined;

      bridge = await buildSubprocessMcpConfig({
        sessionId: session.id,
        channelContext: options.channelContext,
        locale: options.locale ?? options.channelContext?.locale,
        // Project-scoped in-process servers (e.g. Video Mode tools) the caller
        // wants reachable from the Codex CLI over the loopback bridge.
        inProcessServers: options.bridgeInProcessServers,
        // Honor disablePolicyServers: when the caller scopes the run to its own
        // in-process servers (Video Mode), don't also expose the global
        // connector bridges (google/composio/assets) — match the direct path.
        ...(options.disablePolicyServers ? { connectors: [] } : {}),
      });

      // Codex handles its own planning — pass original prompt, not formatted plan steps.
      const basePrompt =
        getWorkspaceInstruction(
          sessionCwd,
          sandboxOpts,
          options.userWorkspaceDir,
          options.allowWorkspaceWrite,
        ) +
        ASK_USER_QUESTION_INSTRUCTION +
        '\n\n' +
        this.buildPromptWithContext(options.originalPrompt, options);

      const executionPrompt = applyDenialHints(
        await relocateAttachmentsIntoWorkDir(
          formatConversationPrompt(
            options.resumeSessionId ? undefined : options.conversation,
            basePrompt,
          ),
          sessionCwd,
        ),
        bridge.denialHints,
      );

      const abortSignal = options.abortController?.signal;

      const codex = createCodexClient(this.config, bridge);
      const thread = createCodexThread(
        codex,
        buildThreadOptions({
          sessionCwd,
          sandboxEnabled: !!sandboxOpts?.enabled,
          reasoningEffort: mapReasoningEffort(options.thinkingConfig),
        }),
        options.resumeSessionId,
      );

      const { events } = await thread.runStreamed(executionPrompt, {
        signal: abortSignal,
      });

      let turnStartMs = 0;
      for await (const event of events) {
        if (abortSignal?.aborted) break;
        if (event.type === 'turn.started') {
          turnStartMs = Date.now();
        } else if (event.type === 'turn.completed') {
          logUsage({
            sessionId: session.id,
            taskId: options.taskId,
            callType: 'agent',
            provider: 'openai',
            model:
              extractModelName(this.config.model) ??
              CODEX_METADATA.defaultModel,
            inputTokens:
              event.usage.input_tokens - event.usage.cached_input_tokens,
            outputTokens: event.usage.output_tokens,
            reasoningOutputTokens: event.usage.reasoning_output_tokens,
            cacheReadTokens: event.usage.cached_input_tokens || undefined,
            latencyMs: turnStartMs ? Date.now() - turnStartMs : undefined,
            metadata: { phase: 'execution' },
          });
        }
        yield* deduplicateTextEvents(
          mapSdkEvent(event, sessionCwd, session.id),
        );
      }
    } catch (err) {
      logger.error(`[${session.id}] Execution error: ${err}`);
      yield {
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      };
    } finally {
      bridge?.revoke();
      this.sessions.delete(session.id);
      yield { type: 'done' };
    }
  }
}

// ============================================================================
// Environment Test
// ============================================================================

// Cache the binary check result so repeated health probes don't re-scan PATH.
let _binaryFound: boolean | undefined;

async function isBinaryAvailable(): Promise<boolean> {
  if (_binaryFound !== undefined) return _binaryFound;
  // Use resolveCodexBinaryPath which searches login shells, extended PATH,
  // and common install locations — spawnSync('codex') with default PATH
  // fails in Tauri sidecar where PATH is minimal.
  _binaryFound = resolveCodexBinaryPath() !== undefined;
  return _binaryFound;
}

async function testEnvironment(
  config: AgentConfig,
): Promise<AdapterEnvironmentReport> {
  const errors: string[] = [];

  const binaryFound = await isBinaryAvailable();
  if (!binaryFound) {
    errors.push(
      'codex binary not found — install with: npm install -g @openai/codex-sdk',
    );
  }

  const authResolution = resolveCodexApiKey(config);
  const authValid = !!authResolution.apiKey;
  if (!authValid) {
    errors.push('No Codex or OpenAI API key configured');
  }

  return {
    healthy: binaryFound && authValid,
    binaryFound,
    authValid,
    helloProbeOk: false,
    errors,
  };
}

// ============================================================================
// Plugin Definition
// ============================================================================

const codexPlugin: AgentPlugin = defineAgentPlugin({
  metadata: {
    ...CODEX_METADATA,
    transport: 'sdk',
  },
  factory: (config: AgentConfig) => new CodexAgent(config),
  testEnvironment,
  listModels: async () =>
    (CODEX_METADATA.supportedModels ?? []).map((id) => ({ id, label: id })),
});

export default codexPlugin;
