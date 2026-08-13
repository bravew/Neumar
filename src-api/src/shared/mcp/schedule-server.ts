/**
 * Schedule MCP Server
 *
 * Exposes 5 tools for agent-driven automation management:
 * - schedule_create: Create a scheduled recurring task
 * - schedule_list: List all active scheduled tasks
 * - schedule_cancel: Cancel and delete a scheduled task
 * - schedule_toggle: Pause or resume a scheduled task
 * - schedule_history: Get recent run history for a task
 *
 * Uses the tool() helper from claude-agent-sdk.
 */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import { getConnectorDenialMessage } from '@/shared/auth/connector-policy';
import { SCHEDULE_CREATE_RATE_LIMIT } from '@/shared/automation/constants';
import * as engine from '@/shared/automation/engine';
import type {
  Automation,
  AutomationChannelDelivery,
  AutomationCondition,
  AutomationOrigin,
  ChannelPlatformOrDesktop,
  CreateAutomationInput,
} from '@/shared/automation/types';
import { errorMessage } from '@/shared/utils/errors';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('ScheduleMCP');

/** Tool names exported for allowedTools registration */
export const SCHEDULE_TOOL_NAMES = [
  'schedule_create',
  'schedule_list',
  'schedule_cancel',
  'schedule_toggle',
  'schedule_history',
];

/**
 * System prompt injection for schedule-aware agents.
 * Added to the agent's context when schedule tools are available.
 */
export const SCHEDULE_SYSTEM_PROMPT = `
## Scheduling Capabilities

You can create scheduled tasks using the schedule_create tool. When users ask to schedule something:

### Heartbeat vs Cron — Choose the Right Type
Two fundamentally different schedule types:

**Use scheduleType: "interval" (creates a HEARTBEAT) for:**
- Periodic checks: "every 5 minutes", "every hour", "every 30 min"
- Monitoring: "check X every N minutes and tell me if Y"
- Recurring awareness: "keep me updated", "tell me the time every minute"
- Anything that repeats at a fixed interval
- Examples: "every 1 minute tell me the time", "check my inbox every 30 min"

**Use scheduleType: "cron" (creates a CRON JOB) for:**
- Fixed-time tasks: "every day at 8am", "every Monday at 10am"
- Calendar-aligned: "weekdays at 9am", "first of every month"
- Precise scheduling with cron expressions

**Use scheduleType: "once" for:**
- One-shot delayed tasks: "after 2 minutes", "at 5pm today", "tomorrow at noon"

### Cron Expression Quick Reference
- "every day at 8am" → cronExpr: "0 8 * * *"
- "every weekday at 9am" → cronExpr: "0 9 * * 1-5"
- "every Monday at 10am" → cronExpr: "0 10 * * 1"
- "every Sunday at 6pm" → cronExpr: "0 18 * * 0"
- "first day of every month" → cronExpr: "0 9 1 * *"

### Interval Quick Reference
- "every 1 minute" → intervalMinutes: 1
- "every 5 minutes" → intervalMinutes: 5
- "every 30 minutes" → intervalMinutes: 30
- "every hour" → intervalMinutes: 60
- "every 2 hours" → intervalMinutes: 120

### Delivery Resolution
- If user says "send to Telegram" → deliveryPlatform: "telegram"
- If user says "notify me on Discord" → deliveryPlatform: "discord"
- If user says "send it here" → use current channel (auto-detected)
- If no delivery specified → default to current channel/desktop

### Suppress-Empty Protocol
For heartbeat (interval) automations with suppressEmpty: true, append to the prompt:
"If nothing needs attention, start your response with @@HEARTBEAT_OK on its own line.
If there IS something to report, do NOT include this token."

### Cost Awareness
- Each scheduled run costs tokens. For frequent schedules (< 1 hour), suggest cost budget.
- Default budget suggestion: $1/day for hourly tasks, $5/month for daily tasks.

Always confirm the schedule with the user AFTER creating, showing:
- What will run (prompt summary)
- When (human-readable schedule)
- Where results go (delivery target)
- When it expires (if set)

### Interactive Management (Slack channels)
When confirming a schedule creation in a Slack channel, the schedule_create tool response includes a "managementButtons" field containing pre-built interactive button markdown. You MUST include this value VERBATIM in your confirmation message — it contains the correct automation ID for Pause/Stop actions.

Never generate your own button IDs and never use plain text instructions like "tell me to pause" — always use the managementButtons value from the tool response.
`;

