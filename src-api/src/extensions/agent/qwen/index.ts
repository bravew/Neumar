/**
 * Qwen Code CLI Adapter
 *
 * Runs the `qwen` CLI (https://qwenlm.github.io/qwen-code-docs/) as an agent
 * provider. Qwen Code is a Gemini CLI fork: `--yolo` enables non-interactive
 * auto-approve mode, the prompt is piped over stdin (no positional prompt —
 * current builds reject a bare `-`), and stdout is plain text streamed as
 * text events. Stderr is surfaced on non-zero exit.
 */

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
  PlainTextStreamParser,
  resolveBinaryPath,
  streamCliAgentTurn,
} from '@/extensions/agent/shared/cli';

import { getSetting } from '@/shared/db/operations';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('QwenAgent');

const QWEN_METADATA: AgentProviderMetadata = {
  type: 'qwen',
  name: 'Qwen Code',
  description: 'Qwen Code CLI running locally in non-interactive mode',
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

interface QwenAgentConfig {
  binaryPath?: string;
  model?: string;
}

/** Binary detection priority: config → env var → PATH. */
function detectBinary(configPath?: string): string | null {
  if (configPath) return configPath;
  const envPath = process.env['QWEN_CODE_PATH'];
  if (envPath) return envPath;
  return resolveBinaryPath('qwen', []);
}

export class QwenAgent extends BaseAgent {
  readonly provider: AgentProvider = 'qwen';
  private localConfig: QwenAgentConfig;

  constructor(config: AgentConfig) {
    super(config);
    const providerConfig = (config.providerConfig ??
      {}) as Partial<QwenAgentConfig>;
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
            'Qwen Code binary not found. Install it with `npm install -g @qwen-code/qwen-code` or set QWEN_CODE_PATH.',
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

      const args = ['--yolo'];
      const model = stripRuntimeModelPrefix('qwen', this.localConfig.model);
      if (model && model !== 'default') args.push('--model', model);

      const composed = formatCliConversationPrompt(
        options?.conversation,
        prompt,
      );
      const stdinText = `${ASK_USER_QUESTION_INSTRUCTION}\n\n${composed}`;

      logger.info(`Spawning qwen: model=${model ?? 'default'}`);

      yield* streamCliAgentTurn({
        runtimeName: 'Qwen Code',
        parser: new PlainTextStreamParser(),
        spec: {
          binaryPath,
          args,
          cwd,
          // Full inherited env: the launch env carries the user's CLI auth
          // (OAuth config under HOME, DASHSCOPE_API_KEY / OPENAI_API_KEY,
          // proxies). An allowlist breaks logins that work in the user's
          // terminal — see Open Design issue #951.
          env: { ...process.env },
          stdinText,
          abortSignals: [
            options?.abortController?.signal,
            session.abortController.signal,
          ],
        },
      });
    } catch (err) {
      logger.error('Qwen agent error', { error: err });
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

export function createQwenAgent(config: AgentConfig): QwenAgent {
  return new QwenAgent(config);
}

export const qwenPlugin: AgentPlugin = defineAgentPlugin({
  metadata: QWEN_METADATA,
  factory: (config) => createQwenAgent(config),
  async testEnvironment() {
    const binaryPath = detectBinary();
    return {
      healthy: !!binaryPath,
      binaryFound: !!binaryPath,
      // Qwen auth is config-file/OAuth based with no cheap status probe;
      // auth failures surface as visible run errors.
      authValid: true,
      helloProbeOk: false,
      errors: binaryPath ? [] : ['qwen binary not found'],
    };
  },
});
