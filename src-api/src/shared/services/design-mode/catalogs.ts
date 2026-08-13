import { randomUUID } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getDisabledPluginNames } from '@/shared/db/plugins';
import {
  loadPlugins,
  resolveBuiltinPluginRoot,
  type LoadedPlugin,
  type LoadedSkill,
} from '@/shared/plugins';
import {
  extractFrontmatter,
  extractIndentedBlock,
  parseMarkdownFrontmatter,
  readFrontmatterBlockScalar,
  readFrontmatterScalar,
  readFrontmatterStringList,
} from '@/shared/utils/frontmatter';
import { createLogger } from '@/shared/utils/logger';

import { getDesignWorkspaceRoot } from './fs';
import { mediaAspects } from './types';
import type {
  DesignSurface,
  MediaAspect,
  PromptTemplateSnapshot,
} from './types';

const logger = createLogger('DesignCatalogs');

const CATALOG_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,99}$/i;
const CATALOG_SOURCE_PATTERN = /^[\w][\w.-]*$/;
const CATALOG_MAX_FILES = 2_000;
const CATALOG_MAX_FILE_BYTES = 10 * 1024 * 1024;
const CATALOG_MAX_TOTAL_BYTES = 75 * 1024 * 1024;

export type DesignCatalogOrigin = 'bundled' | 'installed';
export type DesignSkillOrigin = 'builtin' | 'installed';

interface DesignSystemRoot {
  root: string;
  origin: DesignCatalogOrigin;
}

interface PluginDesignSystemEntry {
  id: string;
  root: string;
  plugin: LoadedPlugin;
}

interface DesignPluginManifest {
  designSystems: Array<{
    id: string;
    path: string;
  }>;
}

function assertCatalogId(id: string, kind: string): void {
  if (!CATALOG_ID_PATTERN.test(id)) {
    throw new Error(`Invalid ${kind} id`);
  }
}

function assertCatalogSourceSlug(slug: string, kind: string): void {
  if (
    !CATALOG_SOURCE_PATTERN.test(slug) ||
    slug.startsWith('.') ||
    slug.includes('..') ||
    path.isAbsolute(slug)
  ) {
    throw new Error(`Invalid ${kind} source`);
  }
}

export interface DesignSystemRecord {
  id: string;
  title: string;
  category: string;
  summary: string;
  body: string;
  tokenCss?: string;
  componentsHtml?: string;
  swatches: string[];
  tokens: string[];
  path?: string;
  origin: DesignCatalogOrigin;
  version?: string;
  updateAvailable?: boolean;
  canUninstall?: boolean;
  editable?: boolean;
  // Freshness signals from the pack's meta.json: installCatalogPack stamps
  // installedAt; dtcg/shadcn imports stamp createdAt. Bundled systems have
  // neither and keep curated order under a `newest` sort.
  installedAt?: string;
  createdAt?: string;
}

export class DesignSystemReadOnlyError extends Error {
  constructor(message = 'Built-in design systems are read-only') {
    super(message);
    this.name = 'DesignSystemReadOnlyError';
  }
}

export class DesignSystemNotFoundError extends Error {
  constructor(id: string) {
    super(`Design system not found: ${id}`);
    this.name = 'DesignSystemNotFoundError';
  }
}

export interface PatchDesignSystemInput {
  title?: string;
  body?: string;
}

export interface CraftRecord {
  id: string;
  title: string;
  body: string;
  path?: string;
}

export interface DesignSkillInput {
  name: string;
  type: 'text' | 'textarea' | 'select' | 'checkbox' | 'radio' | 'number';
  required?: boolean;
  options?: string[];
  label?: string;
  help?: string;
  maxSelections?: number;
}

export interface DesignSkillMetadata {
  mode?: string;
  platform?: 'desktop' | 'mobile';
  featured?: number;
  surface: DesignSurface | 'other';
  scenario?: string;
  preview?: {
    type?: string;
    entry?: string;
    reload?: string;
  };
  designSystem?: {
    requires?: boolean;
  };
  craft?: {
    requires: string[];
  };
  inputs: DesignSkillInput[];
  parameters: DesignSkillInput[];
  outputs: Array<{ kind: string; formats?: string[] }>;
  capabilitiesRequired: string[];
  defaultFor: DesignSurface[];
  examplePrompt?: string;
  warnings: string[];
}

export interface DesignSkillRecord {
  id: string;
  name: string;
  slug: string;
  description: string;
  source: string;
  path?: string;
  content: string;
  icon?: string;
  category?: string;
  trigger?: string;
  origin: DesignSkillOrigin;
  version?: string;
  updateAvailable?: boolean;
  canUninstall?: boolean;
  od: DesignSkillMetadata;
}

export class InvalidDesignSkillError extends Error {
  constructor(skillId: string) {
    super(`Unknown DesignMode skill: ${skillId}`);
    this.name = 'InvalidDesignSkillError';
  }
}

export interface PromptTemplateRecord extends Omit<
  PromptTemplateSnapshot,
  'prompt'
> {
  prompt?: string;
  previewImageUrl?: string;
  previewVideoUrl?: string;
}

export interface DesignLiveArtifactTemplateRecord {
  id: string;
  title: string;
  category: string;
  summary: string;
  path?: string;
  previewImagePath?: string;
  files: {
    artifact: string;
    data: string;
    template: string;
    index?: string;
    provenance?: string;
    design?: string;
    readme?: string;
  };
  readme?: string;
  designSpec?: string;
  templateHtml?: string;
  data?: unknown;
  artifact?: unknown;
  provenance?: unknown;
}

const SURFACES = new Set<DesignSurface>([
  'document',
  'image',
  'video',
  'audio',
  'deck',
  'prototype',
  'template',
  'campaign',
]);

