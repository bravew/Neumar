/**
 * Dynamic Plugin Loader
 *
 * Loads provider plugins from files or directories.
 * Supports hot-reloading and external plugin discovery.
 */

import * as fs from 'fs';
import * as path from 'path';

import type {
  IProvider,
  ProviderMetadata,
  ProviderPlugin,
} from '@/shared/provider/types';
import { isProviderPlugin } from '@/shared/provider/types';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('PluginLoader');

// ============================================================================
// Plugin Loading
// ============================================================================

/**
 * Result of loading a plugin
 */
export interface PluginLoadResult<TProvider extends IProvider = IProvider> {
  success: boolean;
  plugin?: ProviderPlugin<TProvider>;
  error?: Error;
  path: string;
}

/**
 * Plugin discovery options
 */
export interface PluginDiscoveryOptions {
  /** Directories to search for plugins */
  directories: string[];
  /** File patterns to match (default: ['*.plugin.js', '*.plugin.ts']) */
  patterns?: string[];
  /** Whether to search subdirectories */
  recursive?: boolean;
  /** Ignore patterns */
  ignore?: string[];
}

/**
 * Load a plugin from a file path
 */
export async function loadPlugin<TProvider extends IProvider = IProvider>(
  filePath: string,
): Promise<PluginLoadResult<TProvider>> {
  const absolutePath = path.resolve(filePath);

  try {
    // Check if file exists
    if (!fs.existsSync(absolutePath)) {
      return {
        success: false,
        error: new Error(`Plugin file not found: ${absolutePath}`),
        path: absolutePath,
      };
    }

    // Dynamic import
    const module = await import(absolutePath);

    // Look for default export or 'plugin' export
    const pluginExport = module.default || module.plugin;

    if (!pluginExport) {
      return {
        success: false,
        error: new Error(
          `No default or 'plugin' export found in: ${absolutePath}`,
        ),
        path: absolutePath,
      };
    }

    // Validate plugin structure
    if (!isProviderPlugin(pluginExport)) {
      return {
        success: false,
        error: new Error(`Invalid plugin structure in: ${absolutePath}`),
        path: absolutePath,
      };
    }

    logger.info(
      `Loaded plugin: ${pluginExport.metadata.name} from ${absolutePath}`,
    );

    return {
      success: true,
      plugin: pluginExport as ProviderPlugin<TProvider>,
      path: absolutePath,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error)),
      path: absolutePath,
    };
  }
}

/**
 * Load multiple plugins from an array of paths
 */
export async function loadPlugins<TProvider extends IProvider = IProvider>(
  filePaths: string[],
): Promise<PluginLoadResult<TProvider>[]> {
  return Promise.all(filePaths.map((p) => loadPlugin<TProvider>(p)));
}

/**
 * Discover and load plugins from directories
 */
export async function discoverPlugins<TProvider extends IProvider = IProvider>(
  options: PluginDiscoveryOptions,
): Promise<PluginLoadResult<TProvider>[]> {
  const patterns = options.patterns || ['*.plugin.js', '*.plugin.ts'];
  const ignorePatterns = options.ignore || ['node_modules', '.git'];
  const discovered: string[] = [];

  function matchesPattern(filename: string): boolean {
    return patterns.some((pattern) => {
      const regex = new RegExp(pattern.replace(/\*/g, '.*'));
      return regex.test(filename);
    });
  }

  function shouldIgnore(pathname: string): boolean {
    return ignorePatterns.some((pattern) => pathname.includes(pattern));
  }

  function scanDirectory(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
      return;
    }

    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (shouldIgnore(fullPath)) {
        continue;
      }

      if (entry.isDirectory() && options.recursive) {
        scanDirectory(fullPath);
      } else if (entry.isFile() && matchesPattern(entry.name)) {
        discovered.push(fullPath);
      }
    }
  }

  // Scan all directories
  for (const dir of options.directories) {
    scanDirectory(dir);
  }

  // Load all discovered plugins
  return loadPlugins<TProvider>(discovered);
}

// ============================================================================
// Plugin Validation
// ============================================================================

/**
 * Validate plugin metadata
 */
export function validatePluginMetadata(metadata: ProviderMetadata): string[] {
  const errors: string[] = [];

  if (!metadata.type || typeof metadata.type !== 'string') {
    errors.push("Plugin metadata must have a 'type' string");
  }

  if (!metadata.name || typeof metadata.name !== 'string') {
    errors.push("Plugin metadata must have a 'name' string");
  }

  if (!metadata.version || typeof metadata.version !== 'string') {
    errors.push("Plugin metadata must have a 'version' string");
  }

  if (!metadata.description || typeof metadata.description !== 'string') {
    errors.push("Plugin metadata must have a 'description' string");
  }

  if (!metadata.configSchema || typeof metadata.configSchema !== 'object') {
    errors.push("Plugin metadata must have a 'configSchema' object");
  }

  // Validate version format (semver)
  if (metadata.version && !/^\d+\.\d+\.\d+/.test(metadata.version)) {
    errors.push("Plugin version should follow semver format (e.g., '1.0.0')");
  }

  return errors;
}

/**
 * Validate a plugin
 */
