/**
 * Mock Agent Adapter
 *
 * Replays a pre-recorded session as neuma AgentMessages — zero LLM tokens,
 * zero network. Modeled on open-design's `mocks/` replay CLIs
 * (_sample/open-design/mocks), but wired at neuma's own IAgent boundary
 * instead of spawning an external CLI: neuma drives the Claude Agent SDK over
 * a bidirectional control protocol that a stdout-only mock can't satisfy, so
 * the faithful seam is the agent registry, not the `claude` binary.
 *
 * Use it to drive the full chat-server pipeline (routes → registry → agent →
 * AgentMessage stream → SSE → UI) deterministically in e2e tests and local
 * iteration. Select provider `mock`; pin a trace with NEUMA_MOCK_TRACE.
 * See ./README.md and ./recording.ts.
 */

import crypto from 'node:crypto';

import {
  BaseAgent,
  formatPlanForExecution,
  isConversationalPrompt,
  PLANNING_INSTRUCTION,
} from '@/core/agent/base';
import { defineAgentPlugin } from '@/core/agent/plugin';
import type { AgentPlugin, AgentProviderMetadata } from '@/core/agent/plugin';
import type {
  AdapterEnvironmentReport,
  AgentConfig,
  AgentMessage,
  AgentOptions,
  ExecuteOptions,
  PlanOptions,
} from '@/core/agent/types';

import { createLogger } from '@/shared/utils/logger';

import { pickRecording } from './recording';

const logger = createLogger('MockAgent');

const MOCK_AGENT_METADATA: AgentProviderMetadata = {
  type: 'mock',
  name: 'Mock Agent (replay)',
  version: '1.0.0',
  description:
    'Replays a recorded session as AgentMessages. Zero tokens — for e2e tests and offline iteration. Trace selected via NEUMA_MOCK_TRACE / NEUMA_MOCK_POOL.',
  configSchema: {
    type: 'object',
    properties: {
      // Per-config trace override; falls back to NEUMA_MOCK_TRACE env.
      model: {
        type: 'string',
        description:
          'Recording id (or prefix) to replay; overrides NEUMA_MOCK_TRACE',
      },
    },
  },
  builtin: true,
  supportsPlan: false,
  supportsStreaming: true,
  supportsSandbox: false,
  tags: ['mock', 'replay', 'testing'],
  transport: 'sdk',
  supportsMcp: 'none',
  supportsSkills: 'none',
  supportsPlanMode: 'none',
  requiresApiKey: false,
  supportsEnvironmentTest: true,
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MAX_STEP_DELAY_MS = 1500;

/**
 * Mock Agent implementation — replays a recording as an AgentMessage stream.
 */
export class MockAgent extends BaseAgent {
  readonly provider = 'mock' as const;
  private aborted = new Set<string>();

  constructor(config: AgentConfig) {
    super(config);
  }

  async *run(
    prompt: string,
    options?: AgentOptions,
  ): AsyncGenerator<AgentMessage> {
    const sessionId = options?.sessionId || crypto.randomUUID();
    yield { type: 'session', sessionId, cwd: options?.cwd };

    // A per-config trace (config.model) wins over the env so multiple mock
    // tasks can replay different traces concurrently.
    let recording;
    try {
      recording = pickRecording({ trace: this.config.model });
    } catch (err) {
      yield {
        type: 'error',
        content: err instanceof Error ? err.message : String(err),
      };
      yield { type: 'done' };
      return;
    }

    if (!recording) {
      yield {
        type: 'error',
        content:
          'No mock recordings found. Add a *.jsonl fixture under extensions/agent/mock/recordings/ or set NEUMA_MOCK_RECORDINGS_DIR.',
      };
      yield { type: 'done' };
      return;
    }

    logger.info(
      `[${sessionId}] Replaying "${recording.id}" (${recording.events.length} events) via ${recording.method}`,
    );

    const noDelay = process.env.NEUMA_MOCK_NO_DELAY === '1';
    const signal = options?.abortController?.signal;
    const results = new Map<
      string,
      Extract<(typeof recording.events)[number], { type: 'tool_result' }>
    >();
    for (const e of recording.events) {
      if (e.type === 'tool_result') results.set(e.id, e);
    }

    let lastT = 0;
    for (const e of recording.events) {
      if (this.aborted.has(sessionId) || signal?.aborted) {
        this.aborted.delete(sessionId);
        yield { type: 'done' };
        return;
      }
      if (e.type === 'tool_result') continue; // emitted alongside its tool_call

      const t = 't_ms' in e && typeof e.t_ms === 'number' ? e.t_ms : undefined;
      if (!noDelay && t !== undefined) {
        const delta = Math.min(MAX_STEP_DELAY_MS, Math.max(0, t - lastT));
        if (delta > 0) await sleep(delta);
        lastT = t;
        if (signal?.aborted) {
          yield { type: 'done' };
          return;
        }
      }

      switch (e.type) {
        case 'thinking':
          yield { type: 'thinking', content: e.content };
          break;
        case 'text':
          yield { type: 'text', content: e.content };
          break;
        case 'tool_call': {
          yield { type: 'tool_use', id: e.id, name: e.name, input: e.input };
          const result = results.get(e.id);
          yield {
            type: 'tool_result',
            toolUseId: e.id,
            output: result?.output ?? '',
            isError: result?.isError ?? false,
          };
          break;
        }
        case 'report':
          yield { type: 'text', content: e.content };
          break;
        case 'error':
          yield { type: 'error', content: e.content };
          break;
      }
    }

    yield {
      type: 'result',
      usage: { input_tokens: 0, output_tokens: 0 },
      cost: 0,
    };
    yield { type: 'done' };
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

  async stop(sessionId: string): Promise<void> {
    this.aborted.add(sessionId);
    await super.stop(sessionId);
  }
}

export function createMockAgent(config: AgentConfig): MockAgent {
  return new MockAgent(config);
}

async function testMockEnvironment(
  _config: AgentConfig,
): Promise<AdapterEnvironmentReport> {
  const errors: string[] = [];
  let found = false;
  try {
    found = pickRecording() !== null;
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }
  if (!found && errors.length === 0) {
    errors.push('No mock recordings on disk.');
  }
  return {
    healthy: found,
    binaryFound: true, // N/A — in-process replay
    authValid: true,
    helloProbeOk: found,
    errors,
  };
}

/**
 * Mock Agent plugin definition.
 */
export const mockAgentPlugin: AgentPlugin = defineAgentPlugin({
  metadata: MOCK_AGENT_METADATA,
  factory: (config) => createMockAgent(config),
  testEnvironment: testMockEnvironment,
});
