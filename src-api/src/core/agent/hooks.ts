/**
 * Agent Prompt Build Hooks
 *
 * Provides a before_prompt_build plugin hook so agent plugins can inject,
 * prepend, or replace system context without modifying core files.
 *
 * Inspired by OpenClaw's plugin hook architecture.
 *
 * Merge strategy:
 *   - systemPrompt: highest-priority plugin wins (first result encountered)
 *   - prependContext: all plugins concatenate in priority order
 *   - appendContext:  all plugins concatenate in priority order
 */

import type { ContextMode } from '@/core/agent/types';

import { getSetting } from '@/shared/db/operations';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('PromptBuildHooks');

// ============================================================================
// Hook Types
// ============================================================================

export interface PromptBuildInput {
  /** The raw user prompt */
  prompt: string;
  /** The resolved system context from AgentContextResolver */
  systemContext: string;
  /** Full vs minimal context tier */
  contextMode: ContextMode;
}

export interface PromptBuildResult {
  /** Replace entire systemContext (last plugin with this field wins) */
  systemPrompt?: string;
  /** Prepend before systemContext — all plugins accumulate in priority order */
  prependContext?: string;
  /** Append after systemContext — all plugins accumulate in priority order */
  appendContext?: string;
}

export type PromptBuildHook = (
  input: PromptBuildInput,
) => PromptBuildResult | Promise<PromptBuildResult>;

export interface HookTimeoutConfig {
  timeoutMs: number;
  slowWarnMs: number;
  enforceTimeout: boolean;
}

export const DEFAULT_HOOK_TIMEOUT_MS = 15_000;
export const DEFAULT_HOOK_SLOW_WARN_MS = 10_000;

export class HookTimeoutError extends Error {
  constructor(
    readonly hookName: string,
    readonly timeoutMs: number,
  ) {
    super(`Hook "${hookName}" timed out after ${timeoutMs}ms`);
    this.name = 'HookTimeoutError';
  }
}

export async function runHookWithTimeout<T>(
  hookName: string,
  fn: () => T | Promise<T>,
  config: HookTimeoutConfig = readHookTimeoutConfig(),
): Promise<T> {
  let slowTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    logger.warn('agent.hook_slow', {
      hookName,
      slowWarnMs: config.slowWarnMs,
      timeoutMs: config.timeoutMs,
      enforceTimeout: config.enforceTimeout,
    });
  }, config.slowWarnMs);

  try {
    const hookPromise = Promise.resolve().then(fn);
    if (!config.enforceTimeout) {
      return await hookPromise;
    }

    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
    try {
      return await Promise.race([
        hookPromise,
        new Promise<never>((_, reject) => {
          timeoutTimer = setTimeout(() => {
            logger.warn('agent.hook_timeout', {
              hookName,
              timeoutMs: config.timeoutMs,
            });
            reject(new HookTimeoutError(hookName, config.timeoutMs));
          }, config.timeoutMs);
        }),
      ]);
    } finally {
      if (timeoutTimer) clearTimeout(timeoutTimer);
    }
  } finally {
    if (slowTimer) {
      clearTimeout(slowTimer);
      slowTimer = null;
    }
  }
}

export function readHookTimeoutConfig(): HookTimeoutConfig {
  if (process.env.NODE_ENV === 'test') {
    return {
      timeoutMs: DEFAULT_HOOK_TIMEOUT_MS,
      slowWarnMs: DEFAULT_HOOK_SLOW_WARN_MS,
      enforceTimeout: false,
    };
  }
  const timeoutMs = parsePositiveIntSetting(
    getSetting('flags.hooks.timeoutMs'),
    DEFAULT_HOOK_TIMEOUT_MS,
  );
  return {
    timeoutMs,
    slowWarnMs: Math.min(DEFAULT_HOOK_SLOW_WARN_MS, timeoutMs),
    enforceTimeout: parseBooleanSetting(
      getSetting('flags.hooks.enforceTimeout'),
    ),
  };
}

function parsePositiveIntSetting(
  value: string | null,
  fallback: number,
): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBooleanSetting(value: string | null): boolean {
  return value === 'true' || value === '1';
}

// ============================================================================
// Hook Runner
// ============================================================================

export class PromptBuildHookRunner {
  private hooks: Array<{ priority: number; fn: PromptBuildHook }> = [];

  constructor(private readonly timeoutConfig?: HookTimeoutConfig) {}

  /**
   * Register a hook. Higher priority runs first.
   */
  register(fn: PromptBuildHook, priority = 0): void {
    this.hooks.push({ priority, fn });
    // Keep sorted descending so iteration order == priority order
    this.hooks.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Run all hooks and compose the final system context string.
   * Returns the base systemContext unchanged if no hooks are registered.
   */
  async compose(base: string, input: PromptBuildInput): Promise<string> {
    if (this.hooks.length === 0) return base;

    let override: string | undefined;
    const prepends: string[] = [];
    const appends: string[] = [];

    for (const { fn } of this.hooks) {
      try {
        const result = await runHookWithTimeout(
          'before_prompt_build',
          () => fn(input),
          this.timeoutConfig,
        );
        // systemPrompt: first one wins (hooks run in descending priority order,
        // so the first result is from the highest-priority plugin)
        if (result.systemPrompt !== undefined && override === undefined)
          override = result.systemPrompt;
        if (result.prependContext) prepends.push(result.prependContext);
        if (result.appendContext) appends.push(result.appendContext);
      } catch (err) {
        logger.warn(`before_prompt_build hook failed: ${err}`);
      }
    }

    const effective = override ?? base;
    return [...prepends, effective, ...appends].filter(Boolean).join('\n\n');
  }

  get size(): number {
    return this.hooks.length;
  }
}

// ============================================================================
// Global singleton
// ============================================================================

export const promptBuildHooks = new PromptBuildHookRunner();
