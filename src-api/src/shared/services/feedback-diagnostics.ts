/**
 * Bug-report diagnostics collection — redacted by construction.
 *
 * Collects only non-secret runtime metadata: OS platform/release/arch, RSS
 * memory, app name/version, active provider id and MCP names if available.
 * Never includes API keys, tokens, or feedback body/email.
 */

import os from 'os';

import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('FeedbackDiagnostics');

export interface FeedbackDiagnostics {
  os: {
    platform: NodeJS.Platform;
    release: string;
    arch: string;
  };
  process: {
    nodeVersion: string;
    rssMb: number;
  };
  app: {
    name?: string;
    version?: string;
  };
  provider?: {
    id: string;
  };
  mcp?: {
    activeNames: string[];
  };
}

const SECRET_KEY_PATTERN = /(token|key|secret|password|api[_-]?key|bearer)/i;

/** Drop any field whose key looks secret-bearing. Defense-in-depth. */
export function redactSecrets(input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (SECRET_KEY_PATTERN.test(k)) continue;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = redactSecrets(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function collectFeedbackDiagnostics(opts?: {
  appName?: string;
  appVersion?: string;
  providerId?: string;
  mcpNames?: string[];
}): FeedbackDiagnostics {
  const memory = process.memoryUsage();
  const diag: FeedbackDiagnostics = {
    os: {
      platform: process.platform,
      release: os.release(),
      arch: process.arch,
    },
    process: {
      nodeVersion: process.version,
      rssMb: Math.round(memory.rss / 1024 / 1024),
    },
    app: {
      name: opts?.appName,
      version: opts?.appVersion,
    },
  };

  if (opts?.providerId) {
    diag.provider = { id: opts.providerId };
  }
  if (opts?.mcpNames && opts.mcpNames.length > 0) {
    diag.mcp = { activeNames: opts.mcpNames.slice(0, 20) };
  }

  try {
    return redactSecrets(diag) as FeedbackDiagnostics;
  } catch (err) {
    logger.warn('Diagnostic redaction failed; returning minimal shape', err);
    return {
      os: diag.os,
      process: diag.process,
      app: diag.app,
    };
  }
}
