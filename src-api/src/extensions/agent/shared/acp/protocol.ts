import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { Readable, Writable } from 'node:stream';

import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type Agent,
  type AgentCapabilities,
  type AuthMethod,
  type Client,
  type ContentBlock,
  type McpServer,
  type ModelInfo,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
} from '@zed-industries/agent-client-protocol';

import { ToolPermissionRegistry } from '@/core/agent/tool-permission-registry';
import type { ToolClassification } from '@/core/agent/tool-permission-registry';
import type { AgentMessage } from '@/core/agent/types';

import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('AcpRuntime');

const DEFAULT_STAGE_TIMEOUT_MS = 30_000;
const DEFAULT_PROMPT_TIMEOUT_MS = 30 * 60_000;
const DEFAULT_POST_TOOL_CONTINUATION_TIMEOUT_MS = 60_000;
const MAX_STDERR_BYTES = 16_000;
const POST_TOOL_CONTINUATION_PROMPT =
  'Continue the same turn after the completed tool call. Briefly report the outcome and finish the response. Do not repeat the tool call unless the result requires it.';

export type AcpPermissionDecision = 'allow' | 'deny' | 'ask';

export interface AcpPermissionMediator {
  (
    request: RequestPermissionRequest,
    policyDecision: AcpPermissionDecision,
  ): Promise<string | null>;
}

export interface AcpRuntimeOptions {
  binaryPath: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  mcpServers?: McpServer[];
  permissionRegistry?: ToolPermissionRegistry;
  mediatePermission?: AcpPermissionMediator;
  onMessage: (message: AgentMessage) => void | Promise<void>;
  stageTimeoutMs?: number;
  promptTimeoutMs?: number;
  postToolContinuationTimeoutMs?: number;
}

export interface AcpSessionResult {
  sessionId: string;
  loaded: boolean;
  needsTranscriptReseed: boolean;
  models: ModelInfo[];
  promptCapabilities: AgentCapabilities['promptCapabilities'];
}

export class AcpTurnActivity {
  private awaitingPostToolResponse = false;

  reset(): void {
    this.awaitingPostToolResponse = false;
  }

  observe(message: AgentMessage): void {
    if (message.type === 'tool_result') {
      this.awaitingPostToolResponse = true;
    } else if (
      message.type === 'text' &&
      typeof message.content === 'string' &&
      message.content.trim().length > 0
    ) {
      this.awaitingPostToolResponse = false;
    }
  }

  needsContinuation(): boolean {
    return this.awaitingPostToolResponse;
  }
}

