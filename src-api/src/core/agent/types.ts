/**
 * Agent SDK Abstraction Layer - Type Definitions
 *
 * This module defines the common interfaces for different agent implementations.
 * Supports: Claude Agent SDK, DeepAgents.js, and custom implementations.
 */

// ============================================================================
// Message Types
// ============================================================================

import type {
  McpServerConfig,
  SdkMcpToolDefinition,
} from '@anthropic-ai/claude-agent-sdk';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { TurnBudgetOutcome } from './turn-budget';

/**
 * A per-run in-process MCP server exposed to a subprocess runtime over the
 * loopback bridge. `createServer` is a factory (fresh instance per bridge
 * request). Structurally matches `InProcessBridgeServer` in the subprocess
 * bridge so it can be passed straight through.
 */
export interface BridgeInProcessServer {
  name: string;
  createServer: () => McpServer | Promise<McpServer>;
  /** Ambient context installed around each bridged request (output dir, video
   * project id for media ingest), mirroring the direct path's session ctx. */
  sessionContext?: SessionContext;
  /** Best-effort post-request hook receiving the raw JSON-RPC response text —
   * lets the caller react to tool output (e.g. ingest generated media) without
   * coupling the generic bridge to any feature. */
  onResult?: (responseText: string) => void | Promise<void>;
}

import type { ToolLifecycleHook } from '@/core/agent/tool-lifecycle-hooks';
import type { SandboxConfig } from '@/core/sandbox/types';

import type { SessionContext } from '@/shared/services/session-context';

import type { ProcessSandboxProfile } from './sandbox-profile';
import type { ToolClassification } from './tool-permission-registry';

export type { SandboxConfig };

/**
 * Model configuration for custom API endpoints
 */
export interface ModelConfig {
  /** Stable settings/provider identity. Do not infer wire behavior from URLs. */
  providerId?: string;
  /** Provider-specific OpenAI-compatible wire contract. */
  dialect?: OpenAICompatDialect;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  agentType?: AgentProvider;
}

export type OpenAICompatDialect = 'standard' | 'kimi-k3';

export type AgentMessageType =
  | 'session'
  | 'text'
  | 'user'
  | 'tool_use'
  | 'tool_use_args_delta'
  | 'tool_result'
  | 'result'
  | 'error'
  | 'done'
  | 'plan'
  | 'direct_answer'
  | 'thinking'
  | 'planning_status'
  | 'step_started'
  | 'step_finished'
  | 'permission_request'
  | 'system'
  | 'tool_progress';

/**
 * AG-UI Protocol aligned event type constants.
 * Mirrors @ag-ui/core EventType enum for internal use.
 * Old AgentMessageType strings remain for backward compat until Phase 2 migration.
 */
export const AGUIEventType = {
  // Lifecycle
  RUN_STARTED: 'RUN_STARTED',
  RUN_FINISHED: 'RUN_FINISHED',
  RUN_ERROR: 'RUN_ERROR',
  STEP_STARTED: 'STEP_STARTED',
  STEP_FINISHED: 'STEP_FINISHED',
  // Text messages
  TEXT_MESSAGE_START: 'TEXT_MESSAGE_START',
  TEXT_MESSAGE_CONTENT: 'TEXT_MESSAGE_CONTENT',
  TEXT_MESSAGE_END: 'TEXT_MESSAGE_END',
  // Tool calls
  TOOL_CALL_START: 'TOOL_CALL_START',
  TOOL_CALL_ARGS: 'TOOL_CALL_ARGS',
  TOOL_CALL_END: 'TOOL_CALL_END',
  TOOL_CALL_RESULT: 'TOOL_CALL_RESULT',
  // State
  STATE_SNAPSHOT: 'STATE_SNAPSHOT',
  STATE_DELTA: 'STATE_DELTA',
  MESSAGES_SNAPSHOT: 'MESSAGES_SNAPSHOT',
  // Reasoning (extended thinking)
  REASONING_START: 'REASONING_START',
  REASONING_MESSAGE_START: 'REASONING_MESSAGE_START',
  REASONING_MESSAGE_CONTENT: 'REASONING_MESSAGE_CONTENT',
  REASONING_MESSAGE_END: 'REASONING_MESSAGE_END',
  REASONING_END: 'REASONING_END',
  // Special
  CUSTOM: 'CUSTOM',
  RAW: 'RAW',
  ERROR: 'ERROR',
} as const;

