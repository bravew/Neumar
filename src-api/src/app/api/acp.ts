/**
 * ACP / A2A Routes
 *
 * Two protocol surfaces share this module:
 *  - A2A v0.3.0 over HTTP JSON-RPC at `POST /acp/a2a` (+ SSE streaming).
 *  - ACP (Agent Client Protocol) over WebSocket at `WS /acp/ws`.
 *
 * The agent-card endpoint lives at `/.well-known/agent-card.json` and is
 * mounted from `index.ts` at the root path.
 *
 * Auth: Bearer JWT (HS256) signed with `WEBUI_JWT_SECRET`. Tokens issued
 * before `NEUMA_BOOT_AT` are rejected so a daemon restart invalidates
 * any leaked tokens.
 *
 * NOTE: This is a protocol-shape skeleton. `message/send` returns a task
 * envelope with a `submitted` state but does not yet route the message to
 * the agent loop — wiring `payload → agent run` is a follow-up.
 */

import { randomUUID } from 'node:crypto';

import { Hono } from 'hono';
import type { Context } from 'hono';
import { verify } from 'hono/jwt';
import { streamSSE } from 'hono/streaming';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

import {
  A2ATaskState,
  type A2AAgentCard,
  type A2AMessage,
  type A2ATask,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from '@/extensions/agent/a2a/types';

import { getAllAgentProfiles } from '@/shared/db/operations';
import {
  acpRpcKey,
  acpRpcLimiter,
} from '@/shared/services/gateway/core/concurrency';
import { createLogger } from '@/shared/utils/logger';
import { getUpgradeWebSocket } from '@/shared/ws';

const logger = createLogger('AcpRoutes');

// ============================================================================
// Boot timestamp — JWTs older than this are rejected.
// ============================================================================

const BOOT_AT_SECONDS = Math.floor(Date.now() / 1000);
process.env.NEUMA_BOOT_AT = String(BOOT_AT_SECONDS);

// ============================================================================
// In-memory task store (replace with DB-backed gateway_sessions in follow-up)
// ============================================================================

interface StoredTask extends A2ATask {
  createdAt: number;
  identityId: string;
}

const taskStore = new Map<string, StoredTask>();

// Cap memory usage — FIFO eviction by insertion order. Map iteration order is
// insertion order, and tasks are inserted at creation time, so the first key
// is also the chronologically oldest.
const MAX_TASKS = 500;
function rememberTask(task: StoredTask): void {
  taskStore.set(task.id, task);
  if (taskStore.size > MAX_TASKS) {
    const oldestKey = taskStore.keys().next().value;
    if (oldestKey !== undefined) taskStore.delete(oldestKey);
  }
}

// ============================================================================
// Auth — bearer JWT, with iat >= NEUMA_BOOT_AT enforcement
// ============================================================================

interface AcpClaims {
  sub?: string;
  tier?: 'viewer' | 'operator' | 'admin';
  iat?: number;
  exp?: number;
}

function identityId(claims: AcpClaims): string {
  return claims.sub ?? 'anonymous';
}

async function verifyBearer(c: Context): Promise<AcpClaims | null> {
  const auth = c.req.header('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;
  const secret = process.env.WEBUI_JWT_SECRET;
  if (!secret) return null;
  try {
    const claims = (await verify(
      token,
      secret,
      'HS256',
    )) as unknown as AcpClaims;
    if (typeof claims.iat === 'number' && claims.iat < BOOT_AT_SECONDS) {
      logger.warn('Rejected JWT issued before NEUMA_BOOT_AT');
      return null;
    }
    return claims;
  } catch {
    return null;
  }
}

function unauthorized(c: Context) {
  return c.json({ error: 'Unauthorized' }, 401 as ContentfulStatusCode);
}

function consumeAcpRpc(
  c: Context,
  claims: AcpClaims,
): { allowed: true } | { allowed: false; response: Response } {
  const limit = acpRpcLimiter.consume(acpRpcKey(identityId(claims)));
  if (limit.allowed) return { allowed: true };
  c.header('Retry-After', String(limit.retryAfterSecs));
  return {
    allowed: false,
    response: c.json(
      jsonRpcError(null, -32029, 'Rate limit exceeded'),
      429 as ContentfulStatusCode,
    ),
  };
}

// ============================================================================
// Agent card — built from active profiles
// ============================================================================

export function buildAgentCard(baseUrl: string): A2AAgentCard {
  const profiles = getAllAgentProfiles('active');
  return {
    name: 'Neuma',
    description: 'Multi-channel agentic workstation',
    url: `${baseUrl}/acp/a2a`,
    version: '6.0.0',
    capabilities: { streaming: true, stateTransitionHistory: false },
    authentication: { schemes: ['bearer'] },
    skills: profiles.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description ?? p.role ?? 'Agent profile',
      tags: p.role ? [p.role] : undefined,
    })),
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
  };
}

