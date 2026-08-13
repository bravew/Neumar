import fs from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import { getInstalledPlugin } from '@/shared/db/plugins';
import {
  escapeXml,
  findLocalSkill,
  loadPluginLocalSkills,
  resolveContainedPath,
} from '@/shared/plugins/apply-utils';
import type { LoadedSkill } from '@/shared/plugins/loader';
import {
  PluginManifestSchema,
  type PluginManifest,
} from '@/shared/plugins/manifest';
import {
  computeCapabilityGrants,
  createAppliedSnapshot,
  getPluginTrustState,
  resolveInstalledPluginRuntimeConfig,
  toAppliedSnapshotConfig,
  type AppliedSnapshot,
  type Capability,
  type CapabilityGrant,
  type PluginRuntimeConfig,
} from '@/shared/plugins/runtime';

const DESIGN_PLUGIN_MAX_SKILLS = 5;
const DESIGN_PLUGIN_MAX_SYSTEMS = 50;

const DesignPluginManifestSchema = z.object({
  specVersion: z.string().min(1).max(50).optional(),
  title: z.string().min(1).max(200).optional(),
  description: z.string().min(1).max(1000).optional(),
  promptGuide: z.string().min(1).max(20_000).optional(),
  systemPrompt: z.string().min(1).max(20_000).optional(),
  instructions: z.string().min(1).max(20_000).optional(),
  skills: z.array(z.string().min(1).max(120)).max(5).optional(),
  capabilities: z
    .array(z.string().regex(/^[a-z][a-z0-9-]*:[a-z0-9_.-]+$/))
    .max(30)
    .optional(),
  designSystems: z
    .array(
      z.object({
        id: z.string().min(1).max(100),
        path: z.string().min(1).max(300),
      }),
    )
    .max(DESIGN_PLUGIN_MAX_SYSTEMS)
    .optional(),
});

export type DesignPluginManifest = z.infer<typeof DesignPluginManifestSchema>;

export interface DesignPluginSnapshotPayload {
  title: string;
  description: string;
  promptGuide: string;
  designSystems: Array<{
    id: string;
    path: string;
    title: string;
    body: string;
    tokenCss?: string;
    componentsHtml?: string;
  }>;
  skills: Array<{
    name: string;
    bareName: string;
    body: string;
  }>;
  grants: CapabilityGrant[];
  deniedCapabilities: Capability[];
}

export interface AppliedDesignPlugin {
  pluginId: string;
  snapshot: AppliedSnapshot<DesignPluginSnapshotPayload>;
  systemContext: string;
  pinnedSkills: string[];
  config: PluginRuntimeConfig;
}

export interface ApplyDesignPluginOptions {
  inputs?: Record<string, unknown>;
  approvedCapabilities?: readonly string[];
  lastReviewedDigest?: string | null;
  signatureOk?: boolean | null;
  createdAt?: string;
}

