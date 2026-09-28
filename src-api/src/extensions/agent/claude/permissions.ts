/**
 * Claude Agent SDK permission wiring.
 *
 * Two regimes, chosen per run:
 *
 * - **Host-approved** (the run has a `taskId`, so the UI can answer a
 *   `permission_request`, or the caller opted into `autoApprove`): every tool
 *   call goes through `canUseTool` and the per-session
 *   {@link ToolPermissionRegistry}. The run's bare `allowedTools` entries are
 *   moved out of the SDK options and into this module's pre-approval list —
 *   passed to the SDK they would auto-approve the whole tool before the
 *   callback runs (`CLAUDE_SDK_CAN_USE_TOOL_SHADOWED`).
 * - **Headless** (no `taskId`, no `autoApprove` — schedules, pipelines,
 *   automations): nobody can answer a prompt, so the SDK gets
 *   `permissionPrompts: 'none'` and denies anything its rules don't allow.
 *   Only the run's explicit `allowedTools` still run, with `Edit`/`Write`
 *   narrowed to the session's workspace directories. A `PreToolUse` hook
 *   still applies the Bash danger check and registry deny rules, because
 *   `permissionPrompts: 'none'` never calls `canUseTool` and the SDK
 *   auto-approves bare allow rules on its own.
 */

import { isAbsolute, resolve } from 'node:path';

import type {
  CanUseTool,
  HookCallback,
  Options,
  PermissionResult,
} from '@anthropic-ai/claude-agent-sdk';

import type { DenialTracker } from '@/core/agent/denial-tracker';
import type { LoopGuard } from '@/core/agent/loop-guard';
import { AutoClassifier } from '@/core/agent/safety/auto-classifier';
import {
  assessRiskLevel,
  checkBashCommand,
} from '@/core/agent/safety/dangerous-patterns';
import type { ToolPermissionRegistry } from '@/core/agent/tool-permission-registry';

import { getSetting } from '@/shared/db/operations';
import { taskEventBus } from '@/shared/services/task-event-bus';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('ClaudePermissions');

/** `mcpServer.source` of the in-process servers this host registers. */
const SDK_MCP_SERVER_SOURCE = 'sdk';

/** Message returned when an ask has no approval surface. */
export const HEADLESS_DENY_MESSAGE =
  'This run has no approval surface, so tools that need approval are denied. ' +
  'Allow the tool explicitly for this automation or channel to use it.';

export interface PendingPermission {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resolve: (result: any) => void;
  toolName: string;
  /** Original tool input, echoed back as `updatedInput` when the user allows. */
  toolInput: unknown;
  sessionId: string;
  createdAt: number;
  registry: ToolPermissionRegistry;
  /** The SDK forbade a persistent "always allow" rule for this ask. */
  suppressAlwaysAllowRule?: boolean;
}

/** Truncate tool input to a short string for logging and denial tracking. */
function summarizeInput(input: unknown, maxLen = 200): string {
  if (typeof input === 'object' && input) {
    return JSON.stringify(input).slice(0, maxLen);
  }
  return String(input ?? '');
}

// ── Auto-classifier singleton (lazy, feature-flagged) ──
// Cache the enabled setting to avoid DB reads on every tool call.
// Refreshed every 60s so settings changes take effect without restart.
let autoClassifierInstance: AutoClassifier | undefined;
let autoClassifierApiKey: string | undefined;
let autoClassifierEnabledCache: { value: boolean; ts: number } | undefined;
const CLASSIFIER_SETTING_TTL_MS = 60_000;

function getAutoClassifier(): AutoClassifier | undefined {
  const now = Date.now();
  if (
    !autoClassifierEnabledCache ||
    now - autoClassifierEnabledCache.ts > CLASSIFIER_SETTING_TTL_MS
  ) {
    const enabled = getSetting('autoClassifierEnabled');
    autoClassifierEnabledCache = {
      value: enabled === 'true' || enabled === '1',
      ts: now,
    };
  }
  if (!autoClassifierEnabledCache.value) return undefined;

  const apiKey = process.env.ANTHROPIC_API_KEY || getSetting('apiKey');
  if (!apiKey) return undefined;
  // Recreate if API key changed
  if (autoClassifierInstance && autoClassifierApiKey === apiKey) {
    return autoClassifierInstance;
  }
  autoClassifierApiKey = apiKey;
  autoClassifierInstance = new AutoClassifier(apiKey);
  return autoClassifierInstance;
}

/** Tool classifications that trigger the auto-classifier */
const CLASSIFIER_TARGET_CLASSIFICATIONS = new Set(['execute', 'destructive']);

