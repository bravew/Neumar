/**
 * Database Types
 *
 * Shared types for database operations.
 * These mirror the frontend types for consistency.
 */

import type {
  JobState,
  LegState,
} from '@/shared/services/publish/state-machine';
import type {
  DestinationKind,
  ProvenanceState,
} from '@/shared/services/publish/types';

// ============ Session Types ============

export interface Session {
  id: string;
  prompt: string;
  task_count: number;
  created_at: string;
  updated_at: string;
}

export interface CreateSessionInput {
  id: string;
  prompt: string;
}

// ============ Task Types ============

export type TaskStatus = 'running' | 'completed' | 'error' | 'stopped';
export type TaskPriority = 'urgent' | 'high' | 'medium' | 'low';
export type TaskLinkType = 'parent_child' | 'blocks' | 'relates_to';
export type CommentAuthorType = 'user' | 'agent' | 'system';

export interface Task {
  id: string;
  session_id: string;
  task_index: number;
  prompt: string; // Original user message — NEVER modified after creation
  title?: string | null; // Auto-generated display title (separate from prompt)
  /** Per-task working directory — a subdirectory under the global workspace root (`workDir` setting) */
  work_dir?: string | null;
  /** JSON array of additional workspace directories for multi-folder access */
  additional_work_dirs?: string | null;
  /** Provider/agent runtime session ID used to resume a run. */
  agent_session_id?: string | null;
  /** Timestamp when the task entered 'running' status */
  started_at?: string | null;
  /** Last heartbeat from agent execution — used for zombie process detection */
  heartbeat_at?: string | null;
  /** Project this task belongs to */
  project_id?: string | null;
  /** Goal this task contributes to */
  goal_id?: string | null;
  /** Parent task for sub-task hierarchy */
  parent_task_id?: string | null;
  /** Task priority level */
  priority?: TaskPriority;
  /** JSON array of label strings */
  labels?: string | null;
  /** Reason this task is blocked */
  blocked_reason?: string | null;
  /** Assigned agent profile ID */
  assignee_profile_id?: string | null;
  /** Applied plugin id for this task run, when a plugin was selected. */
  applied_plugin_id?: string | null;
  /** Redacted applied plugin snapshot JSON recorded when the run starts. */
  applied_plugin_snapshot_json?: string | null;
  /** Queue status for task assignment */
  queue_status?: QueueStatus;
  /** Queue priority (higher = picked first, default 0) */
  queue_priority?: number;
  status: TaskStatus;
  cost: number | null;
  duration: number | null;
  favorite?: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateTaskInput {
  id: string;
  session_id: string;
  task_index: number;
  prompt: string;
  work_dir?: string;
  additional_work_dirs?: string;
  agent_session_id?: string | null;
  parent_task_id?: string | null;
  project_id?: string | null;
  assignee_profile_id?: string | null;
}

export interface UpdateTaskInput {
  status?: TaskStatus;
  cost?: number | null;
  duration?: number | null;
  prompt?: string;
  title?: string | null;
  work_dir?: string | null;
  agent_session_id?: string | null;
  favorite?: boolean;
  project_id?: string | null;
  goal_id?: string | null;
  parent_task_id?: string | null;
  priority?: TaskPriority;
  labels?: string | null;
  blocked_reason?: string | null;
  applied_plugin_id?: string | null;
  applied_plugin_snapshot_json?: string | null;
}

// ============ Message Types ============

export type MessageType =
  | 'text'
  | 'tool_use'
  | 'tool_result'
  | 'result'
  | 'error'
  | 'user'
  | 'plan';

export interface Message {
  /**
   * Database-generated auto-increment primary key.
   * Used for internal indexing, foreign keys, and efficient database queries.
   */
  id: number;

  task_id: string;
  type: MessageType;
  content: string | null;
  tool_name: string | null;
  tool_input: string | null;
  tool_output: string | null;
  tool_use_id: string | null;
  subtype: string | null;
  error_message: string | null;
  attachments: string | null;