// ============================================================================
// Rate Limiting
// ============================================================================

const createCounts = new Map<string, { count: number; resetAt: number }>();

/** Timestamp of last eviction sweep */
let lastEvictAt = 0;

/** Minimum interval between eviction sweeps (5 minutes) */
const EVICT_INTERVAL_MS = 5 * 60 * 1000;

function checkCreateRateLimit(sessionId: string): boolean {
  const now = Date.now();

  // Evict expired entries periodically (not on every call)
  if (now - lastEvictAt > EVICT_INTERVAL_MS) {
    for (const [key, val] of createCounts) {
      if (now > val.resetAt) createCounts.delete(key);
    }
    lastEvictAt = now;
  }

  const entry = createCounts.get(sessionId);

  if (!entry || now > entry.resetAt) {
    createCounts.set(sessionId, {
      count: 1,
      resetAt: now + 60 * 60 * 1000,
    });
    return true;
  }

  if (entry.count >= SCHEDULE_CREATE_RATE_LIMIT) {
    return false;
  }

  entry.count++;
  return true;
}

// ============================================================================
// Automation Lookup (with channel scoping)
// ============================================================================

function findByNameOrId(nameOrId: string): Automation | undefined {
  const automations = engine.list();
  return (
    automations.find((a) => a.id === nameOrId) ??
    automations.find((a) => a.name.toLowerCase() === nameOrId.toLowerCase())
  );
}

/**
 * Check whether a channel context owns an automation.
 * An automation is owned by a channel context when its originChannel
 * matches the same platform AND the same base channel ID (ignoring
 * thread_ts — a user in any thread of a DM/channel owns automations
 * from that DM/channel).
 */
function isOwnedByChannel(
  automation: Automation,
  ctx: { platform: string; conversationId: string },
): boolean {
  const oc = automation.originChannel;
  if (!oc) return false;
  if (oc.platform !== ctx.platform) return false;
  // Compare base channel ID (before the ':' separator)
  const baseCtx = ctx.conversationId.split(':')[0]!;
  const baseOc = oc.conversationId.split(':')[0]!;
  return baseCtx === baseOc;
}

/**
 * List automations scoped to the current context.
 * - Channel context: only automations from the same platform + channel
 * - Desktop/no context: all automations (admin view)
 */
function scopedList(channelCtx?: {
  platform: string;
  conversationId: string;
}): Automation[] {
  const all = engine.list();
  if (!channelCtx) return all;
  return all.filter((a) => isOwnedByChannel(a, channelCtx));
}

/**
 * Find by name/ID, scoped to the current channel context.
 * Returns the automation only if the caller is allowed to access it.
 */
function scopedFind(
  nameOrId: string,
  channelCtx?: { platform: string; conversationId: string },
): Automation | undefined {
  const target = findByNameOrId(nameOrId);
  if (!target) {
    logger.debug(`scopedFind: "${nameOrId}" not found in any automation`);
    return undefined;
  }
  // Desktop/no context: full access
  if (!channelCtx) return target;
  // Channel context: only automations from the same channel
  if (!isOwnedByChannel(target, channelCtx)) return undefined;
  return target;
}

// ============================================================================
// Delivery Resolution
// ============================================================================

/**
 * Resolve delivery target based on explicit input and channel context.
 *
 * Priority:
 * 1. Explicit delivery in tool input
 * 2. Channel context (if user is on Telegram, default to their chat)
 * 3. Desktop notification
 * 4. None
 */