/** Cached resolved catalog root so we only stat the candidates once. */
let resolvedCatalogRoot: string | null = null;

/**
 * Locate the design-mode catalog tree (prompt-templates/, craft/,
 * design-systems/, skills/).
 *
 * Production (Tauri sidecar): the build copies `src/shared/design-mode/` to
 * `dist/design-mode/`, and tauri.conf bundles it as a resource. Tauri exposes
 * the resources directory via `RESOURCES_DIR` and maps `../src-api/dist/...`
 * to `_up_/src-api/dist/...`.
 *
 * Dev (tsx): resolve relative to this source file.
 */
function catalogRoot(): string {
  if (resolvedCatalogRoot) return resolvedCatalogRoot;

  const candidates: string[] = [];
  const resourcesDir = process.env.RESOURCES_DIR;
  if (resourcesDir) {
    candidates.push(
      path.join(resourcesDir, '_up_', 'src-api', 'dist', 'design-mode'),
      path.join(resourcesDir, 'design-mode'),
    );
  }
  // Bundled binary: templates copied next to the executable.
  const execDir = path.dirname(process.execPath);
  candidates.push(
    path.join(execDir, 'design-mode'),
    path.join(execDir, 'dist', 'design-mode'),
  );
  // Dev fallback: relative to this source file.
  try {
    candidates.push(
      path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        '../../design-mode',
      ),
    );
  } catch {
    // import.meta.url not available in some snapshot fs contexts.
  }

  for (const candidate of candidates) {
    try {
      if (statSync(candidate).isDirectory()) {
        resolvedCatalogRoot = candidate;
        logger.info(`design-mode catalog root: ${candidate}`);
        return candidate;
      }
    } catch {
      // try next
    }
  }

  // Last resort: return the dev path so callers get a meaningful ENOENT
  // instead of an empty string.
  const fallback = candidates[candidates.length - 1] ?? execDir;
  logger.warn(
    `design-mode catalog root not found; using fallback: ${fallback}`,
  );
  resolvedCatalogRoot = fallback;
  return fallback;
}

/**
 * Bundled design systems live in the parent plugin directory
 * (`plugins/builtin/design-systems/<slug>/`, checkpoint 2 of
 * dev-doc/plan/07-04-plugin-system). Each system is a bundled plugin whose
 * content sits at the plugin root, so the `<root>/<slug>/DESIGN.md` scan shape
 * is unchanged from the old design-mode catalog tree.
 */
function bundledDesignSystemRoot(): string {
  return path.join(resolveBuiltinPluginRoot(), 'design-systems');
}

/**
 * Bundled design skills are plugins under
 * `plugins/builtin/design-skills/<slug>/` with content at
 * `skills/<slug>/SKILL.md` (standard plugin skill layout).
 */
function bundledDesignSkillRoot(): string {
  return path.join(resolveBuiltinPluginRoot(), 'design-skills');
}

function bundledDesignSkillContentDir(slug: string): string {
  return path.join(
    resolvePackPath(bundledDesignSkillRoot(), slug),
    'skills',
    slug,
  );
}

/**
 * Plugin names for bundled design content, matching the wrapping manifests the
 * migration script generates (scripts/migrate-design-catalogs.mjs). Used to
 * honor a user's disable of a built-in design plugin.
 */
function bundledDesignSystemPluginName(slug: string): string {
  return `design-system-${slug}`;
}

function bundledDesignSkillPluginName(slug: string): string {
  return `design-skill-${slug}`;
}

function safeDisabledPluginNames(): Set<string> {
  try {
    return getDisabledPluginNames();
  } catch {
    return new Set();
  }
}

function installedDesignSystemRoot(): string {
  return path.join(getDesignWorkspaceRoot(), '.neuma/design-systems');
}

function installedDesignSkillRoot(): string {
  return path.join(getDesignWorkspaceRoot(), '.neuma/skills');
}

function designSystemRoots(): DesignSystemRoot[] {
  const roots: DesignSystemRoot[] = [
    { root: bundledDesignSystemRoot(), origin: 'bundled' },
  ];
  try {
    roots.push({ root: installedDesignSystemRoot(), origin: 'installed' });
  } catch {
    // workDir can be unset during first-run setup; bundled systems still load.
  }
  return roots;
}

export async function listDesignSystems(
  // Light catalog mode: omit each system's `components.html` so the list stays
  // small. Callers needing the full record (preview, export) fetch by id.
  summaryOnly = false,
): Promise<DesignSystemRecord[]> {
  const records: DesignSystemRecord[] = [];
  const disabled = safeDisabledPluginNames();
  for (const { root, origin } of designSystemRoots()) {
    for (const dir of await safeReaddir(root)) {
      if (!dir.isDirectory()) continue;
      // A disabled built-in design-system plugin drops out of the catalog.
      if (
        origin === 'bundled' &&
        disabled.has(bundledDesignSystemPluginName(dir.name))
      ) {
        continue;
      }
      const file = path.join(root, dir.name, 'DESIGN.md');
      const record = await readDesignSystem(
        file,
        dir.name,
        origin,
        summaryOnly,
      );
      if (record) records.push(record);
    }
  }
  for (const entry of await pluginDesignSystemEntries()) {
    const record = await readDesignSystem(
      path.join(entry.root, 'DESIGN.md'),
      entry.id,
      'installed',
      summaryOnly,
      {
        canUninstall: false,
        editable: false,
        version: entry.plugin.manifest.version,
      },
    );
    if (record) records.push(record);
  }
  return [
    ...new Map(records.map((record) => [record.id, record])).values(),
  ].sort(compareDesignSystems);
}

