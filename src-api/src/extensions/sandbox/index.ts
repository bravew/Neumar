// Import for registration
import type { SandboxPlugin } from '@/core/sandbox/plugin';
import { getSandboxRegistry } from '@/core/sandbox/registry';

import { claudePlugin } from '@/extensions/sandbox/claude';
import { codexPlugin } from '@/extensions/sandbox/codex';
import { nativePlugin } from '@/extensions/sandbox/native';

import { createLogger } from '@/shared/utils/logger';

/**
 * Sandbox Providers Index
 *
 * Exports all available sandbox providers and registers them with the registry.
 * Now uses the plugin system for better extensibility.
 */

// Export providers
export {
  NativeProvider,
  createNativeProvider,
  nativePlugin,
} from '@/extensions/sandbox/native';
export {
  CodexProvider,
  createCodexProvider,
  codexPlugin,
} from '@/extensions/sandbox/codex';
export {
  ClaudeProvider,
  createClaudeProvider,
  claudePlugin,
} from '@/extensions/sandbox/claude';

const logger = createLogger('SandboxProviders');

/**
 * All built-in plugins
 */
export const builtinPlugins: SandboxPlugin[] = [
  nativePlugin,
  codexPlugin,
  claudePlugin,
];

/**
 * Register all built-in sandbox providers
 */
export function registerBuiltinProviders(): void {
  const registry = getSandboxRegistry();

  for (const plugin of builtinPlugins) {
    registry.register(plugin);
  }

  logger.info(
    `Registered built-in providers: ${builtinPlugins.map((p) => p.metadata.type).join(', ')}`,
  );
}

/**
 * Register a custom sandbox plugin
 */
export function registerSandboxPlugin(plugin: SandboxPlugin): void {
  const registry = getSandboxRegistry();
  registry.register(plugin);
}