function resolveDeliveryTarget(
  explicit?: {
    platform?: string;
    conversationId?: string;
    suppressEmpty?: boolean;
  },
  channelContext?: {
    platform: string;
    conversationId: string;
    configId?: string;
  },
  scheduleType?: 'cron' | 'interval' | 'once',
): AutomationChannelDelivery | undefined {
  // For one-shot tasks, default suppressEmpty to false — user explicitly
  // asked for output, there's nothing to suppress.
  // For recurring tasks (cron/interval), default to true — "nothing to report" is common.
  const defaultSuppress = scheduleType === 'once' ? false : true;

  if (explicit?.platform && explicit.conversationId) {
    return {
      platform: explicit.platform as ChannelPlatformOrDesktop,
      configId: channelContext?.configId,
      conversationId: explicit.conversationId,
      suppressEmpty: explicit.suppressEmpty ?? defaultSuppress,
    };
  }

  if (channelContext) {
    // Strip thread_ts from conversationId so deliveries post to the
    // channel root, not inside the @mention thread. The conversationId
    // from channel messages is "channel:thread_ts" — we only want the
    // channel part for automation delivery.
    const channelOnly = channelContext.conversationId.includes(':')
      ? channelContext.conversationId.split(':')[0]!
      : channelContext.conversationId;
    return {
      platform: channelContext.platform as ChannelPlatformOrDesktop,
      configId: channelContext.configId,
      conversationId: channelOnly,
      suppressEmpty: defaultSuppress,
    };
  }

  // Default to desktop notification
  return {
    platform: 'desktop',
    conversationId: 'default',
    suppressEmpty: defaultSuppress,
  };
}

// ============================================================================
// Tool Factories
// ============================================================================

/**
 * Create all schedule tools with the given context.
 * Called during agent setup with the current session's context.
 */
