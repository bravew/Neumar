import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

import {
  createErrorEnvelope,
  httpStatusForError,
} from '@/shared/mcp/public-server/errors';
import { classifyIp } from '@/shared/network-policy/ip';
import { getAppDataDir } from '@/shared/utils/paths';

export const MCP_SERVER_SECRET_FILE = 'mcp-server.secret';

export function getBridgeSecretPath(): string {
  return path.join(getAppDataDir(), MCP_SERVER_SECRET_FILE);
}

export function ensureBridgeSecret(): string {
  const secretPath = getBridgeSecretPath();
  const existing = readBridgeSecret();
  if (existing) return existing;

  const dir = path.dirname(secretPath);
  mkdirSync(dir, { recursive: true });
  const secret = randomBytes(32).toString('base64url');
  const tmp = `${secretPath}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(tmp, secret, { encoding: 'utf8', flag: 'wx' });
  try {
    chmodSync(tmp, 0o600);
  } catch {
    // Windows may ignore mode bits.
  }
  try {
    renameSync(tmp, secretPath);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      // ignore cleanup failure
    }
    throw err;
  }
  try {
    chmodSync(secretPath, 0o600);
  } catch {
    // ignore
  }
  return secret;
}

export function readBridgeSecret(): string | null {
  const secretPath = getBridgeSecretPath();
  if (!existsSync(secretPath)) return null;
  const value = readFileSync(secretPath, 'utf8').trim();
  return value.length > 0 ? value : null;
}

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

export const mcpCommandAuth = createMiddleware(async (c, next) => {
  if (!isLoopbackRemote(getRemoteAddress(c))) {
    return c.json(
      createErrorEnvelope(
        'UNAUTHORIZED',
        'MCP command routes are loopback-only',
      ),
      httpStatusForError('UNAUTHORIZED') as ContentfulStatusCode,
    );
  }
  const expected = readBridgeSecret();
  const provided = extractBearer(c);
  if (!expected || !provided || !secretsEqual(provided, expected)) {
    return c.json(
      createErrorEnvelope(
        'UNAUTHORIZED',
        'Invalid or missing MCP bridge secret',
      ),
      httpStatusForError('UNAUTHORIZED') as ContentfulStatusCode,
    );
  }
  await next();
});
