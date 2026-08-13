import { getSetting } from '@/shared/db/operations';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('DesignMediaAliases');

let warnedMalformedEnv = false;

export function loadMediaModelAliases(): Record<string, string> {
  const env = process.env.DESIGNMODE_MEDIA_MODEL_ALIASES;
  if (env !== undefined) {
    if (env.trim() === '') return {};
    const parsed = parseAliasMap(env);
    if (parsed) return parsed;
    if (!warnedMalformedEnv) {
      warnedMalformedEnv = true;
      logger.warn(
        'DESIGNMODE_MEDIA_MODEL_ALIASES is malformed JSON; falling back to settings.',
      );
    }
  }

  const raw = getSetting('designMode');
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as {
      media?: { aliases?: unknown };
    };
    return normalizeAliasMap(parsed.media?.aliases);
  } catch {
    return {};
  }
}

export function resolveMediaModel(
  id: string,
  aliases = loadMediaModelAliases(),
): string {
  return aliases[id] ?? id;
}

function parseAliasMap(raw: string): Record<string, string> | null {
  try {
    return normalizeAliasMap(JSON.parse(raw));
  } catch {
    return null;
  }
}

function normalizeAliasMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const aliases: Record<string, string> = {};
  for (const [from, to] of Object.entries(value)) {
    if (typeof to === 'string' && from.trim() && to.trim()) {
      aliases[from] = to;
    }
  }
  return aliases;
}
