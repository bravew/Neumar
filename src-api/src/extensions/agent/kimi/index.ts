import { homedir } from 'node:os';
import { join } from 'node:path';

import type {
  McpServer,
  RequestPermissionRequest,
} from '@zed-industries/agent-client-protocol';

import {
  BaseAgent,
  formatPlanForExecution,
  isConversationalPrompt,
  PLANNING_INSTRUCTION,
} from '@/core/agent/base';
import { defineAgentPlugin } from '@/core/agent/plugin';
import type { AgentPlugin, AgentProviderMetadata } from '@/core/agent/plugin';
import { stripRuntimeModelPrefix } from '@/core/agent/runtime-ids';
import {
  requestHostToolPermission,
  ToolPermissionRegistry,
} from '@/core/agent/tool-permission-registry';
import type {
  AgentConfig,
  AgentMessage,
  AgentOptions,
  AgentProvider,
  ExecuteOptions,
  PlanOptions,
} from '@/core/agent/types';

import { validateCwd } from '@/extensions/agent/process-agent/security';
import { AcpRuntimeClient } from '@/extensions/agent/shared/acp';
import {
  formatCliConversationPrompt,
  resolveBinaryPath,
} from '@/extensions/agent/shared/cli';

import { getSetting } from '@/shared/db/operations';
import {
  buildSubprocessMcpConfig,
  type SubprocessMcpConfig,
} from '@/shared/mcp/subprocess-bridge';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('KimiAgent');

const KIMI_METADATA: AgentProviderMetadata = {
  type: 'kimi',
  name: 'Kimi Code CLI',
  description: 'Kimi Code running locally through Agent Client Protocol',
  builtin: true,
  supportsPlan: true,
  supportsStreaming: true,
  supportsSandbox: false,
  supportsResume: true,
  supportsModelDiscovery: true,
  transport: 'cli',
  supportsMcp: 'native',
  supportsSkills: 'none',
  supportsPlanMode: 'orchestrated',
  requiresBinary: true,
  requiresApiKey: false,
};

interface KimiConfig {
  binaryPath?: string;
  model?: string;
}

function detectBinary(configPath?: string): string | null {
  return (
    configPath ??
    process.env.KIMI_PATH ??
    resolveBinaryPath('kimi', [
      join(
        homedir(),
        '.kimi-code',
        'bin',
        process.platform === 'win32' ? 'kimi.exe' : 'kimi',
      ),
    ])
  );
}

class MessageQueue {
  private messages: AgentMessage[] = [];
  private waiter: (() => void) | null = null;
  private finished = false;

  push(message: AgentMessage): void {
    this.messages.push(message);
    this.waiter?.();
    this.waiter = null;
  }

  close(): void {
    this.finished = true;
    this.waiter?.();
    this.waiter = null;
  }

  async *drain(): AsyncGenerator<AgentMessage> {
    while (!this.finished || this.messages.length > 0) {
      const message = this.messages.shift();
      if (message) {
        yield message;
        continue;
      }
      await new Promise<void>((resolve) => {
        this.waiter = resolve;
      });
    }
  }
}

function bridgeMcpServers(
  bridge: SubprocessMcpConfig | undefined,
): McpServer[] {
  const servers = bridge?.codexConfig.mcp_servers ?? {};
  return Object.entries(servers).map(([name, server]) => ({
    type: 'http' as const,
    name,
    url: server.url,
    headers: [
      {
        name: 'Authorization',
        value: `Bearer ${bridge?.env[server.bearer_token_env_var] ?? ''}`,
      },
    ],
  }));
}

export async function listKimiModels(
  config?: AgentConfig,
): Promise<Array<{ id: string; label: string }>> {
  const providerConfig = (config?.providerConfig ?? {}) as Partial<KimiConfig>;
  const binaryPath = detectBinary(providerConfig.binaryPath);
  if (!binaryPath) return [];
  const workspaceRoot =
    config?.workDir ?? getSetting('workDir') ?? process.cwd();
  const cwd = validateCwd(config?.workDir ?? workspaceRoot, workspaceRoot);
  let client: AcpRuntimeClient | undefined;
  try {
    client = await AcpRuntimeClient.connect({
      binaryPath,
      args: ['acp'],
      cwd,
      env: { ...process.env },
      onMessage: () => undefined,
    });
    const session = await client.createOrLoadSession({});
    return session.models.map((model) => ({
      id: model.modelId,
      label: model.name,
    }));
  } finally {
    client?.close();
  }
}

export class KimiAgent extends BaseAgent {
  readonly provider: AgentProvider = 'kimi';
  private readonly localConfig: KimiConfig;

  constructor(config: AgentConfig) {
    super(config);
    const providerConfig = (config.providerConfig ?? {}) as Partial<KimiConfig>;
    this.localConfig = {
      binaryPath: providerConfig.binaryPath,
      model: providerConfig.model ?? config.model,
    };
  }

