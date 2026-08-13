import { getSandboxRegistry } from '@/core/sandbox/registry';

import { registerBuiltinProviders } from '@/extensions/sandbox/index';

import { createLogger } from '@/shared/utils/logger';

import type {
  ISandboxProvider,
  SandboxExecOptions,
  SandboxExecResult,
  SandboxProviderType,
  ScriptOptions,
} from './types.js';

/**
 * Sandbox Module
 *
 * Provides extensible sandbox functionality for isolated code execution.
 * Supports multiple providers: Codex, Claude, Native (no isolation).
 */

// Export types
export * from '@/core/sandbox/types';

// Export plugin system
export * from '@/core/sandbox/plugin';

// Export pool
export {
  SandboxPool,
  getGlobalSandboxPool,
  initGlobalSandboxPool,
  shutdownGlobalSandboxPool,
  type PooledSandbox,
  type PooledSandboxConfig,
  type PoolStats,
  type IPoolableSandboxProvider,
} from '@/core/sandbox/pool';

// Export registry
export {
  getSandboxRegistry,
  registerSandboxProvider,
  createSandboxProvider,
  getSandboxProvider,
  getAvailableSandboxProviders,
  stopAllSandboxProviders,
} from '@/core/sandbox/registry';

const logger = createLogger('Sandbox');

const PROVIDER_LABELS: Record<string, string> = {
  codex: 'Codex Sandbox (process isolation)',
  claude: 'Claude Sandbox (container isolation)',
  native: 'Native (host execution)',
};

const ISOLATION_LABELS: Record<string, string> = {
  vm: 'VM hardware isolation',
  container: 'container isolation',
  process: 'process isolation',
  none: 'no isolation',
};

// Export providers
export {
  NativeProvider,
  createNativeProvider,
  nativePlugin,
  CodexProvider,
  createCodexProvider,
  codexPlugin,
  ClaudeProvider,
  createClaudeProvider,
  claudePlugin,
  builtinPlugins,
  registerBuiltinProviders,
  registerSandboxPlugin,
} from '@/extensions/sandbox/index';

// ============================================================================
// Initialization
// ============================================================================

let initialized = false;

/**
 * Initialize the sandbox module with built-in providers
 */
