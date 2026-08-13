/**
 * A2A Client
 *
 * JSON-RPC 2.0 client for A2A agent communication.
 * Supports agent card discovery, task lifecycle, and SSE streaming.
 */

import crypto from 'crypto';

import { safeFetch, safeFetchStream } from '@/shared/network-policy/fetch';
import { trustedLocalPolicy } from '@/shared/network-policy/schema';
import { createLogger } from '@/shared/utils/logger';
import { validateBaseUrl } from '@/shared/utils/url-validator';

import type {
  A2AAgentCard,
  A2AMessage,
  A2AStreamEvent,
  A2ATask,
  JsonRpcRequest,
  JsonRpcResponse,
} from './types';
import { A2AMethods } from './types';

const logger = createLogger('A2AClient');

export interface A2ASseParseResult {
  events: A2AStreamEvent[];
  done: boolean;
  rest: string;
  malformedData: string[];
}

export interface A2AClientOptions {
  timeout?: number;
  headers?: Record<string, string>;
}

function splitSseBlocks(
  input: string,
  flush = false,
): { blocks: string[]; rest: string } {
  const blocks: string[] = [];
  let rest = input;

  while (true) {
    const match = /\r?\n\r?\n/.exec(rest);
    if (!match || match.index === undefined) break;
    blocks.push(rest.slice(0, match.index));
    rest = rest.slice(match.index + match[0].length);
  }

  if (flush && rest.trim()) {
    blocks.push(rest);
    rest = '';
  }

  return { blocks, rest };
}

function parseSseDataBlock(block: string): string | null {
  const dataLines: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).replace(/^ /, ''));
    }
  }
  if (dataLines.length === 0) return null;
  return dataLines.join('\n').trim();
}

export function parseA2ASseChunk(
  input: string,
  options: { flush?: boolean } = {},
): A2ASseParseResult {
  const { blocks, rest } = splitSseBlocks(input, options.flush === true);
  const events: A2AStreamEvent[] = [];
  const malformedData: string[] = [];
  let done = false;

  for (const block of blocks) {
    const data = parseSseDataBlock(block);
    if (!data) continue;
    if (data === '[DONE]') {
      done = true;
      break;
    }
    try {
      events.push(JSON.parse(data) as A2AStreamEvent);
    } catch {
      malformedData.push(data.slice(0, 100));
    }
  }

  return { events, done, rest: done ? '' : rest, malformedData };
}

/**
 * A2A Client for agent-to-agent communication.
 */
export class A2AClient {
  private agentUrl: string;
  private timeout: number;
  private headers: Record<string, string>;

  constructor(agentUrl: string, options?: A2AClientOptions) {
    // Sync hostname-only pre-check — rejects malformed URLs and obvious
    // private/internal IPs early. Per-request validation in `validateTarget`
    // adds DNS pinning to close the rebinding window.
    const syncCheck = validateBaseUrl(agentUrl);
    if (!syncCheck.valid) {
      throw new Error(`A2A agent URL validation failed: ${syncCheck.reason}`);
    }
    this.agentUrl = agentUrl.replace(/\/$/, '');
    this.timeout = options?.timeout || 30000;
    this.headers = options?.headers || {};
  }

  /**
   * Discover agent capabilities via agent card.
   */
  async discoverAgent(): Promise<A2AAgentCard> {
    const url = `${this.agentUrl}/.well-known/agent-card.json`;
    logger.info(`Discovering agent at ${url}`);

    const response = await safeFetch(url, trustedLocalPolicy(), {
      method: 'GET',
      headers: this.headers,
      timeoutMs: this.timeout,
      maxRedirects: 0,
    });

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Agent card discovery failed: HTTP ${response.status}`);
    }

    return JSON.parse(response.body.toString('utf-8')) as A2AAgentCard;
  }

  /**
   * Send a message to an A2A agent (non-streaming).
   */
  async sendMessage(params: {
    id: string;
    sessionId?: string;
    message: A2AMessage;
  }): Promise<A2ATask> {
    return this.rpc<A2ATask>(A2AMethods.SEND_MESSAGE, {
      id: params.id,
      sessionId: params.sessionId,
      message: params.message,
    });
  }

  /**
   * Send a streaming message to an A2A agent (SSE).
   */
  async *sendStreamingMessage(params: {
    id: string;
    sessionId?: string;
    message: A2AMessage;
  }): AsyncGenerator<A2AStreamEvent> {
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: crypto.randomUUID(),
      method: A2AMethods.SEND_STREAMING_MESSAGE,
      params: {
        id: params.id,
        sessionId: params.sessionId,
        message: params.message,
      },
    };

    const response = await safeFetchStream(
      this.agentUrl,
      trustedLocalPolicy(),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          ...this.headers,
        },
        body: JSON.stringify(request),
        timeoutMs: this.timeout,
      },
    );

    if (response.status < 200 || response.status >= 300) {
      response.stream.resume();
      throw new Error(`A2A streaming failed: HTTP ${response.status}`);
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      for await (const chunk of response.stream) {
        buffer += decoder.decode(chunk as Buffer, { stream: true });
        const parsed = parseA2ASseChunk(buffer);
        buffer = parsed.rest;

        for (const data of parsed.malformedData) {
          logger.warn(`Skipping malformed A2A SSE data: ${data.slice(0, 100)}`);
        }
        for (const event of parsed.events) {
          yield event;
        }
        if (parsed.done) return;
      }

      buffer += decoder.decode();
      const parsed = parseA2ASseChunk(buffer, { flush: true });
      for (const data of parsed.malformedData) {
        logger.warn(`Skipping malformed A2A SSE data: ${data.slice(0, 100)}`);
      }
      for (const event of parsed.events) {
        yield event;
      }
    } finally {
      response.stream.destroy();
    }
  }

  /**
   * Get a task by ID.
   */
  async getTask(taskId: string): Promise<A2ATask> {
    return this.rpc<A2ATask>(A2AMethods.GET_TASK, {
      id: taskId,
    });
  }

  /**
   * List tasks for a session.
   */
  async listTasks(sessionId?: string): Promise<A2ATask[]> {
    return this.rpc<A2ATask[]>(A2AMethods.LIST_TASKS, {
      sessionId,
    });
  }

  /**
   * Cancel a task.
   */
  async cancelTask(taskId: string): Promise<A2ATask> {
    return this.rpc<A2ATask>(A2AMethods.CANCEL_TASK, {
      id: taskId,
    });
  }

  /**
   * Send a JSON-RPC 2.0 request.
   */
  private async rpc<T>(
    method: string,
    params: Record<string, unknown>,
  ): Promise<T> {
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: crypto.randomUUID(),
      method,
      params,
    };

    const response = await safeFetch(this.agentUrl, trustedLocalPolicy(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.headers,
      },
      body: JSON.stringify(request),
      timeoutMs: this.timeout,
      maxRedirects: 0,
    });

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`A2A RPC '${method}' failed: HTTP ${response.status}`);
    }

    const rpcResponse = JSON.parse(
      response.body.toString('utf-8'),
    ) as JsonRpcResponse<T>;

    if (rpcResponse.error) {
      throw new Error(
        `A2A RPC error [${rpcResponse.error.code}]: ${rpcResponse.error.message}`,
      );
    }

    return rpcResponse.result as T;
  }
}
