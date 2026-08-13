/**
 * Automation Engine Types
 *
 * All TypeScript interfaces and Zod validation schemas for
 * automations, runs, and store data.
 */

import { z } from 'zod';

import { MAX_RUN_TIMEOUT_MS, SAFE_PATH_SEGMENT } from './constants';

// ============================================================================
// Trigger Types
// ============================================================================

/** Supported automation trigger types */
export type AutomationTriggerType = 'cron' | 'webhook' | 'heartbeat' | 'manual';

/** Schedule kinds for cron-type triggers */
export type ScheduleKind = 'once' | 'interval' | 'cron';

/** Schedule configuration for cron-type automations */
export interface AutomationSchedule {
  kind: ScheduleKind;
  /** ISO datetime for one-time schedules */
  at?: string;
  /** Interval in milliseconds for recurring schedules */
  intervalMs?: number;
  /** Cron expression string (e.g., "0 9 * * 1") */
  cronExpr?: string;
  /** IANA timezone (e.g., "America/New_York") */
  timezone?: string;
}

/** Webhook trigger configuration */
export interface AutomationWebhookConfig {
  /** URL slug for the webhook endpoint */
  slug: string;
  /** Bearer token for authentication */
  token: string;
  /** Optional template for transforming webhook payload into prompt */
  payloadTemplate?: string;
  /** Maximum request body size in bytes */
  maxBodyBytes?: number;
}

/** Heartbeat trigger configuration */
export interface AutomationHeartbeatConfig {
  /** Heartbeat interval in milliseconds */
  intervalMs: number;
  /** Active hours window in "HH:MM-HH:MM" format */
  activeHours?: string;
  /** IANA timezone for active hours evaluation */
  timezone?: string;
  /** Heartbeat behavior mode */
  mode?: 'standard' | 'queue_pickup';
  /** Profile whose queue to check (required when mode is 'queue_pickup') */
  queueProfileId?: string;
  /** Context assembly strategy for queue-pickup */
  contextMode?: 'fat' | 'thin';
}

// ============================================================================
// Trigger Union
// ============================================================================

/** Trigger configuration — discriminated by type */
export type AutomationTrigger =
  | { type: 'cron'; schedule: AutomationSchedule }
  | { type: 'webhook'; webhook: AutomationWebhookConfig }
  | { type: 'heartbeat'; heartbeat: AutomationHeartbeatConfig }
  | { type: 'manual' };

// ============================================================================
// Agent Configuration
// ============================================================================

/** Agent execution configuration for an automation */
export interface AutomationAgentConfig {
  /** Model provider name (e.g., "claude", "openai-compat") */
  provider?: string;
  /** Model identifier */
  model?: string;
  /** Whether to use the plan-then-execute flow */
  usePlanning: boolean;
  /** Auto-approve plans without user interaction (only if usePlanning is true) */
  autoApprove: boolean;
  /** Working directory for the agent */
  workDir?: string;
  /** Per-run execution timeout in milliseconds */
  timeoutMs?: number;
  /** MCP servers to enable for this automation */
  mcpServers?: string[];
  /** Skills to enable for this automation */
  skills?: string[];
}

// ============================================================================
// Delivery Configuration
// ============================================================================

/** Delivery mode for post-run notifications */
export type DeliveryMode = 'none' | 'slack' | 'webhook' | 'channel' | 'desktop';
export type WakeMode = 'always' | 'silent';

/** Notification delivery configuration (legacy Slack/webhook modes) */
export interface AutomationDelivery {
  mode: DeliveryMode;
  /** Slack incoming webhook URL */
  slackWebhookUrl?: string;
  /** HTTP webhook URL for notifications */
  webhookUrl?: string;
  /** Only send notifications on failure */
  onlyOnFailure?: boolean;
  /** Whether successful runs should wake the user or stay silent */
  wakeMode?: WakeMode;
  /** Suppress successful run notifications without changing failure delivery */
  suppressSuccessNotification?: boolean;
}

// ============================================================================
// Channel Delivery Configuration
// ============================================================================

/** Channel delivery target for automation run results */
export interface AutomationChannelDelivery {
  /** Target channel platform */
  platform: ChannelPlatformOrDesktop;
  /** Channel config ID (multi-bot) — used for precise plugin lookup */
  configId?: string;
  /** Chat/conversation ID on the platform */
  conversationId: string;
  /** Whether to suppress delivery when there's nothing to report */
  suppressEmpty: boolean;
  /** Max message length before truncation (overrides platform default) */
  maxLength?: number;
  /** Output format: 'text' (plain), 'markdown' (platform-native), 'summary' (LLM-condensed) */
  format?: 'text' | 'markdown' | 'summary';
  /** Whether successful runs should wake the user or stay silent */
  wakeMode?: WakeMode;
  /** Suppress successful run notifications without changing failure delivery */
  suppressSuccessNotification?: boolean;
}

