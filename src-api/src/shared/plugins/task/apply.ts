import fs from 'node:fs/promises';

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

const TASK_PLUGIN_MAX_SKILLS = 3;

const TaskPluginManifestSchema = z.object({
  specVersion: z.string().min(1).max(50).optional(),
  name: z.string().min(1).max(120).optional(),
  title: z.string().min(1).max(200).optional(),
  description: z.string().min(1).max(1000).optional(),
  promptGuide: z.string().min(1).max(20_000).optional(),
  systemPrompt: z.string().min(1).max(20_000).optional(),
  instructions: z.string().min(1).max(20_000).optional(),
  skills: z.array(z.string().min(1).max(120)).max(3).optional(),
  capabilities: z
    .array(z.string().regex(/^[a-z][a-z0-9-]*:[a-z0-9_.-]+$/))
    .max(30)
    .optional(),
  pipeline: z
    .object({
      stages: z
        .array(
          z.object({
            id: z.string().min(1).max(80),
            title: z.string().min(1).max(160).optional(),
            instructions: z.string().min(1).max(2000).optional(),
            skills: z.array(z.string().min(1).max(120)).max(3).optional(),
          }),
        )
        .max(20),
    })
    .optional(),
});

export type TaskPluginManifest = z.infer<typeof TaskPluginManifestSchema>;

export interface TaskPluginSnapshotPayload {
  title: string;
  description: string;
  promptGuide: string;
  skills: Array<{
    name: string;
    bareName: string;
    body: string;
  }>;
  grants: CapabilityGrant[];
  deniedCapabilities: Capability[];
  pipeline?: TaskPluginManifest['pipeline'];
}

export interface AppliedTaskPlugin {
  pluginId: string;
  snapshot: AppliedSnapshot<TaskPluginSnapshotPayload>;
  systemContext: string;
  pinnedSkills: string[];
  config: PluginRuntimeConfig;
}

export interface ApplyTaskPluginOptions {
  inputs?: Record<string, unknown>;
  createdAt?: string;
}

export async function applyTaskPlugin(
  pluginId: string,
  options: ApplyTaskPluginOptions = {},
): Promise<AppliedTaskPlugin> {
  const installed = getInstalledPlugin(pluginId);
  if (!installed) throw new Error(`Plugin not found: ${pluginId}`);
  if (!installed.enabled) throw new Error(`Plugin is disabled: ${pluginId}`);

  const manifest = parseInstalledManifest(installed.manifest);
  const taskManifest = await readTaskManifest(
    installed.installPath,
    manifest.metadata?.neuma?.taskManifest,
  );
  const skills = await loadPluginLocalSkills(installed.installPath, manifest);
  const selectedSkills = selectTaskSkills(skills, taskManifest);
  const requestedCapabilities = requestedTaskCapabilities(taskManifest);
  const trust = getPluginTrustState({
    trustTier: installed.trustTier ?? 'local',
    manifest,
    lastReviewedDigest: installed.lastReviewedDigest,
    signatureOk: installed.signatureOk,
  });
  const grants = computeCapabilityGrants({
    requested: requestedCapabilities,
    trustTier: trust.trustTier,
    manifestDigest: trust.manifestDigest,
    lastReviewedDigest: trust.lastReviewedDigest,
    signatureOk: installed.signatureOk,
  });
  const deniedCapabilities = grants.flatMap((grant) =>
    grant.granted ? [] : [grant.capability],
  );
  const config = resolveInstalledPluginRuntimeConfig(pluginId, manifest);
  const promptGuide = buildPromptGuide(manifest, taskManifest);
  const payload: TaskPluginSnapshotPayload = {
    title: taskManifest?.title ?? manifest.displayName ?? manifest.name,
    description: taskManifest?.description ?? manifest.description,
    promptGuide,
    skills: selectedSkills.map((skill) => ({
      name: skill.name,
      bareName: skill.bareName,
      body: skill.body ?? skill.content,
    })),
    grants,
    deniedCapabilities,
    ...(taskManifest?.pipeline ? { pipeline: taskManifest.pipeline } : {}),
  };
  const snapshot = createAppliedSnapshot({
    domain: 'task',
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
    systemContext: buildTaskPluginSystemContext(snapshot, config, options),
    pinnedSkills: selectedSkills.map((skill) => skill.name),
    config,
  };
}

function parseInstalledManifest(value: unknown): PluginManifest {
  const parsed = PluginManifestSchema.safeParse(value);
  if (!parsed.success) throw new Error('Installed plugin manifest is invalid');
  return parsed.data;
}

async function readTaskManifest(
  pluginRoot: string,
  pointer: string | undefined,
): Promise<TaskPluginManifest | null> {
  if (!pointer) return null;
  const manifestPath = resolveContainedPath(pluginRoot, pointer);
  if (!manifestPath) {
    throw new Error('metadata.neuma.taskManifest must stay within the plugin');
  }
  const raw = await fs.readFile(manifestPath, 'utf-8');
  const parsed = TaskPluginManifestSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new Error(
      `Invalid task manifest: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
        .join('; ')}`,
    );
  }
  return parsed.data;
}

function selectTaskSkills(
  skills: readonly LoadedSkill[],
  manifest: TaskPluginManifest | null,
): LoadedSkill[] {
  const requested = [
    ...(manifest?.skills ?? []),
    ...(manifest?.pipeline?.stages.flatMap((stage) => stage.skills ?? []) ??
      []),
  ];
  if (requested.length === 0) return skills.slice(0, TASK_PLUGIN_MAX_SKILLS);

  const selected: LoadedSkill[] = [];
  for (const name of requested) {
    const skill = findLocalSkill(skills, name);
    if (skill && !selected.some((entry) => entry.name === skill.name)) {
      selected.push(skill);
    }
    if (selected.length >= TASK_PLUGIN_MAX_SKILLS) break;
  }
  return selected;
}

function requestedTaskCapabilities(
  manifest: TaskPluginManifest | null,
): Capability[] {
  return ['prompt:inject', ...((manifest?.capabilities ?? []) as Capability[])];
}

function buildPromptGuide(
  manifest: PluginManifest,
  taskManifest: TaskPluginManifest | null,
): string {
  const guide =
    taskManifest?.promptGuide ??
    taskManifest?.systemPrompt ??
    taskManifest?.instructions;
  const pipeline = taskManifest?.pipeline?.stages
    .map((stage, index) =>
      [`${index + 1}. ${stage.title ?? stage.id}`, stage.instructions]
        .filter(Boolean)
        .join(' — '),
    )
    .join('\n');

  return [
    guide ?? manifest.description,
    pipeline ? `Pipeline stages:\n${pipeline}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

function buildTaskPluginSystemContext(
  snapshot: AppliedSnapshot<TaskPluginSnapshotPayload>,
  config: PluginRuntimeConfig,
  options: ApplyTaskPluginOptions,
): string {
  return [
    `## Active Task Plugin: ${snapshot.payload.title}`,
    `Plugin: ${snapshot.plugin.id}@${snapshot.plugin.version}`,
    snapshot.payload.promptGuide,
    formatTaskPluginConfig(config),
    formatTaskPluginInputs(options.inputs),
    snapshot.payload.skills.length > 0
      ? [
          'Plugin-local skills:',
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

function formatTaskPluginConfig(config: PluginRuntimeConfig): string {
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

function formatTaskPluginInputs(
  inputs: Record<string, unknown> | undefined,
): string {
  if (!inputs || Object.keys(inputs).length === 0) return '';
  return `Plugin inputs:\n${JSON.stringify(inputs, null, 2)}`;
}
