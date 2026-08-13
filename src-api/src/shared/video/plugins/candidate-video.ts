import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { getDatabase } from '@/shared/db';
import {
  getInstalledPlugin,
  type InstalledPlugin,
  upsertInstalledPlugin,
} from '@/shared/db/plugins';
import type { PluginManifest, PluginScope } from '@/shared/plugins';
import { PLUGIN_NAME_RE, parseManifest } from '@/shared/plugins';
import {
  computeManifestDigest,
  createPluginCandidate,
  type AppliedSnapshot,
  type PluginCandidate,
  type PluginCandidateStatus,
} from '@/shared/plugins/runtime';
import {
  createPlugin,
  type CreatePluginResult,
} from '@/shared/plugins/scaffold';
import { createLogger } from '@/shared/utils/logger';
import { pathExists } from '@/shared/utils/paths';
import { listVideoIntentLog } from '@/shared/video/recipes';

import {
  defaultProjectPluginRoot,
  getDefaultUserPluginRoot,
  loadVideoPlugins,
} from './loader';
import {
  VIDEO_PLUGIN_CAPABILITIES,
  requiredCapabilitiesForAtoms,
  type VideoPluginCapability,
  type VideoPluginSnapshotPayload,
  type VideoPluginStage,
} from './types';
import { parseVideoPluginManifest, type VideoPluginManifest } from './validate';

const logger = createLogger('VideoPluginCandidate');
const VIDEO_PLUGIN_CANDIDATE_CONFIDENCE = 0.82;

export type VideoPluginCandidate =
  PluginCandidate<VideoPluginSnapshotPayload> & {
    pluginId?: string;
    savedPluginId?: string;
  };

export interface SaveVideoPluginCandidateInput {
  title?: string;
  description?: string;
  tags?: string[];
  scope?: Extract<PluginScope, 'project' | 'user'>;
}

export interface SaveVideoPluginCandidateResult {
  candidate: VideoPluginCandidate;
  plugin: InstalledPlugin;
  pluginDir: string;
  manifestPath: string;
  videoManifestPath: string;
}

export interface VideoPluginExportBundle {
  format: 'neuma.video-plugin.bundle.v1';
  exportedAt: string;
  genericManifest: unknown;
  videoManifest: unknown;
}

interface VideoPluginCandidateRow {
  id: string;
  plugin_id: string | null;
  source_plugin_id?: string | null;
  project_id: string;
  session_id: string | null;
  title: string;
  description: string;
  confidence: number;
  status: PluginCandidateStatus;
  applied_snapshot_json: string;
  manifest_digest: string | null;
  draft_manifest_path: string | null;
  saved_plugin_id: string | null;
  created_at: string;
  updated_at: string;
}

const NON_TRIVIAL_ATOMS = new Set([
  'research-search',
  'broll-stock',
  'ai-image',
  'ai-clip',
  'music-select',
  'tts-narration',
  'reference-analyze',
  'reference-vision',
]);
const VIDEO_PLUGIN_CAPABILITY_SET = new Set<string>(VIDEO_PLUGIN_CAPABILITIES);

export async function detectVideoPluginCandidateAfterRender(
  projectId: string,
): Promise<VideoPluginCandidate | null> {
  const snapshotEntry = [...listVideoIntentLog(projectId, { limit: 50 })]
    .reverse()
    .find((entry) => entry.appliedPluginSnapshot);
  const snapshot = snapshotEntry?.appliedPluginSnapshot;
  if (!snapshot || !isQualifyingSnapshot(snapshot)) return null;

  const existing = findExistingCandidate(projectId, snapshot);
  if (existing) return existing;

  const candidate = createPluginCandidate<VideoPluginSnapshotPayload>({
    domain: 'video',
    projectId,
    title: titleFromSnapshot(snapshot),
    description: descriptionFromSnapshot(snapshotEntry.userIntentText),
    confidence: VIDEO_PLUGIN_CANDIDATE_CONFIDENCE,
    appliedSnapshot: snapshot,
    manifestDigest: snapshot.plugin.manifestDigest,
  });
  return insertVideoPluginCandidate(candidate, snapshot.plugin.id);
}