export type AGUIEventTypeValue =
  (typeof AGUIEventType)[keyof typeof AGUIEventType];

export interface AgentMessage {
  type: AgentMessageType;
  code?: 'AGENT_PROMPT_TOO_LARGE' | string;
  /**
   * Live backend session ID used for cancellation, question routing, and
   * per-run bookkeeping.
   */
  sessionId?: string;
  /**
   * Durable upstream provider session/thread handle used for later resume.
   * This can differ from `sessionId`; callers must not use it for `/stop`.
   */
  resumeSessionId?: string;
  content?: string;
  subtype?: string;
  name?: string;
  id?: string;
  input?: unknown;
  cost?: number;
  duration?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    reasoning_output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  model?: string;
  // Tool result fields
  toolUseId?: string;
  output?: string;
  isError?: boolean;
  // Plan fields
  plan?: TaskPlan;
  // Error fields
  message?: string;
  // Planning progress fields
  /** Elapsed time in ms since planning started (for planning_status messages) */
  elapsedMs?: number;
  /** Truncated snippet of the model's reasoning (from thinking_delta events) */
  thinkingText?: string;
  // Step lifecycle fields
  stepName?: string;
  // Permission fields
  permission?: {
    id: string;
    tool: string;
    command?: string;
    description: string;
    risk_level?: 'low' | 'medium' | 'high';
  };
  // AG-UI correlation fields
  /** Unique identifier for this run/execution */
  runId?: string;
  /** Monotonic sequence number within a run (OpenClaw pattern for ordering guarantees) */
  seq?: number;
  /** Unix ms timestamp of event emission */
  ts?: number;
  /** AG-UI stream category */
  stream?: 'lifecycle' | 'tool' | 'assistant' | 'error' | 'reasoning';
  /**
   * Transient progress/heartbeat message — should be excluded from
   * conversation history sent to the API on subsequent turns.
   */
  isProgress?: boolean;
  /** Zero-based execution attempt, used for durable retry provenance. */
  attempt?: number;
  /**
   * Parent tool use ID — scopes this message to a sub-agent conversation.
   * Set on step_started/step_finished/task_progress for sub-agent lifecycle tracking.
   */
  parentToolUseId?: string;
  /** Actual session working directory (emitted on 'session' messages so the
   *  API can update the task's work_dir in the database). */
  cwd?: string;
  /**
   * Why the agent SDK query loop terminated.
   * Available on 'result' messages from Agent SDK ≥0.2.91.
   */
  terminalReason?: string;
  /**
   * Provider-neutral stop reason, normalized at the shared agent-runtime
   * boundary (see `core/agent/turn-budget.ts`). Set on 'result' messages so
   * the UI can distinguish "the model finished" from "we hit a ceiling".
   */
  turnBudget?: TurnBudgetOutcome;
  /** Configured turn ceiling for this run, when the caller set one. */
  maxTurns?: number;
  /**
   * Phase 7: tool-output defense verdict + audit metadata. Adapters set this
   * on tool_result messages so AG-UI / persistence can attach a security
   * chip and redact persisted content according to the verdict.
   * Never includes raw payload bytes.
   */
  security?: {
    verdict: 'ALLOW' | 'WARN' | 'BLOCK' | 'HITL_REQUIRED';
    source: string;
    payloadHash?: string;
    redactedSnippet?: string;
    /** Per-category aggregate scores (0..1). */
    scores?: Record<string, number>;
  };
}

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  /** Image file paths attached to this message (saved to workspace) */
  imagePaths?: string[];
}

/**
 * Image attachment for vision capabilities
 */
export interface ImageAttachment {
  data: string; // Base64 encoded image data
  mimeType: string; // e.g., 'image/png', 'image/jpeg'
}

// ============================================================================
// Plan Types
// ============================================================================

export interface TaskPlan {
  id: string;
  goal: string;
  steps: PlanStep[];
  notes?: string;
  executionMode?: 'standard' | 'batch';
  createdAt: Date;
}

export interface PlanStep {
  id: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
}

// ============================================================================
// Agent Configuration
// ============================================================================

