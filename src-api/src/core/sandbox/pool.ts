/**
 * Sandbox Instance Pool
 *
 * Manages a pool of reusable sandbox instances for better performance.
 * Migrated from src-sandbox/src/index.ts
 */

import type {
  ISandboxProvider,
  SandboxExecResult,
  VolumeMount,
} from '@/core/sandbox/types';

import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('SandboxPool');

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration for pooled sandbox instances
 */
export interface PooledSandboxConfig {
  /** Container/VM image */
  image?: string;
  /** Memory limit in MiB */
  memoryMib?: number;
  /** Number of CPU cores */
  cpus?: number;
  /** Working directory */
  workDir?: string;
  /** Timeout in milliseconds */
  timeout?: number;
  /** Environment variables */
  env?: Record<string, string>;
  /** Volume mounts */
  volumes?: VolumeMount[];
}

/**
 * A pooled sandbox instance
 */
export interface PooledSandbox {
  /** Unique instance ID */
  id: string;
  /** Image this instance is running */
  image: string;
  /** Creation time */
  createdAt: Date;
  /** Last used time */
  lastUsedAt: Date;
  /** Whether instance is currently in use */
  inUse: boolean;
  /** The underlying sandbox provider */
  provider: ISandboxProvider;
}

/**
 * Pool statistics
 */
export interface PoolStats {
  /** Total instances in pool */
  total: number;
  /** Instances currently in use */
  inUse: number;
  /** Instances available */
  available: number;
  /** Instances by image */
  byImage: Record<string, number>;
}

// ============================================================================
// Sandbox Pool Implementation
// ============================================================================

/**
 * Pool of reusable sandbox instances
 */
export class SandboxPool {
  /** Pool of instances by image */
  private pool: Map<string, PooledSandbox[]> = new Map();

  /** Maximum pool size */
  private maxSize: number;

  /** Provider factory function */
  private providerFactory: (config?: PooledSandboxConfig) => ISandboxProvider;

  /** Counter for unique IDs */
  private idCounter: number = 0;

  constructor(
    providerFactory: (config?: PooledSandboxConfig) => ISandboxProvider,
    maxSize: number = 5,
  ) {
    this.providerFactory = providerFactory;
    this.maxSize = maxSize;
  }

  /**
   * Get or create a sandbox instance for the given image
   */
  async acquire(
    image: string,
    config?: PooledSandboxConfig,
  ): Promise<PooledSandbox> {
    // Look for available instance with same image
    const instances = this.pool.get(image) || [];
    const available = instances.find((i) => !i.inUse);

    if (available) {
      available.inUse = true;
      available.lastUsedAt = new Date();
      logger.info(`Reusing instance ${available.id} for image: ${image}`);
      return available;
    }

    // Cleanup if pool is full
    await this.cleanupIfNeeded();

    // Create new instance
    const provider = this.providerFactory({
      ...config,
      image,
    });

    await provider.init({
      image,
      memoryMib: config?.memoryMib || 1024,
      cpus: config?.cpus || 2,
      workDir: config?.workDir || '/workspace',
    });

    const instance: PooledSandbox = {
      id: `sandbox-${++this.idCounter}`,
      image,
      createdAt: new Date(),
      lastUsedAt: new Date(),
      inUse: true,
      provider,
    };

    // Add to pool
    if (!this.pool.has(image)) {
      this.pool.set(image, []);
    }
    this.pool.get(image)!.push(instance);

    logger.info(`Created new instance ${instance.id} for image: ${image}`);
    return instance;
  }

  /**
   * Release a sandbox instance back to the pool
   */
  release(instance: PooledSandbox): void {
    instance.inUse = false;
    instance.lastUsedAt = new Date();
    logger.info(`Released instance ${instance.id}`);
  }

  /**
   * Cleanup old instances if pool is full
   */
  private async cleanupIfNeeded(): Promise<void> {
    const totalCount = this.getTotalCount();

    if (totalCount >= this.maxSize) {
      // Find oldest unused instance
      let oldest: PooledSandbox | null = null;
      let oldestImage: string | null = null;

      for (const [image, instances] of this.pool) {
        for (const instance of instances) {
          if (!instance.inUse) {
            if (!oldest || instance.lastUsedAt < oldest.lastUsedAt) {
              oldest = instance;
              oldestImage = image;
            }
          }
        }
      }

      if (oldest && oldestImage) {
        logger.info(`Removing old instance ${oldest.id}`);
        await this.removeInstance(oldestImage, oldest);
      }
    }
  }

