/**
 * Sandbox Plugin System
 *
 * Provides plugin definition and registration for sandbox providers.
 * Supports extending the system with custom sandbox implementations.
 */

import type {
  ISandboxProvider,
  SandboxCapabilities,
  SandboxExecOptions,
  SandboxExecResult,
  SandboxProviderConfig,
  ScriptOptions,
  VolumeMount,
} from '@/core/sandbox/types';

import type { ProviderMetadata } from '@/shared/provider/types';

// ============================================================================
// Sandbox Plugin Types
// ============================================================================

/**
 * Extended metadata for sandbox providers
 */
export interface SandboxProviderMetadata extends ProviderMetadata {
  /** Whether this is a built-in provider */
  builtin?: boolean;
  /** Isolation level this provider offers */
  isolation: 'vm' | 'container' | 'process' | 'none';
  /** Supported runtime environments */
  supportedRuntimes: string[];
  /** Whether the provider supports volume mounts */
  supportsVolumeMounts: boolean;
  /** Whether the provider supports networking */
  supportsNetworking: boolean;
  /** Whether the provider supports pooling */
  supportsPooling: boolean;
  /** Tags for categorization */
  tags?: string[];
  // ----- Phase 7: enforcement and policy support metadata -----
  enforcement: 'hard' | 'reduced' | 'none';
  supportsNetworkPolicy: boolean;
  supportsReadDeny: boolean;
  supportsWriteAllowlist: boolean;
  supportsAuditEvents: boolean;
  /**
   * Whether this provider may be selected for marketplace/untrusted execution.
   * Always false for native and reduced-isolation providers.
   */
  marketplaceEligible: boolean;
  reducedIsolationReason?: string;
}

/**
 * Sandbox provider plugin
 */
export interface SandboxPlugin {
  metadata: SandboxProviderMetadata;
  factory: (config?: SandboxProviderConfig) => ISandboxProvider;
  onInit?: () => Promise<void>;
  onDestroy?: () => Promise<void>;
}

// ============================================================================
// Plugin Definition Helper
// ============================================================================

/**
 * Define a sandbox plugin with type safety
 *
 * @example
 * ```typescript
 * export default defineSandboxPlugin({
 *   metadata: {
 *     type: "docker",
 *     name: "Docker Container",
 *     version: "1.0.0",
 *     description: "Docker container sandbox",
 *     configSchema: {...},
 *     isolation: "container",
 *     supportedRuntimes: ["node", "python", "bun"],
 *     supportsVolumeMounts: true,
 *     supportsNetworking: true,
 *     supportsPooling: true,
 *   },
 *   factory: (config) => new DockerProvider(config),
 * });
 * ```
 */
export function defineSandboxPlugin(plugin: SandboxPlugin): SandboxPlugin {
  // Validate required fields
  if (!plugin.metadata.type) {
    throw new Error('Sandbox plugin must have a type');
  }
  if (!plugin.metadata.name) {
    throw new Error('Sandbox plugin must have a name');
  }
  if (typeof plugin.factory !== 'function') {
    throw new Error('Sandbox plugin must have a factory function');
  }

  return plugin;
}

// ============================================================================
// Base Sandbox Provider
// ============================================================================

/**
 * Base class for sandbox providers with common functionality
 */
export abstract class BaseSandboxProvider implements ISandboxProvider {
  abstract readonly type: string;
  abstract readonly name: string;
  readonly version: string = '1.0.0';

  protected config: Record<string, unknown> = {};
  protected volumes: VolumeMount[] = [];
  protected initialized: boolean = false;

  /**
   * Check if this provider is available
   */
  abstract isAvailable(): Promise<boolean>;

  /**
   * Initialize the provider
   */
  async init(config?: Record<string, unknown>): Promise<void> {
    if (config) {
      this.config = { ...this.config, ...config };
    }
    this.initialized = true;
  }

  /**
   * Execute a command
   */
  abstract exec(options: SandboxExecOptions): Promise<SandboxExecResult>;

  /**
   * Run a script file
   */
  abstract runScript(
    filePath: string,
    workDir: string,
    options?: ScriptOptions,
  ): Promise<SandboxExecResult>;

  /**
   * Stop the provider
   */
  abstract stop(): Promise<void>;

  /**
   * Shutdown (alias for stop, implements IProvider)
   */
  async shutdown(): Promise<void> {
    return this.stop();
  }

  /**
   * Get provider capabilities
   */
  abstract getCapabilities(): SandboxCapabilities;

  /**
   * Set volume mounts
   */
  setVolumes(volumes: VolumeMount[]): void {
    this.volumes = volumes;
  }

  /**
   * Helper to detect runtime from file extension
   */
  protected detectRuntime(filePath: string): {
    runtime: string;
    image: string;
  } {
    const ext = filePath.split('.').pop()?.toLowerCase() || '';

    switch (ext) {
      case 'py':
        return { runtime: 'python', image: 'python:3.11-slim' };
      case 'ts':
      case 'mts':
        return { runtime: 'bun', image: 'oven/bun:latest' };
      case 'js':
      case 'mjs':
      default:
        return { runtime: 'node', image: 'node:18-alpine' };
    }
  }

