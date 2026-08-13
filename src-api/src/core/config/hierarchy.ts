import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { APP_DATA_DIR } from '@/config/branding';

import { getSetting } from '@/shared/db/operations';
import { createLogger } from '@/shared/utils/logger';

import type { ToolPermissionRules } from '../agent/tool-permission-registry';

const logger = createLogger('ConfigHierarchy');

// ── Types ────────────────────────────────────────────────────────────────────

export type ConfigSource = 'managed' | 'user' | 'project' | 'local';

// ── Config Hierarchy ─────────────────────────────────────────────────────────

/**
 * Settings hierarchy with source precedence:
 *   managed > local > project > user
 *
 * Managed settings are read-only and cannot be overridden.
 * Permission deny rules from managed layer are always enforced.
 */
export class ConfigHierarchy {
  private layers = new Map<ConfigSource, Record<string, unknown>>();

  constructor() {
    this.load();
  }

  /**
   * Load all configuration layers from their respective files.
   * Failures are silently ignored (files are optional).
   */
  load(): void {
    this.layers.clear();

    // 1. User: ~/.<slug>/settings.json
    const userPath = join(homedir(), APP_DATA_DIR, 'settings.json');
    this.loadFile('user', userPath);

    // 2. Project: {workDir}/.<slug>/settings.json
    const workDir = getSetting('workDir');
    if (workDir) {
      const projectPath = join(workDir, APP_DATA_DIR, 'settings.json');
      this.loadFile('project', projectPath);

      // 3. Local: {workDir}/.<slug>/settings.local.json (gitignored)
      const localPath = join(workDir, APP_DATA_DIR, 'settings.local.json');
      this.loadFile('local', localPath);
    }

    // 4. Managed: /etc/<slug>/settings.json (macOS/Linux), read-only
    const managedPath =
      process.platform === 'win32'
        ? join(
            process.env.PROGRAMDATA ?? 'C:\\ProgramData',
            APP_DATA_DIR,
            'settings.json',
          )
        : join('/etc', APP_DATA_DIR, 'settings.json');
    this.loadFile('managed', managedPath);

    logger.info('Config hierarchy loaded:', {
      layers: [...this.layers.keys()],
    });
  }

  /**
   * Get a config value with its source. Highest-priority source wins.
   * Priority: managed > local > project > user
   */
  get(key: string): { value: unknown; source: ConfigSource } | undefined {
    const sources: ConfigSource[] = ['managed', 'local', 'project', 'user'];
    for (const source of sources) {
      const layer = this.layers.get(source);
      if (layer && key in layer) {
        return { value: layer[key], source };
      }
    }
    return undefined;
  }

  /** Get just the value (no source info). */
  getEffective(key: string): unknown {
    return this.get(key)?.value;
  }

  /**
   * Write a value to a specific layer.
   * Throws if attempting to write to the managed layer.
   */
  set(key: string, value: unknown, source: ConfigSource): void {
    if (source === 'managed') {
      throw new Error(
        'Cannot write to managed configuration — it is read-only',
      );
    }
    const layer = this.layers.get(source) ?? {};
    layer[key] = value;
    this.layers.set(source, layer);
  }

  /**
   * Merge permission rules across all layers.
   * - Managed deny rules are always enforced (cannot be overridden)
   * - Allow/ask rules from all layers are merged additively and deduplicated
   */
  getMergedRules(): ToolPermissionRules {
    const merged: ToolPermissionRules = {
      alwaysAllow: [],
      alwaysDeny: [],
      alwaysAsk: [],
    };

    // Collect from all layers (order doesn't matter — we merge additively)
    const sources: ConfigSource[] = ['managed', 'user', 'project', 'local'];
    for (const source of sources) {
      const layer = this.layers.get(source);
      if (!layer) continue;

      const rules = layer.permissions as
        | Partial<ToolPermissionRules>
        | undefined;
      if (!rules) continue;

      if (Array.isArray(rules.alwaysAllow)) {
        merged.alwaysAllow.push(...rules.alwaysAllow);
      }
      if (Array.isArray(rules.alwaysDeny)) {
        merged.alwaysDeny.push(...rules.alwaysDeny);
      }
      if (Array.isArray(rules.alwaysAsk)) {
        merged.alwaysAsk.push(...rules.alwaysAsk);
      }
    }

    // Managed deny rules cannot be overridden — remove any allow/ask that
    // conflict with managed deny rules
    const managedLayer = this.layers.get('managed');
    const managedDeny = (
      managedLayer?.permissions as Partial<ToolPermissionRules> | undefined
    )?.alwaysDeny;
    if (Array.isArray(managedDeny) && managedDeny.length > 0) {
      const denySet = new Set(managedDeny);
      merged.alwaysAllow = merged.alwaysAllow.filter((r) => !denySet.has(r));
      merged.alwaysAsk = merged.alwaysAsk.filter((r) => !denySet.has(r));
    }

    // Deduplicate
    merged.alwaysAllow = [...new Set(merged.alwaysAllow)];
    merged.alwaysDeny = [...new Set(merged.alwaysDeny)];
    merged.alwaysAsk = [...new Set(merged.alwaysAsk)];

    return merged;
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private loadFile(source: ConfigSource, filePath: string): void {
    if (!existsSync(filePath)) return;

    try {
      const content = readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(content);
      if (typeof parsed === 'object' && parsed !== null) {
        this.layers.set(source, parsed);
        logger.debug(`Loaded ${source} config from ${filePath}`);
      }
    } catch (err) {
      logger.warn(`Failed to load ${source} config from ${filePath}:`, err);
    }
  }
}

// ── Singleton ────────────────────────────────────────────────────────────────

let instance: ConfigHierarchy | undefined;

export function getConfigHierarchy(): ConfigHierarchy {
  if (!instance) {
    instance = new ConfigHierarchy();
  }
  return instance;
}
