/**
 * Gateway Config Loader
 *
 * Loads gateway.json from ~/.neumar/, resolves env: references, validates with Zod.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

import { APP_DATA_DIR } from '@/config/branding';

import { createLogger } from '@/shared/utils/logger';

import { GatewayConfigSchema, type GatewayConfig } from './types';

const logger = createLogger('GatewayConfig');

let cachedConfig: GatewayConfig | null = null;

function getConfigPath(): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || '';
  return join(homeDir, APP_DATA_DIR, 'gateway.json');
}

/**
 * Resolve `env:VAR_NAME` references in config values to actual env vars.
 * Recurses through objects and arrays.
 */
function resolveEnvRefs(obj: unknown): unknown {
  if (typeof obj === 'string' && obj.startsWith('env:')) {
    const varName = obj.slice(4);
    const value = process.env[varName];
    if (value === undefined) {
      logger.warn(
        `Environment variable '${varName}' referenced in gateway config is not set`,
      );
      return '';
    }
    return value;
  }
  if (Array.isArray(obj)) {
    return obj.map(resolveEnvRefs);
  }
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = resolveEnvRefs(value);
    }
    return result;
  }
  return obj;
}

export function loadGatewayConfig(force = false): GatewayConfig {
  if (cachedConfig && !force) return cachedConfig;

  const configPath = getConfigPath();

  let rawConfig: unknown = {};
  if (existsSync(configPath)) {
    try {
      const content = readFileSync(configPath, 'utf-8');
      rawConfig = JSON.parse(content);
      logger.info(`Loaded gateway config from ${configPath}`);
    } catch (err) {
      logger.warn(
        `Failed to parse gateway config: ${err instanceof Error ? err.message : String(err)}`,
      );
      rawConfig = {};
    }
  } else {
    logger.info('No gateway.json found, using defaults');
  }

  // Resolve env: references
  const resolved = resolveEnvRefs(rawConfig);

  // Validate with Zod (defaults fill in missing fields)
  const result = GatewayConfigSchema.safeParse(resolved);
  if (!result.success) {
    logger.warn(`Gateway config validation errors: ${result.error.message}`);
    cachedConfig = GatewayConfigSchema.parse({});
  } else {
    cachedConfig = result.data;
  }

  return cachedConfig;
}

export function saveGatewayConfig(config: GatewayConfig): void {
  const configPath = getConfigPath();
  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  cachedConfig = config;
  logger.info('Gateway config saved');
}

export function getGatewayConfig(): GatewayConfig {
  return cachedConfig ?? loadGatewayConfig();
}

export function isGatewayEnabled(): boolean {
  return getGatewayConfig().gateway.enabled;
}