  /**
   * External identifier for correlating database records with Claude API responses.
   * Deterministically generated as:
   * - For tool messages: `${taskId}_${toolUseId}`
   * - For other messages: `${taskId}_${type}_${sequence}`
   *
   * Used for:
   * - Idempotency checks (prevents duplicate message insertion on retries/replays)
   * - Message deduplication via unique index in database
   * - Tracking message lineage across agent conversation flow
   *
   * Nullable because some internally-generated messages (errors, notifications)
   * may not originate from the API with an assigned ID.
   */
  message_id: string | null;

  cost: number | null;
  usage_input: number | null;
  usage_output: number | null;
  usage_cache_read: number | null;
  usage_cache_creation: number | null;
  model: string | null;

  /** Branch identifier — default is 'main'. Set by migration 005. */
  branch_id?: string;
  /** References Message.id of the branch-point message. Set by migration 005. */
  parent_message_id?: number | null;

  created_at: string;
}

export interface CreateMessageInput {
  task_id: string;
  type: MessageType;
  content?: string | null;
  tool_name?: string | null;
  tool_input?: string | null;
  tool_output?: string | null;
  tool_use_id?: string | null;
  subtype?: string | null;
  error_message?: string | null;
  attachments?: string | null;
  message_id?: string | null;
  cost?: number | null;
  usage_input?: number | null;
  usage_output?: number | null;
  usage_cache_read?: number | null;
  usage_cache_creation?: number | null;
  model?: string | null;
  agui_type?: string | null;
  run_id?: string | null;
  step_name?: string | null;
}

// ============ Agent Question Types ============

export type AgentQuestionStatus =
  | 'pending'
  | 'answered'
  | 'cancelled'
  | 'expired';

export interface AgentQuestionRow {
  id: string;
  session_id: string;
  task_id: string | null;
  tool_use_id: string | null;
  questions_json: string;
  status: AgentQuestionStatus;
  answer_json: string | null;
  asked_at: string;
  answered_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateAgentQuestionInput {
  id?: string;
  session_id: string;
  task_id?: string | null;
  tool_use_id?: string | null;
  questions: unknown[];
  expires_at?: string | null;
}

// ============ File Types ============

export type FileType =
  | 'image'
  | 'text'
  | 'code'
  | 'document'
  | 'website'
  | 'presentation'
  | 'spreadsheet'
  | 'audio'
  | 'video';

export interface LibraryFile {
  id: number;
  task_id: string;
  name: string;
  type: FileType;
  path: string;
  preview: string | null;
  thumbnail: string | null;
  is_favorite: boolean;
  created_at: string;
  /**
   * JSON-encoded media provenance for AI-generated assets (provider, model,
   * requestedProvider, requestedModel, fallbackReason). NULL for files that
   * weren't produced by the media-generation router.
   */
  provenance: string | null;
}

export interface CreateFileInput {
  task_id: string;
  name: string;
  type: FileType;
  path: string;
  preview?: string | null;
  thumbnail?: string | null;
  /** JSON string as written by the media-generation provenance writer */
  provenance?: string | null;
}

// ============ Usage Log Types ============

export type CallType =
  | 'agent'
  | 'title'
  | 'embedding'
  | 'image'
  | 'speech'
  | 'ptc'
  | 'other';

export type BillingType = 'api' | 'subscription' | 'free';

export interface UsageLog {
  id: string;
  task_id: string | null;
  session_id: string | null;
  parent_id: string | null;
  call_type: CallType;
  provider: string | null;
  model: string | null;
  billing_type: BillingType;
  billing_scope: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  input_cost: number;
  output_cost: number;
  cache_read_cost: number;
  cache_creation_cost: number;
  total_cost: number;
  unit_cost: number;
  unit_type: string | null;
  unit_count: number;
  latency_ms: number;
  status: string;
  error_message: string | null;
  metadata: string;
  created_at: string;
}

export interface ModelPricing {
  model_id: string;
  provider: string;
  display_name: string;
  input_cost_per_million: number;
  output_cost_per_million: number;
  cache_read_cost_per_million: number;
  cache_creation_cost_per_million: number;
  unit_cost: number;
  unit_type: string | null;
  is_default: number;
  updated_at: string;
}

// ============ Orchestration Run Types ============

export type OrchestrationRunType = 'plan' | 'delegation' | 'approval_wait';

export type OrchestrationRunStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'executing'
  | 'completed'
  | 'failed';

export interface OrchestrationRun {
  id: string;
  task_id: string;
  run_type: OrchestrationRunType;
  status: OrchestrationRunStatus;
  payload: string; // JSON
  resume_token: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateOrchestrationRunInput {
  id: string;
  task_id: string;
  run_type: OrchestrationRunType;
  payload: string;
  resume_token?: string;
}

// ============ Project Types ============

export type ProjectStatus = 'active' | 'in_progress' | 'completed' | 'archived';
export type GoalStatus = 'active' | 'completed' | 'archived';

export interface Project {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  workspace: string | null;
  status: ProjectStatus;
  created_at: string;
  updated_at: string;
}

export interface CreateProjectInput {
  id: string;
  name: string;
  description?: string;
  color?: string;
  workspace?: string;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string | null;
  color?: string | null;
  workspace?: string | null;
  status?: ProjectStatus;
}

export interface Goal {
  id: string;
  title: string;
  description: string | null;
  status: GoalStatus;
  project_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateGoalInput {
  id: string;
  title: string;
  description?: string;
  project_id?: string;
}

export interface UpdateGoalInput {
  title?: string;
  description?: string | null;
  status?: GoalStatus;
  project_id?: string | null;
}

// ============ Activity Event Types ============

export type ActorType = 'user' | 'agent' | 'system' | 'automation';
export type EntityType =
  | 'task'
  | 'project'
  | 'goal'
  | 'approval'
  | 'automation'
  | 'profile';

export interface ActivityEvent {
  id: string;
  actor_type: ActorType;
  actor_id: string | null;
  event_type: string;
  entity_type: EntityType;
  entity_id: string | null;
  project_id: string | null;
  metadata: string | null;
  created_at: string;
}

export interface CreateActivityEventInput {
  id: string;
  actor_type: ActorType;
  actor_id?: string;
  event_type: string;
  entity_type: EntityType;
  entity_id?: string;
  project_id?: string;
  metadata?: string;
}

// ============ Task Link Types ============

export interface TaskLink {
  id: string;
  from_task_id: string;
  to_task_id: string;
  link_type: TaskLinkType;
  created_at: string;
}

export interface CreateTaskLinkInput {
  id: string;
  from_task_id: string;
  to_task_id: string;
  link_type: TaskLinkType;
}

// ============ Task Comment Types ============

export interface TaskComment {
  id: string;
  task_id: string;
  author_type: CommentAuthorType;
  author_id: string | null;
  content: string;
  created_at: string;
}

export interface CreateTaskCommentInput {
  id: string;
  task_id: string;
  author_type: CommentAuthorType;
  author_id?: string;
  content: string;
}

// ============ Soul Types ============

export type SoulOrigin = 'predefined' | 'user' | 'evolved' | 'imported';

export interface AgentSoul {
  schema_version: '1.0';
  soul_language?: string;

