/**
 * Cursor Agent CLI Adapter
 *
 * Runs the `cursor-agent` headless CLI (https://cursor.com/cli) as an agent
 * provider. Invocation follows the documented headless shape:
 * `--print --output-format stream-json --stream-partial-output --force`,
 * prompt piped over stdin (no `-` sentinel — Cursor treats a bare dash as
 * the literal prompt), `--workspace <cwd>`, `--model` when not default, and
 * `--trust` only when the `--help` probe shows the flag (older builds exit 1
 * on unknown options).
 *
 * Replaces the former `cursor-local` adapter, which targeted the Cursor IDE
 * binary with an invented `--non-interactive` flag and was permanently gated.
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
import {
  buildSubprocessMcpConfig,
  type SubprocessMcpConfig,
} from '@/shared/mcp/subprocess-bridge';
import { createLogger } from '@/shared/utils/logger';

import { writeCursorWorkspaceMcpConfig } from './mcp-config';
import { CursorAgentStreamParser } from './stream';

const logger = createLogger('CursorAgent');

const execFileP = promisify(execFile);

const CURSOR_AGENT_METADATA: AgentProviderMetadata = {
  type: 'cursor-agent',
  name: 'Cursor Agent',
  description: 'Cursor Agent CLI running locally in headless mode',
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

interface CursorAgentConfig {
  binaryPath?: string;
  model?: string;
}

/** Binary detection priority: config → env var → PATH. */
function detectBinary(configPath?: string): string | null {
  if (configPath) return configPath;
  const envPath = process.env['CURSOR_AGENT_PATH'];
  if (envPath) return envPath;
  return resolveBinaryPath('cursor-agent', []);
}

/**
 * `--trust` grants workspace trust in headless runs but only newer builds
 * accept it; older ones exit 1 with "unknown option". Probe `--help` once
 * per process and cache the answer.
 */
let trustFlagProbes = new Map<string, Promise<boolean>>();
function probeTrustFlag(binaryPath: string): Promise<boolean> {
  let probe = trustFlagProbes.get(binaryPath);
  if (!probe) {
    probe = execFileP(binaryPath, ['--help'], {
      timeout: 5000,
      maxBuffer: 1024 * 1024,
    })
      .then(({ stdout }) => stdout.includes('--trust'))
      .catch(() => false);
    trustFlagProbes.set(binaryPath, probe);
  }
  return probe;
}

/** Test-only: reset the cached `--help` probe. */
export function resetCursorAgentProbesForTest(): void {
  trustFlagProbes = new Map();
}

export class CursorAgentAgent extends BaseAgent {
  readonly provider: AgentProvider = 'cursor-agent';
  private localConfig: CursorAgentConfig;