export async function getDesignSystem(
  id: string,
): Promise<DesignSystemRecord | null> {
  assertCatalogId(id, 'design system');
  for (const { root, origin } of [...designSystemRoots()].reverse()) {
    const record = await readDesignSystem(
      path.join(root, id, 'DESIGN.md'),
      id,
      origin,
    );
    if (record) return record;
  }
  for (const entry of await pluginDesignSystemEntries()) {
    if (entry.id !== id) continue;
    return readDesignSystem(
      path.join(entry.root, 'DESIGN.md'),
      entry.id,
      'installed',
      false,
      {
        canUninstall: false,
        editable: false,
        version: entry.plugin.manifest.version,
      },
    );
  }
  return null;
}

export async function listCraft(): Promise<CraftRecord[]> {
  const root = path.join(catalogRoot(), 'craft');
  const records: CraftRecord[] = [];
  for (const entry of await safeReaddir(root)) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const id = entry.name.replace(/\.md$/, '');
    const body = await fs.readFile(path.join(root, entry.name), 'utf-8');
    records.push({
      id,
      title: titleFromMarkdown(body, id),
      body,
      path: path.join(root, entry.name),
    });
  }
  return records.sort((a, b) => a.id.localeCompare(b.id));
}

export async function getCraft(id: string): Promise<CraftRecord | null> {
  assertCatalogId(id, 'craft');
  const file = path.join(catalogRoot(), 'craft', `${id}.md`);
  try {
    const body = await fs.readFile(file, 'utf-8');
    return { id, title: titleFromMarkdown(body, id), body, path: file };
  } catch {
    return null;
  }
}

export async function listPromptTemplates(
  surface: 'image' | 'video',
  includePrompt = false,
): Promise<PromptTemplateRecord[]> {
  const root = path.join(catalogRoot(), 'prompt-templates', surface);
  const records: PromptTemplateRecord[] = [];
  for (const entry of await safeReaddir(root)) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const record = await readPromptTemplate(
      path.join(root, entry.name),
      includePrompt,
    );
    if (record) records.push(record);
  }
  return records.sort((a, b) => a.title.localeCompare(b.title));
}

export async function getPromptTemplate(
  surface: 'image' | 'video',
  id: string,
): Promise<PromptTemplateRecord | null> {
  assertCatalogId(id, 'prompt template');
  const file = path.join(
    catalogRoot(),
    'prompt-templates',
    surface,
    `${id}.json`,
  );
  return readPromptTemplate(file, true);
}

export async function listDesignLiveArtifactTemplates(): Promise<
  DesignLiveArtifactTemplateRecord[]
> {
  const root = path.join(catalogRoot(), 'templates', 'live-artifacts');
  const records: DesignLiveArtifactTemplateRecord[] = [];
  for (const dir of await safeReaddir(root)) {
    if (!dir.isDirectory()) continue;
    const record = await readLiveArtifactTemplate(path.join(root, dir.name));
    if (record) records.push(record);
  }
  return records.sort((a, b) => a.title.localeCompare(b.title));
}

export async function getDesignLiveArtifactTemplate(
  id: string,
): Promise<DesignLiveArtifactTemplateRecord | null> {
  assertCatalogId(id, 'live artifact template');
  return readLiveArtifactTemplate(
    path.join(catalogRoot(), 'templates', 'live-artifacts', id),
    true,
  );
}

export async function listDesignSkills(): Promise<DesignSkillRecord[]> {
  const [bundled, workspaceInstalled, installed] = await Promise.all([
    listBundledDesignSkills(),
    loadWorkspaceDesignSkills(),
    loadInstalledDesignSkills(),
  ]);
  const bundledSlugs = new Set(bundled.map((skill) => skill.slug));
  for (const skill of workspaceInstalled) {
    if (bundledSlugs.has(skill.slug)) {
      skill.id = `bundled:${skill.slug}`;
    }
  }
  const byId = new Map<string, DesignSkillRecord>();
  for (const skill of [...bundled, ...workspaceInstalled, ...installed]) {
    byId.set(skill.id, skill);
  }
  return [...byId.values()].sort((a, b) => {
    const surface = a.od.surface.localeCompare(b.od.surface);
    return surface || a.name.localeCompare(b.name);
  });
}

export async function getDesignSkill(
  id: string,
): Promise<DesignSkillRecord | null> {
  const skills = await listDesignSkills();
  return skills.find((skill) => skill.id === id || skill.slug === id) ?? null;
}

export async function resolveDesignSkillId(
  skillId: string | null,
): Promise<string | null> {
  if (!skillId) return null;
  const skill = await getDesignSkill(skillId);
  if (!skill) throw new InvalidDesignSkillError(skillId);
  return skill.id;
}

