/**
 * Plugin scaffolder.
 *
 * `compileTmpl` substitutes `{{TOKEN}}` placeholders (gstack convention,
 * `_sample/gstack/review/SKILL.md.tmpl:30`). Missing tokens are left intact
 * and surfaced via the logger so authors can see what they forgot.
 *
 * `createPlugin` writes a complete plugin tree under `<dir>/<name>/` from a
 * built-in template. The generated `.claude-plugin/plugin.json` is validated
 * against {@link PluginManifestSchema} before any files are kept.
 */

import fs from 'fs/promises';
import { dirname, join, relative, resolve } from 'path';
import { fileURLToPath } from 'url';

import { createLogger } from '@/shared/utils/logger';
import { pathExists } from '@/shared/utils/paths';

import { parseManifest, type PluginManifest } from './manifest';

const logger = createLogger('PluginScaffold');

// Resolve templates dir relative to this file so it works in both tsx-dev
// (running .ts straight from src/) and the bundled sidecar (after esbuild
// outputs CJS that still keeps __dirname semantics via createRequire).
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TEMPLATES_DIR = resolve(__dirname, 'templates');

export type PluginTemplate = 'basic' | 'with-script' | 'with-mcp';

export interface CreatePluginOptions {
  /** Lower-kebab-case plugin name (also the install dir basename). */
  name: string;
  /** Parent directory; the plugin lives at `<dir>/<name>/`. */
  dir: string;
  /** Built-in template to copy from. Defaults to `basic`. */
  template?: PluginTemplate;
  /** Custom token overrides (merged on top of standard tokens). */
  vars?: Record<string, string>;
  /** Optional manifest description (defaults to "<name> plugin"). */
  description?: string;
}

export interface CreatePluginResult {
  pluginDir: string;
  manifestPath: string;
  files: string[];
}

const TOKEN_RE = /\{\{([A-Z0-9_]+)\}\}/g;

/**
 * Substitute `{{TOKEN}}` placeholders in a template file.
 *
 * Tokens that have no matching key in `vars` are left in place verbatim and a
 * warning is logged (one log line per missing token). This is deliberate: we
 * never want to silently render `{{API_KEY}}` as the empty string into a
 * SKILL.md that someone is about to publish.
 */
export async function compileTmpl(
  tmplPath: string,
  vars: Record<string, string>,
): Promise<string> {
  const raw = await fs.readFile(tmplPath, 'utf-8');
  const missing = new Set<string>();
  const out = raw.replace(TOKEN_RE, (match, token: string) => {
    if (Object.prototype.hasOwnProperty.call(vars, token)) {
      return vars[token] ?? match;
    }
    missing.add(token);
    return match;
  });
  if (missing.size > 0) {
    logger.warn(
      `compileTmpl(${relative(process.cwd(), tmplPath)}): missing vars [${[
        ...missing,
      ].join(', ')}] — left in place`,
    );
  }
  return out;
}

/**
 * Read the API package.json version once at module load. Falls back to "0.0.0"
 * if package.json can't be located (e.g., bundled binary in a non-standard
 * layout) — never fatal, the token is just informational.
 */
async function readHostVersion(): Promise<string> {
  const candidates = [
    resolve(__dirname, '../../../package.json'),
    resolve(__dirname, '../../../../package.json'),
  ];
  for (const candidate of candidates) {
    try {
      const txt = await fs.readFile(candidate, 'utf-8');
      const pkg = JSON.parse(txt) as { version?: string };
      if (pkg.version) return pkg.version;
    } catch {
      // try next
    }
  }
  return '0.0.0';
}

/**
 * Walk a template tree and collect all files. Directories with `__name__` in
 * the path get rewritten to the plugin's actual name so e.g.
 * `skills/__name__/SKILL.md.tmpl` → `skills/<name>/SKILL.md`.
 */
async function listTemplateFiles(
  root: string,
): Promise<{ srcAbs: string; relPath: string }[]> {
  const out: { srcAbs: string; relPath: string }[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(abs);
      } else if (entry.isFile()) {
        out.push({ srcAbs: abs, relPath: relative(root, abs) });
      }
    }
  }
  await walk(root);
  return out;
}

