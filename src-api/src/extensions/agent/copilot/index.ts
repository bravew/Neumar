/**
 * GitHub Copilot CLI Adapter
 *
 * Runs the `copilot` CLI (https://docs.github.com/en/copilot/how-tos/copilot-cli)
 * as an agent provider. Invocation: `--allow-all-tools --output-format json`
 * plus `--model` when not default; the prompt is piped over stdin with NO
 * `-p` flag — `-p -` makes Copilot read the dash as a literal one-character
 * prompt, while omitting `-p` under a non-TTY pipe delegates to stdin.
 * `--allow-all-tools` is required for non-interactive runs: without it the
 * CLI blocks waiting for human approval on every tool call.
 *
 * Copilot requires an active subscription; auth/subscription failures
 * surface as visible run errors (and via the auth probe in testEnvironment).
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { ASK_USER_QUESTION_INSTRUCTION } from '@/core/agent/ask-user-question';
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
  streamCliAgentTurn,
} from '@/extensions/agent/shared/cli';

import { getSetting } from '@/shared/db/operations';
import { createLogger } from '@/shared/utils/logger';

import { CopilotStreamParser } from './stream';

const logger = createLogger('CopilotAgent');

const execFileP = promisify(execFile);

/**
 * Copilot's deck-generation / large-prompt turns can go silent for stretches
 * beyond the default 5-minute budget while the model is still working — the
 * CLI emits no keepalive frames. 30 minutes bounds genuine hangs while
 * giving heavy turns room to land (Open Design shipped the same budget).
 */
const COPILOT_TIMEOUT_MS = 30 * 60 * 1000;

const COPILOT_METADATA: AgentProviderMetadata = {
  type: 'copilot',
  name: 'GitHub Copilot CLI',
  description: 'GitHub Copilot CLI running locally in programmatic mode',
  builtin: true,
  supportsPlan: true,
  supportsStreaming: true,
  supportsSandbox: false,
  transport: 'cli',
  supportsMcp: 'none',
  supportsSkills: 'none',
  supportsPlanMode: 'orchestrated',
  requiresBinary: true,
  requiresApiKey: false,
};

interface CopilotAgentConfig {
  binaryPath?: string;
  model?: string;
}

/** Binary detection priority: config → env var → PATH. */
function detectBinary(configPath?: string): string | null {
  if (configPath) return configPath;
  const envPath = process.env['COPILOT_CLI_PATH'];
  if (envPath) return envPath;
  return resolveBinaryPath('copilot', []);
}

export class CopilotAgent extends BaseAgent {
  readonly provider: AgentProvider = 'copilot';
  private localConfig: CopilotAgentConfig;

  constructor(config: AgentConfig) {
    super(config);
    const providerConfig = (config.providerConfig ??
      {}) as Partial<CopilotAgentConfig>;
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
      if (!binaryPath) {
        yield {
          type: 'error',
          message:
            'GitHub Copilot CLI not found. Install it with `npm install -g @github/copilot` or set COPILOT_CLI_PATH.',
        };
        yield { type: 'done' };
        return;
      }

      const workspaceRoot = getSetting('workDir') ?? process.cwd();
      let cwd: string;
      try {
        cwd = validateCwd(options?.cwd ?? workspaceRoot, workspaceRoot);
      } catch (err) {
        yield { type: 'error', message: String(err) };
        yield { type: 'done' };
        return;
      }

      const args = ['--allow-all-tools', '--output-format', 'json'];
      const model = stripRuntimeModelPrefix('copilot', this.localConfig.model);
      if (model && model !== 'default') args.push('--model', model);

      const composed = formatCliConversationPrompt(
        options?.conversation,
        prompt,
      );
      const stdinText = `${ASK_USER_QUESTION_INSTRUCTION}\n\n${composed}`;

      logger.info(`Spawning copilot: model=${model ?? 'default'}`);

      yield* streamCliAgentTurn({
        runtimeName: 'GitHub Copilot CLI',
        parser: new CopilotStreamParser(),
        spec: {
          binaryPath,
          args,
          cwd,
          // Full inherited env: the launch env carries the user's CLI auth
          // (gh login state, GH_TOKEN / GITHUB_TOKEN, proxies). An allowlist
          // breaks logins that work in the user's terminal — see Open Design
          // issue #951.
          env: { ...process.env },
          stdinText,
          timeoutMs: COPILOT_TIMEOUT_MS,
          abortSignals: [
            options?.abortController?.signal,
            session.abortController.signal,
          ],
        },
      });
    } catch (err) {
      logger.error('Copilot agent error', { error: err });
      yield { type: 'error', message: String(err) };
      yield { type: 'done' };
    } finally {
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

export function createCopilotAgent(config: AgentConfig): CopilotAgent {
  return new CopilotAgent(config);
}

export const copilotPlugin: AgentPlugin = defineAgentPlugin({
  metadata: COPILOT_METADATA,
  factory: (config) => createCopilotAgent(config),
  async testEnvironment() {
    const binaryPath = detectBinary();
    if (!binaryPath) {
      return {
        healthy: false,
        binaryFound: false,
        authValid: false,
        helloProbeOk: false,
        errors: ['copilot binary not found'],
      };
    }
    // Distinguish "binary installed" from "subscription/auth active" — org
    // policy can disable the CLI even when installed.
    try {
      const { stdout, stderr } = await execFileP(binaryPath, ['--version'], {
        timeout: 5000,
        maxBuffer: 1024 * 1024,
      });
      const output = `${stdout}\n${stderr}`;
      const helloProbeOk = /\d+\.\d+/.test(output);
      return {
        healthy: helloProbeOk,
        binaryFound: true,
        // No cheap offline auth probe: `copilot` validates the subscription
        // on run. Auth failures surface as visible run errors.
        authValid: true,
        helloProbeOk,
        errors: helloProbeOk ? [] : ['copilot --version probe failed'],
      };
    } catch (err) {
      return {
        healthy: false,
        binaryFound: true,
        authValid: false,
        helloProbeOk: false,
        errors: [`copilot probe failed: ${String(err)}`],
      };
    }
  },
});