/** Channel platforms plus desktop notifications */
export type ChannelPlatformOrDesktop =
  | 'telegram'
  | 'discord'
  | 'slack'
  | 'lark'
  | 'desktop';

// ============================================================================
// Origin Tracking
// ============================================================================

/** Where the automation was created */
export type AutomationOrigin = 'chat' | 'channel' | 'api' | 'ui';

// ============================================================================
// Condition (Check-and-Notify Pattern)
// ============================================================================

/** Condition for check-and-notify automations */
export interface AutomationCondition {
  /** Natural language description of when to notify */
  description: string;
  /** Evaluation mode (currently only LLM judge) */
  mode: 'llm_judge';
  /** Number of consecutive "nothing to report" before skipping LLM judge */
  skipAfterQuietRuns?: number;
}

// ============================================================================
// Overlap & Missed-Fire Policies
// ============================================================================

/** What to do when a new fire occurs while a previous run is still executing */
export type OverlapPolicy = 'skip' | 'queue' | 'cancel_previous';

/** What to do when the app starts and discovers missed fires */
export type MissedFirePolicy = 'fire_immediately' | 'skip' | 'fire_once';

// ============================================================================
// Automation Definition
// ============================================================================

/** Full automation definition */
export interface Automation {
  /** Unique automation ID */
  id: string;
  /** Human-readable name */
  name: string;
  /** Optional description */
  description?: string;
  /** Whether the automation is enabled */
  enabled: boolean;
  /** The prompt to send to the agent */
  prompt: string;
  /** Trigger configuration */
  trigger: AutomationTrigger;
  /** Agent execution configuration */
  agent: AutomationAgentConfig;
  /** Post-run notification delivery (legacy Slack/webhook) */
  delivery?: AutomationDelivery;
  /** Freeform tags for organization */
  tags?: string[];
  /** ISO timestamp of creation */
  createdAt: string;
  /** ISO timestamp of last update */
  updatedAt: string;
  /** Count of consecutive trigger errors (for backoff) */
  consecutiveErrors?: number;

  // ── Lifecycle controls ──

  /** ISO datetime when this automation expires and auto-disables */
  expiresAt?: string;
  /** Maximum number of runs before auto-disabling (null = unlimited) */
  maxRuns?: number;
  /** Count of runs executed so far */
  runCount: number;
  /** Maximum accumulated cost in USD before auto-disabling */
  costBudget?: number;
  /** Total cost accumulated across all runs */
  totalCost: number;

  // ── Channel delivery ──

  /** Channel delivery target (replaces legacy slack/webhook for channel platforms) */
  channelDelivery?: AutomationChannelDelivery;

  // ── Origin tracking ──

  /** Where this automation was created */
  origin: AutomationOrigin;
  /** Session/conversation where user created this */
  originSessionId?: string;
  /** Channel where user created this (for result routing) */
  originChannel?: { platform: string; conversationId: string };
  /**
   * Permission tier of the identity that created this automation. Used by
   * ConnectorPolicy at run time to prevent privilege escalation through
   * scheduled runs (a non-admin who creates a schedule must not have it
   * later run as admin). Optional for backwards compatibility — automations
   * created before this field landed are treated as admin-tier; the schedule
   * MCP gate (`gateConnector('schedule_create', …)`) now blocks non-admin
   * chat creation, so any rows missing this field were created by the
   * desktop owner.
   */
  creatorTier?: 'viewer' | 'operator' | 'admin';
  /** gateway_identities.id of the creator, when applicable */
  creatorIdentityId?: string;

  // ── Condition (check-and-notify pattern) ──

  /** Optional condition that must be true for delivery */
  condition?: AutomationCondition;

  // ── Agent profile ──

  /** Agent profile to use for execution */
  agentProfileId?: string;

  // ── Locale ──

  /** User's language at creation time — used for system-generated delivery messages */
  locale: string;

  // ── Overlap & missed-fire policies ──

  /** What to do when a new fire occurs while a previous run is still executing */
  overlapPolicy: OverlapPolicy;
  /** What to do when the app starts and discovers missed fires */
  missedFirePolicy: MissedFirePolicy;
  /** Timestamp of the next expected fire (persisted for missed-fire detection) */
  nextRunAt?: string;

