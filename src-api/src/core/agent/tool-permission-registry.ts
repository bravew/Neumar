import { taskEventBus } from '@/shared/services/task-event-bus';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('ToolPermissionRegistry');

// ── Types ──────────────────────────────────────────────────────────────────────

export type ToolClassification =
  | 'read'
  | 'write'
  | 'execute'
  | 'destructive'
  | 'network';

export interface ToolPermissionRules {
  alwaysAllow: string[];
  alwaysDeny: string[];
  alwaysAsk: string[];
  filesystem?: FilesystemPermissionRule[];
}

export type FilesystemOperation = 'read' | 'write' | 'ls' | 'glob' | 'grep';

export interface FilesystemPermissionRule {
  pattern: string;
  effect: 'allow' | 'deny';
  ops?: FilesystemOperation[];
}

// ── Built-in tool classifications ──────────────────────────────────────────────

const TOOL_CLASSIFICATIONS: Record<string, ToolClassification> = {
  Read: 'read',
  Glob: 'read',
  Grep: 'read',
  LSP: 'read',
  Skill: 'read',
  Edit: 'write',
  Write: 'write',
  TodoWrite: 'write',
  Bash: 'execute',
  Task: 'execute',
  WebFetch: 'network',
  WebSearch: 'network',
};

// Classifications that require user approval by default
const APPROVAL_REQUIRED_CLASSIFICATIONS = new Set<ToolClassification>([
  'execute',
  'destructive',
]);

// ── Pattern matching helper ────────────────────────────────────────────────────

// Pattern format: "ToolName" or "ToolName(pattern)"
// Examples: "Bash", "Read(src/**)", "Bash(rm *)"
const RULE_PATTERN_RE = /^(\w[\w.*]*)(?:\((.+)\))?$/;

function matchesRule(
  toolName: string,
  input: unknown,
  pattern: string,
): boolean {
  const match = RULE_PATTERN_RE.exec(pattern);
  if (!match) return false;

  const [, namePattern, inputPattern] = match;
  if (!namePattern) return false;

  // Check tool name — support wildcards like "mcp__*"
  if (namePattern.includes('*')) {
    const prefix = namePattern.replace(/\*.*$/, '');
    if (!toolName.startsWith(prefix)) return false;
  } else if (namePattern !== toolName) {
    return false;
  }

  // If no input pattern, match on tool name alone
  if (!inputPattern) return true;

  // Simple input matching — check if the stringified input contains the pattern text
  // (v1 uses includes() since minimatch is not in dependencies)
  const inputStr =
    typeof input === 'string' ? input : JSON.stringify(input ?? '');
  return inputStr.includes(inputPattern);
}

// ── Registry class ─────────────────────────────────────────────────────────────

export class ToolPermissionRegistry {
  private rules: ToolPermissionRules;
  private customClassifications = new Map<string, ToolClassification>();

  constructor(rules?: ToolPermissionRules) {
    this.rules = rules ?? { alwaysAllow: [], alwaysDeny: [], alwaysAsk: [] };
  }

  /**
   * Evaluate permission for a tool call.
   * Order: deny rules → ask rules → allow rules → tool classification → default
   */
  evaluate(toolName: string, input: unknown): 'allow' | 'deny' | 'ask' {
    // 1. Deny rules always win
    if (this.matchesAny(toolName, input, this.rules.alwaysDeny)) {
      logger.debug(`Tool ${toolName} denied by rule`);
      return 'deny';
    }

    // 2. Ask rules checked next
    if (this.matchesAny(toolName, input, this.rules.alwaysAsk)) {
      return 'ask';
    }

    // 3. Allow rules — checked before classification so "Always Allow" overrides default classification
    if (this.matchesAny(toolName, input, this.rules.alwaysAllow)) {
      return 'allow';
    }

    // 4. Check tool classification
    const classification = this.classifyTool(toolName);
    if (
      classification &&
      APPROVAL_REQUIRED_CLASSIFICATIONS.has(classification)
    ) {
      return 'ask';
    }

    // 5. Default: allow (sandbox provides OS-level safety as fallback)
    return 'allow';
  }

  classifyTool(toolName: string): ToolClassification | undefined {
    // Check custom classifications first
    const custom = this.customClassifications.get(toolName);
    if (custom) return custom;

    // Check built-in classifications
    const builtin = TOOL_CLASSIFICATIONS[toolName];
    if (builtin) return builtin;

    // MCP tools default to network
    if (toolName.startsWith('mcp__')) {
      return 'network';
    }

    return undefined;
  }

  setClassification(
    toolName: string,
    classification: ToolClassification,
  ): void {
    this.customClassifications.set(toolName, classification);
  }

  updateRules(rules: Partial<ToolPermissionRules>): void {
    if (rules.alwaysAllow) this.rules.alwaysAllow = rules.alwaysAllow;
    if (rules.alwaysDeny) this.rules.alwaysDeny = rules.alwaysDeny;
    if (rules.alwaysAsk) this.rules.alwaysAsk = rules.alwaysAsk;
  }

  addAllowRule(pattern: string): void {
    if (!this.rules.alwaysAllow.includes(pattern)) {
      this.rules.alwaysAllow.push(pattern);
    }
  }

  getRules(): ToolPermissionRules {
    return { ...this.rules };
  }

  private matchesAny(
    toolName: string,
    input: unknown,
    patterns: string[],
  ): boolean {
    return patterns.some((pattern) => matchesRule(toolName, input, pattern));
  }
}

interface PendingHostPermission {
  sessionId: string;
  toolName: string;
  registry: ToolPermissionRegistry;
  resolve: (approved: boolean) => void;
}

const pendingHostPermissions = new Map<string, PendingHostPermission>();

export function requestHostToolPermission(params: {
  taskId: string;
  sessionId: string;
  toolName: string;
  input: unknown;
  registry: ToolPermissionRegistry;
  signal: AbortSignal;
}): Promise<boolean> {
  const requestId = crypto.randomUUID();
  const command =
    typeof params.input === 'string'
      ? params.input
      : JSON.stringify(params.input ?? {});
  taskEventBus.publish(params.taskId, {
    type: 'permission_request',
    permission: {
      id: requestId,
      tool: params.toolName,
      command,
      description: `Execute ${params.toolName}`,
      risk_level: 'medium',
    },
  });
  return new Promise((resolve) => {
    pendingHostPermissions.set(requestId, {
      sessionId: params.sessionId,
      toolName: params.toolName,
      registry: params.registry,
      resolve,
    });
    params.signal.addEventListener(
      'abort',
      () => {
        if (pendingHostPermissions.delete(requestId)) resolve(false);
      },
      { once: true },
    );
  });
}

export function resolveHostToolPermission(
  requestId: string,
  approved: boolean,
  alwaysAllow?: boolean,
  sessionId?: string,
): boolean {
  const pending = pendingHostPermissions.get(requestId);
  if (!pending || (sessionId && pending.sessionId !== sessionId)) return false;
  pendingHostPermissions.delete(requestId);
  if (approved && alwaysAllow) pending.registry.addAllowRule(pending.toolName);
  pending.resolve(approved);
  return true;
}