  /**
   * Remove a specific instance from the pool
   */
  private async removeInstance(
    image: string,
    instance: PooledSandbox,
  ): Promise<void> {
    try {
      await instance.provider.stop();
    } catch (error) {
      logger.warn(`Error stopping instance ${instance.id}:`, error);
    }

    const instances = this.pool.get(image);
    if (instances) {
      const index = instances.indexOf(instance);
      if (index !== -1) {
        instances.splice(index, 1);
      }
      if (instances.length === 0) {
        this.pool.delete(image);
      }
    }
  }

  /**
   * Get total instance count
   */
  private getTotalCount(): number {
    let count = 0;
    for (const instances of this.pool.values()) {
      count += instances.length;
    }
    return count;
  }

  /**
   * Stop all instances in the pool
   */
  async stopAll(): Promise<void> {
    logger.info('Stopping all instances...');

    const promises: Promise<void>[] = [];

    for (const [_image, instances] of this.pool) {
      for (const instance of instances) {
        promises.push(
          instance.provider.stop().catch((error) => {
            logger.warn(`Error stopping instance ${instance.id}:`, error);
          }),
        );
      }
    }

    await Promise.all(promises);
    this.pool.clear();

    logger.info('All instances stopped');
  }

  /**
   * Get pool statistics
   */
  getStats(): PoolStats {
    const stats: PoolStats = {
      total: 0,
      inUse: 0,
      available: 0,
      byImage: {},
    };

    for (const [image, instances] of this.pool) {
      stats.byImage[image] = instances.length;
      for (const instance of instances) {
        stats.total++;
        if (instance.inUse) {
          stats.inUse++;
        } else {
          stats.available++;
        }
      }
    }

    return stats;
  }

  /**
   * Get the maximum pool size
   */
  getMaxSize(): number {
    return this.maxSize;
  }

  /**
   * Set the maximum pool size
   */
  setMaxSize(size: number): void {
    this.maxSize = size;
  }
}

// ============================================================================
// Poolable Provider Interface
// ============================================================================

/**
 * Interface for providers that support pooling
 */
export interface IPoolableSandboxProvider extends ISandboxProvider {
  /** Whether this provider supports pooling */
  readonly supportsPooling: boolean;

  /**
   * Acquire an instance from the pool
   */
  acquireInstance(config?: PooledSandboxConfig): Promise<PooledSandbox>;

  /**
   * Release an instance back to the pool
   */
  releaseInstance(instance: PooledSandbox): void;

  /**
   * Execute with automatic pool management
   */
  execPooled(options: {
    command: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
    image?: string;
  }): Promise<SandboxExecResult>;
}

// ============================================================================
// Global Pool Instance
// ============================================================================

let globalPool: SandboxPool | null = null;

/**
 * Get or create the global sandbox pool
 */
export function getGlobalSandboxPool(
  providerFactory?: (config?: PooledSandboxConfig) => ISandboxProvider,
  maxSize?: number,
): SandboxPool {
  if (!globalPool && providerFactory) {
    globalPool = new SandboxPool(providerFactory, maxSize);
  }
  if (!globalPool) {
    throw new Error(
      'Global sandbox pool not initialized. Call with providerFactory first.',
    );
  }
  return globalPool;
}

/**
 * Initialize the global sandbox pool
 */
export function initGlobalSandboxPool(
  providerFactory: (config?: PooledSandboxConfig) => ISandboxProvider,
  maxSize: number = 5,
): SandboxPool {
  globalPool = new SandboxPool(providerFactory, maxSize);
  return globalPool;
}

/**
 * Stop and clear the global sandbox pool
 */
export async function shutdownGlobalSandboxPool(): Promise<void> {
  if (globalPool) {
    await globalPool.stopAll();
    globalPool = null;
  }
}