export type AgentProvider =
  | 'claude'
  | 'codex'
  | 'deepagents'
  | 'open-agent-sdk'
  | 'openai-compat'
  | 'gemini'
  | 'gemini-local'
  | 'opencode-local'
  | 'cursor-agent'
  | 'qwen'
  | 'copilot'
  | 'kimi'
  | 'atomcode'
  | 'pi-local'
  | 'http-agent'
  | 'a2a'
  | 'video'
  | 'mock'
  | 'custom';

/** Extensible adapter identifier for registry */
export type AgentAdapterId = string;

/** Transport mechanism used by the adapter */
export type AgentTransport = 'sdk' | 'cli' | 'http' | 'process' | 'a2a';

/** MCP integration support level */
export type McpSupport = 'native' | 'shim' | 'none';

/** Skills integration support level */
export type SkillsSupport = 'native' | 'shim' | 'none';

/** Plan mode support level */
export type PlanModeSupport = 'native' | 'orchestrated' | 'none';

/** Environment health report from adapter preflight check */
export interface AdapterEnvironmentReport {
  healthy: boolean;
  binaryFound: boolean;
  authValid: boolean;
  helloProbeOk: boolean;
  errors: string[];
  models?: Array<{ id: string; label: string }>;
}

export interface AgentConfig {
  /** Agent provider to use */
  provider: AgentProvider;
  /** API key for the provider */
  apiKey?: string;
  /** Custom API base URL (for third-party API endpoints) */
  baseUrl?: string;
  /** Model to use (provider-specific) */
  model?: string;
  /** Stable settings/provider identity used for provider-owned state. */
  providerId?: string;
  /** Explicit OpenAI-compatible wire contract. */
  dialect?: OpenAICompatDialect;
  /**
   * Working directory for file operations.
   * Typically the user-configured global workspace root (`workDir` setting).
   */
  workDir?: string;
  /** Agent type override — selects the agent implementation (e.g. 'openai-compat') */
  agentType?: AgentProvider;
  /** Custom configuration for the provider */
  providerConfig?: Record<string, unknown>;
  /** Optional process sandbox profile for adapters that spawn local children. */
  sandboxProfile?: ProcessSandboxProfile;
  /** Optional harness profile override for provider:model behavior flags. */
  harnessProfileId?: string;
  /** Transport hint used when resolving a harness profile. */
  harnessTransport?: AgentTransport;
}

/**
 * Skills configuration for loading skills from different directories
 */
export interface SkillsConfig {
  /** Whether skills are globally enabled */
  enabled: boolean;
  /** Whether to load skills from user directory (~/.claude/skills) */
  userDirEnabled: boolean;
  /** Whether to load skills from app directory (workspace/skills) */
  appDirEnabled: boolean;
  /** Custom skills directory path (legacy support) */
  skillsPath?: string;
}

/**
 * MCP configuration for loading MCP servers from different config files
 */
export interface McpConfig {
  /** Whether MCP is globally enabled */
  enabled: boolean;
  /** Whether to load MCP servers from user directory (claude config) */
  userDirEnabled: boolean;
  /** Whether to load MCP servers from app directory */
  appDirEnabled: boolean;
  /** Custom MCP config file path (legacy support) */
  mcpConfigPath?: string;
}

/**
 * Context resolution mode.
 * - 'full'    → runtime + workspace + language + profile + userPrefs + memories (main agent)
 * - 'minimal' → runtime + workspace + language only (sub-agents / A2A delegates)
 */
export type ContextMode = 'full' | 'minimal';

/**
 * Pre-resolved system context snapshot produced by AgentContextResolver.
 * The service layer resolves this once per request and passes it through AgentOptions.
 */
export interface ResolvedAgentContext {
  /** Full context: runtime + workspace + profile system_prompt + userPrefs + memories */
  full: string;
  /** Minimal context: runtime + workspace only — for sub-agents */
  minimal: string;
  /** Greeting from soul voice — injected as first assistant message in new conversations */
  greeting?: string;
  /**
   * Static context: workspace + language + profile + prefs + search hint.
   * Stable between turns — suitable for prompt caching (cache_control: ephemeral).
   */
  staticContext: string;
  /**
   * Dynamic context: runtime timestamp + auto-recalled memories.
   * Changes every turn — must NOT be in the cached system prompt block.
   */
  dynamicContext: string;
  /** Profile-level thinking defaults (from agent_profiles.default_thinking_config) */
  profileThinkingConfig?: AgentOptions['thinkingConfig'];
  /**
   * Profile-level allowed skill slugs (from agent_profiles.default_skills).
   * When set (even as empty array), only these skills should be available.
   * When undefined, all skills are available (no profile filtering).
   */
  profileAllowedSkills?: string[];
}

