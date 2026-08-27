/**
 * Database Validation Schemas
 *
 * Zod schemas for validating API request bodies.
 * These correspond to the types in ./types.ts.
 */

import { z } from 'zod';

// ============ Session Schemas ============

export const CreateSessionSchema = z.object({
  id: z.string().min(1),
  prompt: z.string().min(1),
});

export const UpdateSessionTaskCountSchema = z.object({
  taskCount: z.number().int().min(0),
});

// ============ Task Schemas ============

export const SearchQuerySchema = z.object({
  q: z.string().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const CreateTaskSchema = z.object({
  id: z.string().min(1),
  session_id: z.string().min(1),
  task_index: z.number().int().min(0),
  prompt: z.string().min(1),
  work_dir: z.string().optional(),
  additional_work_dirs: z.string().optional(),
  agent_session_id: z.string().nullable().optional(),
  parent_task_id: z.string().nullable().optional(),
  project_id: z.string().nullable().optional(),
  assignee_profile_id: z.string().nullable().optional(),
});

export const UpdateTaskSchema = z.object({
  status: z.enum(['running', 'completed', 'error', 'stopped']).optional(),
  cost: z.number().nullable().optional(),
  duration: z.number().nullable().optional(),
  prompt: z.string().optional(),
  title: z.string().nullable().optional(),
  work_dir: z.string().nullable().optional(),
  agent_session_id: z.string().nullable().optional(),
  favorite: z.boolean().optional(),
  project_id: z.string().nullable().optional(),
  goal_id: z.string().nullable().optional(),
  parent_task_id: z.string().nullable().optional(),
  priority: z.enum(['urgent', 'high', 'medium', 'low']).optional(),
  labels: z.string().nullable().optional(),
  blocked_reason: z.string().nullable().optional(),
});

// ============ Message Schemas ============

const MessageTypeEnum = z.enum([
  'text',
  'tool_use',
  'tool_result',
  'result',
  'error',
  'user',
  'plan',
]);

const FileTypeEnum = z.enum([
  'image',
  'text',
  'code',
  'document',
  'website',
  'presentation',
  'spreadsheet',
  'audio',
  'video',
]);

export const CreateMessageSchema = z.object({
  task_id: z.string().min(1),
  type: MessageTypeEnum,
  content: z.string().nullable().optional(),
  tool_name: z.string().nullable().optional(),
  tool_input: z.string().nullable().optional(),
  tool_output: z.string().nullable().optional(),
  tool_use_id: z.string().nullable().optional(),
  subtype: z.string().nullable().optional(),
  error_message: z.string().nullable().optional(),
  attachments: z.string().nullable().optional(),
  is_error: z.union([z.boolean(), z.number().int().min(0).max(1)]).optional(),
  cost: z.number().nullable().optional(),
  usage_input: z.number().int().nullable().optional(),
  usage_output: z.number().int().nullable().optional(),
  usage_cache_read: z.number().int().nullable().optional(),
  usage_cache_creation: z.number().int().nullable().optional(),
  model: z.string().nullable().optional(),
  // Needed for the partial UNIQUE index on `message_id` to catch duplicates
  // when both the frontend (via /messages) and ag-ui.ts (via the run payload)
  // try to persist the same user message. Before this field was part of the
  // schema, Zod stripped it silently and the DB got two rows per submission.
  message_id: z.string().nullable().optional(),
  run_id: z.string().nullable().optional(),
  agui_type: z.string().nullable().optional(),
  step_name: z.string().nullable().optional(),
});

export const UpdateTaskFromMessageSchema = z.object({
  messageType: z.string().min(1),
  subtype: z.string().optional(),
  cost: z.number().optional(),
  duration: z.number().optional(),
});

export const UpdateMessageContentSchema = z.object({
  content: z.string().min(1),
});

// ============ File Schemas ============

export const CreateFileSchema = z.object({
  task_id: z.string().min(1),
  name: z.string().min(1),
  type: FileTypeEnum,
  path: z.string().min(1),
  preview: z.string().nullable().optional(),
  thumbnail: z.string().nullable().optional(),
});

// ============ Task Link & Comment Schemas ============

export const CreateTaskLinkSchema = z.object({
  id: z.string().min(1),
  from_task_id: z.string().min(1),
  to_task_id: z.string().min(1),
  link_type: z.enum(['parent_child', 'blocks', 'relates_to']),
});

export const CreateTaskCommentSchema = z.object({
  id: z.string().min(1),
  task_id: z.string().min(1),
  author_type: z.enum(['user', 'agent', 'system']),
  author_id: z.string().optional(),
  content: z.string().min(1),
});

// ============ Project Schemas ============

export const CreateProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  workspace: z.string().max(500).optional(),
});

