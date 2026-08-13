import { open } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { sanitizeCustomModel } from './validation.js';

const MAX_SETTINGS_BYTES = 1024 * 1024;
const MAX_CONFIGURED_MODELS = 200;

function resolveSettingsPath(env: NodeJS.ProcessEnv, userHome: string): string {
  const configured = env.QWEN_SETTINGS_FILE?.trim();
  if (!configured) return join(userHome, '.qwen', 'settings.json');
  if (configured === '~') return userHome;
  if (configured.startsWith('~/') || configured.startsWith('~\\')) {
    return join(userHome, configured.slice(2));
  }
  return configured;
}

async function readBoundedJson(path: string): Promise<unknown> {
  const handle = await open(path, 'r');
  try {
    const stats = await handle.stat();
    if (stats.size > MAX_SETTINGS_BYTES) return null;
    const buffer = Buffer.alloc(Math.max(1, stats.size));
    const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, 0);
    return JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'));
  } finally {
    await handle.close();
  }
}

function selectedModelId(value: unknown): unknown {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  return record.id ?? record.name;
}

/**
 * Read only configured Qwen model ids. Settings failures intentionally degrade
 * to an empty list so the registry can keep its tested fallback models.
 */
export async function readQwenConfiguredModelIds(
  options: {
    env?: NodeJS.ProcessEnv;
    userHome?: string;
  } = {},
): Promise<string[]> {
  const env = options.env ?? process.env;
  const userHome = options.userHome ?? homedir();
  let settings: unknown;
  try {
    settings = await readBoundedJson(resolveSettingsPath(env, userHome));
  } catch {
    return [];
  }
  if (!settings || typeof settings !== 'object') return [];

  const root = settings as Record<string, unknown>;
  const candidates: unknown[] = [selectedModelId(root.model)];
  if (root.modelProviders && typeof root.modelProviders === 'object') {
    for (const entries of Object.values(
      root.modelProviders as Record<string, unknown>,
    )) {
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        if (entry && typeof entry === 'object') {
          candidates.push((entry as Record<string, unknown>).id);
        }
      }
    }
  }

  const ids: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const id = sanitizeCustomModel(candidate);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length === MAX_CONFIGURED_MODELS) break;
  }
  return ids;
}