// ============================================================================
// JSON-RPC helpers
// ============================================================================

function jsonRpcOk<T>(id: string | number, result: T): JsonRpcResponse<T> {
  return { jsonrpc: '2.0', id, result };
}

function jsonRpcError(
  id: string | number | null,
  code: number,
  message: string,
): JsonRpcResponse {
  return { jsonrpc: '2.0', id: id ?? 0, error: { code, message } };
}

function extractMessage(
  params: Record<string, unknown> | undefined,
): A2AMessage | null {
  if (!params || typeof params !== 'object') return null;
  const message = (params as { message?: unknown }).message;
  if (!message || typeof message !== 'object') return null;
  const m = message as Partial<A2AMessage>;
  if (m.role !== 'user' && m.role !== 'agent') return null;
  if (!Array.isArray(m.parts)) return null;
  return { role: m.role, parts: m.parts };
}

function newTask(identityId: string, message: A2AMessage): StoredTask {
  const now = new Date().toISOString();
  const task: StoredTask = {
    id: randomUUID(),
    status: { state: A2ATaskState.SUBMITTED, message, timestamp: now },
    history: [message],
    createdAt: Date.now(),
    identityId,
  };
  rememberTask(task);
  return task;
}

// ============================================================================
// JSON-RPC dispatcher
// ============================================================================

interface DispatchOutcome {
  status: ContentfulStatusCode;
  body: JsonRpcResponse;
  /** Set when the response should be SSE-streamed instead of JSON. */
  stream?: AsyncGenerator<JsonRpcResponse>;
}

async function dispatch(
  req: JsonRpcRequest,
  identity: AcpClaims,
): Promise<DispatchOutcome> {
  const id = req.id;
  switch (req.method) {
    case 'message/send': {
      const message = extractMessage(req.params);
      if (!message) {
        return {
          status: 400,
          body: jsonRpcError(id, -32602, 'Invalid params: message required'),
        };
      }
      const task = newTask(identityId(identity), message);
      // Mark working immediately — real agent execution is wired in follow-up.
      task.status.state = A2ATaskState.WORKING;
      return { status: 200, body: jsonRpcOk(id, task) };
    }

    case 'message/stream': {
      const message = extractMessage(req.params);
      if (!message) {
        return {
          status: 400,
          body: jsonRpcError(id, -32602, 'Invalid params: message required'),
        };
      }
      const task = newTask(identityId(identity), message);
      async function* gen(): AsyncGenerator<JsonRpcResponse> {
        task.status.state = A2ATaskState.WORKING;
        yield jsonRpcOk(id, { type: 'status', task });
        task.status.state = A2ATaskState.COMPLETED;
        task.status.timestamp = new Date().toISOString();
        yield jsonRpcOk(id, { type: 'status', task });
        yield jsonRpcOk(id, { type: 'done', taskId: task.id });
      }
      return {
        status: 200,
        body: jsonRpcOk(id, { taskId: task.id }),
        stream: gen(),
      };
    }

    case 'tasks/get': {
      const taskId = (req.params as { id?: string } | undefined)?.id;
      if (!taskId) {
        return {
          status: 400,
          body: jsonRpcError(id, -32602, 'Missing task id'),
        };
      }
      const task = taskStore.get(taskId);
      if (!task) {
        return {
          status: 404,
          body: jsonRpcError(id, -32001, 'Task not found'),
        };
      }
      return { status: 200, body: jsonRpcOk(id, task) };
    }

    case 'tasks/cancel': {
      const taskId = (req.params as { id?: string } | undefined)?.id;
      if (!taskId) {
        return {
          status: 400,
          body: jsonRpcError(id, -32602, 'Missing task id'),
        };
      }
      const task = taskStore.get(taskId);
      if (!task) {
        return {
          status: 404,
          body: jsonRpcError(id, -32001, 'Task not found'),
        };
      }
      task.status.state = A2ATaskState.CANCELED;
      task.status.timestamp = new Date().toISOString();
      return { status: 200, body: jsonRpcOk(id, task) };
    }

    default:
      return {
        status: 404,
        body: jsonRpcError(id, -32601, `Method not found: ${req.method}`),
      };
  }
}