export interface AgentOptions {
  /** Product mode used to compose mode-specific clarification policy. */
  runMode?: 'task' | 'design' | 'video';
  /** Session ID for continuing conversations */
  sessionId?: string;
  /** Conversation history */
  conversation?: ConversationMessage[];
  /**
   * Task-specific working directory.
   * Each task gets its own working directory under the workspace root.
   * Not to be confused with `userWorkspaceDir` (the global workspace root).
   */
  cwd?: string;
  /**
   * User-configured workspace root directory (from folder picker / settings).
   * This is the global `workDir` setting — the top-level directory the user
   * has granted access to. Individual tasks create subdirectories under this.
   * When set, the agent is granted read access (and optionally write access)
   * to this directory in addition to the session working directory.
   * This is enforced at the OS level via sandbox filesystem rules.
   */
  userWorkspaceDir?: string;
  /**
   * Whether the agent is allowed to write to the user workspace directory.
   * Defaults to false (read-only). When true, the user workspace becomes
   * a writable boundary in addition to the session directory.
   */
  allowWorkspaceWrite?: boolean;
  /**
   * Additional user directories the agent can access (read/write).
   * Used when the user selects multiple workspace folders.
   */
  additionalUserDirs?: string[];
  /** Allowed tools */
  allowedTools?: string[];
  /** Additional tools to deny for this run. Merged with hardcoded denies. */
  disallowedTools?: string[];
  /** Per-run tool classifications used by the permission registry. */
  toolClassifications?: Record<string, ToolClassification>;
  /** Additional per-run tool lifecycle hooks. */
  toolLifecycleHooks?: ToolLifecycleHook[];
  /** Task ID for tracking */
  taskId?: string;
  /** Abort controller for cancellation */
  abortController?: AbortController;
  /** Permission mode */
  permissionMode?: 'plan' | 'execute' | 'bypassPermissions';
  /** Sandbox configuration for isolated execution */
  sandbox?: SandboxConfig;
  /** Image attachments for vision capabilities */
  images?: ImageAttachment[];
  /** Skills configuration */
  skillsConfig?: SkillsConfig;
  /** MCP configuration */
  mcpConfig?: McpConfig;
  /** Explicitly mentioned MCP server names (via @mention in prompt).
   *  When non-empty, only these user MCP servers are loaded. */
  mentionedMcpServers?: string[];
  /** Pinned skill slugs (max 3) — these skills are preloaded into the
   *  agent's context so they are guaranteed to be available. */
  pinnedSkills?: string[];

  /**
   * Pre-resolved system context assembled by AgentContextResolver.
   * Adapters MUST use this field — never call getSetting() or autoRecall() directly.
   * Populated by the service layer before calling agent.run/plan/execute.
   */
  systemContext?: string;

  /**
   * Full resolved context with static/dynamic split for prompt caching.
   * Adapters can use `resolvedContext.staticContext` for cache-stable system prompts
   * and `resolvedContext.dynamicContext` for per-turn content.
   */
  resolvedContext?: ResolvedAgentContext;

  /**
   * Controls which context tier is applied. Defaults to 'full'.
   * Pass 'minimal' for sub-agents spawned via A2A or Task tool.
   */
  contextMode?: ContextMode;

  /**
   * Agent profile ID assigned to this run (tasks.assignee_profile_id).
   * Used by AgentContextResolver to load profile.system_prompt and role.
   */
  agentProfileId?: string;

