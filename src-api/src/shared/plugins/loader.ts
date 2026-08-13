/**
 * Plugin Loader v2
 *
 * Walks the plugin cascade (project → user → marketplace → bundled) plus a
 * legacy `~/.claude/skills/*` compat tier, parses each plugin's manifest,
 * loads its skills, and namespaces every skill as `pluginName:skillName`.
 *
 * Public-facing surface remains compatible with the v1 `LoadedSkill` shape
 * so existing callers in `src-api/src/shared/skills/index.ts` keep working
 * without code changes.
 */

import fs from 'fs/promises';
import { basename, join, resolve, sep } from 'path';

import chokidar from 'chokidar';
import type { FSWatcher } from 'chokidar';

import type { RunMode } from '@/core/agent/runtime-state';

import {
  getAppDir,
  getBundledSkillsDir,
  getClaudeSkillsDir,
} from '@/config/constants';

import { getDisabledPluginNames } from '@/shared/db/plugins';
import { parseMarkdownFrontmatter } from '@/shared/utils/frontmatter';
import { createLogger } from '@/shared/utils/logger';

import {
  parseManifest,
  readManifestFile,
  type PluginManifest,
} from './manifest';
import { resolveBuiltinPluginRoot } from './paths';

const logger = createLogger('Plugins');

/** Source tier in the cascade. */
export type PluginScope =
  | 'project'
  | 'user'
  | 'marketplace'
  | 'bundled'
  | 'legacy';

/** Skill metadata parsed from SKILL.md frontmatter. */
export interface SkillMetadata {
  name: string;
  description: string;
  license?: string;
  author?: string;
  version?: string;
  argumentHint?: string;
  trigger?: string;
  category?: string;
  icon?: string;
  emoji?: string;
  tags?: string[];
  modes?: RunMode[];
  subcommands?: unknown;
}

/** A skill loaded from a plugin (or legacy bare directory). */
export interface LoadedSkill {
  /** Canonical namespaced identifier — `pluginName:skillName`. */
  name: string;
  /** Skill name without the namespace prefix; preserved for legacy callers. */
  bareName: string;
  /** Owning plugin's namespace, or null for legacy bare skills. */
  plugin: string | null;
  /** Absolute path to the skill directory. */
  path: string;
  metadata: SkillMetadata;
  /** Full SKILL.md content. */
  content: string;
  /** SKILL.md body with YAML frontmatter stripped. */
  body?: string;
}

/** A single plugin discovered on disk. */
export interface LoadedPlugin {
  manifest: PluginManifest;
  /** Tier this plugin was found in. */
  scope: PluginScope;
  /** Absolute path to the plugin root directory. */
  path: string;
  /** All skills found under `<plugin>/<manifest.skills>/<skill>/SKILL.md`. */
  skills: LoadedSkill[];
}

export interface PluginLoaderConfig {
  enabled?: boolean;
  /** Optional override for the project plugin root (workspace-local). */
  projectDir?: string;
  /** Enable hot-reload watchers. Defaults on outside test runs. */
  watch?: boolean;
}

let loaderGeneration = 0;
let watcher: FSWatcher | null = null;
let watcherRootsKey = '';
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

export function getPluginLoaderGeneration(): number {
  return loaderGeneration;
}

export function invalidatePluginLoaderCache(reason = 'manual'): void {
  loaderGeneration++;
  logger.info('Plugin loader cache invalidated', {
    reason,
    generation: loaderGeneration,
  });
}

export async function stopPluginHotReload(): Promise<void> {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  if (watcher) {
    await watcher.close();
    watcher = null;
    watcherRootsKey = '';
  }
}

// ---------------------------------------------------------------------------
// Frontmatter parsing
// ---------------------------------------------------------------------------

/**
 * Parse SKILL.md frontmatter. Handles single-line `key: value`, quoted values,
 * and `key: |` / `key: >` block scalars (sufficient for the descriptions
 * shipped by baoyu-skills and the Anthropic samples). Not a full YAML parser —
 * by design, to avoid pulling in js-yaml as a runtime dep.
 */
