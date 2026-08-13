/**
 * Agent Provider Registry
 *
 * Manages registration and creation of agent providers.
 * Independent implementation for agent-specific functionality.
 */

import { promptBuildHooks } from '@/core/agent/hooks';
import type { AgentPlugin, AgentProviderMetadata } from '@/core/agent/plugin';
import type {
  AdapterEnvironmentReport,
  AgentConfig,
  AgentFactory,
  AgentProvider,
  AgentTransport,
  IAgent,
  McpSupport,
  SkillsSupport,
} from '@/core/agent/types';

import { createLogger } from '@/shared/utils/logger';

// ============================================================================
// Agent Instance State
// ============================================================================

type AgentState =
  | 'uninitialized'
  | 'initializing'
  | 'ready'
  | 'error'
  | 'stopped';

interface AgentInstance {
  agent: IAgent;
  state: AgentState;
  config?: AgentConfig;
  error?: Error;
  createdAt?: Date;
  lastUsedAt?: Date;
}

// ============================================================================
// Registry Implementation
// ============================================================================

/**
 * Agent registry with plugin support
 */
class AgentRegistry {
  private readonly registryName = 'AgentRegistry';
  private readonly logger = createLogger('AgentRegistry');
  private plugins: Map<string, AgentPlugin> = new Map();
  private instances: Map<string, AgentInstance> = new Map();

  /**
   * Register a provider factory (legacy interface)
   */
  register(provider: AgentProvider, factory: AgentFactory): void;
  /**
   * Register a provider plugin (new interface)
   */
  register(plugin: AgentPlugin): void;
  register(
    providerOrPlugin: AgentProvider | AgentPlugin,
    factory?: AgentFactory,
  ): void {
    if (typeof providerOrPlugin === 'string') {
      // Legacy registration with provider name and factory
      const legacyPlugin: AgentPlugin = {
        metadata: {
          type: providerOrPlugin,
          name: providerOrPlugin,
          version: '1.0.0',
          description: `${providerOrPlugin} agent provider`,
          supportsPlan: false,
          supportsStreaming: false,
          supportsSandbox: false,
        },
        factory: (config: AgentConfig) => factory!(config),
      };
      this.registerPlugin(legacyPlugin);
    } else {
      // New plugin registration
      this.registerPlugin(providerOrPlugin);
    }
  }

  private registerPlugin(plugin: AgentPlugin): void {
    const { type } = plugin.metadata;
    if (this.plugins.has(type)) {
      this.logger.warn(`Overwriting existing provider: ${type}`);
    }
    this.plugins.set(type, plugin);
    // Register any before_prompt_build hooks declared by the plugin
    for (const h of plugin.promptBuildHooks ?? []) {
      promptBuildHooks.register(h.fn, h.priority ?? 0);
    }
    this.logger.info(`Registered provider: ${type} (${plugin.metadata.name})`);
  }

  /**
   * Unregister a provider by type
   */
  unregister(type: string): void {
    this.plugins.delete(type);
    this.instances.delete(type);
  }

  /**
   * Check if a provider type is registered
   */
  has(type: string): boolean {
    return this.plugins.has(type);
  }

  /**
   * Get a provider factory by type
   */
  get(provider: AgentProvider): AgentFactory | undefined {
    return this.getFactory(provider);
  }

  getFactory(type: string): ((config: AgentConfig) => IAgent) | undefined {
    const plugin = this.plugins.get(type);
    return plugin?.factory;
  }

  /**
   * Get provider metadata by type
   */
  getMetadata(type: string): AgentProviderMetadata | undefined {
    return this.plugins.get(type)?.metadata;
  }

  /**
   * Get all registered metadata
   */
  getAllMetadata(): AgentProviderMetadata[] {
    return Array.from(this.plugins.values()).map((p) => p.metadata);
  }

