/**
 * Agent Service
 *
 * This service provides the main interface for running AI agents.
 * It uses the agents abstraction layer to support multiple providers.
 */

import {
  createAgent,
  createAgentFromEnv,
  type AgentConfig,
  type AgentMessage,
  type AgentOptions,
  type AgentProvider,
  type AgentSession,
  type ContextMode,
  type ConversationMessage,
  type IAgent,
  type ImageAttachment,
  type McpConfig,
  type ModelConfig,
  type PlanOptions,
  type ResolvedAgentContext,
  type SandboxConfig,
  type SkillsConfig,
  type TaskPlan,
} from '@/core/agent';
import {
  resolveAgentContext,
  type RuntimeContext,
} from '@/core/agent/context-resolver';
import {
  classifyRunFailure,
  shouldAutoRetryRun,
  type RetrySafetyContext,
} from '@/core/agent/error-retry';
import { promptBuildHooks } from '@/core/agent/hooks';
import { withToolResultLoopGuard } from '@/core/agent/tool-result-loop-guard';
import { getPlanManager } from '@/core/plan-manager';
import { getSessionManager } from '@/core/session-manager';

import { DEFAULT_AGENT_PROVIDER } from '@/config/constants';

import { updateTask } from '@/shared/db/operations';
import { applyTaskPlugin } from '@/shared/plugins';
import {
  autoCapture,
  type MemoryScope,
} from '@/shared/services/memory/agent-hooks';
import { normalizeGeminiBaseUrl } from '@/shared/utils/gemini';
// ============================================================================
// Logging - uses shared logger (writes to app data directory logs)
// ============================================================================
import { createLogger } from '@/shared/utils/logger';

const serviceLogger = createLogger('AgentService');

export async function* withSafeRunRetry(
  createStream: () => AsyncIterable<AgentMessage>,
  signal: AbortSignal,
): AsyncGenerator<AgentMessage> {
  for (let attempt = 0; attempt <= 1; attempt += 1) {
    const safety: RetrySafetyContext = {
      attempt,
      visibleOutput: false,
      toolCall: false,
      artifactWrite: false,
      liveArtifact: false,
      cancelled: signal.aborted,
    };
    try {
      let retry = false;
      for await (const message of createStream()) {
        if (message.type === 'error') {
          const classification = classifyRunFailure({
            message: message.message ?? message.content ?? 'Agent run failed',
            code: message.code ?? message.subtype,
          });
          if (shouldAutoRetryRun(classification, safety)) {
            retry = true;
            break;
          }
        }
        if (
          message.type === 'text' ||
          message.type === 'direct_answer' ||
          message.type === 'thinking' ||
          message.type === 'planning_status' ||
          message.type === 'plan'
        ) {
          safety.visibleOutput = true;
        }
        if (
          message.type === 'tool_use' ||
          message.type === 'permission_request'
        ) {
          safety.toolCall = true;
          safety.artifactWrite = true;
          safety.liveArtifact = true;
        }
        yield message;
      }
      if (!retry) return;
    } catch (error) {
      const classification = classifyRunFailure({
        message: error instanceof Error ? error.message : String(error),
      });
      safety.cancelled = signal.aborted;
      if (!shouldAutoRetryRun(classification, safety)) throw error;
    }
    serviceLogger.warn('Retrying transient agent failure before side effects', {
      attempt: attempt + 2,
    });
    yield {
      type: 'system',
      subtype: 'auto_retry',
      attempt: attempt + 1,
      isProgress: true,
    };
  }
}

/** Thinking configuration accepted by API routes and passed to agent adapters. */
export type ThinkingConfig = NonNullable<AgentOptions['thinkingConfig']>;

/**
 * Resolve effective thinking config: request-level replaces profile-level entirely.
 * Profile defaults are used only when the request provides no thinking config.
 */
function mergeThinkingConfig(
  profileConfig: ThinkingConfig | undefined,
  requestConfig: ThinkingConfig | undefined,
): ThinkingConfig | undefined {
  return requestConfig ?? profileConfig;
}

/**
 * Derive a MemoryScope from channel context.
 * Uses `platform:userId` as profileId for per-user isolation across channels.
 */