export function listVideoPluginCandidates(
  projectId: string,
  status?: PluginCandidateStatus,
): VideoPluginCandidate[] {
  const db = getDatabase();
  const rows = status
    ? (db
        .prepare(
          `SELECT * FROM video_plugin_candidates
           WHERE project_id = ? AND status = ?
           ORDER BY updated_at DESC`,
        )
        .all(projectId, status) as VideoPluginCandidateRow[])
    : (db
        .prepare(
          `SELECT * FROM video_plugin_candidates
           WHERE project_id = ?
           ORDER BY updated_at DESC`,
        )
        .all(projectId) as VideoPluginCandidateRow[]);
  return rows.map(candidateFromRow).filter(isVideoPluginCandidate);
}

export function getVideoPluginCandidate(
  candidateId: string,
): VideoPluginCandidate | null {
  const row = getDatabase()
    .prepare('SELECT * FROM video_plugin_candidates WHERE id = ?')
    .get(candidateId) as VideoPluginCandidateRow | undefined;
  return row ? candidateFromRow(row) : null;
}

export function dismissVideoPluginCandidate(
  candidateId: string,
): VideoPluginCandidate {
  const candidate = getVideoPluginCandidate(candidateId);
  if (!candidate)
    throw new Error(`Video plugin candidate not found: ${candidateId}`);
  return updateVideoPluginCandidateStatus(candidate, 'dismissed');
}

export async function saveVideoPluginCandidate(
  candidateId: string,
  input: SaveVideoPluginCandidateInput = {},
): Promise<SaveVideoPluginCandidateResult> {
  const candidate = getVideoPluginCandidate(candidateId);
  if (!candidate)
    throw new Error(`Video plugin candidate not found: ${candidateId}`);
  if (candidate.status === 'saved' && candidate.savedPluginId) {
    throw new Error('Video plugin candidate has already been saved');
  }

  const title =
    sanitizeText(input.title ?? candidate.title, 200) || 'Saved Video Flow';
  const description =
    sanitizeText(input.description ?? candidate.description, 1000) ||
    'Saved from a successful video render.';
  const scope = input.scope ?? 'project';
  const pluginRoot =
    scope === 'user' ? getDefaultUserPluginRoot() : defaultProjectPluginRoot();
  const name = await uniquePluginName(pluginRoot, slugifyPluginName(title));
  const genericManifest = buildGenericManifest(name, description);
  const videoManifest = buildVideoManifest({
    name,
    title,
    description,
    tags: input.tags ?? [],
    snapshot: candidate.appliedSnapshot,
  });
  assertValidSavedManifests(genericManifest, videoManifest, name);

  const scaffold = await createPlugin({
    name,
    dir: pluginRoot,
    template: 'basic',
    description,
  });
  await writeSavedPluginFiles(
    scaffold,
    genericManifest,
    videoManifest,
    candidate,
  );

  const manifestDigest = computeManifestDigest(videoManifest);
  const pluginId = pluginIdFromScope(scope, name);
  const plugin = upsertInstalledPlugin({
    id: pluginId,
    name,
    version: genericManifest.version,
    source: 'local',
    sourceRef: scaffold.pluginDir,
    installPath: scaffold.pluginDir,
    scope,
    enabled: true,
    manifest: genericManifest,
    sha256: digestPluginBundle(genericManifest, videoManifest),
    signatureOk: null,
    trustTier: 'saved',
    manifestDigest,
    lastReviewedDigest: manifestDigest,
  });
  const saved = markVideoPluginCandidateSaved(candidate.id, {
    savedPluginId: plugin.id,
    draftManifestPath: path.join(scaffold.pluginDir, 'video-plugin.json'),
  });
  await loadVideoPlugins({ watch: false });

  return {
    candidate: saved,
    plugin,
    pluginDir: scaffold.pluginDir,
    manifestPath: scaffold.manifestPath,
    videoManifestPath: path.join(scaffold.pluginDir, 'video-plugin.json'),
  };
}

export async function exportVideoPluginBundle(
  pluginId: string,
): Promise<VideoPluginExportBundle> {
  const { plugins } = await loadVideoPlugins({ watch: false });
  const plugin = plugins.find((candidate) => candidate.id === pluginId);
  if (!plugin) throw new Error(`Video plugin not found: ${pluginId}`);
  const genericManifest = await readGenericManifest(plugin.rootDir);
  return {
    format: 'neuma.video-plugin.bundle.v1',
    exportedAt: new Date().toISOString(),
    genericManifest,
    videoManifest: plugin.manifest,
  };
}