  constructor(config: AgentConfig) {
    super(config);
    const providerConfig = (config.providerConfig ??
      {}) as Partial<CursorAgentConfig>;
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
            'Cursor Agent binary not found. Install it from https://cursor.com/cli or set CURSOR_AGENT_PATH.',
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

      const args = [
        '--print',
        '--output-format',
        'stream-json',
        '--stream-partial-output',
        '--force',
      ];
      if (await probeTrustFlag(binaryPath)) args.push('--trust');
      args.push('--workspace', cwd);

      const model = stripRuntimeModelPrefix(
        'cursor-agent',
        this.localConfig.model,
      );
      if (model && model !== 'default') args.push('--model', model);

      const composed = formatCliConversationPrompt(
        options?.conversation,
        prompt,
      );
      const withContext = this.buildPromptWithContext(composed, options);
      const stdinText = `${ASK_USER_QUESTION_INSTRUCTION}\n\n${withContext}`;

      // Per-run in-process MCP servers (e.g. Video Mode's video-edit/media/
      // ffmpeg tools) reach Cursor over the loopback subprocess bridge:
      // render the bridge endpoints into the workspace `.cursor/mcp.json`
      // for the duration of this run — the same runtime-agnostic mechanism
      // the Codex adapter uses via `mcp_servers` config.
      let bridge: SubprocessMcpConfig | undefined;
      let restoreMcpConfig: (() => Promise<void>) | undefined;
      if (options?.bridgeInProcessServers?.length) {
        bridge = await buildSubprocessMcpConfig({
          sessionId: session.id,
          channelContext: options.channelContext,
          locale: options.locale,
          inProcessServers: options.bridgeInProcessServers,
          ...(options.disablePolicyServers ? { connectors: [] } : {}),
        });
        restoreMcpConfig = await writeCursorWorkspaceMcpConfig(cwd, bridge);
      }

      logger.info(
        `Spawning cursor-agent: model=${model ?? 'default'}, bridgedServers=${
          options?.bridgeInProcessServers?.length ?? 0
        }`,
      );

      try {
        yield* streamCliAgentTurn({
          runtimeName: 'Cursor Agent',
          parser: new CursorAgentStreamParser(),
          spec: {
            binaryPath,
            args,
            cwd,
            // Full inherited env, not a PATH/HOME allowlist: the launch env is
            // the user's local CLI setup (login/OAuth files, CLI homes,
            // CURSOR_API_KEY / CURSOR_AUTH_TOKEN). Stripping it breaks headless
            // auth even after `cursor-agent login` — see Open Design issue #951
            // and its env precedence notes (`runtimes/env.ts`).
            env: { ...process.env, ...(bridge?.env ?? {}) },
            stdinText,
            abortSignals: [
              options?.abortController?.signal,
              session.abortController.signal,
            ],
          },
        });
      } finally {
        bridge?.revoke();
        await restoreMcpConfig?.();
      }
    } catch (err) {
      logger.error('Cursor Agent error', { error: err });
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

export function createCursorAgentAgent(config: AgentConfig): CursorAgentAgent {
  return new CursorAgentAgent(config);
}

export const cursorAgentPlugin: AgentPlugin = defineAgentPlugin({
  metadata: CURSOR_AGENT_METADATA,
  factory: (config) => createCursorAgentAgent(config),
  async testEnvironment() {
    const binaryPath = detectBinary();
    if (!binaryPath) {
      return {
        healthy: false,
        binaryFound: false,
        authValid: false,
        helloProbeOk: false,
        errors: ['cursor-agent binary not found'],
      };
    }
    // An explicit API key/token in the app environment satisfies headless
    // auth on its own — mirror the detection-layer probe short-circuit.
    if (
      process.env['CURSOR_API_KEY']?.trim() ||
      process.env['CURSOR_AUTH_TOKEN']?.trim()
    ) {
      return {
        healthy: true,
        binaryFound: true,
        authValid: true,
        helloProbeOk: true,
        errors: [],
      };
    }
    // Probe with `cursor-agent models`: it exercises the same headless auth
    // path as `--print` runs. `cursor-agent status` can report a stale IDE
    // login while every headless command fails with "Authentication
    // required", so it must not be trusted here.
    const authRequired =
      /authentication required|not (logged|signed) in|no models available/i;
    try {
      const { stdout, stderr } = await execFileP(binaryPath, ['models'], {
        timeout: 5000,
        maxBuffer: 1024 * 1024,
      });
      const authValid = !authRequired.test(`${stdout}\n${stderr}`);
      return {
        healthy: authValid,
        binaryFound: true,
        authValid,
        helloProbeOk: true,
        errors: authValid
          ? []
          : [
              'cursor-agent headless auth is missing — run `cursor-agent login` in a terminal, or set CURSOR_API_KEY for the app.',
            ],
      };
    } catch (err) {
      const unauthenticated = authRequired.test(String(err));
      return {
        healthy: false,
        binaryFound: true,
        authValid: !unauthenticated,
        helloProbeOk: false,
        errors: [
          unauthenticated
            ? 'cursor-agent headless auth is missing — run `cursor-agent login` in a terminal, or set CURSOR_API_KEY for the app.'
            : `cursor-agent models probe failed: ${String(err)}`,
        ],
      };
    }
  },
});