export function validatePlugin<TProvider extends IProvider = IProvider>(
  plugin: ProviderPlugin<TProvider>,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Validate metadata
  errors.push(...validatePluginMetadata(plugin.metadata));

  // Validate factory
  if (typeof plugin.factory !== 'function') {
    errors.push("Plugin must have a 'factory' function");
  }

  // Try to create an instance
  if (typeof plugin.factory === 'function') {
    try {
      const instance = plugin.factory();

      // Check required methods
      if (typeof instance.isAvailable !== 'function') {
        errors.push("Provider instance must have 'isAvailable' method");
      }
      if (typeof instance.init !== 'function') {
        errors.push("Provider instance must have 'init' method");
      }
      if (typeof instance.shutdown !== 'function') {
        errors.push("Provider instance must have 'shutdown' method");
      }
      if (typeof instance.getCapabilities !== 'function') {
        errors.push("Provider instance must have 'getCapabilities' method");
      }
    } catch (error) {
      errors.push(
        `Factory function threw error: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// ============================================================================
// Plugin Registry Auto-Loading
// ============================================================================

/**
 * Options for auto-loading plugins into a registry
 */
export interface AutoLoadOptions<TProvider extends IProvider = IProvider> {
  /** Plugin discovery options */
  discovery: PluginDiscoveryOptions;
  /** Registry to load plugins into */
  register: (plugin: ProviderPlugin<TProvider>) => void;
  /** Whether to skip invalid plugins (default: true) */
  skipInvalid?: boolean;
  /** Callback for loaded plugins */
  onLoad?: (result: PluginLoadResult<TProvider>) => void;
  /** Callback for errors */
  onError?: (result: PluginLoadResult<TProvider>) => void;
}

/**
 * Auto-discover and load plugins into a registry
 */
export async function autoLoadPlugins<TProvider extends IProvider = IProvider>(
  options: AutoLoadOptions<TProvider>,
): Promise<{ loaded: number; failed: number; errors: string[] }> {
  const results = await discoverPlugins<TProvider>(options.discovery);

  let loaded = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const result of results) {
    if (result.success && result.plugin) {
      // Validate plugin
      const validation = validatePlugin(result.plugin);

      if (!validation.valid) {
        if (options.skipInvalid !== false) {
          failed++;
          errors.push(
            `Invalid plugin at ${result.path}: ${validation.errors.join(', ')}`,
          );
          options.onError?.(result);
          continue;
        }
      }

      // Register plugin
      try {
        options.register(result.plugin);
        loaded++;
        options.onLoad?.(result);
      } catch (error) {
        failed++;
        errors.push(`Failed to register plugin at ${result.path}: ${error}`);
        options.onError?.(result);
      }
    } else {
      failed++;
      errors.push(
        `Failed to load plugin at ${result.path}: ${result.error?.message}`,
      );
      options.onError?.(result);
    }
  }

  logger.info(`Loaded ${loaded} plugins, ${failed} failed`);

  return { loaded, failed, errors };
}

// ============================================================================
// Watch for Plugin Changes
// ============================================================================

/**
 * Watch options
 */
export interface WatchOptions<TProvider extends IProvider = IProvider> {
  /** Directories to watch */
  directories: string[];
  /** Callback when a plugin is added/modified */
  onPlugin: (plugin: ProviderPlugin<TProvider>, path: string) => void;
  /** Callback when a plugin is removed */
  onRemove?: (path: string) => void;
  /** Debounce delay in ms (default: 500) */
  debounce?: number;
}

/**
 * Watch directories for plugin changes
 * Returns a cleanup function to stop watching
 */
export function watchPlugins<TProvider extends IProvider = IProvider>(
  options: WatchOptions<TProvider>,
): () => void {
  const watchers: fs.FSWatcher[] = [];
  const debounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  const debounceDelay = options.debounce ?? 500;

  async function handleChange(filePath: string): Promise<void> {
    // Clear existing timer
    const existing = debounceTimers.get(filePath);
    if (existing) {
      clearTimeout(existing);
    }

    // Set new timer
    debounceTimers.set(
      filePath,
      setTimeout(async () => {
        debounceTimers.delete(filePath);

        if (!fs.existsSync(filePath)) {
          // File was removed
          options.onRemove?.(filePath);
          return;
        }

        // Try to load the plugin
        const result = await loadPlugin<TProvider>(filePath);
        if (result.success && result.plugin) {
          options.onPlugin(result.plugin, filePath);
        }
      }, debounceDelay),
    );
  }

  // Set up watchers
  for (const dir of options.directories) {
    if (!fs.existsSync(dir)) {
      continue;
    }

    const watcher = fs.watch(dir, { recursive: true }, (event, filename) => {
      if (!filename) return;

      const filePath = path.join(dir, filename);

      // Only watch plugin files
      if (filename.includes('.plugin.')) {
        handleChange(filePath);
      }
    });

    watchers.push(watcher);
  }

  // Return cleanup function
  return () => {
    for (const watcher of watchers) {
      watcher.close();
    }
    for (const timer of debounceTimers.values()) {
      clearTimeout(timer);
    }
    debounceTimers.clear();
  };
}
