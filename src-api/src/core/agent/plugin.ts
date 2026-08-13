/**
 * Agent Plugin System
 *
 * Provides plugin definition and registration for agent providers.
 * Supports extending the system with custom agent implementations.
 */

import type { PromptBuildHook } from '@/core/agent/hooks';
import type {
  AdapterEnvironmentReport,
  AgentConfig,
  AgentTransport,
  IAgent,
  McpSupport,
  PlanModeSupport,
  SkillsSupport,
} from '@/core/agent/types';

import { DEFAULT_AGENT_MODEL, DEFAULT_WORK_DIR } from '@/config/constants';

import type { ProviderMetadata } from '@/shared/provider/types';

// ============================================================================
// Agent Plugin Types
// ============================================================================

/**
 * Extended metadata for agent providers
 */
export interface AgentProviderMetadata extends ProviderMetadata {
  /** Whether this is a built-in provider */
  builtin?: boolean;
  /** Whether the agent supports planning phase */
  supportsPlan: boolean;
  /** Whether the agent supports streaming responses */
  supportsStreaming: boolean;
  /** Supported models (if configurable) */
  supportedModels?: string[];
  /** Default model */
  defaultModel?: string;
  /** Whether sandbox mode is supported */
  supportsSandbox: boolean;
  /** Tags for categorization */
  tags?: string[];
  /** Transport mechanism (sdk, cli, http, process, a2a) */
  transport?: AgentTransport;
  /** Whether the adapter supports session resume */
  supportsResume?: boolean;
  /** Whether the adapter supports environment testing */
  supportsEnvironmentTest?: boolean;
  /** Whether the adapter supports model discovery */
  supportsModelDiscovery?: boolean;
  /** MCP integration support level */
  supportsMcp?: McpSupport;
  /** Skills integration support level */
  supportsSkills?: SkillsSupport;
  /** Plan mode support level */
  supportsPlanMode?: PlanModeSupport;
  /** Whether a CLI binary is required */
  requiresBinary?: boolean;
  /** Whether an API key is required */
  requiresApiKey?: boolean;
}

/**
 * Agent provider plugin
 */
export interface AgentPlugin {
  metadata: AgentProviderMetadata;
  factory: (config: AgentConfig) => IAgent;
  onInit?: () => Promise<void>;
  onDestroy?: () => Promise<void>;
  /** Test adapter environment (binary available, auth valid, etc.) */
  testEnvironment?: (config: AgentConfig) => Promise<AdapterEnvironmentReport>;
  /** List available models for this adapter */
  listModels?: (
    config?: AgentConfig,
  ) => Promise<Array<{ id: string; label: string }>>;
  /** Normalize/validate adapter-specific config */
  normalizeConfig?: (config: AgentConfig) => AgentConfig;
  /**
   * before_prompt_build hooks — plugins inject, prepend, or replace system
   * context without modifying core files. Registered at plugin load time.
   */
  promptBuildHooks?: Array<{ fn: PromptBuildHook; priority?: number }>;
}

// ============================================================================
// Plugin Definition Helper
// ============================================================================

/**
 * Define an agent plugin with type safety
 *
 * @example
 * ```typescript
 * export default defineAgentPlugin({
 *   metadata: {
 *     type: "claude",
 *     name: "Claude Agent",
 *     version: "1.0.0",
 *     description: "Claude Agent SDK integration",
 *     configSchema: {...},
 *     supportsPlan: true,
 *     supportsStreaming: true,
 *     supportsSandbox: true,
 *   },
 *   factory: (config) => new ClaudeAgent(config),
 * });
 * ```
 */
export function defineAgentPlugin(plugin: AgentPlugin): AgentPlugin {
  // Validate required fields
  if (!plugin.metadata.type) {
    throw new Error('Agent plugin must have a type');
  }
  if (!plugin.metadata.name) {
    throw new Error('Agent plugin must have a name');
  }
  if (typeof plugin.factory !== 'function') {
    throw new Error('Agent plugin must have a factory function');
  }

  return plugin;
}

// ============================================================================
// Base Agent Class
// ============================================================================

/**
 * Re-export BaseAgent from base.ts for convenience
 */
export {
  BaseAgent,
  PLANNING_INSTRUCTION,
  formatPlanForExecution,
  parsePlanFromResponse,
  getWorkspaceInstruction,
} from '@/core/agent/base';

// ============================================================================
// Default Config Schemas
// ============================================================================

/**
 * JSON Schema for Claude agent configuration
 */
export const CLAUDE_CONFIG_SCHEMA = {
  type: 'object',
  properties: {
    apiKey: {
      type: 'string',
      description: 'Anthropic API key',
    },
    baseUrl: {
      type: 'string',
      description: 'Custom API base URL',
    },
    model: {
      type: 'string',
      default: DEFAULT_AGENT_MODEL,
      description: 'Claude model to use',
    },
    workDir: {
      type: 'string',
      default: DEFAULT_WORK_DIR,
      description: 'Working directory for file operations',
    },
  },
};

/**
 * JSON Schema for Codex agent configuration
 */
export const CODEX_CONFIG_SCHEMA = {
  type: 'object',
  properties: {
    apiKey: {
      type: 'string',
      description: 'OpenAI API key',
    },
    codexPath: {
      type: 'string',
      description: 'Path to codex CLI executable',
    },
    model: {
      type: 'string',
      default: 'gpt-4',
      description: 'OpenAI model to use',
    },
    workDir: {
      type: 'string',
      default: DEFAULT_WORK_DIR,
      description: 'Working directory for file operations',
    },
  },
};

/**
 * BytePlus ModelArk model list — single source of truth for API layer.
 * Text/reasoning, image (Seedream), and video (Seedance) models.
 */