  identity: {
    role: string;
    core_values: string[];
    worldview?: string;
    opinions?: string[];
  };

  voice: {
    tone: string;
    style_rules: string[];
    greeting?: string;
    example_phrases?: string[];
    anti_patterns?: string[];
  };

  cognition: {
    reasoning_style: string;
    expertise?: string[];
    operating_modes?: Record<string, string>;
    approach_preferences?: string[];
    skill_bundles?: Array<{
      name: string;
      description: string;
      approach: string;
      trigger?: string;
    }>;
  };

  boundaries: {
    red_lines: string[];
    escalation_rules?: string[];
    privacy_rules?: string[];
    action_limits?: string[];
  };

  continuity?: {
    session_notes?: string[];
  };

  evolution?: {
    self_improving: boolean;
    max_corrections: number;
    max_learnings: number;
    last_evolved_at?: string;
  };
}

export type CorrectionTrigger =
  | 'user_negative_feedback'
  | 'task_failure'
  | 'user_edit'
  | 'explicit_rating';

export interface Correction {
  id: string;
  timestamp: string;
  trigger: CorrectionTrigger;
  context: string;
  what_went_wrong: string;
  correct_approach: string;
  confidence: number;
}

export type LearningCategory =
  | 'pattern'
  | 'preference'
  | 'tool_usage'
  | 'domain_knowledge'
  | 'communication';

export interface Learning {
  id: string;
  timestamp: string;
  category: LearningCategory;
  content: string;
  source: 'correction' | 'success' | 'observation';
  times_applied: number;
}

export interface SoulAmendment {
  field: string;
  action: 'add' | 'modify' | 'remove';
  old_value?: string;
  new_value: string;
  reason: string;
}

// ============ Agent Profile Types ============

export type ProfileStatus = 'active' | 'paused' | 'archived';
export type QueueStatus =
  | 'unassigned'
  | 'queued'
  | 'picked_up'
  | 'paused_approval'
  | 'done';

export interface AgentProfile {
  id: string;
  name: string;
  role: string | null;
  description: string | null;
  avatar_color: string | null;
  avatar_icon: string | null;
  runtime_id: string;
  default_model: string | null;
  default_provider: string | null;
  default_mcp_servers: string | null;
  default_skills: string | null;
  system_prompt: string | null;
  soul: string | null;
  soul_version: number;
  soul_origin: string;
  corrections_log: string | null;
  learnings: string | null;
  max_concurrent_tasks: number;
  max_delegation_depth: number;
  allowed_delegates: string | null;
  session_compaction_policy: string;
  max_session_messages: number;
  default_thinking_config: string | null;
  routing_hints: string | null;
  status: ProfileStatus;
  created_at: string;
  updated_at: string;
}

export interface CreateAgentProfileInput {
  id: string;
  name: string;
  runtime_id?: string;
  role?: string;
  description?: string;
  avatar_color?: string;
  avatar_icon?: string;
  default_model?: string;
  default_provider?: string;
  default_mcp_servers?: string;
  default_skills?: string;
  system_prompt?: string;
  soul?: string;
  soul_origin?: string;
  max_concurrent_tasks?: number;
  max_delegation_depth?: number;
  allowed_delegates?: string;
  session_compaction_policy?: string;
  max_session_messages?: number;
  default_thinking_config?: string | null;
  routing_hints?: string | null;
}

export interface UpdateAgentProfileInput {
  name?: string;
  role?: string | null;
  description?: string | null;
  avatar_color?: string | null;
  avatar_icon?: string | null;
  runtime_id?: string;
  default_model?: string | null;
  default_provider?: string | null;
  default_mcp_servers?: string | null;
  default_skills?: string | null;
  system_prompt?: string | null;
  soul?: string | null;
  soul_version?: number;
  soul_origin?: string | null;
  corrections_log?: string | null;
  learnings?: string | null;
  max_concurrent_tasks?: number;
  max_delegation_depth?: number;
  allowed_delegates?: string | null;
  session_compaction_policy?: string;
  max_session_messages?: number;
  default_thinking_config?: string | null;
  routing_hints?: string | null;
  status?: ProfileStatus;
}

// ============ User Template Types ============

export type TemplateCategory =
  | 'dev'
  | 'writing'
  | 'research'
  | 'data'
  | 'design'
  | 'ops';

export interface UserTemplate {
  id: string;
  name: string;
  description: string | null;
  category: TemplateCategory;
  system_prompt: string;
  suggested_model: string | null;
  skills: string | null;
  mcp_servers: string | null;
  starter_prompts: string;
  icon: string | null;
  is_built_in: number;
  created_at: string;
  updated_at: string;
}

export interface CreateUserTemplateInput {
  id: string;
  name: string;
  category: TemplateCategory;
  system_prompt: string;
  starter_prompts: string;
  description?: string;
  suggested_model?: string;
  skills?: string;
  mcp_servers?: string;
  icon?: string;
  is_built_in?: number;
}

export interface UpdateUserTemplateInput {
  name?: string;
  description?: string | null;
  category?: TemplateCategory;
  system_prompt?: string;
  suggested_model?: string | null;
  skills?: string | null;
  mcp_servers?: string | null;
  starter_prompts?: string;
  icon?: string | null;
}

// ============ Media Version Types ============

export interface MediaVersionRecord {
  id: string;
  task_id: string;
  artifact_id: string;
  version_number: number;
  path: string;
  prompt: string;
  previous_version_id: string | null;
  type: string;
  created_at: string;
}

// ============ Budget Policy Types ============

export type BudgetScopeType =
  | 'global'
  | 'provider'
  | 'model'
  | 'agent_profile'
  | 'project'
  | 'automation';

export type BudgetPeriodType = 'monthly' | 'weekly' | 'daily';

export interface BudgetPolicy {
  id: string;
  name: string | null;
  scope_type: BudgetScopeType;
  scope_id: string | null;
  period_type: BudgetPeriodType;
  limit_usd: number;
  /** Alert threshold as percentage (default 75) */
  alert_threshold_pct: number;
  /** When true, blocks execution at 100%. Default false = alert-only. */
  hard_stop: boolean;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateBudgetPolicyInput {
  id: string;
  name?: string;
  scope_type: BudgetScopeType;
  scope_id?: string | null;
  period_type?: BudgetPeriodType;
  limit_usd: number;
  alert_threshold_pct?: number;
  hard_stop?: boolean;
}

export interface UpdateBudgetPolicyInput {
  name?: string | null;
  scope_type?: BudgetScopeType;
  scope_id?: string | null;
  period_type?: BudgetPeriodType;
  limit_usd?: number;
  alert_threshold_pct?: number;
  hard_stop?: boolean;
  enabled?: boolean;
}

export interface BudgetSpendCache {
  policy_id: string;
  period_start: string;
  spend_usd: number;
  last_updated_at: string;
}

// ============ File Snapshot Types ============

export interface FileSnapshot {
  id: string;
  task_id: string;
  file_path: string;
  content_before: string | null;
  content_after: string | null;
  created_at: string;
}

export interface CreateFileSnapshotInput {
  id: string;
  task_id: string;
  file_path: string;
  content_before?: string | null;
  content_after?: string | null;
}

// ============ Task Document Types ============

export type DocKey = 'plan' | 'notes' | 'design' | 'custom';
export type DocCreatedBy = 'user' | 'agent';

export interface TaskDocument {
  id: string;
  task_id: string;
  doc_key: DocKey;
  title: string | null;
  content: string;
  version: number;
  created_by: DocCreatedBy;
  created_at: string;
  updated_at: string;
}

export interface CreateTaskDocumentInput {
  id: string;
  task_id: string;
  doc_key: DocKey;
  title?: string;
  content: string;
  created_by?: DocCreatedBy;
}

export interface TaskDocumentHistoryEntry {
  history_id: string;
  document_id: string;
  content: string;
  version: number;
  created_by: DocCreatedBy;
  created_at: string;
}

// ============ Approval Types ============

export type ApprovalType =
  | 'plan'
  | 'delegation'
  | 'budget_override'
  | 'external_action'
  | 'sensitive_fs'
  | 'automation_change';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired';
export type ApprovalRequesterType = 'user' | 'agent' | 'automation' | 'system';
export type ApprovalRiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface Approval {
  id: string;
  approval_type: ApprovalType;
  status: ApprovalStatus;
  requested_by_type: ApprovalRequesterType;
  requested_by_id: string | null;
  entity_type: string;
  entity_id: string;
  title: string;
  description: string | null;
  payload: string | null;
  decided_by: string | null;
  decision_reason: string | null;
  decided_at: string | null;
  expires_at: string | null;
  orchestration_run_id: string | null;
  created_at: string;
  /** Risk-gates whether decide requires a verified resume token. */
  risk_level: ApprovalRiskLevel;
  /** Keyed HMAC-SHA256 hex of the most-recently-issued resume token (if any). */
  resume_token_hash: string | null;
}

export interface CreateApprovalInput {
  id: string;
  approval_type: ApprovalType;
  requested_by_type: ApprovalRequesterType;
  requested_by_id?: string;
  entity_type: string;
  entity_id: string;
  title: string;
  description?: string;
  payload?: string;
  expires_at?: string;
  orchestration_run_id?: string;
  risk_level?: ApprovalRiskLevel;
  resume_token_hash?: string;
}

// ============ Channel Types ============

export type ChannelPlatform =
  | 'telegram'
  | 'lark'
  | 'discord'
  | 'slack'
  | 'imessage'
  | 'whatsapp';
export type ChannelMode = 'polling' | 'webhook' | 'socket';
export type PluginLifecycleState =
  | 'created'
  | 'initializing'
  | 'ready'
  | 'running'
  | 'stopping'
  | 'stopped';
export type ChannelPermissionTier = 'viewer' | 'operator' | 'admin';
export type ChannelAccessMode = 'open' | 'gated';
/** Slack App Home — admin policy for user-added MCP servers. */
export type SlackUserMcpPolicy = 'open' | 'admin-approved' | 'disabled';

export interface ChannelConfig {
  id: string;
  platform: ChannelPlatform;
  /** Human-readable bot name (e.g. "Sales Bot"). Null for legacy single-bot configs. */
  name: string | null;
  token: string | null;
  mode: ChannelMode;
  rate_limit: number;
  enabled: boolean;
  guardrails_provider: 'none' | 'anthropic' | 'llm-guard';
  guardrails_fail_mode: 'open' | 'closed';
  /** Model ID to use for this channel's agent (e.g. 'claude-sonnet-5'). Null = default. */
  model: string | null;
  /** When true, only respond to messages that @-mention the bot in guild channels. Default false. */
  mention_only: boolean;
  /** Agent profile ID — uses the profile's soul/system_prompt for this channel. Null = no profile. */
  agent_profile_id: string | null;
  /** When true, use Block Kit progress blocks for Slack (no "(edited)" tag). Default true. */
  block_kit_progress: boolean;
  /** 'open' = auto-approve new users on first message; 'gated' = require /pair code. Default 'open'. */
  access_mode: ChannelAccessMode;
  /**
   * Slack App Home — comma-separated allowlist of credential connector keys.
   * Empty/null means "all connectors". Slack-only.
   */
  cred_connectors_allowlist: string | null;
  /** Slack App Home — admin policy for user-added MCP servers. Default 'open'. */
  user_mcp_policy: SlackUserMcpPolicy;
  created_at: string;
}

export interface CreateChannelConfigInput {
  id: string;
  platform: ChannelPlatform;
  name?: string;
  token?: string;
  mode?: ChannelMode;
  rate_limit?: number;
  enabled?: boolean;
  guardrails_provider?: 'none' | 'anthropic' | 'llm-guard';
  guardrails_fail_mode?: 'open' | 'closed';
  model?: string | null;
  mention_only?: boolean;
  agent_profile_id?: string | null;
  block_kit_progress?: boolean;
  access_mode?: ChannelAccessMode;
  cred_connectors_allowlist?: string | null;
  user_mcp_policy?: SlackUserMcpPolicy;
}

export interface ChannelUser {
  id: string;
  platform: ChannelPlatform;
  config_id: string | null;
  platform_user_id: string;
  display_name: string | null;
  approved_at: string | null;
  permission_tier: ChannelPermissionTier;
  token_budget: number;
  tokens_used_today: number;
  tokens_period_start: string | null;
}

export interface ChannelPairingCode {
  code: string;
  platform: ChannelPlatform;
  config_id: string | null;
  platform_user_id: string;
  expires_at: string;
  used: boolean;
}

export interface ChannelSession {
  id: string;
  platform: string;
  config_id: string | null;
  session_key: string;
  channel_user_id: string | null;
  agent_session_id: string | null;
  agent_task_id: string | null;
  status: 'active' | 'idle' | 'archived';
  context_summary: string | null;
  last_activity_at: string | null;
  error_count: number;
  created_at: string;
  updated_at: string;
}

export interface CreateChannelSessionInput {
  id: string;
  platform: string;
  config_id?: string;
  session_key: string;
  channel_user_id: string | null;
  status?: 'active' | 'idle' | 'archived';
}

export interface ChannelMessage {
  id: string;
  session_id: string;
  platform: string;
  config_id: string | null;
  platform_message_id: string | null;
  direction: 'inbound' | 'outbound';
  content: string;
  content_type: string;
  token_count: number;
  metadata: string;
  created_at: string;
}

export interface InsertChannelMessageInput {
  id: string;
  session_id: string;
  platform: string;
  config_id?: string;
  platform_message_id: string | null;
  direction: 'inbound' | 'outbound';
  content: string;
  content_type?: string;
  token_count?: number;
  metadata?: string;
}

export interface ChannelAuditLog {
  id: string;
  channel_user_id: string | null;
  platform: string | null;
  config_id: string | null;
  action: string;
  details: string;
  created_at: string;
}

export interface InsertAuditLogInput {
  id: string;
  channel_user_id: string | null;
  platform: string | null;
  config_id?: string;
  action: string;
  details: string;
}

// ============ Publish Ledger Types ============

export interface PublishJobRow {
  id: string;
  workspace_id: string;
  created_by: string;
  artifact_id: string | null;
  source_artifact_path: string;
  source_sha256: string;
  source_size_bytes: number;
  source_mime: string;
  source_provenance_json: string | null;
  source_json: string;
  signed_artifact_path: string | null;
  manifest_path: string | null;
  provenance_state: ProvenanceState;
  state: JobState;
  approval_required: number;
  approval_channel: 'frontend' | 'channel' | null;
  approved_by: string | null;
  approved_at: string | null;
  scheduled_for: string | null;
  idempotency_key: string;
  metadata_json: string;
  workflow_version?: string;
  workflow_state_json?: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface InsertPublishJobRowInput {
  id: string;
  workspace_id: string;
  created_by: string;
  artifact_id?: string | null;
  source_artifact_path: string;
  source_sha256: string;
  source_size_bytes: number;
  source_mime: string;
  source_provenance_json?: string | null;
  source_json: string;
  signed_artifact_path?: string | null;
  manifest_path?: string | null;
  provenance_state: ProvenanceState;
  state: JobState;
  approval_required: number;
  approval_channel?: 'frontend' | 'channel' | null;
  approved_by?: string | null;
  approved_at?: string | null;
  scheduled_for?: string | null;
  idempotency_key: string;
  metadata_json: string;
  workflow_version?: string;
  workflow_state_json?: string;
}

export interface PublishDestinationLegRow {
  id: string;
  job_id: string;
  destination_kind: DestinationKind;
  destination_label: string | null;
  connection_id: string;
  idempotency_key: string;
  state: LegState;
  config_json: string;
  plan_json: string | null;
  session_id: string | null;
  chunk_offset_bytes: number;
  total_bytes: number | null;
  etags_json: string | null;
  attempts: number;
  provider_response_json: string | null;
  published_ref_json: string | null;
  error_class: string | null;
  error_message: string | null;
  next_retry_at: string | null;
  locked_by: string | null;
  lease_until: string | null;
  notification_channel_ref: string | null;
  notification_delivered_at: string | null;
  approval_required?: number;
  approved_by?: string | null;
  approved_at?: string | null;
  rejection_reason?: string | null;
  last_progress_at: string | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
}

export interface InsertPublishDestinationLegRowInput {
  id: string;
  job_id: string;
  destination_kind: DestinationKind;
  destination_label?: string | null;
  connection_id: string;
  idempotency_key: string;
  state: LegState;
  config_json: string;
  total_bytes?: number | null;
  approval_required?: number;
}

export interface PublishQuotaUsageRow {
  connection_id: string;
  quota_kind: string;
  value: number;
  window_start: string;
  window_end: string;
  updated_at: string;
}

export interface SocialPublishConnectionRow {
  id: string;
  provider: string;
  account_handle: string | null;
  display_name: string | null;
  status: string;
  scopes_json: string;
  capabilities_json: string;
  connected_at: string;
  updated_at: string;
  token_ref: string;
}
