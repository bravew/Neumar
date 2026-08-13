import { randomUUID } from 'node:crypto';

import { safeFetch } from '@/shared/network-policy/fetch';
import { trustedLocalPolicy } from '@/shared/network-policy/schema';

const MCP_RPC_TIMEOUT_MS = 10_000;
const MCP_RPC_MAX_BYTES = 8 * 1024 * 1024;

export interface ExternalMcpHttpServer {
  url: string;
  headers?: Record<string, string>;
}

export class ExternalMcpTransportError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'ExternalMcpTransportError';
  }
}

interface JsonRpcEnvelope {
  result?: unknown;
  error?: { code?: number; message?: string };
}

export async function listExternalMcpTools(server: ExternalMcpHttpServer) {
  const result = await externalMcpRpc(server, 'tools/list', {});
  if (
    !result ||
    typeof result !== 'object' ||
    !Array.isArray((result as { tools?: unknown }).tools)
  ) {
    throw new ExternalMcpTransportError(
      'MCP tools/list response did not contain a tools array',
      502,
      'invalid_response',
    );
  }
  return (result as { tools: unknown[] }).tools;
}

export async function callExternalMcpTool(
  server: ExternalMcpHttpServer,
  name: string,
  args: Record<string, unknown>,
) {
  return externalMcpRpc(server, 'tools/call', {
    name,
    arguments: args,
  });
}

async function externalMcpRpc(
  server: ExternalMcpHttpServer,
  method: string,
  params: Record<string, unknown>,
) {
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: randomUUID(),
    method,
    params,
  });
  if (Buffer.byteLength(body, 'utf8') > MCP_RPC_MAX_BYTES) {
    throw new ExternalMcpTransportError(
      'MCP tool payload exceeds 8 MB',
      413,
      'payload_too_large',
    );
  }

  const response = await safeFetch(server.url, trustedLocalPolicy(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(server.headers ?? {}),
    },
    body,
    timeoutMs: MCP_RPC_TIMEOUT_MS,
    maxRedirects: 2,
  });

  if (response.status === 401 || response.status === 403) {
    throw new ExternalMcpTransportError(
      'MCP server requires authentication',
      response.status,
      'auth_required',
    );
  }
  if (response.status < 200 || response.status >= 300) {
    throw new ExternalMcpTransportError(
      `MCP server returned HTTP ${response.status}`,
      502,
      'upstream_error',
    );
  }

  let envelope: JsonRpcEnvelope | null;
  try {
    envelope = parseJsonOrSseFirstFrame(
      response.body.toString('utf8'),
    ) as JsonRpcEnvelope | null;
  } catch {
    envelope = null;
  }
  if (!envelope || typeof envelope !== 'object') {
    throw new ExternalMcpTransportError(
      'MCP server returned an invalid response body',
      502,
      'invalid_response',
    );
  }
  if (envelope.error) {
    throw new ExternalMcpTransportError(
      envelope.error.message ?? 'MCP server returned a JSON-RPC error',
      502,
      'mcp_error',
    );
  }
  return envelope.result;
}

function parseJsonOrSseFirstFrame(body: string): unknown {
  const trimmed = body.trimStart();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return JSON.parse(trimmed);
  }
  const lines = trimmed.split(/\r?\n/);
  for (const line of lines) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice('data:'.length).trim();
    if (!payload || payload === '[DONE]') continue;
    return JSON.parse(payload);
  }
  return null;
}