  /**
   * Create an agent instance
   */
  create(config: AgentConfig): IAgent;
  create(provider: string, config?: AgentConfig): IAgent;
  create(configOrProvider: AgentConfig | string, config?: AgentConfig): IAgent {
    if (typeof configOrProvider === 'string') {
      const plugin = this.plugins.get(configOrProvider);
      if (!plugin) {
        throw new Error(
          `[${this.registryName}] Unknown provider type: ${configOrProvider}. ` +
            `Available: ${this.getRegistered().join(', ')}`,
        );
      }
      return plugin.factory(
        config || { provider: configOrProvider as AgentProvider },
      );
    }
    const plugin = this.plugins.get(configOrProvider.provider);
    if (!plugin) {
      throw new Error(
        `[${this.registryName}] Unknown provider type: ${configOrProvider.provider}. ` +
          `Available: ${this.getRegistered().join(', ')}`,
      );
    }
    return plugin.factory(configOrProvider);
  }

  /**
   * Get or create a singleton instance
   */
  async getInstance(type: string, config?: AgentConfig): Promise<IAgent> {
    let instanceData = this.instances.get(type);

    if (instanceData && instanceData.state === 'ready') {
      instanceData.lastUsedAt = new Date();
      return instanceData.agent;
    }

    // If instance exists but is in error state, try to recreate
    if (instanceData && instanceData.state === 'error') {
      this.logger.info(`Recreating provider ${type} after error`);
      this.instances.delete(type);
      instanceData = undefined;
    }

    // Create new instance
    const effectiveConfig = config || { provider: type as AgentProvider };
    const agent = this.create(type, effectiveConfig);
    instanceData = {
      agent,
      state: 'ready',
      config: effectiveConfig,
      createdAt: new Date(),
      lastUsedAt: new Date(),
    };
    this.instances.set(type, instanceData);

    return agent;
  }

  /**
   * Get all available provider types
   */
  async getAvailable(): Promise<string[]> {
    // For agents, all registered providers are considered available
    return this.getRegistered();
  }

  /**
   * Get all registered provider types
   */
  getRegistered(): string[] {
    return Array.from(this.plugins.keys());
  }

  /**
   * Stop all running provider instances
   */
  async stopAll(): Promise<void> {
    const stopPromises: Promise<void>[] = [];

    for (const [type, instance] of this.instances) {
      if (instance.state === 'ready') {
        // Agents don't have a shutdown method, but we can clear the instance
        this.logger.info(`Clearing agent instance: ${type}`);
      }
    }

    await Promise.all(stopPromises);
    this.instances.clear();
    this.logger.info('All agent instances cleared');
  }

  /**
   * Get agent-specific metadata
   */
  getAgentMetadata(type: string): AgentProviderMetadata | undefined {
    return this.getMetadata(type);
  }

  /**
   * Get all agent metadata
   */
  getAllAgentMetadata(): AgentProviderMetadata[] {
    return this.getAllMetadata();
  }

  /**
   * Get agents that support planning
   */
  getWithPlanning(): string[] {
    const result: string[] = [];
    for (const metadata of this.getAllAgentMetadata()) {
      if (metadata.supportsPlan) {
        result.push(metadata.type);
      }
    }
    return result;
  }

  /**
   * Get agents that support streaming
   */
  getWithStreaming(): string[] {
    const result: string[] = [];
    for (const metadata of this.getAllAgentMetadata()) {
      if (metadata.supportsStreaming) {
        result.push(metadata.type);
      }
    }
    return result;
  }

  /**
   * Get agents that support sandbox mode
   */
  getWithSandbox(): string[] {
    const result: string[] = [];
    for (const metadata of this.getAllAgentMetadata()) {
      if (metadata.supportsSandbox) {
        result.push(metadata.type);
      }
    }
    return result;
  }

  /**
   * Get agents that use a specific transport
   */
  getWithTransport(transport: AgentTransport): string[] {
    const result: string[] = [];
    for (const metadata of this.getAllAgentMetadata()) {
      if (metadata.transport === transport) {
        result.push(metadata.type);
      }
    }
    return result;
  }

  /**
   * Get agents with MCP support at a given level (or any level)
   */
  getWithMcp(support?: McpSupport): string[] {
    const result: string[] = [];
    for (const metadata of this.getAllAgentMetadata()) {
      if (support) {
        if (metadata.supportsMcp === support) {
          result.push(metadata.type);
        }
      } else if (metadata.supportsMcp && metadata.supportsMcp !== 'none') {
        result.push(metadata.type);
      }
    }
    return result;
  }