// ============================================================================
// HTTP routes
// ============================================================================

export const acpRoutes = new Hono();

acpRoutes.post('/a2a', async (c) => {
  const claims = await verifyBearer(c);
  if (!claims) return unauthorized(c);
  const rateLimit = consumeAcpRpc(c, claims);
  if (!rateLimit.allowed) return rateLimit.response;

  let req: JsonRpcRequest;
  try {
    req = (await c.req.json()) as JsonRpcRequest;
  } catch {
    return c.json(
      jsonRpcError(null, -32700, 'Parse error'),
      400 as ContentfulStatusCode,
    );
  }
  if (req?.jsonrpc !== '2.0' || typeof req.method !== 'string') {
    return c.json(
      jsonRpcError(req?.id ?? null, -32600, 'Invalid Request'),
      400 as ContentfulStatusCode,
    );
  }

  const outcome = await dispatch(req, claims);

  if (outcome.stream) {
    return streamSSE(c, async (sse) => {
      for await (const event of outcome.stream!) {
        await sse.writeSSE({ data: JSON.stringify(event) });
      }
    });
  }

  return c.json(outcome.body, outcome.status);
});

// ============================================================================
// ACP WebSocket — JSON-RPC over NDJSON frames
// ============================================================================

export interface AcpSession {
  id: string;
  mode: string;
  modelId: string | null;
  identityId: string;
}

type ApplyAcpSessionModelResult =
  | { ok: true; modelId: string | null }
  | { ok: false; error: JsonRpcResponse };

function getStringParam(
  params: Record<string, unknown> | undefined,
  key: string,
): string | null {
  const value = params?.[key];
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}

export function applyAcpSessionModel(
  session: AcpSession,
  params: Record<string, unknown> | undefined,
  id: string | number,
): ApplyAcpSessionModelResult {
  const modelId =
    getStringParam(params, 'modelId') ?? getStringParam(params, 'model');
  if (!modelId) {
    return {
      ok: false,
      error: jsonRpcError(id, -32602, 'Invalid params: modelId required'),
    };
  }

  session.modelId = modelId === 'default' ? null : modelId;
  return { ok: true, modelId: session.modelId };
}

