import { applyHarnessProfileToConfig } from '@/core/agent/harness-profile';
// Import for factory
import type { AgentPlugin } from '@/core/agent/plugin';
import { getAgentRegistry } from '@/core/agent/registry';
import type { AgentConfig, AgentProvider, IAgent } from '@/core/agent/types';

import { DEFAULT_AGENT_PROVIDER, DEFAULT_WORK_DIR } from '@/config/constants';

import { a2aPlugin } from '@/extensions/agent/a2a';
import { atomCodePlugin } from '@/extensions/agent/atomcode';
import { claudePlugin } from '@/extensions/agent/claude';
import codexPlugin from '@/extensions/agent/codex';
import { copilotPlugin } from '@/extensions/agent/copilot';
import { cursorAgentPlugin } from '@/extensions/agent/cursor-agent';
import { geminiLocalPlugin } from '@/extensions/agent/gemini-local';
import { httpAgentPlugin } from '@/extensions/agent/http-agent';
import { kimiPlugin } from '@/extensions/agent/kimi';
import { mockAgentPlugin } from '@/extensions/agent/mock';
import { openAgentSdkPlugin } from '@/extensions/agent/open-agent-sdk';
import { openaiCompatPlugin } from '@/extensions/agent/openai-compat';
import { openCodeLocalPlugin } from '@/extensions/agent/opencode-local';
import { piLocalPlugin } from '@/extensions/agent/pi-local';
import { processAgentPlugin } from '@/extensions/agent/process-agent';
import { qwenPlugin } from '@/extensions/agent/qwen';
import { videoPlugin } from '@/extensions/agent/video';

import {
  isAtomCodeRuntimeEnabled,
  isKimiRuntimeEnabled,
} from '@/shared/agent-runtimes/registry';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('Agents');

/**
 * Agent SDK Abstraction Layer
 *
 * This module provides a unified interface for different AI agent implementations.
 * Currently supported providers:
 * - Claude Agent SDK (default)
 * - Codex CLI (OpenAI)
 * - DeepAgents.js (optional)
 *
 * Usage:
 * ```typescript
 * import { createAgent, AgentConfig } from "./agents";
 *
 * // Use Claude (default)
 * const agent = createAgent({ provider: "claude" });
 *
 * // Use Codex CLI
 * const agent = createAgent({
 *   provider: "codex",
 *   apiKey: "your-openai-key"
 * });
 *
 * // Use DeepAgents.js
 * const agent = createAgent({
 *   provider: "deepagents",
 *   apiKey: "your-api-key",
 *   model: "claude-sonnet-4-20250514"
 * });
 *
 * // Run agent
 * for await (const message of agent.run("Hello!")) {
 *   console.log(message);
 * }
 * ```
 */

// Re-export types
export * from '@/core/agent/types';

// Export plugin system
export * from '@/core/agent/plugin';

// Export registry
export {
  getAgentRegistry,
  registerAgentProvider,
  registerAgentPlugin,
  createAgentFromConfig,
  getAgentInstance,
  getAvailableAgentProviders,
  getRegisteredAgentProviders,
  getAllAgentMetadata,
  stopAllAgentProviders,
} from '@/core/agent/registry';

// Export base utilities
export {
  BaseAgent,
  isConversationalPrompt,
  isSingleActionPrompt,
  PLANNING_INSTRUCTION,
  formatPlanForExecution,
  parsePlanFromResponse,
  getWorkspaceInstruction,
  getUserPreferencesInstruction,
  type AgentCapabilities,
} from '@/core/agent/base';

// Export provider implementations
export {
  A2AAgent,
  createA2AAgent,
  a2aPlugin,
  discoverA2AAgents,
} from '@/extensions/agent/a2a';
export { AtomCodeAgent, atomCodePlugin } from '@/extensions/agent/atomcode';
export {
  ClaudeAgent,
  createClaudeAgent,
  claudePlugin,
} from '@/extensions/agent/claude';
export { CodexAgent } from '@/extensions/agent/codex';
export { KimiAgent, kimiPlugin } from '@/extensions/agent/kimi';
export { default as codexPlugin } from '@/extensions/agent/codex';
// DeepAgents adapter is a stub and not exported publicly. To re-enable, see
// dev-doc/follow-up/deepagents-revival.md (write when ready) and re-add the
// re-export plus include the plugin in `builtinAgentPlugins` below.
export {
  GeminiLocalAgent,
  createGeminiLocalAgent,
  geminiLocalPlugin,
} from '@/extensions/agent/gemini-local';
export {
  HttpAgent,
  createHttpAgent,
  httpAgentPlugin,
} from '@/extensions/agent/http-agent';
export {
  MockAgent,
  createMockAgent,
  mockAgentPlugin,
} from '@/extensions/agent/mock';
export {
  OpenAICompatAgent,
  createOpenAICompatAgent,
  openaiCompatPlugin,
} from '@/extensions/agent/openai-compat';
export {
  ProcessAgent,
  createProcessAgent,
  processAgentPlugin,
} from '@/extensions/agent/process-agent';
export {
  OpenAgentSdkAgent,
  openAgentSdkPlugin,
} from '@/extensions/agent/open-agent-sdk';
export {
  OpenCodeLocalAgent,
  createOpenCodeLocalAgent,
  openCodeLocalPlugin,
} from '@/extensions/agent/opencode-local';
export {
  CursorAgentAgent,
  createCursorAgentAgent,
  cursorAgentPlugin,
} from '@/extensions/agent/cursor-agent';
export {
  QwenAgent,
  createQwenAgent,
  qwenPlugin,
} from '@/extensions/agent/qwen';
export {
  CopilotAgent,
  createCopilotAgent,
  copilotPlugin,
} from '@/extensions/agent/copilot';
export {
  PiLocalAgent,
  createPiLocalAgent,
  piLocalPlugin,
} from '@/extensions/agent/pi-local';
export {
  VideoAgent,
  createVideoAgent,
  videoPlugin,
} from '@/extensions/agent/video';