  /**
   * Get agents with skills support at a given level (or any level)
   */
  getWithSkills(support?: SkillsSupport): string[] {
    const result: string[] = [];
    for (const metadata of this.getAllAgentMetadata()) {
      if (support) {
        if (metadata.supportsSkills === support) {
          result.push(metadata.type);
        }
      } else if (
        metadata.supportsSkills &&
        metadata.supportsSkills !== 'none'
      ) {
        result.push(metadata.type);
      }
    }
    return result;
  }

  /**
   * Test adapter environment via plugin hook
   */
  async testEnvironment(
    type: string,
    config?: AgentConfig,
  ): Promise<AdapterEnvironmentReport | null> {
    const plugin = this.plugins.get(type);
    if (!plugin?.testEnvironment) {
      return null;
    }
    const effectiveConfig = config || { provider: type as AgentProvider };
    return plugin.testEnvironment(effectiveConfig);
  }

  /**
   * List available models via plugin hook
   */
  async listModels(
    type: string,
    config?: AgentConfig,
  ): Promise<Array<{ id: string; label: string }>> {
    const plugin = this.plugins.get(type);
    if (!plugin?.listModels) {
      // Fall back to supported models from metadata
      const metadata = plugin?.metadata;
      if (metadata?.supportedModels) {
        return metadata.supportedModels.map((id) => ({ id, label: id }));
      }
      return [];
    }
    return plugin.listModels(config);
  }

  /**
   * Get the default agent provider
   * Priority: claude > codex
   */
  async getDefaultProvider(): Promise<string | undefined> {
    const priority = ['claude', 'codex'];
    const available = await this.getAvailable();

    for (const type of priority) {
      if (available.includes(type)) {
        return type;
      }
    }

    return available[0];
  }
}

// ============================================================================
// Global Registry Instance
// ============================================================================

let globalRegistry: AgentRegistry | null = null;

/**
 * Get the global agent provider registry
 */
export function getAgentRegistry(): AgentRegistry {
  if (!globalRegistry) {
    globalRegistry = new AgentRegistry();
  }
  return globalRegistry;
}

/**
 * Register an agent provider factory (legacy)
 */
export function registerAgentProvider(
  provider: AgentProvider,
  factory: AgentFactory,
): void {
  getAgentRegistry().register(provider, factory);
}

/**
 * Register an agent plugin
 */
export function registerAgentPlugin(plugin: AgentPlugin): void {
  getAgentRegistry().register(plugin);
}

/**
 * Create an agent instance from config
 */
export function createAgentFromConfig(config: AgentConfig): IAgent {
  return getAgentRegistry().create(config);
}

/**
 * Get or create a singleton agent instance
 */
export async function getAgentInstance(
  provider: AgentProvider,
  config?: AgentConfig,
): Promise<IAgent> {
  return getAgentRegistry().getInstance(provider, config);
}

/**
 * Get all available agent providers
 */
export async function getAvailableAgentProviders(): Promise<string[]> {
  return getAgentRegistry().getAvailable();
}

/**
 * Get all registered agent providers
 */
export function getRegisteredAgentProviders(): string[] {
  return getAgentRegistry().getRegistered();
}

/**
 * Get all agent metadata
 */
export function getAllAgentMetadata(): AgentProviderMetadata[] {
  return getAgentRegistry().getAllAgentMetadata();
}

/**
 * Stop all agent provider instances
 */
export async function stopAllAgentProviders(): Promise<void> {
  return getAgentRegistry().stopAll();
}

/**
 * Get agents with a specific transport type
 */
export function getAgentsWithTransport(transport: AgentTransport): string[] {
  return getAgentRegistry().getWithTransport(transport);
}

/**
 * Test an agent adapter's environment
 */
export async function testAgentEnvironment(
  type: string,
  config?: AgentConfig,
): Promise<AdapterEnvironmentReport | null> {
  return getAgentRegistry().testEnvironment(type, config);
}

/**
 * List models available for an agent adapter
 */
export async function listAgentModels(
  type: string,
  config?: AgentConfig,
): Promise<Array<{ id: string; label: string }>> {
  return getAgentRegistry().listModels(type, config);
}

export { AgentRegistry };