export const BYTEPLUS_MODELS = [
  // Text / reasoning models
  'seed-1-8-251228',
  'deepseek-v3-2-251201',
  'kimi-k2-250905',
  'deepseek-r1-250528',
  'seed-1-6-flash-250715',
  'glm-4-7-251222',
  // Image generation (Seedream) — newest last so pickModel defaults to it
  'seedream-3-0-t2i-250415',
  'seedream-4-0-250828',
  'seedream-4-5-251128',
  'seedream-5-0-lite-260128',
  'seedream-5-0-260128',
  // Video generation (Seedance) — newest last so pickModel defaults to it
  'seedance-1-0-lite-250328',
  'seedance-1-0-pro-250626',
  'seedance-1-5-pro',
  'seedance-2-0',
  'dreamina-seedance-2-0-fast-260128',
] as const;

/**
 * JSON Schema for OpenAI-compatible agent configuration
 */
export const OPENAI_COMPAT_CONFIG_SCHEMA = {
  type: 'object',
  properties: {
    apiKey: {
      type: 'string',
      description: 'API key for the OpenAI-compatible provider',
    },
    baseUrl: {
      type: 'string',
      description: 'Base URL for the OpenAI-compatible API',
    },
    model: {
      type: 'string',
      description: 'Model to use',
    },
    workDir: {
      type: 'string',
      default: DEFAULT_WORK_DIR,
      description: 'Working directory for file operations',
    },
  },
};

/**
 * JSON Schema for DeepAgents configuration
 */
export const DEEPAGENTS_CONFIG_SCHEMA = {
  type: 'object',
  properties: {
    apiKey: {
      type: 'string',
      description: 'API key for the underlying LLM provider',
    },
    model: {
      type: 'string',
      default: DEFAULT_AGENT_MODEL,
      description: 'Model to use',
    },
    workDir: {
      type: 'string',
      default: DEFAULT_WORK_DIR,
      description: 'Working directory for file operations',
    },
  },
};

// ============================================================================
// Built-in Plugin Metadata
// ============================================================================

/**
 * Metadata for built-in Claude agent
 */
export const CLAUDE_METADATA: AgentProviderMetadata = {
  type: 'claude',
  name: 'Claude Agent',
  version: '1.0.0',
  description:
    'Claude Agent SDK integration with full planning and execution support. Uses Anthropic Claude models.',
  configSchema: CLAUDE_CONFIG_SCHEMA,
  builtin: true,
  supportsPlan: true,
  supportsStreaming: true,
  supportsSandbox: true,
  supportedModels: [
    DEFAULT_AGENT_MODEL,
    'claude-sonnet-4-6',
    'claude-opus-4-8',
    'claude-opus-4-7',
    'claude-opus-4-6',
    'claude-haiku-4-5-20251001',
    'claude-sonnet-4-5-20250929',
    'claude-sonnet-4-20250514',
    'claude-opus-4-20250514',
    'claude-3-5-sonnet-20241022',
    'claude-3-5-haiku-20241022',
  ],
  defaultModel: DEFAULT_AGENT_MODEL,
  tags: ['anthropic', 'claude', 'planning', 'streaming'],
  transport: 'sdk',
  supportsMcp: 'native',
  supportsSkills: 'native',
  supportsPlanMode: 'native',
  requiresApiKey: true,
};

/**
 * Metadata for built-in Codex agent
 */
export const CODEX_METADATA: AgentProviderMetadata = {
  type: 'codex',
  name: 'OpenAI Codex CLI',
  version: '1.0.0',
  description:
    'OpenAI Codex CLI integration. Uses OpenAI models through the codex command-line tool.',
  configSchema: CODEX_CONFIG_SCHEMA,
  builtin: true,
  supportsPlan: true,
  supportsStreaming: true,
  supportsSandbox: true,
  supportedModels: ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex'],
  defaultModel: 'gpt-5.5',
  tags: ['openai', 'codex', 'cli'],
  transport: 'cli',
  supportsMcp: 'none',
  supportsSkills: 'none',
  supportsPlanMode: 'orchestrated',
  requiresBinary: true,
};

/**
 * Metadata for built-in OpenAI-compatible agent
 */
export const OPENAI_COMPAT_METADATA: AgentProviderMetadata = {
  type: 'openai-compat',
  name: 'OpenAI Compatible',
  version: '1.0.0',
  description:
    'OpenAI-compatible API integration with agentic tool loop. Supports BytePlus ModelArk and other OpenAI-compatible endpoints. ' +
    'Includes text/reasoning models, Seedream image generation, and Seedance video generation.',
  configSchema: OPENAI_COMPAT_CONFIG_SCHEMA,
  builtin: true,
  supportsPlan: true,
  supportsStreaming: true,
  supportsSandbox: false,
  supportedModels: [...BYTEPLUS_MODELS],
  defaultModel: 'seed-1-8-251228',
  tags: ['openai', 'byteplus', 'modelark'],
  transport: 'http',
  supportsMcp: 'shim',
  supportsSkills: 'none',
  supportsPlanMode: 'orchestrated',
  requiresApiKey: true,
};

/**
 * Metadata for built-in DeepAgents adapter
 */
export const DEEPAGENTS_METADATA: AgentProviderMetadata = {
  type: 'deepagents',
  name: 'DeepAgents',
  version: '1.0.0',
  description:
    'DeepAgents.js framework integration using LangGraph. Supports multiple LLM providers.',
  configSchema: DEEPAGENTS_CONFIG_SCHEMA,
  builtin: true,
  supportsPlan: true,
  supportsStreaming: true,
  supportsSandbox: false,
  tags: ['langgraph', 'deepagents', 'multi-provider'],
  transport: 'sdk',
  supportsMcp: 'none',
  supportsSkills: 'none',
  supportsPlanMode: 'orchestrated',
};
