/**
 * A2A Protocol Integration
 *
 * Agent-to-Agent protocol support for interoperability with
 * A2A-compliant agents (RC v1.0).
 */

export { A2AClient, type A2AClientOptions } from './client';
export { A2AAgent, createA2AAgent, a2aPlugin } from './plugin';
export type {
  A2AAgentCard,
  A2AArtifact,
  A2AMessage,
  A2APart,
  A2AStreamEvent,
  A2ATask,
  A2ATaskStateValue,
  JsonRpcRequest,
  JsonRpcResponse,
} from './types';
export { A2AMethods, A2ATaskState } from './types';

import { createLogger } from '@/shared/utils/logger';

import { A2AClient } from './client';
import type { A2AAgentCard } from './types';

const logger = createLogger('A2A');

/**
 * Discover multiple A2A agents from a list of URLs.
 */
export async function discoverA2AAgents(
  urls: string[],
): Promise<A2AAgentCard[]> {
  const cards: A2AAgentCard[] = [];

  for (const url of urls) {
    try {
      const client = new A2AClient(url);
      const card = await client.discoverAgent();
      cards.push(card);
    } catch (error) {
      logger.warn(
        `Failed to discover agent at ${url}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return cards;
}
