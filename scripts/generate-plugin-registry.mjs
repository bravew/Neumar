#!/usr/bin/env node

/**
 * Generate the official plugin registry from a scan of `plugins/builtin/`
 * (dev-doc/plan/07-04-plugin-system checkpoint 3).
 *
 * Output: plugins/registry/official/marketplace.json — Anthropic
 * marketplace.json wire format plus per-entry Neuma extensions
 * (`metadata.neuma.surfaces`, `metadata.neuma.capabilitiesSummary`).
 * The file is GENERATED — never hand-edit it; `--check` fails when the
 * committed file drifts from a fresh scan.
 *
 * Usage:
 *   node scripts/generate-plugin-registry.mjs           # write the registry
 *   node scripts/generate-plugin-registry.mjs --check   # verify, write nothing
 */

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const BUILTIN_ROOT = path.join(repoRoot, 'plugins/builtin');
const REGISTRY_FILE = path.join(
  repoRoot,
  'plugins/registry/official/marketplace.json',
);
const MANIFEST_DIRS = ['.claude-plugin', '.codex-plugin', '.cursor-plugin'];

const branding = JSON.parse(
  readFileSync(path.join(repoRoot, 'branding.json'), 'utf-8'),
);

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

function readPluginManifest(pluginDir) {
  for (const dir of MANIFEST_DIRS) {
    const file = path.join(pluginDir, dir, 'plugin.json');
    if (existsSync(file)) return readJson(file);
  }
  return null;
}

function listDirs(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        !entry.name.startsWith('.') &&
        !entry.name.startsWith('_'),
    )
    .map((entry) => entry.name)
    .sort();
}

/**
 * Derive the pre-install capability disclosure for a catalog entry. Video
 * plugins declare capabilities in their sidecar manifest; skill and
 * design-system plugins contribute prompt context only.
 */
function capabilitiesSummary(pluginDir, manifest) {
  const neuma = manifest?.metadata?.neuma ?? {};
  const summary = new Set(['prompt:inject']);
  if (typeof neuma.videoManifest === 'string') {
    const sidecar = readJson(path.join(pluginDir, neuma.videoManifest));
    for (const capability of sidecar?.video?.capabilities ?? []) {
      if (typeof capability === 'string') summary.add(capability);
    }
  }
  if (typeof neuma.taskManifest === 'string') {
    const sidecar = readJson(path.join(pluginDir, neuma.taskManifest));
    for (const capability of sidecar?.capabilities ?? []) {
      if (typeof capability === 'string') summary.add(capability);
    }
  }
  return [...summary].sort();
}

function collectEntries() {
  const entries = [];
  for (const category of listDirs(BUILTIN_ROOT)) {
    const categoryDir = path.join(BUILTIN_ROOT, category);
    for (const slug of listDirs(categoryDir)) {
      const pluginDir = path.join(categoryDir, slug);
      const manifest = readPluginManifest(pluginDir);
      if (!manifest) continue;
      if (!manifest.name || !manifest.version || !manifest.description) {
        throw new Error(`Incomplete manifest for ${category}/${slug}`);
      }
      const neuma = manifest.metadata?.neuma ?? {};
      entries.push({
        name: manifest.name,
        source: `./${category}/${slug}`,
        description: manifest.description,
        version: manifest.version,
        ...(manifest.displayName ? { displayName: manifest.displayName } : {}),
        ...(manifest.license ? { license: manifest.license } : {}),
        ...(manifest.keywords ? { keywords: manifest.keywords } : {}),
        category,
        metadata: {
          neuma: {
            ...(Array.isArray(neuma.surfaces)
              ? { surfaces: neuma.surfaces }
              : {}),
            capabilitiesSummary: capabilitiesSummary(pluginDir, manifest),
          },
        },
      });
    }
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  return entries;
}

function buildRegistry() {
  const entries = collectEntries();
  return {
    $schema: 'https://json.schemastore.org/claude-code-marketplace.json',
    name: `${branding.slug}-official`,
    owner: { name: branding.displayName },
    metadata: {
      description: `Official ${branding.displayName} plugin registry, generated from plugins/builtin/.`,
      version: '0.1.0',
      generatedFrom: 'plugins/builtin',
      pluginRoot: './plugins/builtin',
      pluginCount: entries.length,
    },
    plugins: entries,
  };
}

function formatRegistryJson(json) {
  const formatterName = process.platform === 'win32' ? 'oxfmt.cmd' : 'oxfmt';
  const formatter = path.join(repoRoot, 'node_modules', '.bin', formatterName);
  if (!existsSync(formatter)) return json;

  const result = spawnSync(formatter, ['--stdin-filepath', REGISTRY_FILE], {
    cwd: repoRoot,
    encoding: 'utf-8',
    input: json,
  });
  if (result.status !== 0 || result.error) {
    const detail =
      result.stderr ||
      result.stdout ||
      result.error?.message ||
      (result.signal ? `signal ${result.signal}` : '') ||
      `exit status ${result.status ?? 'unknown'}`;
    throw new Error(`Failed to format generated plugin registry: ${detail}`);
  }
  return result.stdout;
}

const registry = buildRegistry();
const rendered = formatRegistryJson(`${JSON.stringify(registry, null, 2)}\n`);

if (process.argv[2] === '--check') {
  const committed = existsSync(REGISTRY_FILE)
    ? readFileSync(REGISTRY_FILE, 'utf-8')
    : null;
  if (committed !== rendered) {
    console.error(
      '[registry] plugins/registry/official/marketplace.json is stale — run: node scripts/generate-plugin-registry.mjs',
    );
    process.exit(1);
  }
  console.log(
    `[registry] OK — ${registry.plugins.length} entries match a fresh scan`,
  );
} else {
  mkdirSync(path.dirname(REGISTRY_FILE), { recursive: true });
  writeFileSync(REGISTRY_FILE, rendered);
  console.log(
    `[registry] wrote ${registry.plugins.length} entries to plugins/registry/official/marketplace.json`,
  );
}
