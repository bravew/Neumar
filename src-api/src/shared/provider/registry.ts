/**
 * Base Provider Registry
 *
 * Generic registry implementation for managing provider plugins.
 * Can be extended for specific provider types (Sandbox, Agent, etc.)
 */

import type {
  IProvider,
  IProviderRegistry,
  ProviderEvent,
  ProviderEventListener,
  ProviderInstance,
  ProviderMetadata,
  ProviderPlugin,
  ProviderState,
} from '@/shared/provider/types';
import { createLogger } from '@/shared/utils/logger';

// ============================================================================
// Base Registry Implementation
// ============================================================================

/**
 * Generic provider registry with plugin support
 */
export class BaseProviderRegistry<
  TProvider extends IProvider = IProvider,
  TConfig = Record<string, unknown>,
> implements IProviderRegistry<TProvider, TConfig> {
  /** Registry name for logging */
  protected readonly registryName: string;

  /** Logger instance */
  protected readonly logger: ReturnType<typeof createLogger>;

  /** Registered plugins by type */
  protected plugins: Map<string, ProviderPlugin<TProvider, TConfig>> =
    new Map();

  /** Singleton instances by type */
  protected instances: Map<string, ProviderInstance<TProvider>> = new Map();

  /** Event listeners */
  protected listeners: Set<ProviderEventListener> = new Set();

  constructor(registryName: string = 'ProviderRegistry') {
    this.registryName = registryName;
    this.logger = createLogger(registryName);
  }

  // ============================================================================
  // Plugin Registration
  // ============================================================================

  /**
   * Register a provider plugin
   */
  register(plugin: ProviderPlugin<TProvider, TConfig>): void {
    const { type } = plugin.metadata;

    if (this.plugins.has(type)) {
      this.logger.warn(`Overwriting existing provider: ${type}`);
    }

    this.plugins.set(type, plugin);
    this.logger.info(`Registered provider: ${type} (${plugin.metadata.name})`);

    this.emit({
      type: 'provider:registered',
      providerType: type,
      timestamp: new Date(),
      data: plugin.metadata,
    });
  }

  /**
   * Unregister a provider by type
   */
  unregister(type: string): void {
    const plugin = this.plugins.get(type);
    if (!plugin) {
      return;
    }

    // Stop and remove any running instance
    const instance = this.instances.get(type);
    if (instance) {
      instance.provider.shutdown().catch((err) => {
        this.logger.warn(`Error stopping provider ${type}:`, err);
      });
      this.instances.delete(type);
    }

    this.plugins.delete(type);
    this.logger.info(`Unregistered provider: ${type}`);

    this.emit({
      type: 'provider:unregistered',
      providerType: type,
      timestamp: new Date(),
    });
  }

  /**
   * Check if a provider type is registered
   */
  has(type: string): boolean {
    return this.plugins.has(type);
  }

  // ============================================================================
  // Factory Access
  // ============================================================================

  /**
   * Get a provider factory by type
   */
  getFactory(type: string): ((config?: TConfig) => TProvider) | undefined {
    const plugin = this.plugins.get(type);
    return plugin?.factory;
  }

  /**
   * Get provider metadata by type
   */
  getMetadata(type: string): ProviderMetadata | undefined {
    return this.plugins.get(type)?.metadata;
  }

  /**
   * Get all registered metadata
   */
  getAllMetadata(): ProviderMetadata[] {
    return Array.from(this.plugins.values()).map((p) => p.metadata);
  }

  // ============================================================================
  // Instance Creation
  // ============================================================================

  /**
   * Create a provider instance (not singleton)
   */
  create(type: string, config?: TConfig): TProvider {
    const plugin = this.plugins.get(type);
    if (!plugin) {
      throw new Error(
        `[${this.registryName}] Unknown provider type: ${type}. ` +
          `Available: ${this.getRegistered().join(', ')}`,
      );
    }

    return plugin.factory(config);
  }

  /**
   * Get or create a singleton instance
   */
  async getInstance(type: string, config?: TConfig): Promise<TProvider> {
    let instanceData = this.instances.get(type);

    if (instanceData && instanceData.state === 'ready') {
      instanceData.lastUsedAt = new Date();
      return instanceData.provider;
    }

    // If instance exists but is in error state, try to recreate
    if (instanceData && instanceData.state === 'error') {
      this.logger.info(`Recreating provider ${type} after error`);
      this.instances.delete(type);
      instanceData = undefined;
    }

    // Create new instance
    const provider = this.create(type, config);
    instanceData = {
      provider,
      state: 'initializing' as ProviderState,
      createdAt: new Date(),
      lastUsedAt: new Date(),
    };
    this.instances.set(type, instanceData);

    try {
      await provider.init(config as Record<string, unknown>);
      instanceData.state = 'ready';

      this.emit({
        type: 'provider:initialized',
        providerType: type,
        timestamp: new Date(),
      });

      return provider;
    } catch (error) {
      instanceData.state = 'error';
      instanceData.error =
        error instanceof Error ? error : new Error(String(error));

      this.emit({
        type: 'provider:error',
        providerType: type,
        timestamp: new Date(),
        data: error,
      });

      throw error;
    }
  }

  // ============================================================================
  // Availability
  // ============================================================================

  /**
   * Get all available provider types (that are available on current platform)
   */
  async getAvailable(): Promise<string[]> {
    const available: string[] = [];

    for (const [type, plugin] of this.plugins) {
      try {
        const provider = plugin.factory();
        const isAvailable = await provider.isAvailable();
        if (isAvailable) {
          available.push(type);
        }
      } catch {
        // Provider not available
      }
    }

    return available;
  }

  /**
   * Get all registered provider types
   */
  getRegistered(): string[] {
    return Array.from(this.plugins.keys());
  }

  // ============================================================================
  // Instance Management
  // ============================================================================

  /**
   * Get the current state of a provider instance
   */
  getInstanceState(type: string): ProviderState | undefined {
    return this.instances.get(type)?.state;
  }

  /**
   * Stop a specific provider instance
   */
  async stopInstance(type: string): Promise<void> {
    const instance = this.instances.get(type);
    if (!instance) {
      return;
    }

    instance.state = 'stopping';

    try {
      await instance.provider.shutdown();
      instance.state = 'stopped';

      this.emit({
        type: 'provider:stopped',
        providerType: type,
        timestamp: new Date(),
      });
    } catch (error) {
      instance.state = 'error';
      instance.error =
        error instanceof Error ? error : new Error(String(error));
      throw error;
    } finally {
      this.instances.delete(type);
    }
  }

  /**
   * Stop all running provider instances
   */
  async stopAll(): Promise<void> {
    const stopPromises: Promise<void>[] = [];

    for (const [type, instance] of this.instances) {
      if (instance.state === 'ready' || instance.state === 'error') {
        stopPromises.push(
          instance.provider.shutdown().catch((error) => {
            this.logger.warn(`Error stopping provider ${type}:`, error);
          }),
        );
      }
    }

    await Promise.all(stopPromises);
    this.instances.clear();
    this.logger.info('All provider instances stopped');
  }

  // ============================================================================
  // Events
  // ============================================================================

  /**
   * Add an event listener
   */
  on(listener: ProviderEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Remove an event listener
   */
  off(listener: ProviderEventListener): void {
    this.listeners.delete(listener);
  }

  /**
   * Emit an event to all listeners
   */
  protected emit(event: ProviderEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        this.logger.error('Error in event listener:', error);
      }
    }
  }

  // ============================================================================
  // Utilities
  // ============================================================================

  /**
   * Get the first available provider type
   */
  async getFirstAvailable(): Promise<string | undefined> {
    const available = await this.getAvailable();
    return available[0];
  }

  /**
   * Get provider by priority (tries each in order until one is available)
   */
  async getByPriority(types: string[]): Promise<TProvider | undefined> {
    for (const type of types) {
      if (!this.has(type)) continue;

      try {
        const provider = this.create(type);
        const isAvailable = await provider.isAvailable();
        if (isAvailable) {
          return provider;
        }
      } catch {
        // Try next
      }
    }
    return undefined;
  }
}

// ============================================================================
// Helper to define plugins
// ============================================================================

/**
 * Helper function to define a provider plugin with type safety
 */
export function defineProviderPlugin<
  TProvider extends IProvider = IProvider,
  TConfig = Record<string, unknown>,
>(
  plugin: ProviderPlugin<TProvider, TConfig>,
): ProviderPlugin<TProvider, TConfig> {
  return plugin;
}