function rewriteRelPath(relPath: string, name: string): string {
  // Replace the literal segment "__name__" with the plugin name.
  let out = relPath.split('__name__').join(name);
  // Strip the .tmpl suffix from any file that has it.
  if (out.endsWith('.tmpl')) out = out.slice(0, -'.tmpl'.length);
  return out;
}

function buildManifest(opts: {
  name: string;
  description: string;
  template: PluginTemplate;
}): PluginManifest {
  const base = {
    name: opts.name,
    version: '0.1.0',
    description: opts.description,
    skills: 'skills',
  } as const;

  if (opts.template === 'with-mcp') {
    return { ...base, mcp: '.mcp.json' } as PluginManifest;
  }
  return base as PluginManifest;
}

/**
 * Create a new plugin tree under `<dir>/<name>/`. Refuses to overwrite an
 * existing directory.
 */
export async function createPlugin(
  opts: CreatePluginOptions,
): Promise<CreatePluginResult> {
  const template: PluginTemplate = opts.template ?? 'basic';
  const description = opts.description ?? `${opts.name} plugin`;
  const pluginDir = resolve(opts.dir, opts.name);

  if (await pathExists(pluginDir)) {
    throw new Error(
      `Refusing to overwrite existing directory: ${pluginDir}. ` +
        `Pick a new name or remove the directory first.`,
    );
  }

  const templateRoot = join(TEMPLATES_DIR, template);
  if (!(await pathExists(templateRoot))) {
    throw new Error(
      `Unknown template '${template}' (looked in ${templateRoot})`,
    );
  }

  // Build manifest first so we can validate before touching the filesystem.
  const manifest = buildManifest({ name: opts.name, description, template });
  const manifestParsed = parseManifest(JSON.stringify(manifest));
  if (!manifestParsed.ok) {
    throw new Error(
      `Generated manifest failed validation: ${manifestParsed.issues.join('; ')}`,
    );
  }

  // Resolve standard tokens, then layer custom vars on top so callers can
  // override anything (including HOST_VERSION in tests).
  const today = new Date().toISOString().slice(0, 10);
  const hostVersion = await readHostVersion();
  const vars: Record<string, string> = {
    NAME: opts.name,
    DESCRIPTION: description,
    HOST_VERSION: hostVersion,
    TODAY: today,
    ...(opts.vars ?? {}),
  };

  const files = await listTemplateFiles(templateRoot);

  // Stage everything in memory first, write atomically — refusing to leave a
  // half-written plugin behind if a single template breaks.
  const writes: { destAbs: string; content: string; mode?: number }[] = [];

  for (const file of files) {
    const destRel = rewriteRelPath(file.relPath, opts.name);
    const destAbs = join(pluginDir, destRel);
    let content: string;
    if (file.srcAbs.endsWith('.tmpl')) {
      content = await compileTmpl(file.srcAbs, vars);
    } else {
      content = await fs.readFile(file.srcAbs, 'utf-8');
    }
    const mode = destRel.endsWith('.sh') ? 0o755 : undefined;
    writes.push({ destAbs, content, mode });
  }

  // Add the generated manifest (templates do not ship plugin.json — the
  // scaffolder owns it so it stays in sync with the schema).
  const manifestPath = join(pluginDir, '.claude-plugin', 'plugin.json');
  writes.push({
    destAbs: manifestPath,
    content: JSON.stringify(manifest, null, 2) + '\n',
  });

  await fs.mkdir(pluginDir, { recursive: true });
  for (const w of writes) {
    await fs.mkdir(dirname(w.destAbs), { recursive: true });
    await fs.writeFile(w.destAbs, w.content, 'utf-8');
    if (w.mode !== undefined) {
      await fs.chmod(w.destAbs, w.mode);
    }
  }

  return {
    pluginDir,
    manifestPath,
    files: writes.map((w) => w.destAbs),
  };
}