export async function runAcpPromptSequence<T>(options: {
  activity: AcpTurnActivity;
  send: (prompt: string, continuation: boolean) => Promise<T>;
  initialPrompt: string;
  onContinuation: () => void | Promise<void>;
}): Promise<T> {
  options.activity.reset();
  let result = await options.send(options.initialPrompt, false);
  if (!options.activity.needsContinuation()) return result;

  await options.onContinuation();
  options.activity.reset();
  result = await options.send(POST_TOOL_CONTINUATION_PROMPT, true);
  return result;
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  stage: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`ACP ${stage} timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    timer.unref();
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export function assertAcpProtocolVersion(version: number): void {
  if (version !== PROTOCOL_VERSION) {
    throw new Error(
      `Unsupported ACP protocol version ${version}; expected ${PROTOCOL_VERSION}`,
    );
  }
}

export function normalizeAcpUsage(
  usage: unknown,
): AgentMessage['usage'] | undefined {
  if (!usage || typeof usage !== 'object') return undefined;
  const value = usage as Record<string, unknown>;
  const read = (...keys: string[]): number | undefined => {
    for (const key of keys) {
      const tokenCount = value[key];
      if (
        typeof tokenCount === 'number' &&
        Number.isFinite(tokenCount) &&
        tokenCount >= 0
      ) {
        return tokenCount;
      }
    }
    return undefined;
  };
  const normalized = {
    input_tokens: read('inputTokens', 'input_tokens'),
    output_tokens: read('outputTokens', 'output_tokens'),
    cache_read_input_tokens: read(
      'cacheReadInputTokens',
      'cache_read_input_tokens',
      'cachedReadTokens',
      'cached_read_tokens',
    ),
    cache_creation_input_tokens: read(
      'cacheCreationInputTokens',
      'cache_creation_input_tokens',
      'cachedWriteTokens',
      'cached_write_tokens',
    ),
  };
  return Object.values(normalized).some((entry) => entry !== undefined)
    ? normalized
    : undefined;
}

export class AcpToolCallTracker {
  private readonly open = new Set<string>();
  private readonly terminal = new Set<string>();

  map(notification: SessionNotification): AgentMessage[] {
    const update = notification.update;
    if (update.sessionUpdate === 'tool_call') {
      if (
        this.open.has(update.toolCallId) ||
        this.terminal.has(update.toolCallId)
      )
        return [];
      this.open.add(update.toolCallId);
    }
    if (update.sessionUpdate === 'tool_call_update') {
      if (update.status !== 'completed' && update.status !== 'failed')
        return [];
      if (this.terminal.has(update.toolCallId)) return [];
      this.open.delete(update.toolCallId);
      this.terminal.add(update.toolCallId);
    }
    return mapAcpSessionUpdate(notification);
  }

  flush(reason: string): AgentMessage[] {
    const messages = [...this.open].map((toolUseId) => ({
      type: 'tool_result' as const,
      toolUseId,
      output: reason,
      isError: true,
    }));
    for (const toolUseId of this.open) this.terminal.add(toolUseId);
    this.open.clear();
    return messages;
  }
}

function textFromContent(content: unknown): string | undefined {
  if (!content || typeof content !== 'object') return undefined;
  const record = content as Record<string, unknown>;
  return record.type === 'text' && typeof record.text === 'string'
    ? record.text
    : undefined;
}

export function mapAcpSessionUpdate(
  notification: SessionNotification,
): AgentMessage[] {
  const update = notification.update;
  switch (update.sessionUpdate) {
    case 'agent_message_chunk': {
      const content = textFromContent(update.content);
      return content ? [{ type: 'text', content }] : [];
    }
    case 'agent_thought_chunk': {
      const content = textFromContent(update.content);
      return content ? [{ type: 'thinking', content }] : [];
    }
    case 'tool_call':
      return [
        {
          type: 'tool_use',
          id: update.toolCallId,
          name: update.title,
          input: update.rawInput ?? {},
        },
      ];
    case 'tool_call_update':
      if (update.status !== 'completed' && update.status !== 'failed')
        return [];
      return [
        {
          type: 'tool_result',
          toolUseId: update.toolCallId,
          output: JSON.stringify(update.rawOutput ?? {}),
          isError: update.status === 'failed',
        },
      ];
    case 'plan':
      return [
        {
          type: 'plan',
          plan: {
            id: crypto.randomUUID(),
            goal: 'ACP agent plan',
            steps: update.entries.map((entry) => ({
              id: crypto.randomUUID(),
              description: entry.content,
              status: entry.status,
            })),
            createdAt: new Date(),
          },
        },
      ];
    case 'user_message_chunk':
    case 'available_commands_update':
    case 'current_mode_update':
      return [];
  }
}

export function selectAcpPermissionOption(
  request: RequestPermissionRequest,
  decision: 'allow' | 'deny',
): RequestPermissionResponse {
  const kinds: ReadonlySet<string> = new Set(
    decision === 'allow'
      ? ['allow_once', 'allow_always']
      : ['reject_once', 'reject_always'],
  );
  const option = request.options.find((candidate) => kinds.has(candidate.kind));
  return option
    ? { outcome: { outcome: 'selected', optionId: option.optionId } }
    : { outcome: { outcome: 'cancelled' } };
}

export async function resolveAcpPermissionRequest(
  registry: ToolPermissionRegistry,
  request: RequestPermissionRequest,
  mediatePermission?: AcpPermissionMediator,
): Promise<RequestPermissionResponse> {
  const title = request.toolCall.title ?? 'ACP tool';
  const classification = acpToolClassification(request.toolCall.kind);
  if (classification && !registry.classifyTool(title)) {
    registry.setClassification(title, classification);
  }
  const decision = registry.evaluate(title, request.toolCall.rawInput);
  if (decision === 'ask' && mediatePermission) {
    const optionId = await mediatePermission(request, decision);
    return optionId
      ? { outcome: { outcome: 'selected', optionId } }
      : { outcome: { outcome: 'cancelled' } };
  }
  return selectAcpPermissionOption(
    request,
    decision === 'allow' ? 'allow' : 'deny',
  );
}

function acpToolClassification(
  kind: RequestPermissionRequest['toolCall']['kind'],
): ToolClassification | undefined {
  if (kind === 'read' || kind === 'search' || kind === 'think') return 'read';
  if (kind === 'edit' || kind === 'move') return 'write';
  if (kind === 'delete') return 'destructive';
  if (kind === 'execute') return 'execute';
  if (kind === 'fetch') return 'network';
  return undefined;
}

export function shouldLoadAcpSession(
  capabilities: AgentCapabilities,
  resumeSessionId: string | undefined,
): resumeSessionId is string {
  return Boolean(resumeSessionId && capabilities.loadSession);
}

export class AcpRuntimeClient {
  private readonly connection: ClientSideConnection;
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly processFailure: Promise<never>;
  private capabilities: AgentCapabilities = {};
  private authMethods: AuthMethod[] = [];
  private readonly mcpServers: McpServer[];
  private readonly cwd: string;
  private readonly onMessage: AcpRuntimeOptions['onMessage'];
  private readonly promptTimeoutMs: number;
  private readonly postToolContinuationTimeoutMs: number;
  private readonly stageTimeoutMs: number;
  private readonly toolTracker = new AcpToolCallTracker();
  private readonly turnActivity = new AcpTurnActivity();
  private stderr = '';

  private constructor(
    connection: ClientSideConnection,
    child: ChildProcessWithoutNullStreams,
    processFailure: Promise<never>,
    mcpServers: McpServer[],
    cwd: string,
    onMessage: AcpRuntimeOptions['onMessage'],
    promptTimeoutMs: number,
    postToolContinuationTimeoutMs: number,
    stageTimeoutMs: number,
  ) {
    this.connection = connection;
    this.child = child;
    this.processFailure = processFailure;
    this.mcpServers = mcpServers;
    this.cwd = cwd;
    this.onMessage = onMessage;
    this.promptTimeoutMs = promptTimeoutMs;
    this.postToolContinuationTimeoutMs = postToolContinuationTimeoutMs;
    this.stageTimeoutMs = stageTimeoutMs;
  }

  static async connect(options: AcpRuntimeOptions): Promise<AcpRuntimeClient> {
    const child = spawn(options.binaryPath, options.args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stderr = '';
    let runtime: AcpRuntimeClient | undefined;
    const processFailure = new Promise<never>((_resolve, reject) => {
      child.once('error', (error) => {
        stderr = (stderr + `\n${error.message}`).slice(-MAX_STDERR_BYTES);
        if (runtime) runtime.stderr = stderr;
        logger.warn('acp_process_error', { error: error.message });
        reject(error);
      });
    });
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + String(chunk)).slice(-MAX_STDERR_BYTES);
      if (runtime) runtime.stderr = stderr;
      logger.debug('acp_stderr', { chunk: String(chunk).slice(0, 2_000) });
    });

    const registry = options.permissionRegistry ?? new ToolPermissionRegistry();
    const client: Client = {
      async requestPermission(request) {
        return resolveAcpPermissionRequest(
          registry,
          request,
          options.mediatePermission,
        );
      },
      async sessionUpdate(notification) {
        if (!runtime) return;
        for (const message of runtime.toolTracker.map(notification)) {
          runtime.turnActivity.observe(message);
          await options.onMessage(message);
        }
      },
    };

    const stream = ndJsonStream(
      Writable.toWeb(child.stdin),
      Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
    );
    const connection = new ClientSideConnection(
      (_agent: Agent) => client,
      stream,
    );
    const stageTimeoutMs = options.stageTimeoutMs ?? DEFAULT_STAGE_TIMEOUT_MS;
    runtime = new AcpRuntimeClient(
      connection,
      child,
      processFailure,
      options.mcpServers ?? [],
      options.cwd,
      options.onMessage,
      options.promptTimeoutMs ?? DEFAULT_PROMPT_TIMEOUT_MS,
      options.postToolContinuationTimeoutMs ??
        DEFAULT_POST_TOOL_CONTINUATION_TIMEOUT_MS,
      stageTimeoutMs,
    );
    runtime.stderr = stderr;
    const initialized = await withTimeout(
      Promise.race([
        connection.initialize({
          protocolVersion: PROTOCOL_VERSION,
          clientCapabilities: {},
        }),
        processFailure,
      ]),
      stageTimeoutMs,
      'initialize',
    ).catch((error) => {
      runtime.close();
      const detail = stderr.trim() ? `: ${stderr.trim()}` : '';
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}${detail}`,
      );
    });
    try {
      assertAcpProtocolVersion(initialized.protocolVersion);
    } catch (error) {
      runtime.close();
      throw error;
    }
    runtime.capabilities = initialized.agentCapabilities ?? {};
    runtime.authMethods = initialized.authMethods ?? [];
    return runtime;
  }

  async createOrLoadSession(params: {
    resumeSessionId?: string;
  }): Promise<AcpSessionResult> {
    if (shouldLoadAcpSession(this.capabilities, params.resumeSessionId)) {
      const loaded = await withTimeout(
        this.connection.loadSession({
          sessionId: params.resumeSessionId,
          cwd: this.cwd,
          mcpServers: this.mcpServers,
        }),
        this.stageTimeoutMs,
        'session/load',
      );
      return {
        sessionId: params.resumeSessionId,
        loaded: true,
        needsTranscriptReseed: false,
        models: loaded.models?.availableModels ?? [],
        promptCapabilities: this.capabilities.promptCapabilities,
      };
    }
    const created = await withTimeout(
      this.connection.newSession({
        cwd: this.cwd,
        mcpServers: this.mcpServers,
      }),
      this.stageTimeoutMs,
      'session/new',
    );
    return {
      sessionId: created.sessionId,
      loaded: false,
      needsTranscriptReseed: Boolean(params.resumeSessionId),
      models: created.models?.availableModels ?? [],
      promptCapabilities: this.capabilities.promptCapabilities,
    };
  }

  async setModel(sessionId: string, modelId: string): Promise<void> {
    await this.connection.setSessionModel({ sessionId, modelId });
  }

  async prompt(
    sessionId: string,
    text: string,
    images: Array<{ data: string; mimeType: string }> = [],
  ): Promise<string> {
    try {
      const result = await runAcpPromptSequence({
        activity: this.turnActivity,
        initialPrompt: text,
        onContinuation: () =>
          this.onMessage({
            type: 'system',
            subtype: 'post_tool_continuation',
            attempt: 1,
            isProgress: true,
          }),
        send: async (nextText, continuation) => {
          const nextPrompt: ContentBlock[] = [{ type: 'text', text: nextText }];
          if (!continuation && this.capabilities.promptCapabilities?.image) {
            nextPrompt.push(
              ...images.map((image) => ({
                type: 'image' as const,
                data: image.data,
                mimeType: image.mimeType,
              })),
            );
          }
          const response = await withTimeout(
            Promise.race([
              this.connection.prompt({ sessionId, prompt: nextPrompt }),
              this.processFailure,
            ]),
            continuation
              ? this.postToolContinuationTimeoutMs
              : this.promptTimeoutMs,
            continuation ? 'post-tool continuation' : 'prompt',
          );
          const usage = normalizeAcpUsage(response._meta?.usage);
          if (usage) await this.onMessage({ type: 'result', usage });
          return response;
        },
      });
      return result.stopReason;
    } finally {
      for (const message of this.toolTracker.flush(
        'ACP turn ended before the tool reported a terminal result',
      )) {
        await this.onMessage(message);
      }
    }
  }

  async cancel(sessionId: string): Promise<void> {
    await this.connection.cancel({ sessionId });
  }

  close(): void {
    if (!this.child.stdin.destroyed) this.child.stdin.end();
    if (this.child.exitCode !== null) return;
    this.child.kill('SIGTERM');
    const timer = setTimeout(() => {
      if (this.child.exitCode === null) this.child.kill('SIGKILL');
    }, 2_000);
    timer.unref();
  }

  getAuthMethods(): readonly AuthMethod[] {
    return this.authMethods;
  }

  getDiagnostics(): string {
    return this.stderr;
  }
}