function parseSkillMarkdown(
  content: string,
): { metadata: SkillMetadata; body: string } | null {
  const parsed = parseMarkdownFrontmatter(content);
  if (!parsed) return null;

  const attributes = parsed.attributes;
  const meta: Partial<SkillMetadata> = {
    name: asString(attributes.name),
    description: asString(attributes.description),
    license: asOptionalString(attributes.license),
    author: asOptionalString(attributes.author),
    version: asOptionalString(attributes.version),
    argumentHint:
      asOptionalString(attributes['argument-hint']) ||
      asOptionalString(attributes.argumentHint),
    trigger: asOptionalString(attributes.trigger),
    category: asOptionalString(attributes.category),
    icon: asOptionalString(attributes.icon),
    emoji: asOptionalString(attributes.emoji),
    tags: asStringArray(attributes.tags),
    modes: asRunModes(attributes.modes),
    subcommands: attributes.subcommands,
  };

  if (!meta.name && !meta.description) return null;

  return {
    metadata: {
      name: meta.name ?? '',
      description: meta.description ?? '',
      license: meta.license,
      author: meta.author,
      version: meta.version,
      argumentHint: meta.argumentHint,
      trigger: meta.trigger,
      category: meta.category,
      icon: meta.icon,
      emoji: meta.emoji,
      tags: meta.tags,
      modes: meta.modes,
      subcommands: meta.subcommands,
    },
    body: parsed.body,
  };
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const values = value.filter(
      (entry): entry is string => typeof entry === 'string',
    );
    return values.length > 0 ? values : undefined;
  }
  if (typeof value === 'string' && value) return [value];
  return undefined;
}

function asRunModes(value: unknown): RunMode[] | undefined {
  const values = Array.isArray(value) ? value : [value];
  if (!values.every(isRunMode)) return undefined;
  return values.length > 0 ? values : undefined;
}

function isRunMode(value: unknown): value is RunMode {
  return value === 'task' || value === 'design' || value === 'video';
}

// ---------------------------------------------------------------------------
// Disk walking
// ---------------------------------------------------------------------------

/**
 * Parse a single skill directory containing a `SKILL.md`. Exported so the
 * legacy `~/.claude/skills/<name>` compat shim can target one dir directly
 * without re-walking the entire plugin cascade.
 */
export async function loadSkillFromDir(
  pluginNamespace: string | null,
  skillDir: string,
): Promise<LoadedSkill | null> {
  try {
    const files = await fs.readdir(skillDir);
    const skillFile = files.find((f) => f.toLowerCase() === 'skill.md');
    if (!skillFile) return null;

    const fullPath = join(skillDir, skillFile);
    const content = await fs.readFile(fullPath, 'utf-8');
    const parsed = parseSkillMarkdown(content);
    if (!parsed) {
      logger.info(`No valid frontmatter: ${fullPath}`);
      return null;
    }

    const { metadata, body } = parsed;
    const bareName = metadata.name || basename(skillDir);
    metadata.name = bareName;
    const ns = pluginNamespace ? `${pluginNamespace}:${bareName}` : bareName;

    return {
      name: ns,
      bareName,
      plugin: pluginNamespace,
      path: skillDir,
      metadata,
      content,
      body,
    };
  } catch {
    return null;
  }
}

async function loadPluginFromDir(
  pluginDir: string,
  scope: PluginScope,
): Promise<LoadedPlugin | null> {
  const manifestFile = await readManifestFile(pluginDir);
  if (!manifestFile) return null;

  const parsed = parseManifest(manifestFile.raw);
  if (!parsed.ok || !parsed.manifest) {
    logger.warn(
      `Invalid plugin manifest at ${manifestFile.path}: ${parsed.issues.join('; ')}`,
    );
    return null;
  }
  const manifest = parsed.manifest;

  const skillsRoot = resolveContainedPath(pluginDir, manifest.skills);
  let skills: LoadedSkill[] = [];
  if (!skillsRoot) {
    logger.warn(
      `Plugin skills directory escapes plugin root; skipping skills: ${manifest.name} (${manifest.skills})`,
    );
    return { manifest, scope, path: pluginDir, skills };
  }
  try {
    const entries = await fs.readdir(skillsRoot, { withFileTypes: true });
    const dirs = entries.filter(
      (e) => e.isDirectory() && !e.name.startsWith('.'),
    );
    const loaded = await Promise.all(
      dirs.map((d) =>
        loadSkillFromDir(manifest.name, join(skillsRoot, d.name)),
      ),
    );
    skills = loaded.filter((s): s is LoadedSkill => s !== null);
  } catch {
    // No skills/ subdir — plugin may still ship commands/agents (out of scope).
  }

  // Explicit skill dirs (Open Design plugins declare root-level SKILL.md files
  // via metadata.neuma.skillFiles). Load each and merge, deduping by name.
  const explicitDirs = manifest.metadata?.neuma?.skillFiles ?? [];
  if (explicitDirs.length > 0) {
    const seen = new Set(skills.map((s) => s.name));
    const explicit = await Promise.all(
      explicitDirs.map((rel) => {
        const dir = resolveContainedPath(pluginDir, rel);
        return dir
          ? loadSkillFromDir(manifest.name, dir)
          : Promise.resolve(null);
      }),
    );
    for (const skill of explicit) {
      if (skill && !seen.has(skill.name)) {
        seen.add(skill.name);
        skills.push(skill);
      }
    }
  }

  return { manifest, scope, path: pluginDir, skills };
}