export const UpdateProjectSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable()
    .optional(),
  workspace: z.string().max(500).nullable().optional(),
  status: z.enum(['active', 'in_progress', 'completed', 'archived']).optional(),
});

export const CreateGoalSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(200),
  description: z.string().max(500).optional(),
  project_id: z.string().optional(),
});

export const UpdateGoalSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(500).nullable().optional(),
  status: z.enum(['active', 'completed', 'archived']).optional(),
  project_id: z.string().nullable().optional(),
});

// ============ Media Version Schemas ============

export const MediaVersionSchema = z.object({
  id: z.string().min(1),
  task_id: z.string().min(1),
  artifact_id: z.string().min(1),
  version_number: z.number().int().min(0),
  path: z.string().min(1),
  prompt: z.string(),
  previous_version_id: z.string().nullable(),
  type: z.string().min(1),
  created_at: z.string().min(1),
});

// ============ Video Mode Schemas ============

export const VideoTemplateIdSchema = z.enum([
  'product-reel',
  'explainer',
  'slideshow',
  'podcast',
  'ugc-ad',
  'custom',
]);

export const VideoAspectRatioSchema = z.enum(['16:9', '9:16', '1:1', '4:5']);

export const CreateVideoProjectSchema = z.object({
  name: z.string().min(1).max(160),
  template: VideoTemplateIdSchema.default('custom'),
  prompt: z.string().max(5000).optional(),
  aspectRatio: VideoAspectRatioSchema.optional(),
});

const VideoAnalysisRangeSchema = z
  .object({
    id: z.string().min(1).optional(),
    startMs: z.number().int().min(0),
    endMs: z.number().int().min(0),
    label: z.string().max(120).optional(),
    confidence: z.number().min(0).max(1).optional(),
  })
  .refine((range) => range.endMs > range.startMs, {
    message: 'endMs must be greater than startMs',
  });

const VideoAnalysisArtifactSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum([
      'silence-ranges',
      'beat-markers',
      'highlight-ranges',
      'transcript-ranges',
      'clip-timings',
      'custom',
    ]),
    sourceMediaId: z.string().min(1).optional(),
    summary: z.string().max(1000).optional(),
    ranges: z.array(VideoAnalysisRangeSchema).max(500).optional(),
    proposedActionBatch: z
      .object({
        id: z.string().min(1).optional(),
        summary: z.string().max(280).optional(),
        ops: z.array(z.unknown()).min(1).max(20),
      })
      .optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    generatedAt: z.string().min(1),
  })
  .strict();

export const UpdateVideoProjectSchema = z.object({
  name: z.string().min(1).max(160).optional(),
  prompt: z.string().max(10000).optional(),
  script: z.string().max(50000).optional(),
  template: VideoTemplateIdSchema.optional(),
  brandKit: z
    .object({
      logos: z.array(z.string()).max(10).optional(),
      primaryColor: z.string().max(40).optional(),
      secondaryColor: z.string().max(40).optional(),
      fontFamily: z.string().max(120).optional(),
      watermarkPosition: z.enum(['tl', 'tr', 'bl', 'br', 'none']).optional(),
    })
    .optional(),
  budget: z
    .object({
      capUsd: z.number().min(0).max(10000).optional(),
      spentUsd: z.number().min(0).max(10000).optional(),
    })
    .optional(),
  analysisArtifacts: z.array(VideoAnalysisArtifactSchema).max(200).optional(),
});

// ============ Orchestration Run Schemas ============

const OrchestrationRunTypeEnum = z.enum([
  'plan',
  'delegation',
  'approval_wait',
]);

const OrchestrationRunStatusEnum = z.enum([
  'pending',
  'approved',
  'rejected',
  'executing',
  'completed',
  'failed',
]);

export const CreateOrchestrationRunSchema = z.object({
  id: z.string().min(1),
  task_id: z.string().min(1),
  run_type: OrchestrationRunTypeEnum,
  payload: z.string().min(1),
  resume_token: z.string().optional(),
});