export function deriveMemoryScope(
  channelContext?: { platform: string; userId?: string },
  agentProfileId?: string,
): MemoryScope | undefined {
  if (channelContext?.userId) {
    return {
      profileId: `${channelContext.platform}:${channelContext.userId}`,
    };
  }
  if (agentProfileId) {
    return { profileId: agentProfileId };
  }
  return undefined;
}

/**
 * Resolve all agent context (profile + prefs + memories + runtime) and run
 * it through before_prompt_build hooks. Returns the final systemContext string
 * to be passed into AgentOptions.systemContext.
 *
 * Called once per request — adapters receive the pre-resolved string and
 * must never call getSetting() or autoRecall() directly.
 */
async function buildRunContext(
  prompt: string,
  sessionId: string,
  opts: {
    workDir?: string;
    language?: string;
    runtimeContext?: RuntimeContext;
    agentProfileId?: string;
    contextMode?: ContextMode;
    channelContext?: {
      platform: string;
      userId?: string;
      displayName?: string;
    };
  },
): Promise<{ systemContext: string; resolvedContext: ResolvedAgentContext }> {
  if (opts.agentProfileId) {
    serviceLogger.debug(
      `buildRunContext: agentProfileId=${opts.agentProfileId}`,
    );
  }
  const memoryScope = deriveMemoryScope(
    opts.channelContext,
    opts.agentProfileId,
  );
  const resolved = await resolveAgentContext({
    prompt,
    sessionId,
    workDir: opts.workDir,
    language: opts.language,
    runtimeContext: opts.runtimeContext,
    agentProfileId: opts.agentProfileId,
    memoryScope,
    channelUserName: opts.channelContext?.displayName,
  });

  const base =
    opts.contextMode === 'minimal' ? resolved.minimal : resolved.full;

  const systemContext = await promptBuildHooks.compose(base, {
    prompt,
    systemContext: base,
    contextMode: opts.contextMode ?? 'full',
  });

  return { systemContext, resolvedContext: resolved };
}

