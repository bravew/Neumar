import { SAFE_READ_TOOL_NAMES } from './catalog';
import { refreshDaemonUrl } from './discover';
import {
  ExternalMcpError,
  createErrorEnvelope,
  isRetryableReadError,
  type ExternalMcpErrorEnvelope,
} from './errors';
import { toolHttpMapping } from './handlers';
import { readBridgeSecret } from './secret';

const DEFAULT_TIMEOUT_MS = 10_000;
const DAEMON_BASE_PATH = '/mcp/server';

export interface DaemonClientOptions {
  initialUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  readSecret?: () => string | null;
}

export interface DaemonHealth {
  version: string;
  ready: boolean;
  daemonUrl: string | null;
  flags: {
    enabled: boolean;
    writesEnabled: boolean;
    agentRunsEnabled: boolean;
    resultLimit: number;
  };
}

export interface DaemonClient {
  inFlight: number;
  currentUrl: string;
  call(toolName: string, args: Record<string, unknown>): Promise<unknown>;
  health(): Promise<DaemonHealth>;
}

function isEnvelope(value: unknown): value is ExternalMcpErrorEnvelope {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as ExternalMcpErrorEnvelope).code === 'string' &&
    typeof (value as ExternalMcpErrorEnvelope).message === 'string'
  );
}

function throwHttpError(status: number, body: unknown): never {
  if (isEnvelope(body)) {
    throw new ExternalMcpError(body.code, body.message, body.requestId);
  }
  if (status === 401 || status === 403) {
    throw new ExternalMcpError('UNAUTHORIZED', 'Daemon rejected the request');
  }
  if (status === 404) {
    throw new ExternalMcpError('NOT_FOUND', 'Not found');
  }
  if (status === 413) {
    throw new ExternalMcpError('PAYLOAD_TOO_LARGE', 'Payload too large');
  }
  throw new ExternalMcpError(
    'DAEMON_UNREACHABLE',
    `Daemon returned HTTP ${status}`,
  );
}

function toQuery(args: Record<string, unknown>, omit: Set<string>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(args)) {
    if (omit.has(key) || value === undefined) continue;
    params.set(key, String(value));
  }
  const encoded = params.toString();
  return encoded ? `?${encoded}` : '';
}

export function createDaemonClient(options: DaemonClientOptions): DaemonClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const readSecret = options.readSecret ?? readBridgeSecret;
  let currentUrl = options.initialUrl.replace(/\/$/, '');
  let inFlight = 0;

  async function request(
    toolName: string,
    args: Record<string, unknown>,
    allowRetry: boolean,
  ): Promise<unknown> {
    const mapping = toolHttpMapping(toolName);
    if (!mapping) {
      throw new ExternalMcpError(
        'VALIDATION_FAILED',
        `Unknown tool: ${toolName}`,
      );
    }

    const path = mapping.path(args);
    const query =
      mapping.method === 'GET' ? toQuery(args, mapping.pathKeys) : '';
    const url = `${currentUrl}${DAEMON_BASE_PATH}${path}${query}`;
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };
    if (mapping.auth) {
      const secret = readSecret();
      if (!secret) {
        throw new ExternalMcpError(
          'UNAUTHORIZED',
          'MCP bridge secret is missing',
        );
      }
      headers.Authorization = `Bearer ${secret}`;
    }
    if (mapping.method !== 'GET') {
      headers['Content-Type'] = 'application/json';
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    inFlight += 1;
    try {
      const response = await fetchImpl(url, {
        method: mapping.method,
        headers,
        body:
          mapping.method === 'GET'
            ? undefined
            : JSON.stringify(mapping.body ? mapping.body(args) : args),
        signal: controller.signal,
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) throwHttpError(response.status, body);
      return body;
    } catch (err) {
      if (err instanceof ExternalMcpError) {
        if (isRetryableReadError(err.code) && !mapping.retryable) {
          currentUrl = refreshDaemonUrl(currentUrl);
          throw err;
        }
        if (
          allowRetry &&
          mapping.retryable &&
          isRetryableReadError(err.code) &&
          SAFE_READ_TOOL_NAMES.has(toolName)
        ) {
          currentUrl = refreshDaemonUrl(currentUrl);
          return await request(toolName, args, false);
        }
        throw err;
      }
      const aborted =
        err instanceof Error &&
        (err.name === 'AbortError' || err.message.includes('abort'));
      const wrapped = new ExternalMcpError(
        aborted ? 'TIMEOUT' : 'DAEMON_UNREACHABLE',
        aborted
          ? 'Timed out waiting for the Neumar app'
          : 'Neumar app is not running. Start Neumar and retry.',
      );
      if (isRetryableReadError(wrapped.code) && !mapping.retryable) {
        currentUrl = refreshDaemonUrl(currentUrl);
        throw wrapped;
      }
      if (
        allowRetry &&
        mapping.retryable &&
        isRetryableReadError(wrapped.code) &&
        SAFE_READ_TOOL_NAMES.has(toolName)
      ) {
        currentUrl = refreshDaemonUrl(currentUrl);
        return await request(toolName, args, false);
      }
      throw wrapped;
    } finally {
      inFlight -= 1;
      clearTimeout(timer);
    }
  }

  return {
    get inFlight() {
      return inFlight;
    },
    get currentUrl() {
      return currentUrl;
    },
    async call(toolName, args) {
      return request(toolName, args, true);
    },
    async health() {
      const body = await request('neumar_health', {}, true);
      return body as DaemonHealth;
    },
  };
}

export function errorResult(err: unknown): {
  isError: true;
  content: Array<{ type: 'text'; text: string }>;
} {
  const envelope =
    err instanceof ExternalMcpError
      ? err.toEnvelope()
      : createErrorEnvelope(
          'DAEMON_UNREACHABLE',
          err instanceof Error ? err.message : 'Tool failed',
        );
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify(envelope) }],
  };
}