  /**
   * Helper to calculate script path inside container
   */
  protected getContainerScriptPath(filePath: string, workDir: string): string {
    if (filePath.startsWith(workDir)) {
      // Remove workDir prefix and leading slash/backslash, then normalize to forward slashes for container
      const relativePath = filePath
        .slice(workDir.length)
        .replace(/^[/\\]/, '')
        .replace(/\\/g, '/');
      return `/workspace/${relativePath}`;
    }
    // Support both Unix (/) and Windows (\) paths
    const fileName = filePath.split(/[/\\]/).pop() || 'script';
    return `/workspace/${fileName}`;
  }
}

// ============================================================================
// Default Config Schemas
// ============================================================================

/**
 * JSON Schema for Docker provider configuration
 */
export const DOCKER_CONFIG_SCHEMA = {
  type: 'object',
  properties: {
    socketPath: {
      type: 'string',
      default: '/var/run/docker.sock',
      description: 'Docker socket path',
    },
    defaultImage: {
      type: 'string',
      default: 'node:18-alpine',
      description: 'Default container image',
    },
    memoryLimit: {
      type: 'string',
      default: '1g',
      description: "Memory limit (e.g., '1g', '512m')",
    },
    cpuLimit: {
      type: 'string',
      default: '1.0',
      description: "CPU limit (e.g., '1.0', '0.5')",
    },
  },
};

/**
 * JSON Schema for Native provider configuration
 */
export const NATIVE_CONFIG_SCHEMA = {
  type: 'object',
  properties: {
    allowedDirectories: {
      type: 'array',
      items: { type: 'string' },
      description: 'Allowed directories for execution',
    },
    shell: {
      type: 'string',
      default: '/bin/sh',
      description: 'Shell to use for commands',
    },
    defaultTimeout: {
      type: 'number',
      default: 30000,
      description: 'Default timeout in milliseconds',
    },
  },
};

/**
 * JSON Schema for E2B provider configuration
 */
export const E2B_CONFIG_SCHEMA = {
  type: 'object',
  properties: {
    apiKey: {
      type: 'string',
      description: 'E2B API key',
    },
    templateId: {
      type: 'string',
      description: 'Sandbox template ID',
    },
    timeout: {
      type: 'number',
      default: 60000,
      description: 'Sandbox timeout in milliseconds',
    },
  },
  required: ['apiKey'],
};

// ============================================================================
// Built-in Plugin Metadata
// ============================================================================

/**
 * Metadata for built-in Native provider
 */
export const NATIVE_METADATA: SandboxProviderMetadata = {
  type: 'native',
  name: 'Native Process',
  version: '1.0.0',
  description:
    'Direct process execution without isolation. Fast but provides no security isolation.',
  configSchema: NATIVE_CONFIG_SCHEMA,
  builtin: true,
  isolation: 'none',
  supportedRuntimes: ['node', 'python', 'bun'],
  supportsVolumeMounts: false,
  supportsNetworking: true,
  supportsPooling: false,
  tags: ['fast', 'no-isolation'],
  enforcement: 'none',
  supportsNetworkPolicy: false,
  supportsReadDeny: false,
  supportsWriteAllowlist: false,
  supportsAuditEvents: false,
  marketplaceEligible: false,
};

/**
 * Metadata for Docker provider
 */
export const DOCKER_METADATA: SandboxProviderMetadata = {
  type: 'docker',
  name: 'Docker Container',
  version: '1.0.0',
  description:
    'Container-based sandbox using Docker. Good isolation with wider platform support.',
  configSchema: DOCKER_CONFIG_SCHEMA,
  builtin: false,
  isolation: 'container',
  supportedRuntimes: ['node', 'python', 'bun'],
  supportsVolumeMounts: true,
  supportsNetworking: true,
  supportsPooling: true,
  tags: ['container', 'docker', 'isolation'],
  enforcement: 'hard',
  supportsNetworkPolicy: true,
  supportsReadDeny: true,
  supportsWriteAllowlist: true,
  supportsAuditEvents: true,
  marketplaceEligible: true,
};

/**
 * Metadata for E2B provider
 */
export const E2B_METADATA: SandboxProviderMetadata = {
  type: 'e2b',
  name: 'E2B Cloud Sandbox',
  version: '1.0.0',
  description:
    'Cloud-based sandbox using E2B. Provides strong isolation with remote execution.',
  configSchema: E2B_CONFIG_SCHEMA,
  builtin: false,
  isolation: 'vm',
  supportedRuntimes: ['node', 'python'],
  supportsVolumeMounts: false,
  supportsNetworking: true,
  supportsPooling: false,
  tags: ['cloud', 'e2b', 'remote'],
  enforcement: 'hard',
  supportsNetworkPolicy: true,
  supportsReadDeny: true,
  supportsWriteAllowlist: true,
  supportsAuditEvents: true,
  marketplaceEligible: true,
};
