import { randomBytes } from 'node:crypto';
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

import { getAppDataDir } from '@/shared/utils/paths';

export const MCP_SERVER_SECRET_FILE = 'mcp-server.secret';

export function getBridgeSecretPath(): string {
  return path.join(getAppDataDir(), MCP_SERVER_SECRET_FILE);
}

export function readBridgeSecret(): string | null {
  const secretPath = getBridgeSecretPath();
  if (!existsSync(secretPath)) return null;
  const value = readFileSync(secretPath, 'utf8').trim();
  return value.length > 0 ? value : null;
}

export function ensureBridgeSecret(): string {
  const existing = readBridgeSecret();
  if (existing) return existing;

  const secretPath = getBridgeSecretPath();
  mkdirSync(path.dirname(secretPath), { recursive: true });
  const secret = randomBytes(32).toString('base64url');
  const tmp = `${secretPath}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(tmp, secret, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
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
