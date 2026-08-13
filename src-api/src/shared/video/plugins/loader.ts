import fs from 'node:fs/promises';
import path from 'node:path';

import { getAppDir } from '@/config/constants';

import { getSetting } from '@/shared/db/operations';
import {
  getDisabledPluginNames,
  listInstalledPlugins,
} from '@/shared/db/plugins';
import {
  loadPlugins,
  loadPluginsFromRoot,
  type LoadedPlugin,
  type PluginLoaderConfig,
} from '@/shared/plugins';
import { resolveBuiltinPluginRoot } from '@/shared/plugins/paths';
import {
  computeManifestDigest,
  filterPluginsBySurface,
  getDomainManifestPointer,
  resolveInstalledPluginRuntimeConfig,
  type TrustTier,
} from '@/shared/plugins/runtime';
import { createLogger } from '@/shared/utils/logger';
import { getVideoFeatureFlag } from '@/shared/video/flags';

import { registerVideoPluginOverlayPresets } from '../overlays/plugin-presets';
import { registerVideoPlugin } from './registry';
import { resolveVideoPlugin } from './resolve';
import type { VideoPlugin } from './types';
import { parseVideoPluginManifest } from './validate';

const logger = createLogger('VideoPluginLoader');

export interface VideoPluginLoadIssue {
  pluginName: string;
  path: string;
  code:
    | 'missing-video-manifest-pointer'
    | 'manifest-path-escapes-plugin'
    | 'manifest-read-failed'
    | 'manifest-invalid';
  message: string;
}

export interface VideoPluginLoadResult {
  plugins: VideoPlugin[];
  issues: VideoPluginLoadIssue[];
}

export interface LoadVideoPluginsOptions {
  projectRoot?: string;
  projectPluginRoot?: string;
  builtinPluginRoot?: string | null;
  watch?: boolean;
  substratePlugins?: LoadedPlugin[];
  register?: boolean;
}