export function scheduleTools(context?: {
  sessionId?: string;
  channelContext?: {
    platform: string;
    conversationId: string;
    configId?: string;
    permissionTier?: 'viewer' | 'operator' | 'admin';
    identityId?: string;
  };
  locale?: string;
  /**
   * Whether this caller passes the `schedule_create` connector gate.
   * Only gates schedule_create — list/cancel/toggle/history stay available
   * (scoped to the caller's channel) so users can manage automations their
   * channel owns even when they can't create new ones. Defaults to true
   * for desktop/ungated callers.
   */
  allowCreate?: boolean;
}) {
  const sessionId = context?.sessionId ?? 'unknown';
  const channelCtx = context?.channelContext;
  const locale = context?.locale ?? 'en-US';
  const allowCreate = context?.allowCreate !== false;

  /** Build a standard "not found" error response for schedule tools */
  function notFoundResult(nameOrId: string) {
    const text = channelCtx
      ? `No automation found with name or ID "${nameOrId}" in this channel.`
      : `No automation found with name or ID "${nameOrId}".`;
    return { content: [{ type: 'text' as const, text }], isError: true };
  }

  return [
    // ── schedule_create ──
    tool(
      'schedule_create',
      `Create a scheduled recurring task. Use when the user asks to schedule, remind, monitor, or set up periodic checks.

Returns JSON with the created automation ID and confirmation details.

IMPORTANT:
- Always confirm schedule details with the user BEFORE calling this tool
- Cron expressions must not fire more than once per minute
- For interval-based schedules, use intervalMinutes (minimum: 1)`,
      {
        name: z
          .string()
          .min(1)
          .max(200)
          .describe('Short descriptive name for the task'),
        prompt: z
          .string()
          .min(1)
          .max(50_000)
          .describe('What the agent should do each time the task runs'),
        scheduleType: z
          .enum(['cron', 'interval', 'once'])
          .describe(
            'Schedule type. "interval" = heartbeat (every N minutes, periodic checks). "cron" = precise time (cron expression). "once" = one-shot delayed task.',
          ),
        cronExpr: z
          .string()
          .optional()
          .describe(
            'Cron expression (e.g., "0 8 * * *" for 8am daily). Required for cron type.',
          ),
        intervalMinutes: z
          .number()
          .min(1)
          .optional()
          .describe(
            'Interval in minutes for recurring tasks. Required for interval type.',
          ),
        at: z
          .string()
          .optional()
          .describe('ISO datetime for one-shot tasks. Required for once type.'),
        timezone: z
          .string()
          .optional()
          .describe('IANA timezone (e.g., "America/New_York")'),
        deliveryPlatform: z
          .enum(['telegram', 'discord', 'slack', 'lark', 'desktop'])
          .optional()
          .describe('Where to send results'),
        deliveryConversationId: z
          .string()
          .optional()
          .describe('Chat/channel ID to deliver to'),
        suppressEmpty: z
          .boolean()
          .optional()
          .describe('Suppress delivery if nothing to report (default: true)'),
        condition: z
          .string()
          .max(500)
          .optional()
          .describe(
            'Only notify when this condition is met (e.g., "price below $800")',
          ),
        expiresInDays: z
          .number()
          .optional()
          .describe('Auto-disable after N days'),
        maxRuns: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Auto-disable after N runs'),
        costBudget: z
          .number()
          .positive()
          .optional()
          .describe('Max cost in USD before auto-disable'),
      },
      async ({
        name,
        prompt,
        scheduleType,
        cronExpr,
        intervalMinutes,
        at,
        timezone,
        deliveryPlatform,
        deliveryConversationId,
        suppressEmpty,
        condition,
        expiresInDays,
        maxRuns,
        costBudget,
      }) => {
        // Connector-tier gate: creation is admin-gated per ConnectorPolicy;
        // the rest of the schedule tools stay usable for channel-owned
        // automations.
        if (!allowCreate) {
          return {
            content: [
              {
                type: 'text' as const,
                text: getConnectorDenialMessage('schedule_create', locale),
              },
            ],
            isError: true,
          };
        }

        // Rate limit check
        if (!checkCreateRateLimit(sessionId)) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Rate limit exceeded: max ${SCHEDULE_CREATE_RATE_LIMIT} automations per hour. Please wait before creating more.`,
              },
            ],
            isError: true,
          };
        }

        // Check for duplicate name
        const existing = engine.list();
        if (existing.some((a) => a.name === name)) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `An automation named "${name}" already exists. Use a different name or cancel the existing one first.`,
              },
            ],
            isError: true,
          };
        }

        // Build trigger — use the right trigger type for the schedule:
        // - 'interval' → heartbeat trigger (periodic awareness daemon with suppress-empty)
        // - 'cron' → cron trigger (precise time-based scheduler)
        // - 'once' → cron trigger with kind: 'once' (one-shot delayed task)
        let trigger: CreateAutomationInput['trigger'];
        switch (scheduleType) {
          case 'cron':
            if (!cronExpr) {
              return {
                content: [
                  {
                    type: 'text' as const,
                    text: 'cronExpr is required for cron schedule type.',
                  },
                ],
                isError: true,
              };
            }
            trigger = {
              type: 'cron',
              schedule: { kind: 'cron', cronExpr, timezone },
            };
            break;

          case 'interval':
            if (!intervalMinutes) {
              return {
                content: [
                  {
                    type: 'text' as const,
                    text: 'intervalMinutes is required for interval schedule type.',
                  },
                ],
                isError: true,
              };
            }
            // Use heartbeat trigger for intervals — it's designed for
            // periodic awareness checks with active hours support,
            // stagger offset to prevent thundering herd, and
            // natural suppress-empty integration.
            trigger = {
              type: 'heartbeat',
              heartbeat: {
                intervalMs: intervalMinutes * 60_000,
                timezone,
                mode: 'standard',
                contextMode: intervalMinutes < 60 ? 'thin' : 'fat',
              },
            };
            break;

          case 'once':
            if (!at) {
              return {
                content: [
                  {
                    type: 'text' as const,
                    text: 'at (ISO datetime) is required for once schedule type.',
                  },
                ],
                isError: true,
              };
            }
            trigger = {
              type: 'cron',
              schedule: { kind: 'once', at, timezone },
            };
            break;
        }

        // Resolve delivery.
        // When channel context exists (user is on Slack/Discord/etc.), always
        // use it — the LLM may hallucinate wrong IDs (e.g., user ID instead
        // of channel:thread_ts). Only allow explicit override when there's
        // no channel context (desktop chat).
        const explicitDelivery =
          !channelCtx && deliveryPlatform
            ? {
                platform: deliveryPlatform,
                conversationId: deliveryConversationId,
                suppressEmpty,
              }
            : undefined;
        const channelDelivery = resolveDeliveryTarget(
          explicitDelivery,
          channelCtx,
          scheduleType,
        );
        // Honor explicit suppressEmpty even when channel context auto-resolves delivery
        if (channelDelivery && channelCtx && suppressEmpty !== undefined) {
          channelDelivery.suppressEmpty = suppressEmpty;
        }

        // Build condition
        let automationCondition: AutomationCondition | undefined;
        if (condition) {
          automationCondition = {
            description: condition,
            mode: 'llm_judge',
          };
        }

        // Calculate expiry
        const expiresAt = expiresInDays
          ? new Date(
              Date.now() + expiresInDays * 24 * 60 * 60 * 1000,
            ).toISOString()
          : undefined;

        // Determine origin
        const origin: AutomationOrigin = channelCtx ? 'channel' : 'chat';

        try {
          const automation = await engine.create({
            name,
            prompt,
            trigger,
            agent: {
              usePlanning: false,
              autoApprove: true,
            },
            channelDelivery,
            expiresAt,
            maxRuns,
            costBudget,
            condition: automationCondition,
            origin,
            originSessionId: sessionId,
            originChannel: channelCtx
              ? {
                  platform: channelCtx.platform,
                  conversationId: channelCtx.conversationId,
                }
              : undefined,
            locale,
            overlapPolicy: 'skip',
            missedFirePolicy: 'fire_once',
            // Connector-tier isolation: persist who created this so the
            // run-time ConnectorPolicy can fail-closed on non-admin
            // creators. ConnectorPolicy already gates `schedule_create`
            // for non-admin tiers — we still record the tier so that any
            // future per-channel allowlist (Phase B) doesn't grant
            // operator-created schedules admin tokens at run time.
            creatorTier: channelCtx?.permissionTier,
            creatorIdentityId: channelCtx?.identityId,
          });

          let scheduleDesc: string;
          switch (scheduleType) {
            case 'cron':
              scheduleDesc = cronExpr!;
              break;
            case 'interval':
              scheduleDesc = `every ${intervalMinutes} minutes (heartbeat)`;
              break;
            case 'once':
              scheduleDesc = `once at ${at}`;
              break;
          }

          // Pre-build management button markdown with the correct ID.
          // Embedded in the JSON so the agent can include it verbatim
          // without hallucinating the ID.
          const mgmtButtons =
            channelCtx?.platform === 'slack'
              ? `\`\`\`buttons\n⏸️ Pause | schedule_toggle ${automation.id}\n🛑 Stop | schedule_cancel ${automation.id} | danger\n\`\`\``
              : undefined;

          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(
                  {
                    success: true,
                    id: automation.id,
                    name: automation.name,
                    schedule: scheduleDesc,
                    delivery: channelDelivery?.platform ?? 'none',
                    expiresAt: automation.expiresAt,
                    maxRuns: automation.maxRuns,
                    condition: condition ?? null,
                    managementButtons: mgmtButtons ?? undefined,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        } catch (err) {
          logger.error('schedule_create failed:', err);
          return {
            content: [
              {
                type: 'text' as const,
                text: `Failed to create schedule: ${errorMessage(err)}`,
              },
            ],
            isError: true,
          };
        }
      },
    ),

    // ── schedule_list ──
    tool(
      'schedule_list',
      'List all scheduled tasks with their status, next run time, and run count.',
      {
        status: z
          .enum(['enabled', 'disabled', 'all'])
          .optional()
          .describe('Filter by status (default: all)'),
      },
      async ({ status }) => {
        const automations = scopedList(channelCtx);
        let filtered: typeof automations;
        switch (status) {
          case 'enabled':
            filtered = automations.filter((a) => a.enabled);
            break;
          case 'disabled':
            filtered = automations.filter((a) => !a.enabled);
            break;
          default:
            filtered = automations;
            break;
        }

        if (filtered.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'No scheduled tasks found.',
              },
            ],
          };
        }

        const items = filtered.map((a) => ({
          id: a.id,
          name: a.name,
          enabled: a.enabled,
          trigger: a.trigger.type,
          schedule:
            a.trigger.type === 'cron'
              ? (a.trigger.schedule.cronExpr ??
                `every ${(a.trigger.schedule.intervalMs ?? 0) / 60000}min`)
              : a.trigger.type === 'heartbeat'
                ? `every ${a.trigger.heartbeat.intervalMs / 60000}min (heartbeat)`
                : a.trigger.type,
          runCount: a.runCount,
          totalCost: `$${a.totalCost.toFixed(2)}`,
          nextRunAt: a.nextRunAt ?? 'N/A',
          expiresAt: a.expiresAt ?? 'never',
          delivery: a.channelDelivery?.platform ?? 'none',
        }));

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(items, null, 2),
            },
          ],
        };
      },
    ),

    // ── schedule_cancel ──
    tool(
      'schedule_cancel',
      'Cancel and delete a scheduled task by name or ID.',
      {
        nameOrId: z.string().describe('Name or ID of the automation to cancel'),
      },
      async ({ nameOrId }) => {
        const target = scopedFind(nameOrId, channelCtx);
        if (!target) return notFoundResult(nameOrId);

        try {
          await engine.remove(target.id);
          return {
            content: [
              {
                type: 'text' as const,
                text: `Automation "${target.name}" (${target.id}) has been cancelled and deleted.`,
              },
            ],
          };
        } catch (err) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Failed to cancel: ${errorMessage(err)}`,
              },
            ],
            isError: true,
          };
        }
      },
    ),

    // ── schedule_toggle ──
    tool(
      'schedule_toggle',
      'Pause or resume a scheduled task.',
      {
        nameOrId: z.string().describe('Name or ID of the automation'),
        enabled: z.boolean().describe('true to resume, false to pause'),
      },
      async ({ nameOrId, enabled }) => {
        const target = scopedFind(nameOrId, channelCtx);
        if (!target) return notFoundResult(nameOrId);

        try {
          await engine.toggle(target.id, enabled);
          return {
            content: [
              {
                type: 'text' as const,
                text: `Automation "${target.name}" is now ${enabled ? 'enabled' : 'paused'}.`,
              },
            ],
          };
        } catch (err) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Failed to toggle: ${errorMessage(err)}`,
              },
            ],
            isError: true,
          };
        }
      },
    ),

    // ── schedule_history ──
    tool(
      'schedule_history',
      'Get recent run history for a scheduled task.',
      {
        nameOrId: z.string().describe('Name or ID of the automation'),
        limit: z
          .number()
          .min(1)
          .max(20)
          .optional()
          .describe('Number of recent runs to return (default: 5)'),
      },
      async ({ nameOrId, limit }) => {
        const target = scopedFind(nameOrId, channelCtx);
        if (!target) return notFoundResult(nameOrId);

        const runs = engine.getRuns(target.id);
        const recent = runs.slice(0, limit ?? 5);

        if (recent.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `No run history for "${target.name}".`,
              },
            ],
          };
        }

        const items = recent.map((r) => ({
          id: r.id,
          status: r.status,
          triggeredBy: r.triggeredBy,
          startedAt: r.startedAt,
          durationMs: r.durationMs,
          cost: r.cost ? `$${r.cost.toFixed(4)}` : null,
          result: r.result?.slice(0, 200),
          error: r.error?.slice(0, 200),
        }));

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(items, null, 2),
            },
          ],
        };
      },
    ),
  ];
}

/**
 * Create an SDK MCP server wrapping the schedule tools.
 * Used to register schedule tools in the normal agent execution path
 * (alongside memory, media, speech, etc.).
 */
export function createScheduleMcpServer(context?: {
  sessionId?: string;
  channelContext?: {
    platform: string;
    conversationId: string;
    configId?: string;
    permissionTier?: 'viewer' | 'operator' | 'admin';
    identityId?: string;
  };
  locale?: string;
  /** See scheduleTools — gates schedule_create only. */
  allowCreate?: boolean;
}) {
  return createSdkMcpServer({
    name: 'schedule',
    version: '1.0.0',
    tools: scheduleTools(context),
  });
}
