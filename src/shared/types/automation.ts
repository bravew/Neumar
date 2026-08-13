/**
 * Automation Types (Frontend)
 *
 * Mirrors the backend types needed for the automation UI.
 * These are duplicated from src-api because the frontend cannot import from src-api.
 */

export type AutomationTriggerType = 'cron' | 'webhook' | 'heartbeat' | 'manual';

export type ScheduleKind = 'once' | 'interval' | 'cron';

export interface AutomationSchedule {
  kind: ScheduleKind;
  at?: string;
  intervalMs?: number;
  cronExpr?: string;
  timezone?: string;
}

export interface AutomationWebhookConfig {
  slug: string;
  token: string;
  payloadTemplate?: string;
  maxBodyBytes?: number;
}

export interface AutomationHeartbeatConfig {
  intervalMs: number;
  activeHours?: string;
  timezone?: string;
  mode?: 'standard' | 'queue_pickup';
  queueProfileId?: string;
  contextMode?: 'fat' | 'thin';
}

export type AutomationTrigger =
  | { type: 'cron'; schedule: AutomationSchedule }
  | { type: 'webhook'; webhook: AutomationWebhookConfig }
  | { type: 'heartbeat'; heartbeat: AutomationHeartbeatConfig }
  | { type: 'manual' };

export interface AutomationAgentConfig {
  provider?: string;
  model?: string;
  usePlanning: boolean;
  autoApprove: boolean;
  workDir?: string;
  timeoutMs?: number;
  mcpServers?: string[];
  skills?: string[];
}

export type DeliveryMode = 'none' | 'slack' | 'webhook' | 'channel' | 'desktop';
export type WakeMode = 'always' | 'silent';

export interface AutomationDelivery {
  mode: DeliveryMode;
  slackWebhookUrl?: string;
  webhookUrl?: string;
  onlyOnFailure?: boolean;
  wakeMode?: WakeMode;
  suppressSuccessNotification?: boolean;
}

export type ChannelPlatformOrDesktop =
  | 'telegram'
  | 'discord'
  | 'slack'
  | 'lark'
  | 'desktop';

export interface AutomationChannelDelivery {
  platform: ChannelPlatformOrDesktop;
  configId?: string;
  conversationId: string;
  suppressEmpty: boolean;
  maxLength?: number;
  format?: 'text' | 'markdown' | 'summary';
  wakeMode?: WakeMode;
  suppressSuccessNotification?: boolean;
}

export type AutomationOrigin = 'chat' | 'channel' | 'api' | 'ui';

export interface AutomationCondition {
  description: string;
  mode: 'llm_judge';
  skipAfterQuietRuns?: number;
}

export type OverlapPolicy = 'skip' | 'queue' | 'cancel_previous';
export type MissedFirePolicy = 'fire_immediately' | 'skip' | 'fire_once';

export interface Automation {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  prompt: string;
  trigger: AutomationTrigger;
  agent: AutomationAgentConfig;
  delivery?: AutomationDelivery;
  channelDelivery?: AutomationChannelDelivery;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
  consecutiveErrors?: number;
  // Lifecycle
  expiresAt?: string;
  maxRuns?: number;
  runCount: number;
  costBudget?: number;
  totalCost: number;
  // Origin
  origin: AutomationOrigin;
  originSessionId?: string;
  originChannel?: { platform: string; conversationId: string };
  // Condition
  condition?: AutomationCondition;
  // Agent profile
  agentProfileId?: string;
  // Locale
  locale: string;
  // Policies
  overlapPolicy: OverlapPolicy;
  missedFirePolicy: MissedFirePolicy;
  nextRunAt?: string;
  // Condition state
  lastResultHash?: string;
  consecutiveQuietRuns?: number;
}

export type AutomationRunStatus =
  | 'queued'
  | 'planning'
  | 'awaiting_approval'
  | 'executing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timed_out';

export interface AutomationRun {
  id: string;
  automationId: string;
  status: AutomationRunStatus;
  triggeredBy: string;
  payload?: unknown;
  planId?: string;
  queuedAt: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  result?: string;
  error?: string;
  cost?: number;
}

export interface CreateAutomationInput {
  name: string;
  description?: string;
  prompt: string;
  trigger: AutomationTrigger;
  agent: AutomationAgentConfig;
  delivery?: AutomationDelivery;
  channelDelivery?: AutomationChannelDelivery;
  tags?: string[];
  enabled?: boolean;
  expiresAt?: string;
  maxRuns?: number;
  costBudget?: number;
  condition?: AutomationCondition;
  origin?: AutomationOrigin;
  originSessionId?: string;
  originChannel?: { platform: string; conversationId: string };
  agentProfileId?: string;
  locale?: string;
  overlapPolicy?: OverlapPolicy;
  missedFirePolicy?: MissedFirePolicy;
}

export type UpdateAutomationInput = Partial<CreateAutomationInput>;

export interface EngineStatus {
  started: boolean;
  activeRunCount: number;
  queuedCount: number;
  automationCount: number;
}