export async function initSandbox(): Promise<void> {
  if (initialized) {
    return;
  }

  registerBuiltinProviders();
  initialized = true;

  logger.info('Module initialized');
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Result of provider selection with fallback info
 */
export interface ProviderSelectionResult {
  provider: ISandboxProvider;
  usedFallback: boolean;
  fallbackReason?: string;
}

/**
 * Phase 7: marketplace execution gate. Marketplace plugins MUST run on a
 * provider that reports both `enforcement === 'hard'` and a non-`none`
 * isolation level. Reduced and native providers are explicitly refused —
 * silently falling back to native (the historical behavior) defeats the
 * whole purpose of marketplace gating.
 *
 * Throws MarketplaceProviderError so the caller can present a clear
 * remediation (install Docker, install bubblewrap, etc.) instead of
 * letting an untrusted plugin run in-process.
 */
export class MarketplaceProviderError extends Error {
  readonly providerType?: string;
  readonly enforcement?: string;
  constructor(message: string, providerType?: string, enforcement?: string) {
    super(message);
    this.name = 'MarketplaceProviderError';
    this.providerType = providerType;
    this.enforcement = enforcement;
  }
}

export function assertMarketplaceEligible(provider: ISandboxProvider): void {
  const caps = provider.getCapabilities();
  if (
    !caps.marketplaceEligible ||
    caps.enforcement !== 'hard' ||
    caps.isolation === 'none'
  ) {
    throw new MarketplaceProviderError(
      `Provider "${provider.type}" is not marketplace eligible ` +
        `(enforcement=${caps.enforcement}, isolation=${caps.isolation}). ` +
        'Marketplace plugins require a hard-isolation sandbox.',
      provider.type,
      caps.enforcement,
    );
  }
}

/**
 * Select a marketplace-eligible provider, or throw if none available.
 * Unlike getBestProviderWithInfo this never falls back to native.
 */
export async function getMarketplaceProvider(): Promise<ISandboxProvider> {
  await initSandbox();
  const registry = getSandboxRegistry();
  // Walk plugin metadata first so we can pick the first eligible candidate
  // without instantiating non-eligible providers.
  for (const meta of registry.getAllSandboxMetadata()) {
    if (!meta.marketplaceEligible) continue;
    if (meta.enforcement !== 'hard') continue;
    if (meta.isolation === 'none') continue;
    try {
      const inst = registry.create(meta.type);
      if (await inst.isAvailable()) {
        await inst.init();
        return inst;
      }
    } catch {
      // try next candidate
    }
  }
  throw new MarketplaceProviderError(
    'No marketplace-eligible sandbox provider is available on this host. ' +
      'Install Docker, bubblewrap, or another hard-isolation provider before running marketplace plugins.',
  );
}

/**
 * Get the best available sandbox provider
 * Priority: Codex → Native (local)
 */
export async function getBestProvider(): Promise<ISandboxProvider> {
  const result = await getBestProviderWithInfo();
  return result.provider;
}

/**
 * Get the best available sandbox provider with fallback information
 * Priority: Codex → Native (local)
 */
export async function getBestProviderWithInfo(): Promise<ProviderSelectionResult> {
  await initSandbox();

  const registry = getSandboxRegistry();

  // 1. First try Codex (preferred)
  try {
    const codexProvider = registry.create('codex');
    logger.info('Checking Codex availability...');
    const isCodexAvailable = await codexProvider.isAvailable();

    if (isCodexAvailable) {
      logger.info('Using Codex sandbox');
      await codexProvider.init();
      return {
        provider: codexProvider,
        usedFallback: false,
      };
    } else {
      logger.info('Codex not available, will use fallback');
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.warn('Codex not available:', errorMsg);
  }

  // 2. Fallback to Native (local execution)
  logger.warn('Codex not available, falling back to Native (local) execution');

  try {
    const nativeProvider = await registry.getInstance('native');
    logger.info('Using Native sandbox (no isolation, local execution)');
    return {
      provider: nativeProvider,
      usedFallback: true,
      fallbackReason:
        'Codex sandbox unavailable; using native (host) execution.',
    };
  } catch (error) {
    logger.error('Native provider also failed:', error);
    throw new Error(
      'Failed to initialize a sandbox environment: neither Codex nor the native provider is available. ' +
        'Check the host environment or contact support.',
    );
  }
}

/**
 * Execute a command using the best available sandbox
 */
export async function execInSandbox(
  options: SandboxExecOptions,
): Promise<SandboxExecResult> {
  const { provider } = await getBestProviderWithInfo();
  const result = await provider.exec(options);
  const caps = provider.getCapabilities();

  // Add provider info to result
  return {
    ...result,
    provider: {
      type: provider.type,
      name: provider.name,
      isolation: caps.isolation,
    },
  };
}

/**
 * Run a script using the best available sandbox
 * Returns result with provider info for UI display
 */
export async function runScriptInSandbox(
  filePath: string,
  workDir: string,
  options?: ScriptOptions,
): Promise<SandboxExecResult> {
  const { provider, usedFallback, fallbackReason } =
    await getBestProviderWithInfo();
  const result = await provider.runScript(filePath, workDir, options);
  const caps = provider.getCapabilities();

  const providerLabel = PROVIDER_LABELS[provider.type] ?? provider.name;
  logger.info(`Script executed via: ${providerLabel}`);

  if (usedFallback && fallbackReason) {
    logger.info(`Fallback reason: ${fallbackReason}`);
  }

  // Add provider info to result for UI display
  return {
    ...result,
    provider: {
      type: provider.type,
      name: provider.name,
      isolation: caps.isolation,
    },
  };
}

/**
 * Get the current sandbox mode information
 */
export async function getSandboxInfo(): Promise<{
  available: boolean;
  provider: SandboxProviderType;
  providerName: string;
  isolation: 'vm' | 'container' | 'process' | 'none';
  message: string;
  usedFallback: boolean;
  fallbackReason?: string;
}> {
  await initSandbox();

  try {
    const { provider, usedFallback, fallbackReason } =
      await getBestProviderWithInfo();
    const caps = provider.getCapabilities();

    const isolationLabel = ISOLATION_LABELS[caps.isolation] ?? 'no isolation';

    return {
      available: true,
      provider: provider.type,
      providerName: provider.name,
      isolation: caps.isolation,
      message: `Using ${provider.name} (${isolationLabel})`,
      usedFallback,
      fallbackReason,
    };
  } catch (error) {
    return {
      available: false,
      provider: 'native',
      providerName: 'Native',
      isolation: 'none',
      message: 'Sandbox environment unavailable',
      usedFallback: true,
      fallbackReason: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