/**
 * Build an `allow` permission result for the `canUseTool` callback.
 *
 * The Claude CLI subprocess validates the callback's return value against a Zod
 * schema whose `allow` branch REQUIRES `updatedInput` to be a record — even
 * though the SDK's TypeScript `PermissionResult` type marks it optional. A bare
 * `{ behavior: 'allow' }` therefore fails at runtime with
 * "Tool permission request failed: ZodError" and the tool call errors out
 * (observed for control tools like `Monitor`). Always echo the unmodified tool
 * input back so the allow branch validates.
 */
export function allowTool(input: unknown): {
  behavior: 'allow';
  updatedInput: Record<string, unknown>;
} {
  return {
    behavior: 'allow',
    updatedInput:
      input && typeof input === 'object'
        ? (input as Record<string, unknown>)
        : {},
  };
}

// ── Pre-approved tools (moved out of SDK allowedTools) ──

/**
 * Bare allow rules taken out of a host-approved run's SDK `allowedTools`,
 * keyed by that run's registry. `canUseTool` treats them as the SDK did —
 * approved without a prompt — but still applies deny rules and the Bash
 * danger check.
 */
const preApprovedRules = new WeakMap<ToolPermissionRegistry, string[]>();

/** A rule without a `(specifier)` allows the whole tool. */
function isBareRule(rule: string): boolean {
  return rule.length > 0 && !rule.includes('(');
}

/** SDK allow-rule name match: exact, or `prefix*` for MCP wildcards. */
function matchesToolName(toolName: string, rule: string): boolean {
  if (rule.endsWith('*')) return toolName.startsWith(rule.slice(0, -1));
  return toolName === rule;
}

function isPreApproved(
  registry: ToolPermissionRegistry,
  toolName: string,
): boolean {
  const rules = preApprovedRules.get(registry);
  return !!rules?.some((rule) => matchesToolName(toolName, rule));
}

// ── Headless path scoping ──

/**
 * File-mutating tools whose headless allow rules are workspace-scoped. The
 * SDK's `Edit(...)` rules cover every built-in file-editing tool, Write
 * included, so both map to `Edit` path rules.
 */
const PATH_SCOPED_TOOLS = new Set(['Edit', 'Write']);

/**
 * Format an absolute directory as a permission-rule path. `//` anchors the
 * rule at the filesystem root; Windows paths are matched in POSIX form
 * (`C:\work` → `/c/work`).
 */
function toRuleDirectory(dir: string): string {
  const absolute = resolve(dir).replace(/\\/g, '/');
  const posix = absolute.replace(
    /^([A-Za-z]):/,
    (_match, drive: string) => `/${drive.toLowerCase()}`,
  );
  return `/${posix.replace(/\/+$/, '')}`;
}

/** `Edit(//abs/dir/**)` for each directory the session may write. */
function editRulesFor(directories: readonly string[]): string[] {
  return directories.map((dir) => `Edit(${toRuleDirectory(dir)}/**)`);
}

// ── Policy ──

export interface ClaudePermissionPolicyInput {
  registry: ToolPermissionRegistry;
  taskId: string | undefined;
  autoApprove: boolean | undefined;
}

/**
 * A run without a task has no UI to answer a permission prompt. `autoApprove`
 * is the caller's explicit allow-all (dispatch, pipelines with auto-approve),
 * so those runs keep the callback.
 */
export function isHeadlessRun({
  taskId,
  autoApprove,
}: Pick<ClaudePermissionPolicyInput, 'taskId' | 'autoApprove'>): boolean {
  return !taskId && !autoApprove;
}

/**
 * Finalize a run's SDK permission options just before `query()`, once every
 * MCP server and sub-agent has added its tools to `allowedTools`.
 */
export function applyPermissionPolicy(
  options: Options,
  input: ClaudePermissionPolicyInput,
): Options {
  const allowedTools = options.allowedTools ?? [];

  if (isHeadlessRun(input)) {
    const directories = [
      ...(options.cwd ? [options.cwd] : []),
      ...(options.additionalDirectories ?? []),
    ].filter((dir) => isAbsolute(dir));
    const scopedAllowedTools = [
      ...new Set(
        allowedTools.flatMap((rule) =>
          PATH_SCOPED_TOOLS.has(rule) ? editRulesFor(directories) : [rule],
        ),
      ),
    ];
    // `permissionPrompts: 'none'` means canUseTool is never called; drop it so
    // the SDK does not treat the bare allow rules as shadowing it. Hooks still
    // run, so the safety hook below is what actually checks those allow rules.
    const { canUseTool: _neverCalled, ...rest } = options;
    return {
      ...rest,
      allowedTools: scopedAllowedTools,
      permissionPrompts: 'none',
      hooks: {
        ...rest.hooks,
        PreToolUse: [
          headlessSafetyHook(input.registry),
          ...(rest.hooks?.PreToolUse ?? []),
        ],
      },
    };
  }

  const bare = allowedTools.filter(isBareRule);
  preApprovedRules.set(input.registry, [
    ...(preApprovedRules.get(input.registry) ?? []),
    ...bare,
  ]);
  return {
    ...options,
    allowedTools: allowedTools.filter((rule) => !isBareRule(rule)),
  };
}