export async function loadVideoPlugins(
  options: LoadVideoPluginsOptions = {},
): Promise<VideoPluginLoadResult> {
  if (!getVideoFeatureFlag('video.plugins')) {
    return { plugins: [], issues: [] };
  }

  const substratePlugins =
    options.substratePlugins ?? (await loadVideoSubstratePlugins(options));

  // Drop plugins the user has disabled (built-ins included).
  let disabled: Set<string>;
  try {
    disabled = getDisabledPluginNames();
  } catch {
    disabled = new Set();
  }
  const videoPlugins = filterPluginsBySurface(substratePlugins, 'video').filter(
    (plugin) => !disabled.has(plugin.manifest.name),
  );
  const loaded: VideoPlugin[] = [];
  const issues: VideoPluginLoadIssue[] = [];

  for (const substratePlugin of videoPlugins) {
    const pointer = getDomainManifestPointer(substratePlugin, 'videoManifest');
    if (!pointer) {
      issues.push({
        pluginName: substratePlugin.manifest.name,
        path: substratePlugin.path,
        code: 'missing-video-manifest-pointer',
        message: 'metadata.neuma.videoManifest is required for video plugins',
      });
      continue;
    }

    const manifestPath = resolveContainedPath(substratePlugin.path, pointer);
    if (!manifestPath) {
      issues.push({
        pluginName: substratePlugin.manifest.name,
        path: substratePlugin.path,
        code: 'manifest-path-escapes-plugin',
        message:
          'metadata.neuma.videoManifest must stay within the plugin folder',
      });
      continue;
    }

    let raw: string;
    try {
      raw = await fs.readFile(manifestPath, 'utf-8');
    } catch (error) {
      issues.push({
        pluginName: substratePlugin.manifest.name,
        path: manifestPath,
        code: 'manifest-read-failed',
        message: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    const parsed = parseVideoPluginManifest(raw, {
      genericManifest: substratePlugin.manifest,
      folderName: path.basename(substratePlugin.path),
    });
    if (!parsed.ok || !parsed.manifest) {
      issues.push({
        pluginName: substratePlugin.manifest.name,
        path: manifestPath,
        code: 'manifest-invalid',
        message: parsed.issues
          .map((issue) => `${issue.path}: ${issue.message}`)
          .join('; '),
      });
      continue;
    }

    const plugin = resolveVideoPlugin({
      manifest: parsed.manifest,
      rootDir: substratePlugin.path,
      manifestPath,
      substratePlugin,
      trustTier: installedTrustTierForVideoPlugin(
        substratePlugin,
        computeManifestDigest(parsed.manifest),
      ),
      config: resolveInstalledPluginRuntimeConfig(
        pluginIdForSubstratePlugin(substratePlugin),
        substratePlugin.manifest,
      ),
    });
    loaded.push(plugin);
    if (options.register !== false) {
      registerVideoPlugin(plugin);
      registerVideoPluginOverlayPresets(plugin);
    }
  }

  if (issues.length > 0) {
    logger.warn('Loaded video plugins with issues', {
      issueCount: issues.length,
    });
  }

  return { plugins: loaded, issues };
}

function pluginIdForSubstratePlugin(plugin: LoadedPlugin): string {
  return `${plugin.scope}/${plugin.manifest.name}`;
}

function installedTrustTierForVideoPlugin(
  substratePlugin: LoadedPlugin,
  manifestDigest: string,
): TrustTier | undefined {
  const installed = listInstalledPlugins().find(
    (candidate) =>
      candidate.name === substratePlugin.manifest.name &&
      path.resolve(candidate.installPath) ===
        path.resolve(substratePlugin.path),
  );
  if (!installed || !installed.enabled) return undefined;
  if (!installed.trustTier || installed.manifestDigest !== manifestDigest) {
    return undefined;
  }
  if (
    installed.trustTier === 'saved' &&
    installed.lastReviewedDigest !== manifestDigest
  ) {
    return undefined;
  }
  return installed.trustTier;
}

export function defaultProjectPluginRoot(projectRoot?: string): string {
  const root = projectRoot ?? getSetting('workDir') ?? getAppDir();
  return path.join(root, '.plugins');
}

function resolveContainedPath(
  rootDir: string,
  relativePath: string,
): string | null {
  const root = path.resolve(rootDir);
  const candidate = path.resolve(root, relativePath);
  if (candidate !== root && !candidate.startsWith(root + path.sep)) {
    return null;
  }
  return candidate;
}

export function getDefaultUserPluginRoot(): string {
  return path.join(getAppDir(), 'plugins');
}

async function loadVideoSubstratePlugins(
  options: LoadVideoPluginsOptions,
): Promise<LoadedPlugin[]> {
  const cascadePlugins = await loadPlugins({
    projectDir:
      options.projectPluginRoot ??
      defaultProjectPluginRoot(options.projectRoot),
    watch: options.watch,
  } satisfies PluginLoaderConfig);
  const builtinRoots =
    options.builtinPluginRoot === null
      ? []
      : options.builtinPluginRoot
        ? [options.builtinPluginRoot]
        : defaultBuiltinVideoPluginRoots(options.projectRoot);
  const builtinPlugins = (
    await Promise.all(
      builtinRoots.map((root) => loadPluginsFromRoot(root, 'bundled')),
    )
  ).flat();
  return mergeByPluginName([...builtinPlugins, ...cascadePlugins]);
}

function defaultBuiltinVideoPluginRoots(projectRoot?: string): string[] {
  const appRoot = getAppDir();
  const roots = [
    path.resolve(
      projectRoot ?? getSetting('workDir') ?? appRoot,
      'plugins',
      'builtin',
    ),
    path.resolve(appRoot, 'plugins', 'builtin'),
    resolveBuiltinPluginRoot(),
  ];
  return [...new Set(roots)];
}

function mergeByPluginName(plugins: readonly LoadedPlugin[]): LoadedPlugin[] {
  const byName = new Map<string, LoadedPlugin>();
  for (const plugin of plugins) {
    byName.set(plugin.manifest.name, plugin);
  }
  return [...byName.values()];
}
