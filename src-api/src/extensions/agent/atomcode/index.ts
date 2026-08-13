import {
  BaseAgent,
  formatPlanForExecution,
  isConversationalPrompt,
  PLANNING_INSTRUCTION,
} from '@/core/agent/base';
import { defineAgentPlugin } from '@/core/agent/plugin';
import type { AgentPlugin, AgentProviderMetadata } from '@/core/agent/plugin';
import { stripRuntimeModelPrefix } from '@/core/agent/runtime-ids';
import type {
  AgentConfig,
  AgentMessage,
  AgentOptions,
  AgentProvider,
  ExecuteOptions,
  PlanOptions,
} from '@/core/agent/types';

import { validateCwd } from '@/extensions/agent/process-agent/security';
import {
  formatCliConversationPrompt,
  resolveBinaryPath,
  runHeadlessPrompt,
} from '@/extensions/agent/shared/cli';

import { getSetting } from '@/shared/db/operations';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('AtomCodeAgent');
const ATOMCODE_MAX_TURNS = 20;

const ATOMCODE_METADATA: AgentProviderMetadata = {
  type: 'atomcode',
  name: 'AtomCode',
  description: 'AtomCode CLI running locally with bounded headless execution',
  builtin: true,
  supportsPlan: true,
  supportsStreaming: false,
  supportsSandbox: false,
  transport: 'cli',
  supportsMcp: 'none',
  supportsSkills: 'none',
  supportsPlanMode: 'orchestrated',
  requiresBinary: true,
  requiresApiKey: false,
};

interface AtomCodeConfig {
  binaryPath?: string;
  model?: string;
}

function detectBinary(configPath?: string): string | null {
  return (
    configPath ?? process.env.ATOMCODE_PATH ?? resolveBinaryPath('atomcode')
  );
}

export function buildAtomCodeArgs(input: {
  promptFile: string;
  maxTurns: number;
  model?: string;
}): string[] {
  const args = [
    '--prompt-file',
    input.promptFile,
    '--max-turns',
    String(input.maxTurns),
    '--disabled-tools',
    'shell,network',
  ];
  if (input.model && input.model !== 'default')
    args.push('--model', input.model);
  return args;
}

export class AtomCodeAgent extends BaseAgent {
  readonly provider: AgentProvider = 'atomcode';
  private readonly localConfig: AtomCodeConfig;

  constructor(config: AgentConfig) {
    super(config);
    const providerConfig = (config.providerConfig ??
      {}) as Partial<AtomCodeConfig>;
    this.localConfig = {
      binaryPath: providerConfig.binaryPath,
      model: providerConfig.model ?? config.model,
    };
  }

  async *run(
    prompt: string,
    options?: AgentOptions,
  ): AsyncGenerator<AgentMessage> {
    const session = this.createSession('executing');
    yield { type: 'session', sessionId: session.id };
    try {
      const binaryPath = detectBinary(this.localConfig.binaryPath);
      if (!binaryPath)
        throw new Error(
          'AtomCode binary not found. Install AtomCode or set ATOMCODE_PATH.',
        );
      const workspaceRoot = getSetting('workDir') ?? process.cwd();
      const cwd = validateCwd(options?.cwd ?? workspaceRoot, workspaceRoot);
      const model = stripRuntimeModelPrefix('atomcode', this.localConfig.model);
      const composed = formatCliConversationPrompt(
        options?.conversation,
        prompt,
      );
      const result = await runHeadlessPrompt({
        binaryPath,
        cwd,
        env: { ...process.env },
        prompt: this.buildPromptWithContext(composed, options),
        maxTurns: ATOMCODE_MAX_TURNS,
        abortSignal:
          options?.abortController?.signal ?? session.abortController.signal,
        buildArgs: ({ promptFile, maxTurns }) =>
          buildAtomCodeArgs({ promptFile, maxTurns, model }),
      });
      if (result.stdout) yield { type: 'text', content: result.stdout };
      if (result.timedOut)
        yield { type: 'error', message: 'AtomCode run timed out.' };
      else if (result.cancelled)
        yield { type: 'error', message: 'AtomCode run was cancelled.' };
      else if (result.code !== 0) {
        yield {
          type: 'error',
          message: result.stderr || `AtomCode exited with code ${result.code}`,
        };
      } else if (!result.stdout.trim()) {
        yield {
          type: 'error',
          message:
            result.stderr || 'AtomCode completed without producing output.',
        };
      }
    } catch (error) {
      logger.error('atomcode_run_failed', { error });
      yield {
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      };
    } finally {
      yield { type: 'done' };
      this.sessions.delete(session.id);
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

export const atomCodePlugin: AgentPlugin = defineAgentPlugin({
  metadata: ATOMCODE_METADATA,
  factory: (config) => new AtomCodeAgent(config),
  async testEnvironment() {
    const binaryPath = detectBinary();
    return {
      healthy: Boolean(binaryPath),
      binaryFound: Boolean(binaryPath),
      authValid: true,
      helloProbeOk: Boolean(binaryPath),
      errors: binaryPath ? [] : ['atomcode binary not found'],
    };
  },
});