  async *run(
    prompt: string,
    options?: AgentOptions,
  ): AsyncGenerator<AgentMessage> {
    const localSession = this.createSession('executing');
    let bridge: SubprocessMcpConfig | undefined;
    let client: AcpRuntimeClient | undefined;
    try {
      const binaryPath = detectBinary(this.localConfig.binaryPath);
      if (!binaryPath)
        throw new Error(
          'Kimi CLI binary not found. Install Kimi CLI or set KIMI_PATH.',
        );
      const workspaceRoot = getSetting('workDir') ?? process.cwd();
      const cwd = validateCwd(options?.cwd ?? workspaceRoot, workspaceRoot);
      if (options?.bridgeInProcessServers?.length) {
        bridge = await buildSubprocessMcpConfig({
          sessionId: localSession.id,
          channelContext: options.channelContext,
          locale: options.locale,
          inProcessServers: options.bridgeInProcessServers,
          ...(options.disablePolicyServers ? { connectors: [] } : {}),
        });
      }

      const queue = new MessageQueue();
      const selectedModel = stripRuntimeModelPrefix(
        'kimi',
        this.localConfig.model,
      );
      const registry = new ToolPermissionRegistry({
        alwaysAllow: options?.allowedTools ?? [],
        alwaysDeny: options?.disallowedTools ?? [],
        alwaysAsk: [],
      });
      for (const [tool, classification] of Object.entries(
        options?.toolClassifications ?? {},
      )) {
        registry.setClassification(tool, classification);
      }
      const mediatePermission = async (request: RequestPermissionRequest) => {
        if (!options?.taskId) return null;
        const approved = await requestHostToolPermission({
          taskId: options.taskId,
          sessionId: localSession.id,
          toolName: request.toolCall.title ?? 'ACP tool',
          input: request.toolCall.rawInput,
          registry,
          signal:
            options.abortController?.signal ??
            localSession.abortController.signal,
        });
        const wantedKind = approved ? 'allow_once' : 'reject_once';
        return (
          request.options.find((option) => option.kind === wantedKind)
            ?.optionId ?? null
        );
      };
      client = await AcpRuntimeClient.connect({
        binaryPath,
        args:
          selectedModel && selectedModel !== 'default'
            ? ['--model', selectedModel, 'acp']
            : ['acp'],
        cwd,
        env: { ...process.env, ...(bridge?.env ?? {}) },
        mcpServers: bridgeMcpServers(bridge),
        permissionRegistry: registry,
        mediatePermission,
        onMessage: (message) => queue.push(message),
      });
      const session = await client.createOrLoadSession({
        resumeSessionId: options?.resumeSessionId,
      });
      yield { type: 'session', sessionId: session.sessionId };

      const abortSignal =
        options?.abortController?.signal ?? localSession.abortController.signal;
      const onAbort = () => void client?.cancel(session.sessionId);
      abortSignal.addEventListener('abort', onAbort, { once: true });
      let promptError: unknown;
      void client
        .prompt(
          session.sessionId,
          this.buildPromptWithContext(
            formatCliConversationPrompt(options?.conversation, prompt),
            options,
          ),
          options?.images,
        )
        .catch((error) => {
          promptError = error;
        })
        .finally(() => queue.close());
      yield* queue.drain();
      abortSignal.removeEventListener('abort', onAbort);
      if (promptError) throw promptError;
    } catch (error) {
      logger.error('kimi_run_failed', { error });
      yield {
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      };
    } finally {
      client?.close();
      bridge?.revoke();
      yield { type: 'done' };
      this.sessions.delete(localSession.id);
    }
  }

  async *plan(
    prompt: string,
    options?: PlanOptions,
  ): AsyncGenerator<AgentMessage> {
    if (isConversationalPrompt(prompt)) {
      yield { type: 'direct_answer' };
      yield* this.run(prompt, options);
      return;
    }
    yield* this.run(`${PLANNING_INSTRUCTION}\n\n${prompt}`, options);
  }

  async *execute(options: ExecuteOptions): AsyncGenerator<AgentMessage> {
    const plan = options.plan || this.getPlan(options.planId);
    if (!plan) {
      yield { type: 'error', content: `Plan not found: ${options.planId}` };
      return;
    }
    yield* this.run(formatPlanForExecution(plan), options);
  }
}

export const kimiPlugin: AgentPlugin = defineAgentPlugin({
  metadata: KIMI_METADATA,
  factory: (config) => new KimiAgent(config),
  async testEnvironment(config) {
    const providerConfig = (config.providerConfig ?? {}) as Partial<KimiConfig>;
    const binaryPath = detectBinary(providerConfig.binaryPath);
    if (!binaryPath) {
      return {
        healthy: false,
        binaryFound: false,
        authValid: false,
        helloProbeOk: false,
        errors: ['kimi binary not found'],
      };
    }
    const workspaceRoot =
      config.workDir ?? getSetting('workDir') ?? process.cwd();
    const cwd = validateCwd(config.workDir ?? workspaceRoot, workspaceRoot);
    let client: AcpRuntimeClient | undefined;
    try {
      client = await AcpRuntimeClient.connect({
        binaryPath,
        args: ['acp'],
        cwd,
        env: { ...process.env },
        stageTimeoutMs: 10_000,
        onMessage: () => undefined,
      });
      const session = await client.createOrLoadSession({});
      return {
        healthy: true,
        binaryFound: true,
        authValid: true,
        helloProbeOk: true,
        errors: [],
        models: session.models.map((model) => ({
          id: model.modelId,
          label: model.name,
        })),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const authRequired = /auth|login|credential|unauthorized/i.test(message);
      return {
        healthy: false,
        binaryFound: true,
        authValid: false,
        helloProbeOk: false,
        errors: [
          authRequired
            ? 'Kimi Code login required. Run `kimi login` and try again.'
            : message,
        ],
      };
    } finally {
      client?.close();
    }
  },
  listModels: listKimiModels,
});