/** Resolve `relativePath` inside `rootDir`, rejecting escapes. */
function resolveContainedPath(
  rootDir: string,
  relativePath: string,
): string | null {
  const root = resolve(rootDir);
  const candidate = resolve(root, relativePath);
  if (candidate !== root && !candidate.startsWith(root + sep)) {
    return null;
  }
  return candidate;
}

/** Synthesize a `legacy` plugin from a bare `~/.claude/skills/<name>/` dir. */
async function loadLegacyBareSkill(
  skillDir: string,
): Promise<LoadedPlugin | null> {
  const skill = await loadSkillFromDir(null, skillDir);
  if (!skill) return null;
  const manifest: PluginManifest = {
    name: 'legacy',
    version: '0.0.0',
    description: `Legacy skill discovered at ${skillDir}`,
    skills: '.',
  };
  return {
    manifest,
    scope: 'legacy',
    path: skillDir,
    skills: [skill],
  };
}

/**
 * Load every plugin under `rootDir`. A first-level directory that carries a
 * manifest is a plugin; one that does not is treated as an organizational
 * category (e.g. `plugins/builtin/video-templates/`) and its immediate
 * children are scanned instead. Category names carry no meaning and nesting
 * stops at one level.
 */
export async function loadPluginsFromRoot(
  rootDir: string,
  scope: PluginScope,
): Promise<LoadedPlugin[]> {
  const dirs = await listChildDirs(rootDir);
  const loaded = await Promise.all(
    dirs.map(async (dir) => {
      const plugin = await loadPluginFromDir(dir, scope);
      if (plugin) return [plugin];
      if (await readManifestFile(dir)) {
        // Manifest present but invalid — already logged; not a category dir.
        return [];
      }
      const children = await listChildDirs(dir);
      const nested = await Promise.all(
        children.map((child) => loadPluginFromDir(child, scope)),
      );
      return nested.filter((p): p is LoadedPlugin => p !== null);
    }),
  );
  const plugins = loaded.flat();
  for (const plugin of plugins) {
    logger.info(
      `Loaded plugin (${scope}): ${plugin.manifest.name}@${plugin.manifest.version} (${plugin.skills.length} skills)`,
    );
  }
  return plugins;
}

async function listChildDirs(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => join(dir, e.name));
  } catch {
    return [];
  }
}

async function loadLegacySkills(): Promise<LoadedPlugin[]> {
  const root = getClaudeSkillsDir();
  let entries: { name: string; isDirectory: () => boolean }[];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const dirs = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((d) => join(root, d.name));

  const probed = await Promise.all(
    dirs.map(async (dir) => {
      // Dirs that already carry a plugin manifest are loaded as `user` scope;
      // legacy tier picks up only the bare-SKILL.md remainder.
      const hasManifest = await readManifestFile(dir);
      return hasManifest ? null : dir;
    }),
  );
  const bareDirs = probed.filter((d): d is string => d !== null);

  const loaded = await Promise.all(bareDirs.map(loadLegacyBareSkill));
  return loaded.filter((p): p is LoadedPlugin => p !== null);
}

