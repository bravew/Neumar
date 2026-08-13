import type { Options } from '@anthropic-ai/claude-agent-sdk';

import { runHookWithTimeout, type HookTimeoutConfig } from '@/core/agent/hooks';

import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('ToolLifecycleHooks');

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ToolHookInput {
  toolName: string;
  toolInput: unknown;
  toolResult?: unknown;
  sessionId: string;
}

export interface ToolHookOutput {
  action: 'allow' | 'deny' | 'modify';
  modifiedInput?: Record<string, unknown>;
  message?: string;
  systemMessage?: string;
}

export interface ToolLifecycleHook {
  event: 'pre_tool_use' | 'post_tool_use';
  matcher?: string; // regex pattern e.g. "Write|Edit", "Bash"
  handler: (input: ToolHookInput) => Promise<ToolHookOutput>;
  priority?: number; // higher priority runs first
  async?: boolean; // fire-and-forget
  /** @internal Compiled regex cached at registration time */
  _compiledMatcher?: RegExp;
}

// SDK hook types (subset needed for conversion)
// Use Function type to avoid SDK type coupling — the SDK will validate at runtime
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SdkHookCallback = (...args: any[]) => Promise<SdkHookJSONOutput>;

interface SdkHookJSONOutput {
  continue?: boolean;
  suppressOutput?: boolean;
  systemMessage?: string;
  reason?: string;
  hookSpecificOutput?: {
    hookEventName: 'PreToolUse' | 'PostToolUse';
    permissionDecision?: 'allow' | 'deny' | 'ask';
    permissionDecisionReason?: string;
    updatedInput?: Record<string, unknown>;
    additionalContext?: string;
  };
}

// ── Hook Runner ────────────────────────────────────────────────────────────────

export class ToolLifecycleHookRunner {
  private hooks: ToolLifecycleHook[] = [];

  constructor(private readonly timeoutConfig?: HookTimeoutConfig) {}

  register(hook: ToolLifecycleHook): void {
    if (hook.matcher) {
      try {
        hook._compiledMatcher = new RegExp(hook.matcher);
      } catch {
        /* fallback to string match */
      }
    }
    this.hooks.push(hook);
    this.hooks.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  }

  /**
   * Convert registered hooks to SDK-compatible HookCallbackMatcher format.
   * Used by the Claude adapter to pass hooks to query() options.
   */
  toSdkHooks(): Pick<
    NonNullable<Options['hooks']>,
    'PreToolUse' | 'PostToolUse'
  > {
    const preToolUseHooks = this.hooks.filter(
      (h) => h.event === 'pre_tool_use',
    );
    const postToolUseHooks = this.hooks.filter(
      (h) => h.event === 'post_tool_use',
    );

    const result: Pick<
      NonNullable<Options['hooks']>,
      'PreToolUse' | 'PostToolUse'
    > = {};

    if (preToolUseHooks.length > 0) {
      result.PreToolUse = preToolUseHooks.map((hook) => ({
        matcher: hook.matcher,
        hooks: [this.wrapForSdk(hook, 'PreToolUse')],
      }));
    }

    if (postToolUseHooks.length > 0) {
      result.PostToolUse = postToolUseHooks.map((hook) => ({
        matcher: hook.matcher,
        hooks: [this.wrapForSdk(hook, 'PostToolUse')],
      }));
    }

    return result;
  }

  /**
   * Execute pre-tool-use hooks directly (for non-SDK providers).
   */
  async runPreToolUse(
    toolName: string,
    input: unknown,
    sessionId: string,
  ): Promise<ToolHookOutput> {
    const hooks = this.hooks.filter(
      (h) => h.event === 'pre_tool_use' && this.matchesHook(toolName, h),
    );

    for (const hook of hooks) {
      try {
        const result = await runHookWithTimeout(
          `${hook.event}:${toolName}`,
          () =>
            hook.handler({
              toolName,
              toolInput: input,
              sessionId,
            }),
          this.timeoutConfig,
        );
        if (result.action === 'deny') {
          return result;
        }
        if (result.action === 'modify' && result.modifiedInput) {
          return result;
        }
      } catch (error) {
        logger.error(`PreToolUse hook error for ${toolName}:`, error);
        // Hooks fail open — don't block tool execution
      }
    }

    return { action: 'allow' };
  }

  /**
   * Execute post-tool-use hooks directly (for non-SDK providers).
   */
  async runPostToolUse(
    toolName: string,
    input: unknown,
    result: unknown,
    sessionId: string,
  ): Promise<void> {
    const hooks = this.hooks.filter(
      (h) => h.event === 'post_tool_use' && this.matchesHook(toolName, h),
    );

    for (const hook of hooks) {
      try {
        if (hook.async) {
          // Fire-and-forget
          runHookWithTimeout(
            `${hook.event}:${toolName}`,
            () =>
              hook.handler({
                toolName,
                toolInput: input,
                toolResult: result,
                sessionId,
              }),
            this.timeoutConfig,
          ).catch((err) =>
            logger.error(`Async PostToolUse hook error for ${toolName}:`, err),
          );
        } else {
          await runHookWithTimeout(
            `${hook.event}:${toolName}`,
            () =>
              hook.handler({
                toolName,
                toolInput: input,
                toolResult: result,
                sessionId,
              }),
            this.timeoutConfig,
          );
        }
      } catch (error) {
        logger.error(`PostToolUse hook error for ${toolName}:`, error);
      }
    }
  }

  private wrapForSdk(
    hook: ToolLifecycleHook,
    hookEventName: 'PreToolUse' | 'PostToolUse',
  ): SdkHookCallback {
    return async (sdkInput: unknown, _toolUseID, _abort) => {
      try {
        // Extract tool name from SDK input
        const input = sdkInput as Record<string, unknown> | undefined;
        const toolName = (input?.tool_name as string) ?? 'unknown';
        const toolInput = input?.tool_input ?? {};
        // PostToolUse SDK payload includes `tool_response`; PreToolUse doesn't.
        const toolResult =
          hookEventName === 'PostToolUse' ? input?.tool_response : undefined;

        const result = await runHookWithTimeout(
          `${hook.event}:${toolName}`,
          () =>
            hook.handler({
              toolName,
              toolInput,
              toolResult,
              sessionId: '', // SDK hooks don't have direct session access
            }),
          this.timeoutConfig,
        );

        if (hookEventName === 'PreToolUse') {
          if (result.action === 'deny') {
            return {
              continue: false,
              reason: result.message,
              hookSpecificOutput: {
                hookEventName: 'PreToolUse' as const,
                permissionDecision: 'deny' as const,
                permissionDecisionReason: result.message,
              },
            };
          }
          if (result.action === 'modify' && result.modifiedInput) {
            return {
              continue: true,
              hookSpecificOutput: {
                hookEventName: 'PreToolUse' as const,
                permissionDecision: 'allow' as const,
                updatedInput: result.modifiedInput,
              },
            };
          }
        }

        return {
          continue: true,
          ...(result.systemMessage
            ? { systemMessage: result.systemMessage }
            : {}),
        };
      } catch (error) {
        logger.error(`SDK hook wrapper error:`, error);
        // Fail open
        return { continue: true };
      }
    };
  }

  private matchesHook(toolName: string, hook: ToolLifecycleHook): boolean {
    if (!hook.matcher) return true;
    if (hook._compiledMatcher) return hook._compiledMatcher.test(toolName);
    return toolName === hook.matcher;
  }
}