export async function applyDesignPlugin(
  pluginId: string,
  options: ApplyDesignPluginOptions = {},
): Promise<AppliedDesignPlugin> {
  const installed = getInstalledPlugin(pluginId);
  if (!installed) throw new Error(`Plugin not found: ${pluginId}`);
  if (!installed.enabled) throw new Error(`Plugin is disabled: ${pluginId}`);

  const manifest = parseInstalledManifest(installed.manifest);
  const designManifest = await readDesignPluginManifest(
    installed.installPath,
    manifest.metadata?.neuma?.designManifest,
  );
  const skills = await loadPluginLocalSkills(installed.installPath, manifest);
  const selectedSkills = selectDesignSkills(skills, designManifest);
  const systems = await loadDesignSystems(
    installed.installPath,
    designManifest,
  );
  const requestedCapabilities = requestedDesignCapabilities(designManifest);
  const trust = getPluginTrustState({
    trustTier: installed.trustTier ?? 'local',
    manifest,
    lastReviewedDigest: options.lastReviewedDigest,
    signatureOk: options.signatureOk ?? installed.signatureOk,
  });
  const grants = computeCapabilityGrants({
    requested: requestedCapabilities,
    trustTier: trust.trustTier,
    manifestDigest: trust.manifestDigest,
    lastReviewedDigest: options.lastReviewedDigest ?? trust.lastReviewedDigest,
    signatureOk: options.signatureOk ?? installed.signatureOk,
    approvedCapabilities: options.approvedCapabilities as Capability[],
  });
  const deniedCapabilities = grants.flatMap((grant) =>
    grant.granted ? [] : [grant.capability],
  );
  const config = resolveInstalledPluginRuntimeConfig(pluginId, manifest);
  const promptGuide = buildPromptGuide(manifest, designManifest);
  const payload: DesignPluginSnapshotPayload = {
    title: designManifest?.title ?? manifest.displayName ?? manifest.name,
    description: designManifest?.description ?? manifest.description,
    promptGuide,
    designSystems: systems,
    skills: selectedSkills.map((skill) => ({
      name: skill.name,
      bareName: skill.bareName,
      body: skill.body ?? skill.content,
    })),
    grants,
    deniedCapabilities,
  };
  const snapshot = createAppliedSnapshot({
    domain: 'design',
    plugin: {
      id: pluginId,
      name: manifest.name,
      version: manifest.version,
      source: installed.scope,
      trustTier: trust.trustTier,
      manifestDigest: trust.manifestDigest,
    },
    capabilities: grants
      .filter((grant) => grant.granted)
      .map((grant) => grant.capability),
    config: toAppliedSnapshotConfig(config),
    payload,
    createdAt: options.createdAt,
  });

  return {
    pluginId,
    snapshot,
    systemContext: buildDesignPluginSystemContext(snapshot, config, options),
    pinnedSkills: selectedSkills.map((skill) => skill.name),
    config,
  };
}

function parseInstalledManifest(value: unknown): PluginManifest {
  const parsed = PluginManifestSchema.safeParse(value);
  if (!parsed.success) throw new Error('Installed plugin manifest is invalid');
  return parsed.data;
}

async function readDesignPluginManifest(
  pluginRoot: string,
  pointer: string | undefined,
): Promise<DesignPluginManifest | null> {
  if (!pointer) return null;
  const manifestPath = resolveContainedPath(pluginRoot, pointer);
  if (!manifestPath) {
    throw new Error(
      'metadata.neuma.designManifest must stay within the plugin',
    );
  }
  const raw = await fs.readFile(manifestPath, 'utf-8');
  const parsed = DesignPluginManifestSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new Error(
      `Invalid design manifest: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
        .join('; ')}`,
    );
  }
  return parsed.data;
}

function selectDesignSkills(
  skills: readonly LoadedSkill[],
  manifest: DesignPluginManifest | null,
): LoadedSkill[] {
  const requested = manifest?.skills ?? [];
  if (requested.length === 0) return skills.slice(0, DESIGN_PLUGIN_MAX_SKILLS);

  const selected: LoadedSkill[] = [];
  for (const name of requested) {
    const skill = findLocalSkill(skills, name);
    if (skill && !selected.some((entry) => entry.name === skill.name)) {
      selected.push(skill);
    }
    if (selected.length >= DESIGN_PLUGIN_MAX_SKILLS) break;
  }
  return selected;
}

async function loadDesignSystems(
  pluginRoot: string,
  manifest: DesignPluginManifest | null,
): Promise<DesignPluginSnapshotPayload['designSystems']> {
  const systems = new Map<
    string,
    DesignPluginSnapshotPayload['designSystems'][number]
  >();
  const explicit = await Promise.all(
    (manifest?.designSystems ?? []).map((system) =>
      readDesignSystem(pluginRoot, system.id, system.path),
    ),
  );
  for (const system of explicit) {
    if (system) systems.set(system.id, system);
  }

  const conventionRoot = resolveContainedPath(pluginRoot, 'design-systems');
  if (!conventionRoot) return [...systems.values()];
  const entries = await fs
    .readdir(conventionRoot, { withFileTypes: true })
    .catch(() => []);
  const convention = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .slice(0, DESIGN_PLUGIN_MAX_SYSTEMS)
      .map((entry) =>
        readDesignSystem(
          pluginRoot,
          entry.name,
          path.join('design-systems', entry.name),
        ),
      ),
  );
  for (const system of convention) {
    if (system) systems.set(system.id, system);
  }
  return [...systems.values()];
}