  /**
   * Channel context — set when the agent was invoked from a channel message.
   * Used by schedule MCP tools to auto-resolve delivery targets.
   */
  channelContext?: {
    platform: string;
    conversationId: string;
    /** Channel config ID for multi-bot plugin lookup */
    configId?: string;
    /** Workspace-qualified user ID for memory scope isolation (e.g. "T04ABC:U12345") */
    userId?: string;
    /** Human-readable display name resolved from the platform (e.g. Slack real_name) */
    displayName?: string;
    /** Bot token — used to register platform-specific search tools (Slack workspace search) */
    botToken?: string;
    /** Slack action_token from the event payload — required by assistant.search.context */
    actionToken?: string;
    /** User's locale from channel profile (Telegram language_code, Discord locale) */
    locale?: string;
    /**
     * Permission tier of the calling identity. Used by ConnectorPolicy
     * (`src-api/src/shared/auth/connector-policy.ts`) to gate globally-scoped
     * MCP server mounts.
     */
    permissionTier?: 'viewer' | 'operator' | 'admin';
    /** gateway_identities.id of the caller, when applicable */
    identityId?: string;
    /** True when the run is launched by a scheduled automation */
    automationOrigin?: boolean;
  };

  /** User's locale for response language and delivery templates */
  locale?: string;

  /**
   * Per-user environment overrides — typically Slack-bound credentials
   * resolved from `slack_user_oauth` (e.g. `LINEAR_API_KEY`,
   * `GITHUB_TOKEN`, `ANTHROPIC_API_KEY`). The agent merges these into the
   * SDK process env so MCP servers and tools that read those env vars
   * pick up the user's auth at runtime. Last-write-wins over global
   * server config — user PAT beats admin-configured token.
   */
  userCredentials?: Record<string, string>;

  /**
   * Per-user MCP server overlay — typically resolved from Slack App Home's
   * `slack_user_mcp` rows. Names override / extend the global mcp.json
   * registration for this run only. Server configs are normal HTTP/SSE
   * MCP descriptors; auth is already baked into their `headers` map.
   */
  userMcpOverlay?: Record<string, unknown>;

  /**
   * In-process MCP servers mounted directly into the SDK run.
   * These are request-scoped servers created by the app rather than loaded
   * from the user's mcp.json. Names become `mcp__<name>__*` tool patterns.
   */
  inProcessMcpServers?: Record<string, McpServerConfig>;

  /**
   * Per-run in-process MCP servers to expose to a *subprocess* runtime (Codex,
   * Cursor, Gemini, DeepSeek CLIs) over the loopback bridge. The Claude path
   * mounts `inProcessMcpServers` directly into the SDK; subprocess runtimes
   * can't, so they bridge these instead. Supplied as factories so each bridge
   * request gets a fresh server instance. Runtime-agnostic by construction.
   */
  bridgeInProcessServers?: BridgeInProcessServer[];

  /**
   * Skip Neuma's built-in/policy MCP servers for this run. User MCP config,
   * per-user overlays, in-process MCP servers, and sandbox tools still mount.
   */
  disablePolicyServers?: boolean;

  /**
   * Skip loading the user's configured MCP servers (mcp.json: HTTP servers and
   * `npx`-spawned stdio servers) for this run. Built-in/policy servers,
   * in-process MCP servers, and sandbox tools still mount.
   *
   * Currently honoured only by the claude provider; other providers do not
   * load user MCP servers, so the flag is a no-op for them.
   *
   * Use for latency-sensitive, self-contained runs (e.g. Design Mode builds
   * that only write files) where external MCP servers add nothing but can
   * stall time-to-first-token — or hang the run entirely — while the spawned
   * CLI waits for every server's `initialize` handshake.
   */
  disableUserMcp?: boolean;

  /** SDK session ID to resume — passes `resume` option to SDK query() */
  resumeSessionId?: string;

  /** Structured output format — requests JSON responses matching a schema */
  outputFormat?: { type: 'json_schema'; schema: Record<string, unknown> };

  /** Workspace isolation mode — 'worktree' creates a git worktree for the agent */
  isolation?: 'shared' | 'worktree';

  /**
   * Auto-approve all tool calls — skips user permission prompts.
   * Used by dispatch/background mode where there is no interactive UI.
   * Sandbox still enforces OS-level safety boundaries.
   */
  autoApprove?: boolean;

  /** Thinking configuration for the SDK query */
  thinkingConfig?: {
    type: 'adaptive' | 'enabled' | 'disabled';
    budgetTokens?: number; // Only for 'enabled' type
    effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'; // Only for 'adaptive' type
  };

  /** Max agentic turns before the SDK stops. Overrides the default (200). */
  maxTurns?: number;

