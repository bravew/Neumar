import { isAbsolute, relative, resolve, sep } from 'node:path';

import picomatch from 'picomatch';
import { z } from 'zod';

import { getSetting, saveSetting } from '@/shared/db/operations';
import { createLogger } from '@/shared/utils/logger';

import type {
  FilesystemOperation,
  FilesystemPermissionRule,
  ToolPermissionRules,
} from './tool-permission-registry';

const logger = createLogger('PermissionRules');

// ── Schema ───────────────────────────────────────────────────────────────────

export const ToolPermissionRulesSchema = z.object({
  alwaysAllow: z.array(z.string()).default([]),
  alwaysDeny: z.array(z.string()).default([]),
  alwaysAsk: z.array(z.string()).default([]),
  filesystem: z
    .array(
      z.object({
        pattern: z.string().min(1),
        effect: z.enum(['allow', 'deny']),
        ops: z
          .array(z.enum(['read', 'write', 'ls', 'glob', 'grep']))
          .optional(),
      }),
    )
    .default([]),
});

const SETTING_KEY = 'toolPermissionRules';

/**
 * Built-in tools that are safe to auto-allow for new users.
 * Excludes 'execute' classified tools (Bash, Task) which require explicit approval.
 */
export const DEFAULT_ALLOWED_TOOLS = [
  'Read',
  'Glob',
  'Grep',
  'LSP',
  'Skill',
  'Edit',
  'Write',
  'TodoWrite',
  'WebFetch',
  'WebSearch',
];

// ── Load / Save ──────────────────────────────────────────────────────────────

/**
 * Load user-configurable permission rules from the settings table.
 * Returns defaults if the setting is missing or contains invalid JSON.
 */
export function loadPermissionRules(): ToolPermissionRules {
  const raw = getSetting(SETTING_KEY);
  if (!raw) {
    // Seed defaults for new users so the UI shows pre-allowed tools
    const defaults: ToolPermissionRules = {
      alwaysAllow: [...DEFAULT_ALLOWED_TOOLS],
      alwaysDeny: [],
      alwaysAsk: [],
      filesystem: [],
    };
    saveSetting(SETTING_KEY, JSON.stringify(defaults));
    logger.info('Seeded default permission rules for new user');
    return defaults;
  }

  try {
    const parsed = JSON.parse(raw);
    const result = ToolPermissionRulesSchema.safeParse(parsed);
    if (result.success) {
      return result.data;
    }
    logger.warn(
      'Invalid permission rules in settings, using defaults:',
      result.error.message,
    );
  } catch (err) {
    logger.warn('Failed to parse permission rules JSON, using defaults:', err);
  }
  return {
    alwaysAllow: [...DEFAULT_ALLOWED_TOOLS],
    alwaysDeny: [],
    alwaysAsk: [],
    filesystem: [],
  };
}

/**
 * Save user-configurable permission rules to the settings table.
 * Validates before saving — throws on invalid input.
 */
export function savePermissionRules(rules: ToolPermissionRules): void {
  const result = ToolPermissionRulesSchema.safeParse(rules);
  if (!result.success) {
    throw new Error(`Invalid permission rules: ${result.error.message}`);
  }
  saveSetting(SETTING_KEY, JSON.stringify(result.data));
  logger.info('Permission rules saved:', {
    allow: result.data.alwaysAllow.length,
    deny: result.data.alwaysDeny.length,
    ask: result.data.alwaysAsk.length,
    filesystem: result.data.filesystem.length,
  });
}

export interface FilesystemPermissionEvaluationInput {
  workspaceRoot: string;
  targetPath: string;
  operation: FilesystemOperation;
  rules?: FilesystemPermissionRule[];
}

export interface FilesystemPermissionEvaluation {
  allowed: boolean;
  reason?: string;
  relativePath?: string;
  matchedRule?: FilesystemPermissionRule;
}

/**
 * Evaluate first-match-wins filesystem rules inside the workspace boundary.
 * The workspace containment check is always enforced before glob rules.
 */
export function evaluateFilesystemPermission({
  workspaceRoot,
  targetPath,
  operation,
  rules = [],
}: FilesystemPermissionEvaluationInput): FilesystemPermissionEvaluation {
  const root = resolve(workspaceRoot);
  const target = resolve(targetPath);
  const relativePath = toWorkspaceRelativePath(root, target);

  if (!relativePath) {
    return {
      allowed: false,
      reason: 'path is outside the workspace boundary',
    };
  }

  for (const rule of rules) {
    if (rule.ops && !rule.ops.includes(operation)) continue;
    if (!matchesFilesystemRule(relativePath, rule.pattern)) continue;
    return {
      allowed: rule.effect === 'allow',
      reason:
        rule.effect === 'allow'
          ? undefined
          : `matched deny rule ${rule.pattern}`,
      relativePath,
      matchedRule: rule,
    };
  }

  return { allowed: true, relativePath };
}

export function filterPermittedFilesystemPaths(
  paths: string[],
  input: Omit<FilesystemPermissionEvaluationInput, 'targetPath'>,
): string[] {
  return paths.filter(
    (path) =>
      evaluateFilesystemPermission({
        ...input,
        targetPath: path,
      }).allowed,
  );
}

function toWorkspaceRelativePath(
  workspaceRoot: string,
  targetPath: string,
): string | null {
  const rel = relative(workspaceRoot, targetPath);
  if (rel === '') return '.';
  if (rel.startsWith('..') || isAbsolute(rel)) return null;
  return rel.split(sep).join('/');
}

function matchesFilesystemRule(relativePath: string, pattern: string): boolean {
  const normalizedPattern = pattern
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '');
  const normalizedPath = relativePath.replace(/\\/g, '/');
  return picomatch.isMatch(normalizedPath, normalizedPattern, {
    dot: true,
    nocase: process.platform === 'win32',
  });
}