async function readDesignSystem(
  pluginRoot: string,
  id: string,
  relativePath: string,
): Promise<DesignPluginSnapshotPayload['designSystems'][number] | null> {
  const root = resolveDesignSystemRoot(pluginRoot, relativePath);
  if (!root) return null;
  const body = await readOptionalText(path.join(root, 'DESIGN.md'));
  if (!body) return null;
  return {
    id,
    path: relativePath,
    title: titleFromMarkdown(body, id),
    body,
    tokenCss:
      (await readOptionalText(path.join(root, 'tokens.css'))) ?? undefined,
    componentsHtml:
      (await readOptionalText(path.join(root, 'components.html'))) ?? undefined,
  };
}

function resolveDesignSystemRoot(
  pluginRoot: string,
  relativePath: string,
): string | null {
  const resolved = resolveContainedPath(pluginRoot, relativePath);
  if (!resolved) return null;
  return path.basename(resolved).toLowerCase() === 'design.md'
    ? path.dirname(resolved)
    : resolved;
}

function requestedDesignCapabilities(
  manifest: DesignPluginManifest | null,
): Capability[] {
  return ['prompt:inject', ...((manifest?.capabilities ?? []) as Capability[])];
}

function buildPromptGuide(
  manifest: PluginManifest,
  designManifest: DesignPluginManifest | null,
): string {
  return (
    designManifest?.promptGuide ??
    designManifest?.systemPrompt ??
    designManifest?.instructions ??
    manifest.description
  );
}

function buildDesignPluginSystemContext(
  snapshot: AppliedSnapshot<DesignPluginSnapshotPayload>,
  config: PluginRuntimeConfig,
  options: ApplyDesignPluginOptions,
): string {
  return [
    `## Active Design Plugin: ${snapshot.payload.title}`,
    `Plugin: ${snapshot.plugin.id}@${snapshot.plugin.version}`,
    snapshot.payload.promptGuide,
    formatDesignSystems(snapshot.payload.designSystems),
    formatDesignPluginConfig(config),
    formatDesignPluginInputs(options.inputs),
    snapshot.payload.skills.length > 0
      ? [
          'Plugin-local design skills:',
          ...snapshot.payload.skills.map(
            (skill) =>
              `<plugin-skill name="${escapeXml(skill.name)}">\n${escapeXml(skill.body)}\n</plugin-skill>`,
          ),
        ].join('\n\n')
      : '',
    snapshot.payload.deniedCapabilities.length > 0
      ? `Denied plugin capabilities: ${snapshot.payload.deniedCapabilities.join(', ')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

function formatDesignSystems(
  systems: DesignPluginSnapshotPayload['designSystems'],
): string {
  if (systems.length === 0) return '';
  return [
    'Plugin design systems:',
    ...systems.map((system) =>
      [
        `### ${system.id}: ${system.title}`,
        system.body,
        system.tokenCss
          ? `tokens.css:\n\`\`\`css\n${system.tokenCss}\n\`\`\``
          : '',
      ]
        .filter(Boolean)
        .join('\n'),
    ),
  ].join('\n\n');
}

function formatDesignPluginConfig(config: PluginRuntimeConfig): string {
  if (config.keys.length === 0) return '';
  return [
    'Plugin configuration:',
    JSON.stringify(
      {
        publicValues: config.publicValues,
        sensitiveKeys: config.sensitiveKeys,
      },
      null,
      2,
    ),
    'Sensitive configuration values are available only to backend tools and are not shown here.',
  ].join('\n');
}

function formatDesignPluginInputs(
  inputs: Record<string, unknown> | undefined,
): string {
  if (!inputs || Object.keys(inputs).length === 0) return '';
  return `Plugin inputs:\n${JSON.stringify(inputs, null, 2)}`;
}

async function readOptionalText(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, 'utf-8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return null;
    throw error;
  }
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