export const UpdateOrchestrationRunStatusSchema = z.object({
  status: OrchestrationRunStatusEnum,
  resume_token: z.string().nullable().optional(),
});

// ============ Soul Schemas ============

export const AgentSoulSchema = z.object({
  schema_version: z.literal('1.0'),
  soul_language: z.string().max(20).optional(),
  identity: z.object({
    role: z.string().min(1).max(500),
    core_values: z.array(z.string().max(200)).min(1).max(10),
    worldview: z.string().max(1000).optional(),
    opinions: z.array(z.string().max(300)).max(10).optional(),
  }),
  voice: z.object({
    tone: z.string().max(200),
    style_rules: z.array(z.string().max(300)).min(1).max(15),
    greeting: z.string().max(500).optional(),
    example_phrases: z.array(z.string().max(200)).max(10).optional(),
    anti_patterns: z.array(z.string().max(200)).max(10).optional(),
  }),
  cognition: z.object({
    reasoning_style: z.string().max(500),
    expertise: z.array(z.string().max(100)).max(10).optional(),
    operating_modes: z.record(z.string(), z.string().max(300)).optional(),
    approach_preferences: z.array(z.string().max(300)).max(10).optional(),
    skill_bundles: z
      .array(
        z.object({
          name: z.string().max(100),
          description: z.string().max(300),
          approach: z.string().max(500),
          trigger: z.string().max(200).optional(),
        }),
      )
      .max(10)
      .optional(),
  }),
  boundaries: z.object({
    red_lines: z.array(z.string().max(300)).min(1).max(15),
    escalation_rules: z.array(z.string().max(300)).max(10).optional(),
    privacy_rules: z.array(z.string().max(300)).max(10).optional(),
    action_limits: z.array(z.string().max(300)).max(10).optional(),
  }),
  continuity: z
    .object({
      session_notes: z.array(z.string().max(300)).max(20).optional(),
    })
    .optional(),
  evolution: z
    .object({
      self_improving: z.boolean(),
      max_corrections: z.number().int().min(5).max(100).default(50),
      max_learnings: z.number().int().min(5).max(100).default(50),
      last_evolved_at: z.string().optional(),
    })
    .optional(),
});

export const CorrectionSchema = z.object({
  id: z.string().min(1),
  timestamp: z.string(),
  trigger: z.enum([
    'user_negative_feedback',
    'task_failure',
    'user_edit',
    'explicit_rating',
  ]),
  context: z.string().max(1000),
  what_went_wrong: z.string().max(500),
  correct_approach: z.string().max(500),
  confidence: z.number().min(0).max(1),
});

export const LearningSchema = z.object({
  id: z.string().min(1),
  timestamp: z.string(),
  category: z.enum([
    'pattern',
    'preference',
    'tool_usage',
    'domain_knowledge',
    'communication',
  ]),
  content: z.string().max(500),
  source: z.enum(['correction', 'success', 'observation']),
  times_applied: z.number().int().min(0),
});

export const SoulAmendmentSchema = z.object({
  field: z.string(),
  action: z.enum(['add', 'modify', 'remove']),
  old_value: z.string().optional(),
  new_value: z.string(),
  reason: z.string(),
});

export const ImportSoulSchema = z.object({
  soul_spec_version: z.literal('1.0'),
  soul_language: z.string().max(20).optional(),
  soul: AgentSoulSchema,
  corrections: z.array(CorrectionSchema).optional(),
  learnings: z.array(LearningSchema).optional(),
});

// ============ Agent Profile Schemas ============

export const CreateAgentProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(100),
  runtime_id: z.string().min(1).default('claude'),
  role: z.string().max(100).optional(),
  description: z.string().max(500).optional(),
  avatar_color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  avatar_icon: z.string().max(50).optional(),
  default_model: z.string().optional(),
  default_provider: z.string().optional(),
  default_mcp_servers: z.string().optional(),
  default_skills: z.string().optional(),
  system_prompt: z.string().max(10000).optional(),
  soul: z.string().optional(),
  soul_origin: z.string().optional(),
  max_concurrent_tasks: z.number().int().min(1).max(10).optional(),
  max_delegation_depth: z.number().int().min(0).max(10).optional(),
  allowed_delegates: z.string().optional(),
  session_compaction_policy: z.string().optional(),
  max_session_messages: z.number().int().min(10).max(1000).optional(),
  default_thinking_config: z
    .string()
    .max(500)
    .refine(
      (s) => {
        try {
          JSON.parse(s);
          return true;
        } catch {
          return false;
        }
      },
      { message: 'must be valid JSON' },
    )
    .nullable()
    .optional(),
});