async function applyTaskPluginRunContext(input: {
  pluginId?: string;
  pluginInputs?: Record<string, unknown>;
  systemContext: string;
  pinnedSkills?: string[];
  taskId?: string;
}): Promise<{ systemContext: string; pinnedSkills?: string[] }> {
  if (!input.pluginId) {
    return {
      systemContext: input.systemContext,
      pinnedSkills: input.pinnedSkills,
    };
  }

  const applied = await applyTaskPlugin(input.pluginId, {
    inputs: input.pluginInputs,
  });
  if (input.taskId) {
    try {
      updateTask(input.taskId, {
        applied_plugin_id: applied.snapshot.plugin.id,
        applied_plugin_snapshot_json: JSON.stringify(applied.snapshot),
      });
    } catch (error) {
      serviceLogger.warn('Failed to record task plugin snapshot', {
        taskId: input.taskId,
        pluginId: input.pluginId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    systemContext: [input.systemContext, applied.systemContext]
      .filter(Boolean)
      .join('\n\n'),
    pinnedSkills: mergePinnedSkills(applied.pinnedSkills, input.pinnedSkills),
  };
}

function mergePinnedSkills(
  pluginSkills: readonly string[],
  requestedSkills: readonly string[] | undefined,
): string[] | undefined {
  const merged = [...new Set([...pluginSkills, ...(requestedSkills ?? [])])];
  return merged.length > 0 ? merged.slice(0, 3) : undefined;
}

// Global agent instance (lazy initialized)
let globalAgent: IAgent | null = null;

// Bounded session and plan managers (replace unbounded global Maps)
const sessionManager = getSessionManager();
const planManager = getPlanManager();

/**
 * Get or create the global agent instance
 * If modelConfig is provided, creates a new agent with those settings
 */
export function getAgent(config?: Partial<AgentConfig>): IAgent {
  const provider: AgentProvider = config?.agentType || DEFAULT_AGENT_PROVIDER;

  serviceLogger.debug('getAgent called with config:', {
    hasConfig: !!config,
    hasApiKey: !!config?.apiKey,
    hasBaseUrl: !!config?.baseUrl,
    model: config?.model,
    provider,
  });

  // If config with API credentials or an explicit runtime is provided, create
  // a new agent instance. Don't cache it to allow different configs per
  // request. `agentType` alone must be sufficient: local CLI runtimes (codex,
  // cursor-agent, qwen, copilot, …) can run on their default model with no
  // API key, and falling back to the global default agent would silently run
  // the wrong runtime. `custom` is not a registered plugin id — it means
  // "user-defined/env config" and must keep the env-agent fallback.
  if (
    config &&
    (config.apiKey ||
      config.baseUrl ||
      config.model ||
      (config.agentType &&
        config.agentType !== DEFAULT_AGENT_PROVIDER &&
        config.agentType !== 'custom'))
  ) {
    // Gemini uses the OpenAI-compatible endpoint under the hood
    const resolvedProvider = provider === 'gemini' ? 'openai-compat' : provider;
    // Append the OpenAI-compatible path for Gemini native base URLs
    const resolvedBaseUrl =
      provider === 'gemini' &&
      config.baseUrl &&
      !config.baseUrl.includes('/openai')
        ? `${normalizeGeminiBaseUrl(config.baseUrl)}/v1beta/openai`
        : config.baseUrl;

    serviceLogger.debug('Creating new agent with custom config:', {
      provider: resolvedProvider,
      hasApiKey: !!config.apiKey,
      baseUrl: resolvedBaseUrl,
      model: config.model,
    });
    return createAgent({
      ...config,
      provider: resolvedProvider,
      baseUrl: resolvedBaseUrl,
    });
  }

  // Use cached global agent for default configuration
  if (!globalAgent) {
    serviceLogger.debug('Creating agent from environment variables');
    globalAgent = createAgentFromEnv();
  }
  return globalAgent;
}

/**
 * Create a new agent session
 */
export function createSession(
  phase: 'plan' | 'execute' = 'plan',
): AgentSession {
  const session: AgentSession = {
    id: crypto.randomUUID(),
    createdAt: new Date(),
    phase: phase === 'plan' ? 'planning' : 'executing',
    isAborted: false,
    abortController: new AbortController(),
  };
  sessionManager.add(session.id, session.abortController, session.phase);
  return session;
}

/**
 * Get an existing session
 */
export function getSession(sessionId: string): AgentSession | undefined {
  const session = sessionManager.get(sessionId);
  if (!session) return undefined;

  return {
    id: sessionId,
    createdAt: new Date(session.createdAt),
    phase: session.phase,
    isAborted: session.abortController.signal.aborted,
    abortController: session.abortController,
  };
}

/**
 * Delete a session
 */
export function deleteSession(sessionId: string): boolean {
  return sessionManager.delete(sessionId);
}

/**
 * Get a stored plan from global store
 */
export function getPlan(planId: string): TaskPlan | undefined {
  return planManager.get(planId);
}

/**
 * Save a plan to global store
 */
export function savePlan(plan: TaskPlan, taskId?: string): void {
  planManager.save(plan, taskId);
}

/**
 * Delete a plan from global store
 */
export function deletePlan(planId: string): boolean {
  return planManager.delete(planId);
}

/**
 * Run the planning phase
 */
export async function* runPlanningPhase(
  prompt: string,
  session: AgentSession,
  workDir?: string,
  modelConfig?: ModelConfig,
  language?: string,
  runtimeContext?: RuntimeContext,
  agentProfileId?: string,
  taskId?: string,
  additionalUserDirs?: string[],
  thinkingConfig?: ThinkingConfig,
  pluginId?: string,
  pluginInputs?: Record<string, unknown>,
  /**
   * Phase A connector-tier isolation: planning-phase service discovery
   * (Google / Slack hint blocks) gates on this. Without it the planner
   * always sees `undefined` → DENY_ALL and never mentions Google services
   * even for admin-tier automations.
   */
  channelContext?: PlanOptions['channelContext'],
): AsyncGenerator<AgentMessage> {
  const agent = getAgent(modelConfig);
  const { systemContext, resolvedContext } = await buildRunContext(
    prompt,
    session.id,
    {
      workDir,
      language,
      runtimeContext,
      agentProfileId,
    },
  );

  const effectiveThinking = mergeThinkingConfig(
    resolvedContext.profileThinkingConfig,
    thinkingConfig,
  );
  const taskPluginContext = await applyTaskPluginRunContext({
    pluginId,
    pluginInputs,
    systemContext,
    taskId,
  });

  const stream = withToolResultLoopGuard(
    agent.plan(prompt, {
      sessionId: session.id,
      abortController: session.abortController,
      cwd: workDir,
      taskId,
      additionalUserDirs,
      systemContext: taskPluginContext.systemContext,
      resolvedContext,
      thinkingConfig: effectiveThinking,
      channelContext,
    }),
  );

  for await (const message of stream) {
    if (message.type === 'plan' && message.plan) {
      savePlan(message.plan, taskId);
    }
    yield message;
  }
}

/**
 * Run the execution phase
 */
export async function* runExecutionPhase(
  planId: string,
  session: AgentSession,
  originalPrompt: string,
  workDir?: string,
  taskId?: string,
  modelConfig?: ModelConfig,
  sandboxConfig?: SandboxConfig,
  skillsConfig?: SkillsConfig,
  mcpConfig?: McpConfig,
  language?: string,
  runtimeContext?: RuntimeContext,
  ptcEnabled?: boolean,
  mentionedMcpServers?: string[],
  userWorkspaceDir?: string,
  allowWorkspaceWrite?: boolean,
  pinnedSkills?: string[],
  conversation?: ConversationMessage[],
  agentProfileId?: string,
  additionalUserDirs?: string[],
  autoApprove?: boolean,
  thinkingConfig?: ThinkingConfig,
  pluginId?: string,
  pluginInputs?: Record<string, unknown>,
  /** Phase A connector-tier isolation — see runPlanningPhase. */
  channelContext?: PlanOptions['channelContext'],
): AsyncGenerator<AgentMessage> {
  const agent = getAgent(modelConfig);

  const plan = getPlan(planId);
  if (!plan) {
    yield { type: 'error', message: `Plan not found: ${planId}` };
    yield { type: 'done' };
    return;
  }

  const { systemContext, resolvedContext } = await buildRunContext(
    originalPrompt,
    session.id,
    {
      workDir,
      language,
      runtimeContext,
      agentProfileId,
    },
  );

  const effectiveThinking = mergeThinkingConfig(
    resolvedContext.profileThinkingConfig,
    thinkingConfig,
  );

  serviceLogger.info(`Executing plan: ${planId} (${plan.goal})`);
  serviceLogger.info('runExecutionPhase sandbox config:', {
    hasSandboxConfig: !!sandboxConfig,
    sandboxEnabled: sandboxConfig?.enabled,
    sandboxProvider: sandboxConfig?.provider,
    apiEndpoint: sandboxConfig?.apiEndpoint,
  });
  serviceLogger.info('runExecutionPhase skills config:', skillsConfig);
  serviceLogger.info('runExecutionPhase mcp config:', mcpConfig);
  const taskPluginContext = await applyTaskPluginRunContext({
    pluginId,
    pluginInputs,
    systemContext,
    pinnedSkills,
    taskId,
  });

  const stream = withToolResultLoopGuard(
    agent.execute({
      planId,
      plan,
      originalPrompt,
      sessionId: session.id,
      cwd: workDir,
      taskId,
      abortController: session.abortController,
      sandbox: sandboxConfig,
      skillsConfig,
      mcpConfig,
      ptcEnabled,
      mentionedMcpServers,
      userWorkspaceDir,
      allowWorkspaceWrite,
      additionalUserDirs,
      pinnedSkills: taskPluginContext.pinnedSkills,
      conversation,
      systemContext: taskPluginContext.systemContext,
      resolvedContext,
      autoApprove,
      thinkingConfig: effectiveThinking,
      channelContext,
    }),
  );

  for await (const message of stream) {
    yield message;
  }
}

/** Options for runAgent (all fields except prompt) */
export interface RunAgentOptions {
  session: AgentSession;
  conversation?: ConversationMessage[];
  workDir?: string;
  taskId?: string;
  modelConfig?: ModelConfig;
  sandboxConfig?: SandboxConfig;
  images?: ImageAttachment[];
  skillsConfig?: SkillsConfig;
  mcpConfig?: McpConfig;
  language?: string;
  runtimeContext?: RuntimeContext;
  mentionedMcpServers?: string[];
  userWorkspaceDir?: string;
  allowWorkspaceWrite?: boolean;
  pinnedSkills?: string[];
  agentProfileId?: string;
  additionalUserDirs?: string[];
  channelContext?: {
    platform: string;
    conversationId: string;
    configId?: string;
    userId?: string;
    displayName?: string;
    botToken?: string;
    actionToken?: string;
    locale?: string;
    /**
     * Permission tier of the calling identity. Used by ConnectorPolicy
     * (`src-api/src/shared/auth/connector-policy.ts`) to decide whether
     * globally-scoped admin tokens (Google, Notion, shared Slack user
     * token) may be mounted for this run.
     */
    permissionTier?: 'viewer' | 'operator' | 'admin';
    /** gateway_identities.id of the caller, when applicable */
    identityId?: string;
    /** True when the run is launched by a scheduled automation */
    automationOrigin?: boolean;
  };
  /**
   * Per-user env overrides resolved from the channel layer (Slack App Home
   * `slack_user_oauth`). Threaded straight to `AgentOptions.userCredentials`.
   */
  userCredentials?: Record<string, string>;
  /**
   * Per-user MCP server overlay resolved from `slack_user_mcp` rows.
   * Threaded straight to `AgentOptions.userMcpOverlay`.
   */
  userMcpOverlay?: Record<string, unknown>;
  locale?: string;
  outputFormat?: { type: 'json_schema'; schema: Record<string, unknown> };
  isolation?: 'shared' | 'worktree';
  autoApprove?: boolean;
  thinkingConfig?: ThinkingConfig;
  pluginId?: string;
  pluginInputs?: Record<string, unknown>;
  /** Max agentic turns before the SDK stops. Overrides the default (200). */
  maxTurns?: number;
}

/**
 * Run agent directly (without planning phase)
 */
export async function* runAgent(
  prompt: string,
  opts: RunAgentOptions,
): AsyncGenerator<AgentMessage> {
  const {
    session,
    conversation,
    workDir,
    taskId,
    modelConfig,
    sandboxConfig,
    images,
    skillsConfig,
    mcpConfig,
    language,
    runtimeContext,
    mentionedMcpServers,
    userWorkspaceDir,
    allowWorkspaceWrite,
    pinnedSkills,
    agentProfileId,
    additionalUserDirs,
    channelContext,
    userCredentials,
    userMcpOverlay,
    locale,
    outputFormat,
    isolation,
    autoApprove,
    thinkingConfig,
    pluginId,
    pluginInputs,
    maxTurns,
  } = opts;

  const agent = getAgent(modelConfig);

  const { systemContext, resolvedContext } = await buildRunContext(
    prompt,
    session.id,
    {
      workDir,
      language,
      runtimeContext,
      agentProfileId,
      channelContext,
    },
  );

  const effectiveThinking = mergeThinkingConfig(
    resolvedContext.profileThinkingConfig,
    thinkingConfig,
  );

  serviceLogger.info('runAgent called with sandbox config:', {
    hasSandboxConfig: !!sandboxConfig,
    sandboxEnabled: sandboxConfig?.enabled,
    sandboxProvider: sandboxConfig?.provider,
    apiEndpoint: sandboxConfig?.apiEndpoint,
  });
  serviceLogger.info('runAgent called with skills config:', skillsConfig);
  serviceLogger.info('runAgent called with mcp config:', mcpConfig);

  // When the user has provided per-run credentials (Slack App Home PATs),
  // tell the LLM explicitly. Without this hint the model often answers
  // GitHub queries with "I don't have a GitHub tool" — the env vars and
  // Bash tool ARE available, but the model doesn't make the connection
  // unaided. The hint is system-context, not visible in chat.
  // Per-key guidance — only emit lines for credentials/overlay names that
  // are actually in scope for this run, so the model isn't told about
  // tools it doesn't have.
  const credKeys = userCredentials ? Object.keys(userCredentials) : [];
  const overlayNames = userMcpOverlay ? Object.keys(userMcpOverlay) : [];
  const hasGithubMcp = overlayNames.includes('github');

  const guidance: string[] = [];
  if (overlayNames.length > 0) {
    guidance.push(
      '## Tools available for this run',
      '',
      'The following authenticated MCP servers are loaded for this turn — prefer them when the task fits:',
      ...overlayNames.map((n) => `  • \`mcp__${n}__*\``),
    );
    if (hasGithubMcp) {
      // GitHub-specific quirk: gh CLI / curl against api.github.com fail
      // in the sandboxed shell because the user's PAT lives only in the
      // MCP server's auth header, not the child process env. Other MCP
      // services have working CLI fallbacks, so we only call this out
      // for GitHub.
      guidance.push(
        '',
        '**GitHub:** call `mcp__github__*` directly (e.g. `mcp__github__get_me`, `mcp__github__list_issues`, ' +
          '`mcp__github__create_pull_request`). Do NOT use Bash with `gh` or `curl https://api.github.com/...` — ' +
          'those return 401/403 here because the PAT is wired into the MCP server, not the shell env.',
      );
    }
  }
  if (credKeys.length > 0) {
    guidance.push(
      '',
      '## Per-user credentials (env vars set for this run)',
      '',
      ...credKeys.map((k) => `  • ${k}`),
      '',
      'These are exposed to subprocesses that read env. Use the matching CLI / SDK normally.',
    );
  }

  const systemContextWithCreds =
    guidance.length > 0
      ? systemContext + '\n\n' + guidance.join('\n')
      : systemContext;
  const taskPluginContext = await applyTaskPluginRunContext({
    pluginId,
    pluginInputs,
    systemContext: systemContextWithCreds,
    pinnedSkills,
    taskId,
  });

  const runOptions = {
    sessionId: session.id,
    conversation,
    cwd: workDir,
    taskId,
    abortController: session.abortController,
    sandbox: sandboxConfig,
    images,
    skillsConfig,
    mcpConfig,
    mentionedMcpServers,
    userWorkspaceDir,
    allowWorkspaceWrite,
    additionalUserDirs,
    pinnedSkills: taskPluginContext.pinnedSkills,
    systemContext: taskPluginContext.systemContext,
    resolvedContext,
    agentProfileId,
    channelContext,
    userCredentials,
    userMcpOverlay,
    locale,
    outputFormat,
    isolation,
    autoApprove,
    thinkingConfig: effectiveThinking,
    maxTurns,
  } satisfies AgentOptions;

  for await (const message of withSafeRunRetry(
    () => withToolResultLoopGuard(agent.run(prompt, runOptions)),
    session.abortController.signal,
  )) {
    yield message;
  }

  // Memory auto-capture — ALL agent types benefit; channel messages get per-user scoped memories.
  const memoryScope = deriveMemoryScope(channelContext, agentProfileId);
  autoCapture(prompt, session.id, memoryScope).catch((err) => {
    serviceLogger.warn(`Auto-capture failed in runAgent: ${err}`);
  });
}

/**
 * Resume a previous SDK session with a new prompt
 */
export async function* runAgentResume(
  resumeSessionId: string,
  prompt: string,
  session: AgentSession,
  workDir?: string,
  taskId?: string,
  modelConfig?: ModelConfig,
  language?: string,
  runtimeContext?: RuntimeContext,
  agentProfileId?: string,
  thinkingConfig?: ThinkingConfig,
): AsyncGenerator<AgentMessage> {
  const agent = getAgent(modelConfig);

  const { systemContext, resolvedContext } = await buildRunContext(
    prompt,
    session.id,
    {
      workDir,
      language,
      runtimeContext,
      agentProfileId,
    },
  );

  const effectiveThinking = mergeThinkingConfig(
    resolvedContext.profileThinkingConfig,
    thinkingConfig,
  );

  serviceLogger.info(`Resuming SDK session: ${resumeSessionId}`);

  const stream = withToolResultLoopGuard(
    agent.run(prompt, {
      sessionId: session.id,
      resumeSessionId,
      cwd: workDir,
      taskId,
      abortController: session.abortController,
      systemContext,
      resolvedContext,
      agentProfileId,
      thinkingConfig: effectiveThinking,
    }),
  );

  for await (const message of stream) {
    yield message;
  }
}

/**
 * Stop an agent execution
 */
export function stopAgent(sessionId: string): void {
  const session = sessionManager.get(sessionId);
  if (session) {
    session.abortController.abort();
  }
}

// Re-export types for convenience
export type {
  AgentMessage,
  AgentSession,
  TaskPlan,
  ConversationMessage,
  AgentConfig,
  IAgent,
  ImageAttachment,
  SkillsConfig,
  McpConfig,
};