function denyPreToolUse(message: string) {
  return {
    continue: false as const,
    reason: message,
    hookSpecificOutput: {
      hookEventName: 'PreToolUse' as const,
      permissionDecision: 'deny' as const,
      permissionDecisionReason: message,
    },
  };
}

/**
 * Safety net for headless runs. Bare `Bash`, `Task`, `WebFetch`, and
 * `mcp__*` allow rules are approved by the SDK without calling `canUseTool`,
 * so this hook applies the same Bash block-list and registry deny rules.
 * A hook failure denies the call: a missed check must not fail open.
 */
function headlessSafetyHook(registry: ToolPermissionRegistry): {
  hooks: HookCallback[];
} {
  const callback: HookCallback = async (input) => {
    if (input.hook_event_name !== 'PreToolUse') return { continue: true };
    try {
      const { tool_name: toolName, tool_input: toolInput } = input;
      if (toolName === 'Bash' && toolInput && typeof toolInput === 'object') {
        const command = (toolInput as Record<string, unknown>).command;
        if (typeof command === 'string') {
          const danger = checkBashCommand(command);
          if (danger.isDangerous && danger.severity === 'block') {
            const message = danger.suggestion ?? 'Blocked: dangerous command';
            logger.warn(`Headless Bash blocked: ${message}`);
            return denyPreToolUse(message);
          }
        }
      }
      if (registry.evaluate(toolName, toolInput) === 'deny') {
        logger.warn(`Headless ${toolName} blocked by permission rules`);
        return denyPreToolUse('Blocked by permission rules');
      }
      return { continue: true };
    } catch (err) {
      logger.error('Headless safety hook failed; denying the tool call', err);
      return denyPreToolUse('Tool denied: safety check failed');
    }
  };
  return { hooks: [callback] };
}

type CanUseToolOptions = Parameters<CanUseTool>[2];

/** Fields the permission dialog needs beyond the tool call itself. */
function buildPromptHints(options: CanUseToolOptions): {
  default_to_no?: boolean;
  suppress_always_allow_rule?: boolean;
  mcp_server?: { name: string; source: string };
} {
  const mcpServer = options.mcpServer;
  // A configured server's name and tools are untrusted: never let a stray
  // click approve one of its calls.
  const untrustedServer =
    !!mcpServer && mcpServer.source !== SDK_MCP_SERVER_SOURCE;
  return {
    ...(options.defaultToNo || untrustedServer ? { default_to_no: true } : {}),
    ...(options.suppressAlwaysAllowRule
      ? { suppress_always_allow_rule: true }
      : {}),
    ...(mcpServer
      ? { mcp_server: { name: mcpServer.name, source: mcpServer.source } }
      : {}),
  };
}

/**
 * Build a canUseTool callback for the Claude Agent SDK.
 *
 * Shared between runGenerator (direct run), executeStepGenerator
 * (plan-then-execute), and the PTC loop.
 */