async function ensurePluginHotReload(
  config: PluginLoaderConfig,
): Promise<void> {
  const shouldWatch = config.watch ?? process.env.NODE_ENV !== 'test';
  if (!shouldWatch) return;

  const roots = await existingWatchRoots(config);
  const nextKey = roots.join('\0');
  if (watcher && watcherRootsKey === nextKey) return;

  await stopPluginHotReload();
  if (roots.length === 0) return;

  watcher = chokidar.watch(roots, {
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 250,
      pollInterval: 50,
    },
  });
  watcherRootsKey = nextKey;

  // Wait for the initial scan to complete so callers (and tests) can rely on
  // subsequent file mutations actually firing change events.
  await new Promise<void>((resolve) => {
    if (!watcher) {
      resolve();
      return;
    }
    const onReady = () => resolve();
    watcher.once('ready', onReady);
    // Safety timeout in case `ready` is delayed on slow filesystems.
    setTimeout(() => {
      watcher?.off('ready', onReady);
      resolve();
    }, 2000);
  });

  const invalidate = (eventName: string, filePath: string) => {
    if (!/skill\.md$/i.test(filePath) && !/plugin\.json$/i.test(filePath)) {
      return;
    }
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      invalidatePluginLoaderCache(`${eventName}:${filePath}`);
    }, 250);
  };

  watcher
    .on('add', (filePath) => invalidate('add', filePath))
    .on('change', (filePath) => invalidate('change', filePath))
    .on('unlink', (filePath) => invalidate('unlink', filePath))
    .on('error', (error) => {
      logger.warn('Plugin hot-reload watcher failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    });

  logger.info('Plugin hot-reload watcher started', { roots });
}

async function existingWatchRoots(
  config: PluginLoaderConfig,
): Promise<string[]> {
  const candidates = [
    config.projectDir ?? null,
    resolveBuiltinPluginRoot(),
    join(getAppDir(), 'plugins'),
    join(getAppDir(), 'marketplace'),
    getBundledSkillsDir(),
    getClaudeSkillsDir(),
  ].filter((root): root is string => Boolean(root));

  const checked = await Promise.all(
    candidates.map(async (root) => {
      try {
        const stats = await fs.stat(root);
        return stats.isDirectory() ? root : null;
      } catch {
        return null;
      }
    }),
  );

  return Array.from(new Set(checked.filter((root): root is string => !!root)));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load all plugins in cascade order. Later tiers override earlier ones when
 * plugin names collide; collisions are logged.
 */
export async function loadPlugins(
  config: PluginLoaderConfig = {},
): Promise<LoadedPlugin[]> {
  if (config.enabled === false) {
    logger.info('Plugins disabled, skipping load');
    return [];
  }
  await ensurePluginHotReload(config);

  const tiers: { scope: PluginScope; root: string | null }[] = [
    // Repo-shipped builtin plugins sit at the lowest priority so every other
    // tier can override them by name.
    { scope: 'bundled', root: resolveBuiltinPluginRoot() },
    { scope: 'project', root: config.projectDir ?? null },
    { scope: 'user', root: join(getAppDir(), 'plugins') },
    { scope: 'marketplace', root: join(getAppDir(), 'marketplace') },
    { scope: 'bundled', root: getBundledSkillsDir() },
  ];

  // Walk all tiers in parallel, merge respecting cascade priority (later
  // tiers override earlier ones).
  const [tierResults, legacy] = await Promise.all([
    Promise.all(
      tiers.map((t) =>
        t.root ? loadPluginsFromRoot(t.root, t.scope) : Promise.resolve([]),
      ),
    ),
    loadLegacySkills(),
  ]);

  const byName = new Map<string, LoadedPlugin>();
  for (const plugins of tierResults) {
    for (const plugin of plugins) {
      const existing = byName.get(plugin.manifest.name);
      if (existing) {
        logger.warn(
          `Plugin name collision: '${plugin.manifest.name}' — ${existing.scope} (${existing.path}) overridden by ${plugin.scope} (${plugin.path})`,
        );
      }
      byName.set(plugin.manifest.name, plugin);
    }
  }
  for (const plugin of legacy) {
    if (!byName.has(plugin.skills[0]?.bareName ?? '')) {
      byName.set(`legacy:${plugin.skills[0]?.bareName ?? plugin.path}`, plugin);
    }
  }

  return Array.from(byName.values());
}

/**
 * Convenience — flatten loaded plugins to their skills.
 *
 * Exclusions:
 * - Disabled plugins (user toggled them off) drop out entirely.
 * - BUNDLED surface-restricted plugins (the design-system / design-skill /
 *   video-template catalog migrated into plugins/builtin) are withheld from
 *   the blanket agent skill list — they reach runs through their mode's
 *   adapter and would otherwise flood every agent with hundreds of skills.
 *
 * A user-installed plugin is an explicit opt-in, so its skills load even when
 * it declares a surface (e.g. an Open Design video plugin the user enabled).
 */
export async function loadAllSkills(
  config: PluginLoaderConfig = {},
): Promise<LoadedSkill[]> {
  const plugins = await loadPlugins(config);
  const disabled = safeDisabledPluginNames();
  return plugins
    .filter(
      (p) => !(p.scope === 'bundled' && p.manifest.metadata?.neuma?.surfaces),
    )
    .filter((p) => !disabled.has(p.manifest.name))
    .flatMap((p) => p.skills);
}

/**
 * Disabled-plugin names, tolerating an unavailable DB (e.g. before migrations
 * or in fixture contexts) by treating everything as enabled.
 */
function safeDisabledPluginNames(): Set<string> {
  try {
    return getDisabledPluginNames();
  } catch {
    return new Set();
  }
}