export async function readDesignSkillExample(
  id: string,
): Promise<string | null> {
  const skill = await getDesignSkill(id);
  if (!skill?.path) return null;

  const root = path.resolve(skill.path);
  const realRoot = await fs.realpath(root).catch(() => root);
  const candidates = await exampleCandidates(root, skill.od.preview?.entry);
  for (const candidate of candidates) {
    const resolved = path.resolve(root, candidate);
    if (!isWithinRoot(root, resolved)) continue;
    try {
      const stat = await fs.stat(resolved);
      if (!stat.isFile() || stat.size > 5 * 1024 * 1024) continue;
      // Resolve symlinks before reading: isWithinRoot compares strings only,
      // so a symlinked candidate could otherwise read a file outside root.
      if (!isWithinRoot(realRoot, await fs.realpath(resolved))) continue;
      return await fs.readFile(resolved, 'utf-8');
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

/**
 * Read a design skill's seed template (`assets/template.html`) — the structured
 * starting point a build composes into, mirroring Open Design's "copy the seed,
 * then fill it" model. Seeding this into the project root before a build means
 * the agent's read-before-write habit succeeds (instead of erroring on a missing
 * file) and it composes from a real token/class system rather than from scratch.
 * Returns null when the skill or its template is absent.
 */
export async function readDesignSkillSeedTemplate(
  id: string,
): Promise<string | null> {
  const skill = await getDesignSkill(id);
  if (!skill?.path) return null;

  const root = path.resolve(skill.path);
  const realRoot = await fs.realpath(root).catch(() => root);
  const resolved = path.resolve(root, 'assets/template.html');
  // Defense in depth: the template path is fixed, but keep the same
  // within-root guard readDesignSkillExample uses for symlinked skill dirs.
  if (!isWithinRoot(root, resolved)) return null;
  try {
    const stat = await fs.stat(resolved);
    if (!stat.isFile() || stat.size > 5 * 1024 * 1024) return null;
    if (!isWithinRoot(realRoot, await fs.realpath(resolved))) return null;
    return await fs.readFile(resolved, 'utf-8');
  } catch {
    return null;
  }
}

export async function installDesignSystemPack(
  input: string,
): Promise<DesignSystemRecord> {
  const slug = normalizeCatalogSourceSlug(input, 'design system');
  const source = resolvePackPath(bundledDesignSystemRoot(), slug);
  const dest = resolvePackPath(installedDesignSystemRoot(), slug);
  await installCatalogPack(source, dest, 'DESIGN.md', {
    id: slug,
    origin: 'bundled',
  });
  const record = await readDesignSystem(
    path.join(dest, 'DESIGN.md'),
    slug,
    'installed',
  );
  if (!record) throw new Error('Installed design system could not be read');
  return record;
}

export async function uninstallDesignSystemPack(input: string): Promise<void> {
  const slug = normalizeCatalogSourceSlug(input, 'design system');
  await removeInstalledPack(installedDesignSystemRoot(), slug);
}

export async function patchDesignSystem(
  id: string,
  patch: PatchDesignSystemInput,
): Promise<DesignSystemRecord> {
  assertCatalogId(id, 'design system');
  const root = resolvePackPath(installedDesignSystemRoot(), id);
  const file = path.join(root, 'DESIGN.md');
  const meta = await readCatalogMeta(path.join(root, 'meta.json'));

  if (stringValue(meta.origin) === 'bundled') {
    throw new DesignSystemReadOnlyError();
  }

  let body: string;
  try {
    body = await fs.readFile(file, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const bundled = await readDesignSystem(
      path.join(bundledDesignSystemRoot(), id, 'DESIGN.md'),
      id,
      'bundled',
    );
    if (bundled) throw new DesignSystemReadOnlyError();
    throw new DesignSystemNotFoundError(id);
  }

  const nextBody =
    patch.body !== undefined
      ? patch.body
      : patch.title
        ? replaceDesignSystemTitle(body, patch.title)
        : body;
  // Resolve symlinks before writing: isWithinRoot only compares path strings,
  // so a symlinked DESIGN.md inside an installed pack could otherwise redirect
  // the write outside the install root.
  const realFile = await fs.realpath(file);
  if (!isWithinRoot(await fs.realpath(root), realFile)) {
    throw new Error('Catalog path escapes the install root');
  }
  await fs.writeFile(file, nextBody, 'utf-8');
  const record = await readDesignSystem(file, id, 'installed');
  if (!record) throw new DesignSystemNotFoundError(id);
  return record;
}

export async function installDesignSkillPack(
  input: string,
): Promise<DesignSkillRecord> {
  const slug = normalizeCatalogSourceSlug(input, 'skill');
  const source = bundledDesignSkillContentDir(slug);
  const dest = resolvePackPath(installedDesignSkillRoot(), slug);
  await installCatalogPack(source, dest, 'SKILL.md', {
    id: slug,
    origin: 'bundled',
  });
  const bundledExists = existsSync(
    path.join(bundledDesignSkillContentDir(slug), 'SKILL.md'),
  );
  const record = await readSkillFile(
    path.join(dest, 'SKILL.md'),
    bundledExists ? `bundled:${slug}` : `installed:${slug}`,
    'installed',
    'installed',
  );
  if (!record) throw new Error('Installed skill could not be read');
  return record;
}

export async function uninstallDesignSkillPack(input: string): Promise<void> {
  const slug = normalizeCatalogSourceSlug(stripCatalogIdPrefix(input), 'skill');
  await removeInstalledPack(installedDesignSkillRoot(), slug);
}

function stripCatalogIdPrefix(input: string): string {
  const index = input.indexOf(':');
  return index >= 0 ? input.slice(index + 1) : input;
}

async function listBundledDesignSkills(): Promise<DesignSkillRecord[]> {
  const out: DesignSkillRecord[] = [];
  const disabled = safeDisabledPluginNames();
  for (const dir of await safeReaddir(bundledDesignSkillRoot())) {
    if (!dir.isDirectory() || dir.name.startsWith('_')) continue;
    if (disabled.has(bundledDesignSkillPluginName(dir.name))) continue;
    const file = path.join(bundledDesignSkillContentDir(dir.name), 'SKILL.md');
    const record = await readSkillFile(
      file,
      `bundled:${dir.name}`,
      'builtin',
      'builtin',
    );
    if (record) out.push(record);
  }
  return out;
}

async function loadWorkspaceDesignSkills(): Promise<DesignSkillRecord[]> {
  let root: string;
  try {
    root = installedDesignSkillRoot();
  } catch {
    return [];
  }
  const out: DesignSkillRecord[] = [];
  for (const dir of await safeReaddir(root)) {
    if (!dir.isDirectory()) continue;
    const file = path.join(root, dir.name, 'SKILL.md');
    const record = await readSkillFile(
      file,
      `installed:${dir.name}`,
      'installed',
      'installed',
    );
    if (record) out.push(record);
  }
  return out;
}

async function loadInstalledDesignSkills(): Promise<DesignSkillRecord[]> {
  try {
    const plugins = await loadDesignPlugins();
    return (
      plugins
        // Bundled design-skill plugins surface through listBundledDesignSkills
        // with their stable `bundled:<slug>` ids.
        .filter((plugin) => plugin.scope !== 'bundled')
        .flatMap((plugin) =>
          plugin.skills.map((skill) =>
            designSkillFromLoadedSkill(plugin, skill),
          ),
        )
    );
  } catch (error) {
    logger.warn('Failed to load installed DesignMode skills:', error);
    return [];
  }
}

function designSkillFromLoadedSkill(
  plugin: LoadedPlugin,
  skill: LoadedSkill,
): DesignSkillRecord {
  const od = parseOdMetadata(skill.content, skill.bareName);
  return {
    id: skill.name,
    name: skill.bareName,
    slug: path.basename(skill.path),
    description: skill.metadata.description,
    source: plugin.manifest.name,
    path: skill.path,
    content: skill.content,
    icon: skill.metadata.icon,
    category: skill.metadata.category,
    trigger: skill.metadata.trigger,
    origin: 'installed',
    version: skill.metadata.version ?? plugin.manifest.version,
    updateAvailable: false,
    canUninstall: false,
    od,
  };
}

async function readSkillFile(
  file: string,
  id: string,
  source: string,
  origin: DesignSkillOrigin,
): Promise<DesignSkillRecord | null> {
  try {
    const content = await fs.readFile(file, 'utf-8');
    const fm = parseMarkdownFrontmatter(content)?.attributes ?? {};
    const slug = path.basename(path.dirname(file));
    return {
      id,
      name: stringValue(fm.name) || slug,
      slug,
      description: stringValue(fm.description) || '',
      source,
      path: path.dirname(file),
      content,
      icon: stringValue(fm.icon),
      category: stringValue(fm.category),
      trigger: stringValue(fm.trigger),
      origin,
      version: stringValue(fm.version),
      updateAvailable: false,
      canUninstall: origin === 'installed',
      od: parseOdMetadata(content, slug),
    };
  } catch {
    return null;
  }
}

async function readDesignSystem(
  file: string,
  id: string,
  origin: DesignCatalogOrigin,
  // Catalog-list mode: skip the heavy `components.html` read (and omit it from
  // the record). With ~150 systems averaging ~14KB of HTML each, eagerly
  // bundling every preview balloons the list payload to multiple MB. The grid
  // lazy-fetches each system's full record (incl. componentsHtml) on demand.
  summaryOnly = false,
  options: {
    canUninstall?: boolean;
    editable?: boolean;
    version?: string;
  } = {},
): Promise<DesignSystemRecord | null> {
  try {
    const body = await fs.readFile(file, 'utf-8');
    const root = path.dirname(file);
    const tokenCss = await readOptionalText(path.join(root, 'tokens.css'));
    const componentsHtml = summaryOnly
      ? undefined
      : await readOptionalText(path.join(root, 'components.html'));
    const meta = await readCatalogMeta(path.join(root, 'meta.json'));
    // Open Design packages carry a `manifest.json` (schema
    // `od-design-system-project/v1`) whose `name`/`description`/`category` are
    // the authored brand identity (e.g. "Airbnb" / "Bundled Open Design
    // package for Airbnb…"). Prefer those — the DESIGN.md H1 is a generic
    // "Design System Inspired by Airbnb" and its blockquote is a one-liner, so
    // deriving title/summary from the markdown produced the wrong brand name in
    // the catalog and a "makes X feel like X" hero. Fall back to the markdown
    // for our own (custom/installed) systems that have no manifest.
    const manifest = await readOptionalJson(path.join(root, 'manifest.json'));
    const manifestName = stringValue(manifest?.name);
    const manifestDescription = stringValue(manifest?.description);
    const manifestCategory = stringValue(manifest?.category);
    const title = manifestName || titleFromMarkdown(body, id);
    const quoteLines = body
      .split('\n')
      .filter((line) => line.trim().startsWith('>'))
      .map((line) => line.replace(/^>\s?/, '').trim());
    const category =
      manifestCategory ||
      quoteLines
        .find((line) => line.toLowerCase().startsWith('category:'))
        ?.replace(/^category:\s*/i, '') ||
      'General';
    const summary =
      manifestDescription ||
      quoteLines.find((line) => !line.toLowerCase().startsWith('category:')) ||
      body
        .split('\n')
        .find((line) => line.trim() && !line.startsWith('#'))
        ?.trim() ||
      title;
    const tokens = [
      ...new Set(
        `${body}\n${tokenCss ?? ''}`.match(/#[0-9a-fA-F]{6}\b/g) ?? [],
      ),
    ];
    return {
      id,
      title,
      category,
      summary,
      body,
      tokenCss: tokenCss ?? undefined,
      componentsHtml: componentsHtml ?? undefined,
      swatches: tokens.slice(0, 4),
      tokens,
      path: file,
      origin,
      version: options.version ?? stringValue(meta.version),
      updateAvailable: false,
      canUninstall: options.canUninstall ?? origin === 'installed',
      editable:
        options.editable ??
        (origin === 'installed' && stringValue(meta.origin) !== 'bundled'),
      installedAt: stringValue(meta.installedAt) || undefined,
      createdAt: stringValue(meta.createdAt) || undefined,
    };
  } catch (error) {
    if (isMissingOptionalFile(error)) {
      return null;
    }
    throw error;
  }
}

async function loadDesignPlugins(): Promise<LoadedPlugin[]> {
  const plugins = await loadPlugins({ enabled: true });
  return plugins.filter(isDesignPlugin);
}

function isDesignPlugin(plugin: LoadedPlugin): boolean {
  const neuma = plugin.manifest.metadata?.neuma;
  return (
    neuma?.surfaces?.includes('design') === true ||
    typeof neuma?.designManifest === 'string'
  );
}

async function pluginDesignSystemEntries(): Promise<PluginDesignSystemEntry[]> {
  const entries = new Map<string, PluginDesignSystemEntry>();
  for (const plugin of await loadDesignPlugins()) {
    // Bundled design-system plugins are read through the
    // bundledDesignSystemRoot() scan with their bare catalog ids; listing
    // them here too would duplicate every system under a prefixed id.
    if (plugin.scope === 'bundled') continue;
    for (const entry of await explicitPluginDesignSystemEntries(plugin)) {
      entries.set(entry.id, entry);
    }
    for (const entry of await conventionPluginDesignSystemEntries(plugin)) {
      entries.set(entry.id, entry);
    }
  }
  return [...entries.values()];
}

async function explicitPluginDesignSystemEntries(
  plugin: LoadedPlugin,
): Promise<PluginDesignSystemEntry[]> {
  const manifestPath = plugin.manifest.metadata?.neuma?.designManifest;
  if (!manifestPath) return [];
  const resolved = resolvePluginRelativePath(plugin.path, manifestPath);
  if (!resolved) {
    logger.warn('Plugin design manifest path escapes plugin root', {
      plugin: plugin.manifest.name,
      designManifest: manifestPath,
    });
    return [];
  }
  const manifest = parseDesignPluginManifest(await readOptionalJson(resolved));
  const entries: PluginDesignSystemEntry[] = [];
  for (const system of manifest.designSystems) {
    const root = resolvePluginDesignSystemRoot(plugin.path, system.path);
    const id = pluginDesignSystemId(plugin.manifest.name, system.id);
    if (!root || !id) continue;
    entries.push({ id, root, plugin });
  }
  return entries;
}

async function conventionPluginDesignSystemEntries(
  plugin: LoadedPlugin,
): Promise<PluginDesignSystemEntry[]> {
  const root = resolvePluginRelativePath(plugin.path, 'design-systems');
  if (!root) return [];
  const entries: PluginDesignSystemEntry[] = [];
  for (const dir of await safeReaddir(root)) {
    if (!dir.isDirectory()) continue;
    const id = pluginDesignSystemId(plugin.manifest.name, dir.name);
    if (!id) continue;
    entries.push({
      id,
      root: path.join(root, dir.name),
      plugin,
    });
  }
  return entries;
}

function parseDesignPluginManifest(
  value: Record<string, unknown> | null,
): DesignPluginManifest {
  const designSystems = Array.isArray(value?.designSystems)
    ? value.designSystems
        .map((entry) => {
          if (!isRecord(entry)) return null;
          const systemPath = stringValue(entry.path);
          if (!systemPath) return null;
          return {
            id: stringValue(entry.id) ?? path.basename(systemPath),
            path: systemPath,
          };
        })
        .filter((entry): entry is { id: string; path: string } =>
          Boolean(entry),
        )
    : [];
  return { designSystems };
}

function resolvePluginDesignSystemRoot(
  pluginRoot: string,
  relativePath: string,
): string | null {
  const resolved = resolvePluginRelativePath(pluginRoot, relativePath);
  if (!resolved) return null;
  return path.basename(resolved).toLowerCase() === 'design.md'
    ? path.dirname(resolved)
    : resolved;
}

function resolvePluginRelativePath(
  pluginRoot: string,
  relativePath: string,
): string | null {
  const root = path.resolve(pluginRoot);
  const candidate = path.resolve(root, relativePath);
  if (candidate !== root && !candidate.startsWith(root + path.sep)) {
    return null;
  }
  return candidate;
}

function pluginDesignSystemId(
  pluginName: string,
  localId: string,
): string | null {
  const id = localId.startsWith(`${pluginName}.`)
    ? localId
    : `${pluginName}.${localId}`;
  return CATALOG_ID_PATTERN.test(id) ? id : null;
}

function compareDesignSystems(a: DesignSystemRecord, b: DesignSystemRecord) {
  const rank = designSystemRank(a) - designSystemRank(b);
  return rank || a.title.localeCompare(b.title);
}

function designSystemRank(record: DesignSystemRecord) {
  if (record.editable) return 0;
  if (record.origin === 'installed') return 1;
  return 2;
}

function replaceDesignSystemTitle(body: string, title: string): string {
  const clean = title.trim();
  const lines = body.split('\n');
  const headingIndex = lines.findIndex((line) => /^#\s+/.test(line));
  if (headingIndex >= 0) {
    lines[headingIndex] = `# ${clean}`;
    return lines.join('\n');
  }
  return [`# ${clean}`, '', body].join('\n');
}

async function readPromptTemplate(
  file: string,
  includePrompt: boolean,
): Promise<PromptTemplateRecord | null> {
  try {
    const raw = await fs.readFile(file, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const id = stringValue(parsed.id) || path.basename(file, '.json');
    const surface = parsed.surface === 'video' ? 'video' : 'image';
    const aspect = parseAspect(stringValue(parsed.aspect));
    const record: PromptTemplateRecord = {
      id,
      surface,
      title: stringValue(parsed.title) || id,
      summary: stringValue(parsed.summary),
      category: stringValue(parsed.category),
      tags: Array.isArray(parsed.tags) ? parsed.tags.map(String) : undefined,
      model: stringValue(parsed.model),
      aspect,
      source:
        parsed.source && typeof parsed.source === 'object'
          ? normalizeSource(parsed.source as Record<string, unknown>)
          : undefined,
      previewImageUrl: stringValue(parsed.previewImageUrl),
      previewVideoUrl: stringValue(parsed.previewVideoUrl),
    };
    if (includePrompt) record.prompt = stringValue(parsed.prompt) || '';
    return record;
  } catch (error) {
    logger.warn(`Failed to read prompt template ${file}:`, error);
    return null;
  }
}

async function readLiveArtifactTemplate(
  root: string,
  includeContent = false,
): Promise<DesignLiveArtifactTemplateRecord | null> {
  try {
    const id = path.basename(root);
    const artifactPath = path.join(root, 'artifact.json');
    const dataPath = path.join(root, 'data.json');
    const templatePath = path.join(root, 'template.html');
    const artifact = JSON.parse(
      await fs.readFile(artifactPath, 'utf-8'),
    ) as Record<string, unknown> | null;
    const readme = await readOptionalText(path.join(root, 'README.md'));
    const title =
      stringValue(artifact?.title) || titleFromMarkdown(readme ?? '', id);
    const category =
      readme
        ?.split('\n')
        .find((line) => line.toLowerCase().includes('category:'))
        ?.replace(/^>\s*/g, '')
        .replace(/^category:\s*/i, '')
        .replace(/\*\*/g, '')
        .trim() || 'Live Artifacts';
    const summary = readmeSummary(readme) || title;
    const record: DesignLiveArtifactTemplateRecord = {
      id,
      title,
      category,
      summary,
      path: root,
      previewImagePath: existsSync(path.join(root, 'preview.png'))
        ? path.join(root, 'preview.png')
        : undefined,
      files: {
        artifact: artifactPath,
        data: dataPath,
        template: templatePath,
        index: existsSync(path.join(root, 'index.html'))
          ? path.join(root, 'index.html')
          : undefined,
        provenance: existsSync(path.join(root, 'provenance.json'))
          ? path.join(root, 'provenance.json')
          : undefined,
        design: existsSync(path.join(root, 'DESIGN.md'))
          ? path.join(root, 'DESIGN.md')
          : undefined,
        readme: existsSync(path.join(root, 'README.md'))
          ? path.join(root, 'README.md')
          : undefined,
      },
    };
    if (includeContent) {
      record.readme = readme ?? undefined;
      record.designSpec =
        (await readOptionalText(path.join(root, 'DESIGN.md'))) ?? undefined;
      record.templateHtml = await fs.readFile(templatePath, 'utf-8');
      record.data = JSON.parse(await fs.readFile(dataPath, 'utf-8'));
      record.artifact = artifact;
      const provenanceRaw = await readOptionalText(
        path.join(root, 'provenance.json'),
      );
      record.provenance = provenanceRaw ? JSON.parse(provenanceRaw) : undefined;
    }
    return record;
  } catch (error) {
    logger.warn(`Failed to read live artifact template ${root}:`, error);
    return null;
  }
}

function parseOdMetadata(content: string, slug: string): DesignSkillMetadata {
  const fm = extractFrontmatter(content);
  const odBlock = extractIndentedBlock(fm, 'od');
  const warnings: string[] = [];
  const mode = readFrontmatterScalar(odBlock, 'mode');
  const rawPlatform = readFrontmatterScalar(odBlock, 'platform');
  const featuredRaw = readFrontmatterScalar(odBlock, 'featured');
  const featured = featuredRaw === undefined ? undefined : Number(featuredRaw);
  const rawSurface =
    readFrontmatterScalar(odBlock, 'surface') || mode || inferSurface(slug);
  const surface = SURFACES.has(rawSurface as DesignSurface)
    ? (rawSurface as DesignSurface)
    : 'other';
  if (mode && rawSurface && mode !== rawSurface) {
    warnings.push(`od.mode (${mode}) and od.surface (${rawSurface}) differ`);
  }
  return {
    mode,
    platform:
      rawPlatform === 'mobile' || rawPlatform === 'desktop'
        ? rawPlatform
        : undefined,
    featured: Number.isFinite(featured) ? featured : undefined,
    surface,
    scenario: readFrontmatterScalar(odBlock, 'scenario'),
    preview: {
      type: readFrontmatterScalar(
        extractIndentedBlock(odBlock, 'preview'),
        'type',
      ),
      entry: readFrontmatterScalar(
        extractIndentedBlock(odBlock, 'preview'),
        'entry',
      ),
      reload: readFrontmatterScalar(
        extractIndentedBlock(odBlock, 'preview'),
        'reload',
      ),
    },
    designSystem: {
      requires:
        readFrontmatterScalar(
          extractIndentedBlock(odBlock, 'design_system'),
          'requires',
        ) === 'true',
    },
    craft: {
      requires: readFrontmatterStringList(
        extractIndentedBlock(odBlock, 'craft'),
        'requires',
      ),
    },
    inputs: [],
    parameters: [],
    outputs: [],
    capabilitiesRequired: readFrontmatterStringList(
      odBlock,
      'capabilities_required',
    ),
    defaultFor: readFrontmatterStringList(odBlock, 'defaultFor').filter(
      (value) => SURFACES.has(value as DesignSurface),
    ) as DesignSurface[],
    examplePrompt: readFrontmatterBlockScalar(odBlock, 'example_prompt'),
    warnings,
  };
}

async function exampleCandidates(
  root: string,
  configuredEntry: string | undefined,
): Promise<string[]> {
  const candidates = [
    configuredEntry,
    'example.html',
    'index.html',
    'examples/example.html',
  ].filter((entry): entry is string => Boolean(entry));

  try {
    const examplesDir = path.join(root, 'examples');
    for (const entry of await safeReaddir(examplesDir)) {
      if (entry.isFile() && entry.name.endsWith('.html')) {
        candidates.push(path.posix.join('examples', entry.name));
      }
    }
  } catch {
    // No examples directory; the common candidates above are enough.
  }

  return [...new Set(candidates)];
}

function isWithinRoot(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return (
    Boolean(relative) &&
    !relative.startsWith('..') &&
    !path.isAbsolute(relative)
  );
}

function normalizeCatalogSourceSlug(input: string, kind: string): string {
  const slug = input.includes(':') ? input.split(':').pop()! : input;
  assertCatalogSourceSlug(slug, kind);
  return slug;
}

function resolvePackPath(root: string, slug: string): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, slug);
  if (!isWithinRoot(resolvedRoot, resolved)) {
    throw new Error('Catalog path escapes the install root');
  }
  return resolved;
}

async function installCatalogPack(
  source: string,
  dest: string,
  requiredFile: string,
  meta: Record<string, string>,
): Promise<void> {
  await assertCatalogPackSource(source, requiredFile);
  try {
    const installed = await fs.lstat(dest);
    if (installed.isSymbolicLink() || !installed.isDirectory()) {
      throw new Error('Installed catalog pack path is not a directory');
    }
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  const parent = path.dirname(dest);
  const tmp = path.join(parent, `.${path.basename(dest)}.${randomUUID()}.tmp`);
  await fs.mkdir(parent, { recursive: true });
  try {
    await fs.mkdir(tmp);
    await copyCatalogTree(source, tmp, '', { fileCount: 0, totalBytes: 0 });
    await fs.writeFile(
      path.join(tmp, 'meta.json'),
      JSON.stringify(
        { ...meta, installedAt: new Date().toISOString() },
        null,
        2,
      ),
      'utf-8',
    );
    await fs.rename(tmp, dest);
  } catch (error) {
    await fs.rm(tmp, { recursive: true, force: true });
    throw error;
  }
}

async function assertCatalogPackSource(
  source: string,
  requiredFile: string,
): Promise<void> {
  const stat = await fs.stat(source);
  if (!stat.isDirectory()) throw new Error('Catalog source is not a directory');
  const required = await fs.stat(path.join(source, requiredFile));
  if (!required.isFile()) {
    throw new Error(`Catalog source is missing ${requiredFile}`);
  }
}

async function removeInstalledPack(root: string, slug: string): Promise<void> {
  const dest = resolvePackPath(root, slug);
  try {
    await fs.lstat(dest);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  await fs.rm(dest, { recursive: true, force: true });
}

async function copyCatalogTree(
  srcRoot: string,
  destRoot: string,
  rel: string,
  counters: { fileCount: number; totalBytes: number },
): Promise<void> {
  const src = rel ? path.join(srcRoot, rel) : srcRoot;
  const entries = await fs.readdir(src, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const childRel = rel ? path.join(rel, entry.name) : entry.name;
    const dest = path.join(destRoot, childRel);
    if (entry.isDirectory()) {
      await fs.mkdir(dest, { recursive: true });
      await copyCatalogTree(srcRoot, destRoot, childRel, counters);
      continue;
    }
    if (!entry.isFile()) continue;
    const srcFile = path.join(srcRoot, childRel);
    const stat = await fs.stat(srcFile);
    if (stat.size > CATALOG_MAX_FILE_BYTES) {
      throw new Error(`Catalog file ${childRel} exceeds the per-file limit`);
    }
    counters.fileCount += 1;
    counters.totalBytes += stat.size;
    if (counters.fileCount > CATALOG_MAX_FILES) {
      throw new Error(`Catalog pack exceeds the file-count limit`);
    }
    if (counters.totalBytes > CATALOG_MAX_TOTAL_BYTES) {
      throw new Error(`Catalog pack exceeds the total-size limit`);
    }
    await fs.copyFile(srcFile, dest);
  }
}

function inferSurface(slug: string): DesignSurface | 'other' {
  if (slug.includes('image') || slug.includes('poster')) return 'image';
  if (slug.includes('video') || slug.includes('motion')) return 'video';
  if (slug.includes('audio') || slug.includes('jingle')) return 'audio';
  if (slug.includes('deck') || slug.includes('ppt')) return 'deck';
  if (slug.includes('prototype') || slug.includes('web')) return 'prototype';
  if (slug.includes('template')) return 'template';
  if (slug.includes('blog') || slug.includes('doc')) return 'document';
  return 'other';
}

async function readOptionalText(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, 'utf-8');
  } catch (error) {
    if (isMissingOptionalFile(error)) {
      return null;
    }
    throw error;
  }
}

function isMissingOptionalFile(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

async function readOptionalJson(
  file: string,
): Promise<Record<string, unknown> | null> {
  const body = await readOptionalText(file);
  if (!body) return null;
  try {
    return JSON.parse(body) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function readCatalogMeta(file: string): Promise<Record<string, unknown>> {
  return (await readOptionalJson(file)) ?? {};
}

function readmeSummary(readme: string | null): string | undefined {
  if (!readme) return undefined;
  return readme
    .split('\n')
    .map((line) => line.trim())
    .find(
      (line) =>
        line &&
        !line.startsWith('#') &&
        !line.startsWith('>') &&
        !line.startsWith('```'),
    );
}

function titleFromMarkdown(body: string, fallback: string): string {
  return (
    body
      .split('\n')
      .find((line) => line.startsWith('# '))
      ?.replace(/^#\s+/, '')
      .trim() || fallback
  );
}

function parseAspect(value: string | undefined): MediaAspect | undefined {
  return value && (mediaAspects as readonly string[]).includes(value)
    ? (value as MediaAspect)
    : undefined;
}

function normalizeSource(source: Record<string, unknown>) {
  return {
    repo: stringValue(source.repo) || 'unknown',
    license: stringValue(source.license) || 'unknown',
    author: stringValue(source.author),
    url: stringValue(source.url),
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function safeReaddir(dir: string): Promise<import('node:fs').Dirent[]> {
  if (!existsSync(dir)) return [];
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}