export async function importVideoPluginBundle(
  bundle: VideoPluginExportBundle,
  options: { scope?: Extract<PluginScope, 'project' | 'user'> } = {},
): Promise<InstalledPlugin> {
  if (bundle.format !== 'neuma.video-plugin.bundle.v1') {
    throw new Error('Unsupported video plugin bundle format');
  }
  const genericParsed = parseManifest(JSON.stringify(bundle.genericManifest));
  if (!genericParsed.ok || !genericParsed.manifest) {
    throw new Error(
      `Invalid plugin manifest: ${genericParsed.issues.join('; ')}`,
    );
  }
  const videoParsed = parseVideoPluginManifest(
    JSON.stringify(bundle.videoManifest),
    {
      genericManifest: genericParsed.manifest,
      folderName: genericParsed.manifest.name,
      validateEngineTemplate: false,
    },
  );
  if (!videoParsed.ok || !videoParsed.manifest) {
    throw new Error(
      `Invalid video plugin manifest: ${videoParsed.issues
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join('; ')}`,
    );
  }

  const scope = options.scope ?? 'project';
  const pluginRoot =
    scope === 'user' ? getDefaultUserPluginRoot() : defaultProjectPluginRoot();
  const name = await uniquePluginName(pluginRoot, genericParsed.manifest.name);
  const genericManifest =
    name === genericParsed.manifest.name
      ? genericParsed.manifest
      : renameGenericManifest(genericParsed.manifest, name);
  const videoManifest =
    name === videoParsed.manifest.name
      ? videoParsed.manifest
      : renameVideoManifest(videoParsed.manifest, name);
  assertValidSavedManifests(genericManifest, videoManifest, name);

  const pluginDir = path.join(pluginRoot, name);
  if (await pathExists(pluginDir)) {
    throw new Error(`Refusing to overwrite existing directory: ${pluginDir}`);
  }
  await fs.mkdir(path.join(pluginDir, '.claude-plugin'), { recursive: true });
  await fs.writeFile(
    path.join(pluginDir, '.claude-plugin', 'plugin.json'),
    JSON.stringify(genericManifest, null, 2) + '\n',
    'utf-8',
  );
  await fs.writeFile(
    path.join(pluginDir, 'video-plugin.json'),
    JSON.stringify(videoManifest, null, 2) + '\n',
    'utf-8',
  );

  const manifestDigest = computeManifestDigest(videoManifest);
  const installed = upsertInstalledPlugin({
    id: pluginIdFromScope(scope, name),
    name,
    version: genericManifest.version,
    source: 'local',
    sourceRef: null,
    installPath: pluginDir,
    scope,
    enabled: true,
    manifest: genericManifest,
    sha256: digestPluginBundle(genericManifest, videoManifest),
    signatureOk: null,
    trustTier: 'imported',
    manifestDigest,
    lastReviewedDigest: null,
  });
  await loadVideoPlugins({ watch: false });
  return installed;
}