export function buildCanUseTool(
  denialTracker: DenialTracker,
  permissionRegistry: ToolPermissionRegistry,
  pendingPermissions: Map<string, PendingPermission>,
  taskId: string | undefined,
  sessionId: string,
  loopGuard: LoopGuard,
): CanUseTool {
  return async (toolName, input, options): Promise<PermissionResult> => {
    const { signal } = options;
    const preApproved = isPreApproved(permissionRegistry, toolName);
    // 0a. Loop guard — stop runaway thrashing/fan-out before maxTurns (200)
    // would, forcing the agent to report the blocker instead of looping.
    // Pre-approved tools never reached this callback before, so they keep
    // their previous exemption.
    if (!preApproved) {
      const loopStop = loopGuard.check(toolName, summarizeInput(input));
      if (loopStop) {
        logger.warn(`[${sessionId}] Loop guard tripped on ${toolName}`);
        return { behavior: 'deny', message: loopStop };
      }
    }
    // 0b. Check denial tracker — stop retrying repeatedly denied tools
    if (denialTracker.shouldFallback(toolName)) {
      return { behavior: 'deny', message: denialTracker.getSummary() };
    }
    // Bash run_in_background processes are children of this turn's CLI
    // subprocess and are killed the instant the turn ends — there is no
    // mechanism in this app to resume or notify the user later, so a
    // backgrounded job that outlives the turn silently dies unfinished
    // (confirmed: output files show `[killed]` seconds after turn end).
    // Force foreground instead, with the timeout raised to the SDK's max so
    // multi-step batches (e.g. downloading a dozen files) still have room
    // to actually finish before the tool call returns.
    let effectiveInput = input;
    if (toolName === 'Bash') {
      const bashInput = effectiveInput as Record<string, unknown> | undefined;
      if (bashInput?.run_in_background === true) {
        logger.info(
          `[${sessionId}] Forcing Bash foreground (run_in_background jobs don't survive turn end): ${summarizeInput(input)}`,
        );
        effectiveInput = {
          ...bashInput,
          run_in_background: false,
          timeout: Math.max(
            typeof bashInput.timeout === 'number' ? bashInput.timeout : 0,
            600_000,
          ),
        };
      }
    }
    // 1. Check dangerous patterns (Bash commands)
    if (toolName === 'Bash') {
      const command = (effectiveInput as Record<string, unknown>)?.command;
      if (typeof command === 'string') {
        const danger = checkBashCommand(command);
        if (danger.isDangerous && danger.severity === 'block') {
          denialTracker.record(toolName, summarizeInput(effectiveInput));
          return {
            behavior: 'deny',
            message: danger.suggestion ?? 'Blocked: dangerous command',
          };
        }
      }
    }
    // 2. Check registry rules (deny → ask → classification → allow)
    const decision = permissionRegistry.evaluate(toolName, effectiveInput);
    if (decision === 'deny') {
      denialTracker.record(toolName, summarizeInput(effectiveInput));
      return { behavior: 'deny', message: 'Blocked by permission rules' };
    }
    // The run's allowedTools pre-approve the tool, as the SDK rule did.
    if (preApproved) return allowTool(effectiveInput);
    if (decision === 'allow') {
      // 2b. Auto-classifier check for execute/destructive tools (feature-flagged)
      const classifier = getAutoClassifier();
      if (!classifier) return allowTool(effectiveInput);

      const classification = permissionRegistry.classifyTool(toolName);
      if (
        !classification ||
        !CLASSIFIER_TARGET_CLASSIFICATIONS.has(classification)
      ) {
        return allowTool(effectiveInput);
      }

      try {
        const result = await classifier.classify(toolName, effectiveInput);
        if (result.decision === 'allow') return allowTool(effectiveInput);
        if (result.decision === 'deny') {
          logger.warn(
            `Auto-classifier denied ${toolName}: ${result.reasoning}`,
          );
          denialTracker.record(toolName, summarizeInput(effectiveInput));
          return {
            behavior: 'deny',
            message: `Safety review: ${result.reasoning}`,
          };
        }
        // 'warn' — fall through to 'ask' flow below (prompt user)
        logger.info(
          `Auto-classifier flagged ${toolName} for review: ${result.reasoning}`,
        );
      } catch {
        // Classifier failure — never block, proceed with 'allow'
        return allowTool(effectiveInput);
      }
    }
    // 3. 'ask' → emit permission_request, wait for user response.
    // Without a task there is no UI to answer, so deny by default.
    if (!taskId) {
      logger.warn(
        `[${sessionId}] Denying ${toolName}: no approval surface for this run`,
      );
      denialTracker.record(toolName, summarizeInput(effectiveInput));
      return { behavior: 'deny', message: HEADLESS_DENY_MESSAGE };
    }
    const requestId = crypto.randomUUID();
    const riskLevel = assessRiskLevel(toolName, effectiveInput);
    const inputStr = summarizeInput(effectiveInput);
    taskEventBus.publish(taskId, {
      type: 'permission_request',
      permission: {
        id: requestId,
        tool: toolName,
        command: inputStr,
        description: `Execute ${toolName}`,
        risk_level: riskLevel,
        ...buildPromptHints(options),
      },
    });
    // Wait for user response via /agent/permission endpoint
    return new Promise((resolve) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const trackedResolve = (result: any) => {
        if (result?.behavior === 'deny') {
          denialTracker.record(toolName, inputStr);
        }
        resolve(result);
      };
      pendingPermissions.set(requestId, {
        resolve: trackedResolve,
        toolName,
        toolInput: effectiveInput,
        sessionId,
        createdAt: Date.now(),
        registry: permissionRegistry,
        suppressAlwaysAllowRule: options.suppressAlwaysAllowRule === true,
      });
      const onAbort = () => {
        if (pendingPermissions.has(requestId)) {
          pendingPermissions.delete(requestId);
          resolve({
            behavior: 'deny' as const,
            message: 'Permission request timed out',
          });
        }
      };
      signal.addEventListener('abort', onAbort, { once: true });
    });
  };
}