export const UpdateAgentProfileSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  role: z.string().max(100).nullable().optional(),
  description: z.string().max(500).nullable().optional(),
  avatar_color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable()
    .optional(),
  avatar_icon: z.string().max(50).nullable().optional(),
  runtime_id: z.string().min(1).optional(),
  default_model: z.string().nullable().optional(),
  default_provider: z.string().nullable().optional(),
  default_mcp_servers: z.string().nullable().optional(),
  default_skills: z.string().nullable().optional(),
  system_prompt: z.string().max(10000).nullable().optional(),
  soul: z.string().nullable().optional(),
  soul_version: z.number().int().optional(),
  soul_origin: z.string().nullable().optional(),
  corrections_log: z.string().nullable().optional(),
  learnings: z.string().nullable().optional(),
  max_concurrent_tasks: z.number().int().min(1).max(10).optional(),
  max_delegation_depth: z.number().int().min(0).max(10).optional(),
  allowed_delegates: z.string().nullable().optional(),
  session_compaction_policy: z.string().optional(),
  max_session_messages: z.number().int().min(10).max(1000).optional(),
  default_thinking_config: z
    .string()
    .max(500)
    .refine(
      (s) => {
        try {
          JSON.parse(s);
          return true;
        } catch {
          return false;
        }
      },
      { message: 'must be valid JSON' },
    )
    .nullable()
    .optional(),
  status: z.enum(['active', 'paused', 'archived']).optional(),
});

// ============ User Template Schemas ============

export const CreateUserTemplateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(100),
  category: z.enum(['dev', 'writing', 'research', 'data', 'design', 'ops']),
  system_prompt: z.string().min(1).max(10000),
  starter_prompts: z.string().min(1),
  description: z.string().max(500).optional(),
  suggested_model: z.string().optional(),
  skills: z.string().optional(),
  mcp_servers: z.string().optional(),
  icon: z.string().max(50).optional(),
  is_built_in: z.number().int().min(0).max(1).optional(),
});

export const UpdateUserTemplateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  category: z
    .enum(['dev', 'writing', 'research', 'data', 'design', 'ops'])
    .optional(),
  system_prompt: z.string().min(1).max(10000).optional(),
  suggested_model: z.string().nullable().optional(),
  skills: z.string().nullable().optional(),
  mcp_servers: z.string().nullable().optional(),
  starter_prompts: z.string().optional(),
  icon: z.string().max(50).nullable().optional(),
});

// ============ Batch Operation Schemas ============

export const BatchDeleteSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
});

// ============ Queue Schemas ============

export const EnqueueTaskSchema = z.object({
  taskId: z.string().min(1),
  profileId: z.string().min(1),
  priority: z.number().int().min(0).max(100).optional(),
});

export const QueueStatsResponseSchema = z.object({
  queued: z.number().int().min(0),
  pickedUp: z.number().int().min(0),
  done: z.number().int().min(0),
});

// ============ Settings Schemas ============

export const SaveSettingSchema = z.object({
  value: z.string(),
});

// ============ Budget Policy Schemas ============

const BudgetScopeTypeEnum = z.enum([
  'global',
  'provider',
  'model',
  'agent_profile',
  'project',
  'automation',
]);

const BudgetPeriodTypeEnum = z.enum(['monthly', 'weekly', 'daily']);

export const CreateBudgetPolicySchema = z.object({
  id: z.string().min(1),
  name: z.string().max(100).optional(),
  scope_type: BudgetScopeTypeEnum,
  scope_id: z
    .string()
    .transform((v) => v || null)
    .nullable()
    .optional(),
  period_type: BudgetPeriodTypeEnum.optional(),
  limit_usd: z.number().positive(),
  alert_threshold_pct: z.number().int().min(1).max(100).optional(),
  hard_stop: z.boolean().optional(),
});

export const UpdateBudgetPolicySchema = z.object({
  name: z.string().max(100).nullable().optional(),
  scope_type: BudgetScopeTypeEnum.optional(),
  scope_id: z.string().nullable().optional(),
  period_type: BudgetPeriodTypeEnum.optional(),
  limit_usd: z.number().positive().optional(),
  alert_threshold_pct: z.number().int().min(1).max(100).optional(),
  hard_stop: z.boolean().optional(),
  enabled: z.boolean().optional(),
});

