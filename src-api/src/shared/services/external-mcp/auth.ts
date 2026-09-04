import { createHash, timingSafeEqual } from 'node:crypto';

import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

import {
  createErrorEnvelope,
  httpStatusForError,
} from '@/shared/mcp/public-server/errors';
import { readBridgeSecret } from '@/shared/mcp/public-server/secret';
import { classifyIp } from '@/shared/network-policy/ip';

import { recordExternalMcpAudit } from './audit';

export {
  MCP_SERVER_SECRET_FILE,
  ensureBridgeSecret,
  getBridgeSecretPath,
  readBridgeSecret,
} from '@/shared/mcp/public-server/secret';

function getRemoteAddress(c: Context): string | undefined {
  const incoming = (
    c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined
  )?.incoming;
  return incoming?.socket?.remoteAddress;
}

export function isLoopbackRemote(remote: string | undefined): boolean {
  if (!remote) return true;
  return classifyIp(remote)?.classification === 'loopback';
}

export function extractBearer(c: Context): string | undefined {
  const header = c.req.header('authorization') ?? c.req.header('Authorization');
  return header?.match(/^Bearer\s+(\S+)$/i)?.[1];
}

function secretsEqual(left: string, right: string): boolean {
  const leftHash = createHash('sha256').update(left).digest();
  const rightHash = createHash('sha256').update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

function unauthorized(c: Context, message: string) {
  recordExternalMcpAudit({
    action: 'block',
    route: c.req.path,
    method: c.req.method,
    code: 'UNAUTHORIZED',
  });
  return c.json(
    createErrorEnvelope('UNAUTHORIZED', message),
    httpStatusForError('UNAUTHORIZED') as ContentfulStatusCode,
  );
}

export const mcpCommandAuth = createMiddleware(async (c, next) => {
  if (!isLoopbackRemote(getRemoteAddress(c))) {
    return unauthorized(c, 'MCP command routes are loopback-only');
  }
  const expected = readBridgeSecret();
  const provided = extractBearer(c);
  if (!expected || !provided || !secretsEqual(provided, expected)) {
    return unauthorized(c, 'Invalid or missing MCP bridge secret');
  }
  await next();
});