  /** Request-scoped Video Mode context for the video agent plugin. */
  videoContext?: {
    projectId?: string;
    /** User-selected LLM model id for this run (overrides the default). */
    model?: string;
    selectedSceneId?: string;
    projectAssetIds?: string[];
    aspectRatio?: string;
    transcriptSelection?: {
      sceneId?: string;
      clipId?: string;
      startMs: number;
      endMs: number;
      text: string;
    };
    editorSelection?: {
      playheadMs?: number;
      selectedClipIds?: string[];
      previewFrame?: {
        atMs: number;
        sceneId?: string;
        clipId?: string;
        aspectRatio?: string;
        source: 'timeline-preview';
      };
      activePanel?: {
        kind: 'clip-inspector';
        clipId: string;
        tab?: string;
      };
    };
    /** Resolved VideoPlugin object, or a plugin id resolved by VideoAgent. */
    plugin?: unknown;
    pluginId?: string;
    pluginInputs?: Record<string, unknown>;
    pluginOutput?: Record<string, unknown>;
    approvedPluginCapabilities?: string[];
    lastReviewedPluginDigest?: string | null;
    pluginSignatureOk?: boolean | null;
  };

  /** Enable Programmatic Tool Calling when the adapter supports it. */
  ptcEnabled?: boolean;

  /** Raw SDK MCP tools made available to Programmatic Tool Calling. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ptcMcpTools?: Array<SdkMcpToolDefinition<any>>;
}

export interface PlanOptions extends AgentOptions {
  /** Planning-specific options */
}

export interface ExecuteOptions extends AgentOptions {
  /** Plan ID to execute */
  planId: string;
  /** Original prompt that created the plan */
  originalPrompt: string;
  /** Sandbox configuration */
  sandbox?: SandboxConfig;
  /** Plan object (optional - if not provided, will look up by planId) */
  plan?: TaskPlan;
}

// ============================================================================
// Agent Interface
// ============================================================================

/**
 * Base interface for all agent implementations.
 * Each provider (Claude, DeepAgents, etc.) must implement this interface.
 */
export interface IAgent {
  /** Provider name */
  readonly provider: AgentProvider;

  /**
   * Run the agent with a prompt (direct execution mode)
   */
  run(prompt: string, options?: AgentOptions): AsyncGenerator<AgentMessage>;

  /**
   * Run planning phase only (returns a plan for approval)
   */
  plan(prompt: string, options?: PlanOptions): AsyncGenerator<AgentMessage>;

  /**
   * Execute an approved plan
   */
  execute(options: ExecuteOptions): AsyncGenerator<AgentMessage>;

  /**
   * Stop the current execution
   */
  stop(sessionId: string): Promise<void>;

  /**
   * Get a stored plan by ID
   */
  getPlan(planId: string): TaskPlan | undefined;

  /**
   * Delete a stored plan
   */
  deletePlan(planId: string): void;
}

// ============================================================================
// Session Management
// ============================================================================

export interface AgentSession {
  id: string;
  createdAt: Date;
  phase: 'planning' | 'executing' | 'idle';
  isAborted: boolean;
  abortController: AbortController;
  config?: AgentConfig;
}

// ============================================================================
// Tool Definitions
// ============================================================================

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const DEFAULT_ALLOWED_TOOLS = [
  'Read',
  'Edit',
  'Write',
  'Glob',
  'Grep',
  'Bash',
  'WebSearch',
  'WebFetch',
  'Skill',
  'Task',
  'LSP',
  'TodoWrite',
];

// ============================================================================
// Factory Types
// ============================================================================

export type AgentFactory = (config: AgentConfig) => IAgent;

export interface AgentRegistry {
  register(provider: AgentProvider, factory: AgentFactory): void;
  get(provider: AgentProvider): AgentFactory | undefined;
  create(config: AgentConfig): IAgent;
}

/**
 * API Request type for agent endpoints
 */
export interface AgentRequest {
  prompt: string;
  sessionId?: string;
  conversation?: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;
  // Two-phase execution control
  phase?: 'plan' | 'execute';
  planId?: string; // Reference to approved plan
  // Workspace settings
  workDir?: string; // Working directory for session outputs
  taskId?: string; // Task ID for session folder
  // Provider selection (optional, defaults to env config)
  provider?: 'claude' | 'openai-compat';
  // Custom model configuration
  modelConfig?: ModelConfig;
  // Sandbox configuration for isolated execution
  sandboxConfig?: SandboxConfig;
}