// ============ Task Document Schemas ============

export const CreateOrUpdateTaskDocumentSchema = z.object({
  id: z.string().min(1).optional(),
  title: z.string().max(200).optional(),
  content: z.string().min(1),
  created_by: z.enum(['user', 'agent']).optional(),
});

// ============ Approval Schemas ============

export const approvalTypeSchema = z.enum([
  'plan',
  'delegation',
  'budget_override',
  'external_action',
  'sensitive_fs',
  'automation_change',
]);

export const approvalStatusSchema = z.enum([
  'pending',
  'approved',
  'rejected',
  'expired',
]);

export const approvalRiskLevelSchema = z.enum([
  'low',
  'medium',
  'high',
  'critical',
]);

export const createApprovalSchema = z.object({
  id: z.string().min(1),
  approval_type: approvalTypeSchema,
  requested_by_type: z.enum(['user', 'agent', 'automation', 'system']),
  requested_by_id: z.string().optional(),
  entity_type: z.string().min(1),
  entity_id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  payload: z.string().optional(),
  expires_at: z.string().optional(),
  orchestration_run_id: z.string().optional(),
  risk_level: approvalRiskLevelSchema.optional(),
});

export const decideApprovalSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  reason: z.string().optional(),
  /**
   * HMAC resume token issued with the original INTERRUPT event. Required
   * when the approval's `risk_level` is `high` or `critical`.
   * See src-api/src/shared/services/ag-ui/resume-token.ts.
   */
  resumeToken: z.string().optional(),
});

// ============ Channel Schemas ============

export const channelPlatformSchema = z.enum([
  'telegram',
  'lark',
  'discord',
  'slack',
  'imessage',
  'whatsapp',
]);

export const channelPermissionTierSchema = z.enum([
  'viewer',
  'operator',
  'admin',
]);

export const createChannelConfigSchema = z.object({
  platform: channelPlatformSchema,
  name: z.string().optional(),
  token: z.string().optional(),
});

export const upsertChannelConfigSchema = z.object({
  name: z.string().nullable().optional(),
  token: z.string().optional(),
  mode: z.enum(['polling', 'webhook', 'socket']).optional(),
  rate_limit: z.number().int().min(1).max(100).optional(),
  enabled: z.boolean().optional(),
  guardrails_provider: z
    .enum(['none', 'anthropic', 'llm-guard'])
    .nullable()
    .optional(),
  guardrails_fail_mode: z.enum(['open', 'closed']).nullable().optional(),
  model: z.string().nullable().optional(),
  mention_only: z.boolean().optional(),
  agent_profile_id: z.string().nullable().optional(),
  access_mode: z.enum(['open', 'gated']).optional(),
  /**
   * Slack App Home — comma-separated allowlist of credential connector keys
   * (`github,linear,anthropic,openai,notion,jira`). When empty the Home tab
   * exposes every connector. Only stored on Slack-platform configs.
   */
  cred_connectors_allowlist: z.string().nullable().optional(),
  /**
   * Slack App Home — policy for user-added MCP servers.
   *   `open`           → users self-add (default)
   *   `admin-approved` → rows insert with pending_admin_approval=1
   *   `disabled`       → MCP section hidden on Home
   */
  user_mcp_policy: z.enum(['open', 'admin-approved', 'disabled']).optional(),
});

export const createChannelSessionSchema = z.object({
  id: z.string(),
  platform: z.string(),
  config_id: z.string().optional(),
  session_key: z.string(),
  channel_user_id: z.string().nullable(),
  status: z.enum(['active', 'idle', 'archived']).optional(),
});

export const insertChannelMessageSchema = z.object({
  id: z.string(),
  session_id: z.string(),
  platform: z.string(),
  config_id: z.string().optional(),
  platform_message_id: z.string().nullable(),
  direction: z.enum(['inbound', 'outbound']),
  content: z.string(),
  content_type: z.string().optional(),
  token_count: z.number().int().optional(),
  metadata: z.string().optional(),
});

export const insertAuditLogSchema = z.object({
  id: z.string(),
  channel_user_id: z.string().nullable(),
  platform: z.string().nullable(),
  config_id: z.string().optional(),
  action: z.string(),
  details: z.string(),
});