function insertVideoPluginCandidate(
  candidate: PluginCandidate<VideoPluginSnapshotPayload>,
  pluginId: string,
): VideoPluginCandidate {
  const installedPluginId = getInstalledPlugin(pluginId)?.id ?? null;
  getDatabase()
    .prepare(
      `INSERT INTO video_plugin_candidates (
        id, plugin_id, source_plugin_id, project_id, session_id, title, description, confidence,
        status, applied_snapshot_json, manifest_digest, draft_manifest_path,
        saved_plugin_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      candidate.id,
      installedPluginId,
      pluginId,
      candidate.projectId,
      candidate.sessionId ?? null,
      candidate.title,
      candidate.description,
      candidate.confidence,
      candidate.status,
      JSON.stringify(candidate.appliedSnapshot),
      candidate.manifestDigest ?? null,
      candidate.draftManifestPath ?? null,
      null,
      candidate.createdAt,
      candidate.updatedAt,
    );
  logger.info('video.plugin_candidate.detected', {
    project_id: candidate.projectId,
    candidate_id: candidate.id,
    plugin_id: pluginId,
  });
  return { ...candidate, pluginId };
}

function findExistingCandidate(
  projectId: string,
  snapshot: AppliedSnapshot<VideoPluginSnapshotPayload>,
): VideoPluginCandidate | null {
  const row = getDatabase()
    .prepare(
      `SELECT * FROM video_plugin_candidates
       WHERE project_id = ?
         AND manifest_digest = ?
         AND status IN ('active', 'saved', 'dismissed')
       ORDER BY updated_at DESC
       LIMIT 1`,
    )
    .get(projectId, snapshot.plugin.manifestDigest) as
    | VideoPluginCandidateRow
    | undefined;
  return row ? candidateFromRow(row) : null;
}

function updateVideoPluginCandidateStatus(
  candidate: VideoPluginCandidate,
  status: PluginCandidateStatus,
): VideoPluginCandidate {
  const updatedAt = new Date().toISOString();
  getDatabase()
    .prepare(
      `UPDATE video_plugin_candidates
       SET status = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(status, updatedAt, candidate.id);
  return { ...candidate, status, updatedAt };
}

function markVideoPluginCandidateSaved(
  candidateId: string,
  input: {
    savedPluginId: string;
    draftManifestPath: string;
  },
): VideoPluginCandidate {
  const updatedAt = new Date().toISOString();
  getDatabase()
    .prepare(
      `UPDATE video_plugin_candidates
       SET status = 'saved',
           saved_plugin_id = ?,
           draft_manifest_path = ?,
           updated_at = ?
       WHERE id = ?`,
    )
    .run(input.savedPluginId, input.draftManifestPath, updatedAt, candidateId);
  const saved = getVideoPluginCandidate(candidateId);
  if (!saved)
    throw new Error(`Video plugin candidate not found: ${candidateId}`);
  return saved;
}

function candidateFromRow(
  row: VideoPluginCandidateRow,
): VideoPluginCandidate | null {
  let appliedSnapshot: AppliedSnapshot<VideoPluginSnapshotPayload>;
  try {
    appliedSnapshot = JSON.parse(
      row.applied_snapshot_json,
    ) as AppliedSnapshot<VideoPluginSnapshotPayload>;
  } catch (error) {
    logger.warn('video.plugin_candidate.snapshot_parse_failed', {
      candidate_id: row.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
  return {
    id: row.id,
    domain: 'video',
    pluginId: row.source_plugin_id ?? row.plugin_id ?? undefined,
    projectId: row.project_id,
    sessionId: row.session_id ?? undefined,
    title: row.title,
    description: row.description,
    confidence: row.confidence,
    status: row.status,
    appliedSnapshot,
    manifestDigest: row.manifest_digest ?? undefined,
    draftManifestPath: row.draft_manifest_path ?? undefined,
    savedPluginId: row.saved_plugin_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function isVideoPluginCandidate(
  candidate: VideoPluginCandidate | null,
): candidate is VideoPluginCandidate {
  return candidate !== null;
}

function isQualifyingSnapshot(
  snapshot: AppliedSnapshot<VideoPluginSnapshotPayload>,
): boolean {
  return snapshot.payload.stages.some((stage) =>
    stage.atoms.some((atom) => NON_TRIVIAL_ATOMS.has(atom)),
  );
}

function titleFromSnapshot(
  snapshot: AppliedSnapshot<VideoPluginSnapshotPayload>,
): string {
  const name = snapshot.plugin.name || snapshot.plugin.id;
  return `${humanizePluginName(name)} Flow`;
}

function descriptionFromSnapshot(prompt: string): string {
  return (
    sanitizeText(
      prompt.replace(/^@plugin:[^\n]+\n+/i, '').trim() ||
        'Saved from a successful video render.',
      1000,
    ) || 'Saved from a successful video render.'
  );
}

function buildGenericManifest(
  name: string,
  description: string,
): PluginManifest {
  return {
    name,
    version: '0.1.0',
    description,
    skills: 'skills',
    metadata: {
      neuma: {
        surfaces: ['video'],
        videoManifest: 'video-plugin.json',
      },
    },
  } as PluginManifest;
}

function buildVideoManifest(input: {
  name: string;
  title: string;
  description: string;
  tags: string[];
  snapshot: AppliedSnapshot<VideoPluginSnapshotPayload>;
}): VideoPluginManifest {
  const stages = input.snapshot.payload.stages.map(stageForManifest);
  const capabilities = capabilitiesForSnapshot(input.snapshot, stages);
  return {
    specVersion: '1.0.0',
    name: input.name,
    title: input.title,
    version: '0.1.0',
    compatibility: {
      neuma: '>=26.6.15 <27.0.0',
      videoPluginApi: '^1.0.0',
    },
    description: input.description,
    tags: input.tags.slice(0, 20),
    video: {
      kind: 'flow',
      mode: 'custom',
      aspectRatios: ['16:9', '9:16', '1:1', '4:5'],
      engine: input.snapshot.payload.engine,
      ...(input.snapshot.payload.templates.length > 0
        ? { templates: input.snapshot.payload.templates }
        : {}),
      useCase: {
        query: useCaseQueryForSnapshot(input.snapshot, input.title),
        goals: [input.title],
      },
      pipeline: {
        stages,
      },
      output: {
        preset: 'saved-flow',
      },
      capabilities,
      networkAccess: networkAccessForSnapshot(input.snapshot, capabilities),
    },
  };
}

function stageForManifest(
  stage: VideoPluginStage,
): VideoPluginManifest['video']['pipeline']['stages'][number] {
  return {
    id: stage.id,
    atoms: [...stage.atoms],
    ...(stage.inputs ? { inputs: stage.inputs } : {}),
    ...(stage.policy ? { policy: stage.policy } : {}),
    ...(stage.optional ? { optional: true } : {}),
    ...(stage.repeat ? { repeat: true } : {}),
    ...(stage.until ? { until: stage.until } : {}),
  };
}

function capabilitiesForSnapshot(
  snapshot: AppliedSnapshot<VideoPluginSnapshotPayload>,
  stages: VideoPluginManifest['video']['pipeline']['stages'],
): VideoPluginCapability[] {
  const capabilities = new Set<VideoPluginCapability>();
  for (const capability of snapshot.capabilities) {
    if (isVideoPluginCapability(capability)) capabilities.add(capability);
  }
  for (const capability of requiredCapabilitiesForAtoms(
    stages.flatMap((stage) => stage.atoms),
  )) {
    capabilities.add(capability);
  }
  if (capabilities.size === 0) capabilities.add('prompt:inject');
  return [...capabilities].sort();
}

function isVideoPluginCapability(
  capability: string,
): capability is VideoPluginCapability {
  return VIDEO_PLUGIN_CAPABILITY_SET.has(capability);
}

function networkAccessForSnapshot(
  snapshot: AppliedSnapshot<VideoPluginSnapshotPayload>,
  capabilities: readonly VideoPluginCapability[],
): VideoPluginManifest['video']['networkAccess'] {
  const needsNetwork = capabilities.some(
    (capability) =>
      capability.startsWith('network:') || capability === 'research:web',
  );
  if (!needsNetwork) return { allowedHosts: ['none'] };
  const egressRules = snapshot.payload.networkPolicy?.egress ?? [];
  const hosts = [
    ...new Set(
      egressRules
        .map((rule) => rule.host)
        .filter((host) => host && host !== '*'),
    ),
  ];
  if (hosts.length === 0) {
    throw new Error(
      'Cannot save this plugin because its network capabilities have no exact allowed hosts',
    );
  }
  const allowedPaths = Object.fromEntries(
    hosts.map((host) => [
      host,
      [
        ...new Set(
          egressRules
            .filter((rule) => rule.host === host)
            .flatMap((rule) => rule.paths ?? ['/'])
            .filter((rulePath) => rulePath.startsWith('/')),
        ),
      ],
    ]),
  );
  return {
    allowedHosts: hosts,
    allowedPaths,
    reason: `Network access used by saved flow ${snapshot.plugin.id}.`,
  };
}

function useCaseQueryForSnapshot(
  snapshot: AppliedSnapshot<VideoPluginSnapshotPayload>,
  title: string,
): string {
  const topic = snapshot.payload.inputs.topic;
  if (typeof topic === 'string' && topic.trim()) {
    return `Use ${title} for {{topic}}.`;
  }
  return `Use ${title} for this project.`;
}

function assertValidSavedManifests(
  genericManifest: PluginManifest,
  videoManifest: VideoPluginManifest,
  folderName: string,
): void {
  const genericParsed = parseManifest(JSON.stringify(genericManifest));
  if (!genericParsed.ok || !genericParsed.manifest) {
    throw new Error(
      `Invalid plugin manifest: ${genericParsed.issues.join('; ')}`,
    );
  }
  const videoParsed = parseVideoPluginManifest(JSON.stringify(videoManifest), {
    genericManifest: genericParsed.manifest,
    folderName,
    validateEngineTemplate: false,
  });
  if (!videoParsed.ok) {
    throw new Error(
      `Invalid video plugin manifest: ${videoParsed.issues
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join('; ')}`,
    );
  }
}

async function writeSavedPluginFiles(
  scaffold: CreatePluginResult,
  genericManifest: PluginManifest,
  videoManifest: VideoPluginManifest,
  candidate: VideoPluginCandidate,
): Promise<void> {
  await fs.writeFile(
    scaffold.manifestPath,
    JSON.stringify(genericManifest, null, 2) + '\n',
    'utf-8',
  );
  await fs.writeFile(
    path.join(scaffold.pluginDir, 'video-plugin.json'),
    JSON.stringify(videoManifest, null, 2) + '\n',
    'utf-8',
  );
  await fs.writeFile(
    path.join(scaffold.pluginDir, 'SKILL.md'),
    skillMarkdownForCandidate(candidate),
    'utf-8',
  );
}

function skillMarkdownForCandidate(candidate: VideoPluginCandidate): string {
  return [
    `# ${candidate.title}`,
    '',
    candidate.description,
    '',
    'Use this saved Video Mode flow as a reusable plugin. Keep outputs aligned with the frozen pipeline stages and capabilities.',
    '',
  ].join('\n');
}

async function readGenericManifest(pluginDir: string): Promise<PluginManifest> {
  const candidates = [
    path.join(pluginDir, '.claude-plugin', 'plugin.json'),
    path.join(pluginDir, '.codex-plugin', 'plugin.json'),
    path.join(pluginDir, '.cursor-plugin', 'plugin.json'),
  ];
  for (const candidate of candidates) {
    try {
      const raw = await fs.readFile(candidate, 'utf-8');
      const parsed = parseManifest(raw);
      if (parsed.ok && parsed.manifest) return parsed.manifest;
    } catch {
      // try next
    }
  }
  throw new Error(`Generic plugin manifest not found under ${pluginDir}`);
}

function renameGenericManifest(
  manifest: PluginManifest,
  name: string,
): PluginManifest {
  return {
    ...manifest,
    name,
    metadata: {
      ...(manifest.metadata ?? {}),
      neuma: {
        ...(manifest.metadata?.neuma ?? {}),
        surfaces: ['video'],
        videoManifest: 'video-plugin.json',
      },
    },
  } as PluginManifest;
}

function renameVideoManifest(
  manifest: VideoPluginManifest,
  name: string,
): VideoPluginManifest {
  return { ...manifest, name };
}

function digestPluginBundle(
  genericManifest: PluginManifest,
  videoManifest: VideoPluginManifest,
): string {
  return createHash('sha256')
    .update(JSON.stringify({ genericManifest, videoManifest }))
    .digest('hex');
}

async function uniquePluginName(
  root: string,
  baseName: string,
): Promise<string> {
  let name = baseName;
  let suffix = 2;
  while (await pathExists(path.join(root, name))) {
    name = `${baseName}-${suffix}`;
    suffix += 1;
  }
  return name;
}

function slugifyPluginName(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return PLUGIN_NAME_RE.test(slug) ? slug : 'saved-video-flow';
}

function humanizePluginName(name: string): string {
  return name
    .split(/[-_]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

const UNSAFE_TEXT_RE = /<script|javascript:|data:text\/html/gi;

function sanitizeText(value: string, max: number): string {
  // Strip repeatedly until stable — a single pass lets nested/overlapping
  // payloads (e.g. "<scr<scriptipt>") reassemble into a live token.
  let previous = value;
  let next = value.replace(UNSAFE_TEXT_RE, '');
  while (next !== previous) {
    previous = next;
    next = next.replace(UNSAFE_TEXT_RE, '');
  }
  return next.trim().slice(0, max);
}

function pluginIdFromScope(scope: PluginScope, name: string): string {
  return `${scope}/${name}`;
}