  // ── Condition evaluator state ──

  /** SHA-256 hash of the last run result (for condition evaluator Layer 1) */
  lastResultHash?: string;
  /** Number of consecutive runs where condition was not met */
  consecutiveQuietRuns?: number;

  // ── Delivery dedup state (persisted for restart recovery) ──

  /** Hash of last delivered result text (for duplicate suppression) */
  lastDeliveryHash?: string;
  /** ISO timestamp of last delivery (dedup window = 24h) */
  lastDeliveryAt?: string;

  // ── Recursive scheduling guard ──

  /** If this automation was created by an automation run, the run ID */
  createdByRunId?: string;
}

// ============================================================================
// Run Types
// ============================================================================

/** Automation run status values */
export type AutomationRunStatus =
  | 'queued'
  | 'planning'
  | 'awaiting_approval'
  | 'executing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timed_out';

/** Execution record for a single automation run */
export interface AutomationRun {
  /** Unique run ID */
  id: string;
  /** Parent automation ID */
  automationId: string;
  /** Current run status */
  status: AutomationRunStatus;
  /** What triggered this run (e.g., "cron", "webhook", "manual") */
  triggeredBy: string;
  /** Optional trigger payload (e.g., webhook body) */
  payload?: unknown;
  /** Plan ID if planning was used */
  planId?: string;
  /** ISO timestamp when the run was queued */
  queuedAt: string;
  /** ISO timestamp when the run started executing */
  startedAt?: string;
  /** ISO timestamp when the run completed */
  completedAt?: string;
  /** Total execution duration in milliseconds */
  durationMs?: number;
  /** Result content from the agent */
  result?: string;
  /** Error message if the run failed */
  error?: string;
  /** Accumulated cost from agent calls */
  cost?: number;
}

// ============================================================================
// Store Data
// ============================================================================

/** Daily cost ledger entry */
export interface DailyCostEntry {
  /** Calendar date "YYYY-MM-DD" */
  date: string;
  /** Total cost in USD for this day */
  cost: number;
}

/** Monthly cost ledger entry */
export interface MonthlyCostEntry {
  /** Calendar month "YYYY-MM" */
  month: string;
  /** Total cost in USD for this month */
  cost: number;
}

/** Global automation config (persisted in store) */
export interface AutomationConfig {
  /** Max total cost across all automations per calendar day (USD). Default: $10 */
  maxGlobalDailyCost: number;
  /** Max total cost across all automations per calendar month (USD). Default: $100 */
  maxGlobalMonthlyCost: number;
}

/** Persisted state shape for the automation store JSON file */
export interface AutomationStoreData {
  /** Schema version for migration support */
  version: number;
  /** All automation definitions */
  automations: Automation[];
  /** All run records */
  runs: AutomationRun[];
  /** Cron state metadata (e.g., last fire times) */
  cronState: Record<
    string,
    { lastFiredAt?: string; consecutiveErrors?: number }
  >;
  /** Global automation configuration */
  config?: AutomationConfig;
  /** Cost tracking ledger */
  costLedger?: {
    daily: DailyCostEntry[];
    monthly: MonthlyCostEntry[];
  };
}

// ============================================================================
// Zod Schemas for API Validation
// ============================================================================

const AutomationScheduleSchema = z.object({
  kind: z.enum(['once', 'interval', 'cron']),
  at: z.string().optional(),
  intervalMs: z.number().positive().optional(),
  cronExpr: z.string().optional(),
  timezone: z.string().optional(),
});

const AutomationWebhookConfigSchema = z.object({
  payloadTemplate: z.string().max(10_000).optional(),
  maxBodyBytes: z
    .number()
    .positive()
    .max(10 * 1024 * 1024)
    .optional(),
});

const AutomationHeartbeatConfigSchema = z.object({
  intervalMs: z.number().positive(),
  activeHours: z.string().optional(),
  timezone: z.string().optional(),
  mode: z.enum(['standard', 'queue_pickup']).optional(),
  queueProfileId: z.string().optional(),
  contextMode: z.enum(['fat', 'thin']).optional(),
});

const AutomationTriggerSchema = z.union([
  z.object({
    type: z.literal('cron'),
    schedule: AutomationScheduleSchema,
  }),
  z.object({
    type: z.literal('webhook'),
    webhook: AutomationWebhookConfigSchema.optional(),
  }),
  z.object({
    type: z.literal('heartbeat'),
    heartbeat: AutomationHeartbeatConfigSchema,
  }),
  z.object({
    type: z.literal('manual'),
  }),
]);

