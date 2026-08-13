/**
 * A2A Agent Plugin
 *
 * AgentPlugin implementation for A2A (Agent-to-Agent) transport.
 */

import crypto from 'crypto';

import {
  BaseAgent,
  formatPlanForExecution,
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

import { DEFAULT_WORK_DIR } from '@/config/constants';

import { createLogger } from '@/shared/utils/logger';

import { A2AClient } from './client';
import { A2ATaskState } from './types';
import type { A2AStreamEvent, A2ATask } from './types';

const logger = createLogger('A2APlugin');

const A2A_METADATA: AgentProviderMetadata = {
  type: 'a2a',
  name: 'A2A Agent',
  version: '1.0.0',
  description:
    'Agent-to-Agent protocol integration. Connects to remote A2A-compliant agents via JSON-RPC 2.0.',
  configSchema: {
    type: 'object',
    properties: {
      baseUrl: {
        type: 'string',
        description: 'A2A agent endpoint URL',
      },
      workDir: {
        type: 'string',
        default: DEFAULT_WORK_DIR,
      },
    },
    required: ['baseUrl'],
  },
  builtin: true,
  supportsPlan: false,
  supportsStreaming: true,
  supportsSandbox: false,
  tags: ['a2a', 'agent-to-agent', 'protocol'],
  transport: 'a2a',
  supportsMcp: 'none',
  supportsSkills: 'none',
  supportsPlanMode: 'none',
  requiresApiKey: false,
  supportsEnvironmentTest: true,
  supportsModelDiscovery: false,
};

/**
 * Map A2A task state to AgentMessage type.
 */
function mapTaskStateToMessageType(state: string): AgentMessage['type'] {
  switch (state) {
    case A2ATaskState.SUBMITTED:
      return 'session';
    case A2ATaskState.WORKING:
      return 'text';
    case A2ATaskState.INPUT_REQUIRED:
      return 'text';
    case A2ATaskState.AUTH_REQUIRED:
      return 'error';
    case A2ATaskState.COMPLETED:
      return 'result';
    case A2ATaskState.FAILED:
      return 'error';
    case A2ATaskState.CANCELED:
      return 'done';
    case A2ATaskState.REJECTED:
      return 'error';
    default:
      return 'text';
  }
}

/**
 * Convert A2A task to AgentMessage.
 */
function taskToMessage(task: A2ATask): AgentMessage {
  const msgType = mapTaskStateToMessageType(task.status.state);

  // Extract text content from task message parts
  let content = '';
  if (task.status.message?.parts) {
    content = task.status.message.parts
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map((p) => p.text)
      .join('\n');
  }

  // Also include artifact content
  if (task.artifacts) {
    for (const artifact of task.artifacts) {
      const artifactText = artifact.parts
        .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map((p) => p.text)
        .join('\n');
      if (artifactText) {
        content += (content ? '\n' : '') + artifactText;
      }
    }
  }

  return {
    type: msgType,
    content: content || undefined,
    sessionId: task.sessionId,
  };
}

/**
 * A2A Agent implementation.
 */
export class A2AAgent extends BaseAgent {
  readonly provider = 'a2a' as const;

  constructor(config: AgentConfig) {
    super(config);
  }

  async *run(
    prompt: string,
    options?: AgentOptions,
  ): AsyncGenerator<AgentMessage> {
    const sessionId = options?.sessionId || crypto.randomUUID();
    yield { type: 'session', sessionId };

    if (!this.config.baseUrl) {
      yield {
        type: 'error',
        content: 'A2A agent requires a baseUrl configuration',
      };
      return;
    }

    const client = new A2AClient(this.config.baseUrl, {
      headers: this.config.apiKey
        ? { Authorization: `Bearer ${this.config.apiKey}` }
        : undefined,
    });

    const taskId = crypto.randomUUID();

    try {
      // Try streaming first
      let hasEvents = false;
      for await (const event of client.sendStreamingMessage({
        id: taskId,
        sessionId,
        message: {
          role: 'user',
          parts: [{ type: 'text', text: prompt }],
        },
      })) {
        hasEvents = true;
        yield this.handleStreamEvent(event);
      }

      if (!hasEvents) {
        // Fall back to non-streaming
        const task = await client.sendMessage({
          id: taskId,
          sessionId,
          message: {
            role: 'user',
            parts: [{ type: 'text', text: prompt }],
          },
        });
        yield taskToMessage(task);
      }
    } catch (error) {
      yield {
        type: 'error',
        content: error instanceof Error ? error.message : String(error),
      };
    }

    yield { type: 'done' };
  }

  async *plan(
    prompt: string,
    options?: PlanOptions,
  ): AsyncGenerator<AgentMessage> {
    yield* this.run(`${PLANNING_INSTRUCTION}\n\n${prompt}`, options);
  }

  async *execute(options: ExecuteOptions): AsyncGenerator<AgentMessage> {
    const plan = options.plan || this.getPlan(options.planId);
    if (!plan) {
      yield {
        type: 'error',
        content: `Plan not found: ${options.planId}`,
      };
      return;
    }
    yield* this.run(formatPlanForExecution(plan), options);
  }

  async stop(_sessionId: string): Promise<void> {
    // A2A tasks are cancelled via the client
    logger.info('A2A agent stop requested');
  }

  private handleStreamEvent(event: A2AStreamEvent): AgentMessage {
    switch (event.type) {
      case 'status':
        return taskToMessage(event.task);
      case 'artifact': {
        const content = event.artifact.parts
          .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
          .map((p) => p.text)
          .join('\n');
        return { type: 'text', content };
      }
      case 'done':
        return { type: 'done' };
      default:
        return { type: 'text' };
    }
  }
}

export function createA2AAgent(config: AgentConfig): A2AAgent {
  return new A2AAgent(config);
}

async function testA2AEnvironment(
  config: AgentConfig,
): Promise<AdapterEnvironmentReport> {
  const errors: string[] = [];

  if (!config.baseUrl) {
    return {
      healthy: false,
      binaryFound: true,
      authValid: true,
      helloProbeOk: false,
      errors: ['No A2A agent URL configured'],
    };
  }

  try {
    const client = new A2AClient(config.baseUrl);
    const card = await client.discoverAgent();
    logger.info(`Discovered A2A agent: ${card.name}`);
    return {
      healthy: true,
      binaryFound: true,
      authValid: true,
      helloProbeOk: true,
      errors: [],
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    errors.push(`Agent discovery failed: ${msg}`);
    return {
      healthy: false,
      binaryFound: true,
      authValid: true,
      helloProbeOk: false,
      errors,
    };
  }
}

/**
 * A2A agent plugin definition
 */
export const a2aPlugin: AgentPlugin = defineAgentPlugin({
  metadata: A2A_METADATA,
  factory: (config) => createA2AAgent(config),
  testEnvironment: testA2AEnvironment,
});