/**
 * All built-in agent plugins.
 *
 * deepagentsPlugin is intentionally excluded — the adapter is a stub
 * (run/plan/execute return placeholder text). Step 3 of the Phase 2
 * agent-loop plan (dev-doc/plan/2026-04-23-phase-2-agent-loop-agui.md)
 * is deferred indefinitely; re-add to this list once the harness ships.
 */
export const builtinAgentPlugins: AgentPlugin[] = [
  a2aPlugin,
  ...(isAtomCodeRuntimeEnabled() ? [atomCodePlugin] : []),
  claudePlugin,
  codexPlugin,
  copilotPlugin,
  cursorAgentPlugin,
  geminiLocalPlugin,
  httpAgentPlugin,
  ...(isKimiRuntimeEnabled() ? [kimiPlugin] : []),
  // The replay mock provider is a test/dev fixture — never register it in a
  // production build, where a request could select `provider: "mock"` and get
  // a deterministic replay instead of a real agent run.
  ...(process.env.NODE_ENV === 'production' ? [] : [mockAgentPlugin]),
  openAgentSdkPlugin,
  openCodeLocalPlugin,
  openaiCompatPlugin,
  piLocalPlugin,
  processAgentPlugin,
  qwenPlugin,
  videoPlugin,
];

/**
 * Register all built-in agent providers
 */
export function registerBuiltinAgentProviders(): void {
  const registry = getAgentRegistry();

  for (const plugin of builtinAgentPlugins) {
    registry.register(plugin);
  }

  logger.info(
    `Registered built-in providers: ${builtinAgentPlugins.map((p) => p.metadata.type).join(', ')}`,
  );
}

/**
 * Get list of available providers (legacy compatibility)
 */
export function getAvailableProviders(): AgentProvider[] {
  return getAgentRegistry().getRegistered() as AgentProvider[];
}

/**
 * Create an agent instance
 *
 * @param config - Agent configuration
 * @returns An IAgent implementation
 * @throws Error if the provider is not registered
 *
 * @example
 * ```typescript
 * // Create a Claude agent (default)
 * const agent = createAgent({ provider: "claude" });
 *
 * // Create with specific working directory
 * const agent = createAgent({
 *   provider: "claude",
 *   workDir: "/path/to/workspace"
 * });
 *
 * // Create DeepAgents.js agent
 * const agent = createAgent({
 *   provider: "deepagents",
 *   apiKey: process.env.ANTHROPIC_API_KEY,
 *   model: "claude-sonnet-4-20250514"
 * });
 * ```
 */
export function createAgent(config: AgentConfig): IAgent {
  const registry = getAgentRegistry();

  // Ensure built-in providers are registered
  if (registry.getRegistered().length === 0) {
    registerBuiltinAgentProviders();
  }

  return registry.create(applyHarnessProfileToConfig(config));
}

/**
 * Default agent configuration
 */
export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  provider: DEFAULT_AGENT_PROVIDER,
  workDir: DEFAULT_WORK_DIR,
};

/**
 * Create a default agent (Claude)
 */
export function createDefaultAgent(overrides?: Partial<AgentConfig>): IAgent {
  return createAgent({
    ...DEFAULT_AGENT_CONFIG,
    ...overrides,
  });
}

/**
 * Environment variable for selecting provider
 */
export function getProviderFromEnv(): AgentProvider {
  const provider = process.env.AGENT_PROVIDER as AgentProvider | undefined;
  const registry = getAgentRegistry();

  // Ensure built-in providers are registered
  if (registry.getRegistered().length === 0) {
    registerBuiltinAgentProviders();
  }

  if (provider && registry.has(provider)) {
    return provider;
  }
  return 'claude';
}

/**
 * Create agent from environment configuration
 */
export function createAgentFromEnv(overrides?: Partial<AgentConfig>): IAgent {
  const provider = getProviderFromEnv();
  return createAgent({
    provider,
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL,
    model: process.env.ANTHROPIC_MODEL || process.env.AGENT_MODEL,
    workDir: process.env.AGENT_WORK_DIR || DEFAULT_WORK_DIR,
    ...overrides,
  });
}

// ============================================================================
// Initialization
// ============================================================================

let initialized = false;

/**
 * Initialize the agents module with built-in providers
 */
export async function initAgents(): Promise<void> {
  if (initialized) {
    return;
  }

  registerBuiltinAgentProviders();
  initialized = true;

  logger.info('Module initialized');
}