const AutomationAgentConfigSchema = z.object({
  provider: z.string().optional(),
  model: z.string().optional(),
  usePlanning: z.boolean(),
  autoApprove: z.boolean(),
  workDir: z
    .string()
    .optional()
    .refine((v) => !v || (!v.includes('..') && SAFE_PATH_SEGMENT.test(v)), {
      message: 'workDir must not contain path traversal sequences',
    }),
  timeoutMs: z.number().positive().max(MAX_RUN_TIMEOUT_MS).optional(),
  mcpServers: z.array(z.string().max(200)).max(50).optional(),
  skills: z.array(z.string().max(200)).max(50).optional(),
});

const AutomationDeliverySchema = z.object({
  mode: z.enum(['none', 'slack', 'webhook', 'channel', 'desktop']),
  slackWebhookUrl: z.string().url().optional(),
  webhookUrl: z.string().url().optional(),
  onlyOnFailure: z.boolean().optional(),
  wakeMode: z.enum(['always', 'silent']).optional(),
  suppressSuccessNotification: z.boolean().optional(),
});

const AutomationChannelDeliverySchema = z.object({
  platform: z.enum(['telegram', 'discord', 'slack', 'lark', 'desktop']),
  configId: z.string().optional(),
  conversationId: z.string().min(1),
  suppressEmpty: z.boolean().default(true),
  maxLength: z.number().positive().optional(),
  format: z.enum(['text', 'markdown', 'summary']).optional(),
  wakeMode: z.enum(['always', 'silent']).optional(),
  suppressSuccessNotification: z.boolean().optional(),
});

const AutomationConditionSchema = z.object({
  description: z.string().min(1).max(500),
  mode: z.literal('llm_judge'),
  skipAfterQuietRuns: z.number().int().min(0).optional(),
});

/** Zod schema for creating a new automation */
export const CreateAutomationSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  prompt: z.string().min(1).max(50_000),
  trigger: AutomationTriggerSchema,
  agent: AutomationAgentConfigSchema,
  delivery: AutomationDeliverySchema.optional(),
  channelDelivery: AutomationChannelDeliverySchema.optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
  enabled: z.boolean().optional(),
  // Lifecycle
  expiresAt: z.string().datetime().optional(),
  maxRuns: z.number().int().positive().optional(),
  costBudget: z.number().positive().optional(),
  // Origin
  origin: z.enum(['chat', 'channel', 'api', 'ui']).optional(),
  originSessionId: z.string().optional(),
  originChannel: z
    .object({
      platform: z.string(),
      conversationId: z.string(),
    })
    .optional(),
  // Condition
  condition: AutomationConditionSchema.optional(),
  // Agent profile
  agentProfileId: z.string().optional(),
  // Locale
  locale: z.string().optional(),
  // Policies
  overlapPolicy: z.enum(['skip', 'queue', 'cancel_previous']).optional(),
  missedFirePolicy: z
    .enum(['fire_immediately', 'skip', 'fire_once'])
    .optional(),
  // Recursive guard
  createdByRunId: z.string().optional(),
  // Connector-tier isolation: persist creator tier so scheduled runs
  // can't escalate via ConnectorPolicy. See connector-policy.ts.
  creatorTier: z.enum(['viewer', 'operator', 'admin']).optional(),
  creatorIdentityId: z.string().optional(),
});

/** Zod schema for updating an existing automation */
export const UpdateAutomationSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  prompt: z.string().min(1).max(50_000).optional(),
  trigger: AutomationTriggerSchema.optional(),
  agent: AutomationAgentConfigSchema.optional(),
  delivery: AutomationDeliverySchema.optional(),
  channelDelivery: AutomationChannelDeliverySchema.optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
  enabled: z.boolean().optional(),
  expiresAt: z.string().datetime().optional(),
  maxRuns: z.number().int().positive().optional(),
  costBudget: z.number().positive().optional(),
  condition: AutomationConditionSchema.optional(),
  agentProfileId: z.string().optional(),
  locale: z.string().optional(),
  overlapPolicy: z.enum(['skip', 'queue', 'cancel_previous']).optional(),
  missedFirePolicy: z
    .enum(['fire_immediately', 'skip', 'fire_once'])
    .optional(),
});

/** Input type for creating an automation (inferred from Zod schema) */
export type CreateAutomationInput = z.infer<typeof CreateAutomationSchema>;

/** Input type for updating an automation (inferred from Zod schema) */
export type UpdateAutomationInput = z.infer<typeof UpdateAutomationSchema>;