acpRoutes.get('/ws', (c, next) => {
  const upgradeWebSocket = getUpgradeWebSocket();
  return upgradeWebSocket(() => {
    const sessions = new Map<string, AcpSession>();
    let identity: AcpClaims | null = null;

    return {
      async onMessage(event, ws) {
        let frame: JsonRpcRequest;
        try {
          frame = JSON.parse(String(event.data)) as JsonRpcRequest;
        } catch {
          ws.send(JSON.stringify(jsonRpcError(null, -32700, 'Parse error')));
          return;
        }

        const { id, method, params } = frame;

        if (method === 'initialize') {
          ws.send(
            JSON.stringify(
              jsonRpcOk(id, {
                protocolVersion: '0.1.0',
                serverInfo: { name: 'Neuma', version: '6.0.0' },
                capabilities: { sessions: true, streaming: true },
              }),
            ),
          );
          return;
        }

        if (method === 'authenticate') {
          const token = (params as { token?: string } | undefined)?.token ?? '';
          const secret = process.env.WEBUI_JWT_SECRET;
          if (!secret) {
            ws.send(
              JSON.stringify(
                jsonRpcError(id, -32000, 'Server auth not configured'),
              ),
            );
            return;
          }
          try {
            const claims = (await verify(
              token,
              secret,
              'HS256',
            )) as unknown as AcpClaims;
            if (
              typeof claims.iat === 'number' &&
              claims.iat < BOOT_AT_SECONDS
            ) {
              ws.send(
                JSON.stringify(
                  jsonRpcError(id, -32001, 'Token issued before boot'),
                ),
              );
              return;
            }
            identity = claims;
            ws.send(JSON.stringify(jsonRpcOk(id, { sub: claims.sub })));
          } catch {
            ws.send(JSON.stringify(jsonRpcError(id, -32001, 'Invalid token')));
          }
          return;
        }

        if (!identity) {
          ws.send(JSON.stringify(jsonRpcError(id, -32001, 'Unauthorized')));
          return;
        }

        const rateLimit = acpRpcLimiter.consume(
          acpRpcKey(identityId(identity)),
        );
        if (!rateLimit.allowed) {
          ws.send(
            JSON.stringify(
              jsonRpcError(
                id,
                -32029,
                `Rate limit exceeded; retry after ${rateLimit.retryAfterSecs}s`,
              ),
            ),
          );
          return;
        }

        switch (method) {
          case 'session/new': {
            const session: AcpSession = {
              id: randomUUID(),
              mode: 'default',
              modelId: null,
              identityId: identityId(identity),
            };
            sessions.set(session.id, session);
            ws.send(
              JSON.stringify(
                jsonRpcOk(id, {
                  sessionId: session.id,
                  modelId: session.modelId ?? 'default',
                }),
              ),
            );
            return;
          }
          case 'session/list': {
            ws.send(
              JSON.stringify(
                jsonRpcOk(id, { sessions: Array.from(sessions.values()) }),
              ),
            );
            return;
          }
          case 'session/set_mode': {
            const sid = (params as { sessionId?: string } | undefined)
              ?.sessionId;
            const mode =
              (params as { mode?: string } | undefined)?.mode ?? 'default';
            const session = sid ? sessions.get(sid) : null;
            if (!session) {
              ws.send(
                JSON.stringify(jsonRpcError(id, -32001, 'Session not found')),
              );
              return;
            }
            session.mode = mode;
            ws.send(JSON.stringify(jsonRpcOk(id, { ok: true })));
            return;
          }
          case 'session/set_model': {
            const sid = (params as { sessionId?: string } | undefined)
              ?.sessionId;
            const session = sid ? sessions.get(sid) : null;
            if (!session) {
              ws.send(
                JSON.stringify(jsonRpcError(id, -32001, 'Session not found')),
              );
              return;
            }
            const applied = applyAcpSessionModel(
              session,
              params as Record<string, unknown> | undefined,
              id,
            );
            if (!applied.ok) {
              ws.send(JSON.stringify(applied.error));
              return;
            }
            ws.send(
              JSON.stringify(
                jsonRpcOk(id, {
                  ok: true,
                  modelId: applied.modelId ?? 'default',
                }),
              ),
            );
            return;
          }
          case 'session/cancel': {
            const sid = (params as { sessionId?: string } | undefined)
              ?.sessionId;
            if (sid) sessions.delete(sid);
            ws.send(JSON.stringify(jsonRpcOk(id, { ok: true })));
            return;
          }
          case 'session/prompt': {
            const sid = (params as { sessionId?: string } | undefined)
              ?.sessionId;
            const session = sid ? sessions.get(sid) : null;
            if (!session) {
              ws.send(
                JSON.stringify(jsonRpcError(id, -32001, 'Session not found')),
              );
              return;
            }
            // Streamed response — emit two JSON-RPC notifications then resolve.
            ws.send(
              JSON.stringify({
                jsonrpc: '2.0',
                method: 'session/update',
                params: {
                  sessionId: session.id,
                  status: 'working',
                  modelId: session.modelId ?? 'default',
                },
              }),
            );
            ws.send(
              JSON.stringify({
                jsonrpc: '2.0',
                method: 'session/update',
                params: {
                  sessionId: session.id,
                  status: 'completed',
                  modelId: session.modelId ?? 'default',
                },
              }),
            );
            ws.send(JSON.stringify(jsonRpcOk(id, { sessionId: session.id })));
            return;
          }
          default:
            ws.send(
              JSON.stringify(
                jsonRpcError(id, -32601, `Method not found: ${method}`),
              ),
            );
        }
      },
      onClose() {
        sessions.clear();
        identity = null;
      },
      onError(err) {
        logger.warn('ACP WS error', err);
      },
    };
  })(c, next);
});

// ============================================================================
// Well-known agent card — mounted at root in index.ts
// ============================================================================

export const wellKnownRoutes = new Hono();

wellKnownRoutes.get('/agent-card.json', (c) => {
  const url = new URL(c.req.url);
  const baseUrl = `${url.protocol}//${url.host}`;
  return c.json(buildAgentCard(baseUrl));
});
