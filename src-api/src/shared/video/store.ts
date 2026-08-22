import { createHash, randomUUID } from 'node:crypto';
import {
  constants as fsConstants,
  createReadStream,
  createWriteStream,
  existsSync,
  readdirSync,
} from 'node:fs';
import fs from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline as streamPipeline } from 'node:stream/promises';

import type { TimelineOp } from '@neumar/video-ir';

import { APP_DATA_DIR } from '@/config/branding';

import { getDatabase } from '@/shared/db';
import { getSetting } from '@/shared/db/operations';
import { readMediaMetadata } from '@/shared/media/probe';
import { validateInputFile, validatePath } from '@/shared/services/ffmpeg';
import { createLogger } from '@/shared/utils/logger';

import {
  buildAutoCutCandidates,
  compileSourceCutPlanTimelineOps,
} from './analysis/auto-cut';
import { createPackedTranscriptArtifact } from './analysis/pack-transcript';
import {
  buildSourceRangeEvidenceArtifact,
  type SourceRangeEvidenceDependencies,
} from './analysis/source-range-evidence';
import { transcribeSourceMedia } from './analysis/transcript';
import {
  estimateStoryboardCostCents,
  estimateStoryboardCostUsd,
} from './cost-estimator';
import {
  assertSupportedImageUpload,
  imageExtensionFromName,
} from './image-validation';
import {
  VIDEO_PROVIDER_CAPABILITIES,
  type ProviderCapability,
} from './providers';
import { buildYtDlpArgs, validateYtDlpUrl } from './source/ytdlp';
import {
  migrateStoryboardToTimeline,
  rebuildTimelineFromStoryboard,
} from './timeline';
import { applyProjectTimelineOps } from './timeline-ops';
import type {
  AnalysisArtifact,
  AnalysisArtifactKind,
  AspectRatio,
  CutCandidate,
  MediaItem,
  MediaMetadata,
  ProviderId,
  SourceCutPlan,
  SourceMedia,
  SourceMediaAnalysis,
  SpeechRange,
  Storyboard,
  StoryboardScene,
  SubtitleWord,
  RenderOutput,
  VideoJob,
  TemplateId,
  VideoProject,
  VideoTimeline,
} from './types';

const logger = createLogger('VideoStore');
const projectDocumentUpdateLocks = new Map<string, Promise<unknown>>();
/**
 * Per-process cache of each project's resolved on-disk root. Resolving a root
 * scans `/Volumes` (`readdirSync`) and probes candidate paths (`existsSync`) —
 * blocking syscalls that, on a stale SMB/NFS mount, can stall the event loop
 * for seconds. `getVideoProjectRoot` is called many times per operation, so we
 * cache the result.
 *
 * Keyed by `workspaceRoot + projectId`, not projectId alone: the resolved root
 * is a function of the active workspace, and `workDir` can change at runtime
 * (settings change, or tests that swap `NEUMA_VIDEO_WORKDIR` between cases while
 * reusing a fixed project id). Composite keying re-resolves when the workspace
 * changes instead of returning a stale root. Deletion clears every entry for a
 * project id across workspaces.
 */
const resolvedProjectRoots = new Map<string, string>();

function projectRootCacheKey(workspaceRoot: string, projectId: string): string {
  // JSON tuple key: collision-free across workspace + id with no fragile separator.
  return JSON.stringify([workspaceRoot, projectId]);
}
const IMAGE_METADATA_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.avif',
]);

export interface VideoProjectListItem {
  id: string;
  name: string;
  template: TemplateId;
  updatedAt: string;
  renderStatus: string;
  hasOutput: boolean;
  posterPath?: string;
  qaWarningCount?: number;
}

export interface CreateVideoProjectInput {
  name: string;
  template: TemplateId;
  prompt?: string;
  aspectRatio?: AspectRatio;
}

export type UpdateVideoProjectInput = Partial<
  Pick<
    VideoProject,
    'name' | 'prompt' | 'script' | 'template' | 'brandKit' | 'templateSnapshot'
  >
> & {
  budget?: Partial<NonNullable<VideoProject['budget']>>;
};

export interface VideoProviderConfig {
  id: string;
  providerId: ProviderId;
  enabled: boolean;
  providerSettingId?: string;
  defaultCostCentsPerSec?: number;
  settings: Record<string, unknown>;
}

export interface VideoProviderConfigView {
  capability: ProviderCapability;
  config: VideoProviderConfig;
}

export interface ImportSourceInput {
  path?: string;
  file?: File;
  origin?: SourceMedia['origin'];
  sourceUrl?: string;
  rights?: SourceMedia['rights'];
}

export interface YtDlpJobInput {
  url: string;
  maxDurationSec?: number;
  format?: 'mp4' | 'best';
  userConfirmedRights: true;
}

export interface InspectSourceRangeInput {
  startMs: number;
  endMs: number;
  frameCount?: number;
  waveformBins?: number;
}

export function getVideoWorkspaceRoot(): string {
  const testWorkspaceRoot =
    process.env.NODE_ENV === 'test'
      ? process.env.NEUMA_VIDEO_WORKDIR
      : undefined;
  const workspaceRoot =
    testWorkspaceRoot ?? getSetting('workDir') ?? process.cwd();
  return path.resolve(workspaceRoot);
}

function getStoredVideoProjectRoot(projectId: string): string | null {
  try {
    const row = getDatabase()
      .prepare('SELECT workspace_root FROM video_projects WHERE id = ?')
      .get(projectId) as { workspace_root: string | null } | undefined;
    const root = row?.workspace_root?.trim();
    return root ? path.resolve(root) : null;
  } catch {
    return null;
  }
}

function updateStoredVideoProjectRoot(projectId: string, root: string): void {
  try {
    getDatabase()
      .prepare(
        `UPDATE video_projects
         SET workspace_root = ?
         WHERE id = ? AND (workspace_root IS NULL OR workspace_root != ?)`,
      )
      .run(path.resolve(root), projectId, path.resolve(root));
  } catch {
    // Older DBs may not have the workspace_root column until migrations run.
  }
}

function visibleWorkspaceName(): string {
  const slug = APP_DATA_DIR.replace(/^\.+/, '') || 'neumar';
  return `_${slug.charAt(0).toUpperCase()}${slug.slice(1)}`;
}

function mountedWorkspaceCandidates(): string[] {
  try {
    return readdirSync('/Volumes', { withFileTypes: true }).flatMap((entry) => {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) return [];
      const volumeRoot = path.join('/Volumes', entry.name);
      return [
        path.join(volumeRoot, visibleWorkspaceName()),
        path.join(volumeRoot, APP_DATA_DIR),
      ];
    });
  } catch {
    return [];
  }
}

function uniqueResolvedRoots(
  roots: Array<string | null | undefined>,
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const root of roots) {
    if (!root) continue;
    const resolved = path.resolve(root);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    result.push(resolved);
  }
  return result;
}

/**
 * User-visible directory under the workspace where each video project lives
 * as its own subfolder (`videos/{projectId}/`). Chosen to mirror conventions
 * in Final Cut Pro / iMovie / CapCut where project bundles sit under a
 * browsable Movies/Videos directory rather than a hidden dotfolder.
 */
export const VIDEO_PROJECTS_DIRNAME = 'videos';
/** Pre-2026-05 location, kept for one-shot migration. */
const LEGACY_VIDEO_PROJECTS_REL = path.join('.neuma', 'video');
const VIDEO_PROJECT_SCHEMA_VERSION = 2;

export function getVideoRootForRoot(root: string): string {
  return path.join(root, VIDEO_PROJECTS_DIRNAME);
}

export function getVideoRoot(): string {
  return getVideoRootForRoot(getVideoWorkspaceRoot());
}

export function getVideoProjectDirForRoot(
  root: string,
  projectId: string,
): string {
  assertSafeId(projectId);
  return path.join(getVideoRootForRoot(root), projectId);
}

export function getVideoProjectJsonPathForRoot(
  root: string,
  projectId: string,
): string {
  return path.join(getVideoProjectDirForRoot(root, projectId), 'project.json');
}

function projectJsonExistsAtRoot(root: string, projectId: string): boolean {
  return (
    existsSync(getVideoProjectJsonPathForRoot(root, projectId)) ||
    existsSync(
      path.join(getLegacyVideoProjectDir(root, projectId), 'project.json'),
    )
  );
}

export function getVideoProjectRoot(projectId: string): string {
  assertSafeId(projectId);
  const workspaceRoot = getVideoWorkspaceRoot();
  const cacheKey = projectRootCacheKey(workspaceRoot, projectId);
  const cached = resolvedProjectRoots.get(cacheKey);
  if (cached) return cached;
  const storedRoot = getStoredVideoProjectRoot(projectId);
  const candidateRoots = uniqueResolvedRoots([
    storedRoot,
    workspaceRoot,
    path.join(homedir(), APP_DATA_DIR),
    ...mountedWorkspaceCandidates(),
  ]);
  const existingRoot = candidateRoots.find((root) =>
    projectJsonExistsAtRoot(root, projectId),
  );
  if (existingRoot) {
    if (existingRoot !== storedRoot) {
      updateStoredVideoProjectRoot(projectId, existingRoot);
    }
    // Only cache a root confirmed on disk — the fallback below may point at a
    // not-yet-created project, which should re-resolve once its files land.
    resolvedProjectRoots.set(cacheKey, existingRoot);
    return existingRoot;
  }
  return storedRoot ?? workspaceRoot;
}

export function getVideoProjectDir(projectId: string): string {
  return getVideoProjectDirForRoot(getVideoProjectRoot(projectId), projectId);
}

/**
 * Per-project cache root for regeneratable artifacts (scene render cache,
 * Remotion bundle, etc.). Lives at `${workspace}/.cache/videos/{id}/` so
 * users can `rm -rf .cache/` to reclaim space without touching project
 * content, and so that `videos/` stays small enough to back up cheaply.
 * Patterned after the DaVinci Resolve "scratch disk" / FCP cache separation
 * — the existing render-cache and Remotion bundle are pure caches with no
 * user-authored content.
 */
export const VIDEO_CACHE_DIRNAME = path.join('.cache', VIDEO_PROJECTS_DIRNAME);

export function getVideoCacheRootForRoot(root: string): string {
  return path.join(root, VIDEO_CACHE_DIRNAME);
}

export function getVideoProjectCacheDirForRoot(
  root: string,
  projectId: string,
): string {
  assertSafeId(projectId);
  return path.join(getVideoCacheRootForRoot(root), projectId);
}

export function getVideoSourceAnalysisCacheDirForRoot(
  root: string,
  projectId: string,
  contentHash: string,
): string {
  assertSafeId(projectId);
  assertSafeCacheSegment(contentHash, 'contentHash');
  return path.join(
    getVideoProjectCacheDirForRoot(root, projectId),
    'analysis',
    contentHash,
  );
}

export function getVideoSourceAnalysisCacheDir(
  projectId: string,
  contentHash: string,
): string {
  return getVideoSourceAnalysisCacheDirForRoot(
    getVideoProjectRoot(projectId),
    projectId,
    contentHash,
  );
}

function getLegacyVideoProjectDir(root: string, projectId: string): string {
  return path.join(root, LEGACY_VIDEO_PROJECTS_REL, projectId);
}

function assertSafeCacheSegment(value: string, label: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value) || value === '..') {
    throw new Error(`Invalid video cache ${label}`);
  }
}

async function moveLegacyDir(from: string, to: string): Promise<boolean> {
  try {
    await fs.access(from);
  } catch {
    return false;
  }
  try {
    await fs.access(to);
    // destination already exists — drop the stale legacy copy to free space
    await fs.rm(from, { recursive: true, force: true });
    return false;
  } catch {
    // destination missing — fall through to rename
  }
  await fs.mkdir(path.dirname(to), { recursive: true });
  try {
    await fs.rename(from, to);
    return true;
  } catch (error) {
    logger.warn('video.cache.migrate_rename_failed', {
      from,
      to,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Hoist the per-project scene render cache and Remotion bundle out of
 * `videos/{id}/` into the shared `.cache/videos/{id}/` tree. Idempotent;
 * skipped when nothing to move.
 */
async function migrateLegacyProjectCache(
  projectId: string,
  root: string,
): Promise<void> {
  if (!/^[a-zA-Z0-9_-]+$/.test(projectId)) return;
  const projectDir = path.join(root, VIDEO_PROJECTS_DIRNAME, projectId);
  const cacheDir = getVideoProjectCacheDirForRoot(root, projectId);
  const moved = await Promise.all([
    moveLegacyDir(
      path.join(projectDir, 'cache'),
      path.join(cacheDir, 'scenes'),
    ),
    moveLegacyDir(
      path.join(projectDir, '.remotion-bundle'),
      path.join(cacheDir, 'remotion-bundle'),
    ),
  ]);
  if (moved.some(Boolean)) {
    logger.info('video.cache.migrated_to_shared_cache_root', {
      project_id: projectId,
      cache_dir: cacheDir,
    });
  }
}

/**
 * Move a single project's directory from the legacy `.neuma/video/{id}` path
 * to `videos/{id}`, and rewrite stored path prefixes inside its `project.json`.
 * Idempotent — early-returns when the new path already exists or the legacy
 * one is missing. Per-project (not whole-tree) so concurrent reads/writes on
 * other projects are not blocked.
 */
async function migrateLegacyProjectDir(
  projectId: string,
  root: string,
): Promise<void> {
  if (!/^[a-zA-Z0-9_-]+$/.test(projectId)) return;
  const newDir = path.join(root, VIDEO_PROJECTS_DIRNAME, projectId);
  const oldDir = getLegacyVideoProjectDir(root, projectId);
  try {
    await fs.access(newDir);
    return;
  } catch {
    // continue
  }
  try {
    await fs.access(oldDir);
  } catch {
    return;
  }
  await fs.mkdir(path.dirname(newDir), { recursive: true });
  try {
    await fs.rename(oldDir, newDir);
  } catch (error) {
    logger.warn('video.project.migrate_rename_failed', {
      project_id: projectId,
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }
  const jsonPath = path.join(newDir, 'project.json');
  try {
    const raw = await fs.readFile(jsonPath, 'utf8');
    if (raw.includes(`${LEGACY_VIDEO_PROJECTS_REL}/`)) {
      const rewritten = raw.replaceAll(
        `${LEGACY_VIDEO_PROJECTS_REL}/`,
        `${VIDEO_PROJECTS_DIRNAME}/`,
      );
      await fs.writeFile(jsonPath, rewritten);
    }
  } catch (error) {
    logger.warn('video.project.migrate_rewrite_failed', {
      project_id: projectId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  logger.info('video.project.migrated_to_visible_dir', {
    project_id: projectId,
    from: oldDir,
    to: newDir,
  });
}

async function migrateProjectLayout(projectId: string): Promise<void> {
  const root = getVideoProjectRoot(projectId);
  await migrateLegacyProjectDir(projectId, root);
  await migrateLegacyProjectCache(projectId, root);
}

export function getVideoProjectJsonPath(projectId: string): string {
  return getVideoProjectJsonPathForRoot(
    getVideoProjectRoot(projectId),
    projectId,
  );
}

export function getVideoAssetsDir(projectId: string): string {
  return path.join(getVideoProjectDir(projectId), 'assets');
}

export function getVideoSourcesDir(projectId: string): string {
  return path.join(getVideoProjectDir(projectId), 'sources');
}

export async function createProject(
  input: CreateVideoProjectInput,
): Promise<VideoProject> {
  const now = new Date().toISOString();
  const workspaceRoot = getVideoWorkspaceRoot();
  const project: VideoProject = {
    schemaVersion: VIDEO_PROJECT_SCHEMA_VERSION,
    id: randomUUID(),
    name: input.name.trim() || 'Untitled video',
    template: input.template,
    prompt: input.prompt ?? '',
    assets: [],
    sources: [],
    linkedSources: [],
    sourceAnalyses: [],
    cutPlans: [],
    analysisArtifacts: [],
    scenes: [],
    storyboard: {
      status: 'draft',
      intent: input.prompt?.trim() ?? '',
      totalDurationMs: 0,
      costEstimateUsd: { low: 0, high: 0 },
      scenes: [],
    },
    render: { status: 'idle', updatedAt: now },
    budget: { capUsd: 5, spentUsd: 0 },
    outputs: [],
    createdAt: now,
    updatedAt: now,
    ...(input.aspectRatio
      ? { settings: { defaultAspectRatios: [input.aspectRatio] } }
      : {}),
  };

  await writeProject(project);
  getDatabase()
    .prepare(
      `INSERT INTO video_projects
        (id, name, template, updated_at, render_status, budget_cap_cents, budget_spent_cents, workspace_root)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      project.id,
      project.name,
      project.template,
      project.updatedAt,
      project.render?.status ?? 'idle',
      Math.round((project.budget?.capUsd ?? 0) * 100),
      Math.round((project.budget?.spentUsd ?? 0) * 100),
      workspaceRoot,
    );
  logger.info('video.project.created', { project_id: project.id });
  return project;
}

export async function listProjects(): Promise<VideoProjectListItem[]> {
  const rows = getDatabase()
    .prepare(
      `SELECT id, name, template, updated_at, render_status
       FROM video_projects
       ORDER BY updated_at DESC`,
    )
    .all() as Array<{
    id: string;
    name: string;
    template: TemplateId;
    updated_at: string;
    render_status: string;
  }>;

  await Promise.all(rows.map((row) => migrateProjectLayout(row.id)));

  return Promise.all(
    rows.map(async (row) => {
      const summary = await readProjectOutputSummary(row.id);
      return {
        id: row.id,
        name: row.name,
        template: row.template,
        updatedAt: row.updated_at,
        renderStatus: row.render_status,
        hasOutput: summary.hasOutput,
        posterPath: summary.posterPath,
        qaWarningCount: summary.qaWarningCount,
      };
    }),
  );
}

export async function getProject(projectId: string): Promise<VideoProject> {
  await migrateProjectLayout(projectId);
  const filePath = getVideoProjectJsonPath(projectId);
  const raw = await fs.readFile(filePath, 'utf8');
  const project = JSON.parse(raw) as VideoProject;
  const migrated = withProjectSchemaVersion(
    migrateStoryboardToTimeline(project),
  );
  if (migrated !== project) {
    await writeProject(migrated);
  }
  return migrated;
}

async function readProjectOutputSummary(projectId: string): Promise<{
  hasOutput: boolean;
  posterPath?: string;
  qaWarningCount: number;
}> {
  try {
    const raw = await fs.readFile(getVideoProjectJsonPath(projectId), 'utf8');
    const project = JSON.parse(raw) as Pick<VideoProject, 'outputs' | 'render'>;
    const outputs = project.outputs ?? [];
    return {
      hasOutput:
        outputs.some((output) => Boolean(output.path)) ||
        Boolean(project.render?.outputPath),
      posterPath: outputs.find((output) => output.posterPath)?.posterPath,
      qaWarningCount: countQaWarnings(outputs),
    };
  } catch {
    return { hasOutput: false, qaWarningCount: 0 };
  }
}

function countQaWarnings(outputs: RenderOutput[]): number {
  return outputs.reduce((total, output) => {
    const report = output.qaReport;
    if (!report) return total;
    return (
      total +
      report.blackFrames.length +
      report.audioClipping.length +
      report.silentGaps.length +
      report.missingMedia.length +
      (report.cutBoundaries ?? []).reduce(
        (count, boundary) => count + boundary.issues.length,
        0,
      ) +
      (report.durationMismatch ? 1 : 0)
    );
  }, 0);
}

export async function updateProject(
  projectId: string,
  updates: UpdateVideoProjectInput,
): Promise<VideoProject> {
  const current = await getProject(projectId);
  const now = new Date().toISOString();
  const next: VideoProject = {
    ...current,
    ...updates,
    budget: updates.budget
      ? { ...(current.budget ?? { capUsd: 5, spentUsd: 0 }), ...updates.budget }
      : current.budget,
    updatedAt: now,
  };

  await writeProject(next);
  getDatabase()
    .prepare(
      `UPDATE video_projects
       SET name = ?, template = ?, updated_at = ?, render_status = ?,
           budget_cap_cents = ?, budget_spent_cents = ?
       WHERE id = ?`,
    )
    .run(
      next.name,
      next.template,
      next.updatedAt,
      next.render?.status ?? 'idle',
      Math.round((next.budget?.capUsd ?? 0) * 100),
      Math.round((next.budget?.spentUsd ?? 0) * 100),
      next.id,
    );
  return next;
}

export async function deleteProject(projectId: string): Promise<void> {
  assertSafeId(projectId);
  const root = getVideoProjectRoot(projectId);
  const projectDir = getVideoProjectDir(projectId);
  const cacheDir = getVideoProjectCacheDirForRoot(root, projectId);
  // Best-effort cleanup of every on-disk artifact: project content + per-project
  // cache (scene render cache + Remotion bundle). Without the cache rm here,
  // deleting a project would leave its `.cache/videos/{id}/` behind, defeating
  // the disk-space point of splitting caches out of `videos/`.
  await Promise.all(
    [projectDir, cacheDir].map(async (dir) => {
      try {
        await fs.rm(dir, { recursive: true, force: true });
      } catch (error) {
        logger.warn('video.project.delete_dir_failed', {
          project_id: projectId,
          dir,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }),
  );
  getDatabase()
    .prepare(`DELETE FROM video_projects WHERE id = ?`)
    .run(projectId);
  // Clear every workspace-keyed entry for this project id.
  const idSuffix = `,${JSON.stringify(projectId)}]`;
  for (const key of resolvedProjectRoots.keys()) {
    if (key.endsWith(idSuffix)) resolvedProjectRoots.delete(key);
  }
  logger.info('video.project.deleted', { project_id: projectId });
}

export async function addProjectAssetFromPath(
  projectId: string,
  sourcePath: string,
): Promise<{ project: VideoProject; asset: MediaItem }> {
  const root = getVideoProjectRoot(projectId);
  const resolvedSource = validateInputFile(sourcePath, root);
  const asset = await copyAssetIntoProject(projectId, resolvedSource);
  const { project, asset: attached } = await attachCopiedProjectAsset(
    projectId,
    asset,
  );
  return { project, asset: attached };
}

/**
 * sha256 of the file backing a project asset, or undefined when it has no
 * readable local bytes (a `catalog:` reference, an un-hydrated placeholder, or
 * a missing file). Prefers the stored metadata hash so we don't re-read large
 * files that were already hashed on import.
 */
export async function projectAssetContentHash(
  root: string,
  asset: MediaItem,
): Promise<string | undefined> {
  if (asset.metadata?.contentHash) return asset.metadata.contentHash;
  if (!asset.path || asset.path.startsWith('catalog:')) return undefined;
  if (asset.materializationState && asset.materializationState !== 'ready') {
    return undefined;
  }
  const abs = path.isAbsolute(asset.path)
    ? asset.path
    : path.join(root, asset.path);
  try {
    return await hashFile(abs);
  } catch {
    return undefined;
  }
}

/**
 * Finds an already-attached project asset whose local bytes match `contentHash`.
 * Checks stored hashes first, then falls back to hashing assets that predate
 * hash tracking so the same file is still recognised as a duplicate.
 */
export async function findProjectAssetByContentHash(
  root: string,
  assets: MediaItem[],
  contentHash: string,
): Promise<MediaItem | undefined> {
  for (const existing of assets) {
    if (existing.metadata?.contentHash === contentHash) return existing;
  }
  for (const existing of assets) {
    if (existing.metadata?.contentHash) continue;
    const hash = await projectAssetContentHash(root, existing);
    if (hash === contentHash) return existing;
  }
  return undefined;
}

/**
 * Appends a freshly copied/uploaded asset to `project.assets`, deduplicating by
 * content: when an identical file is already attached, the redundant copy is
 * deleted and the existing asset is returned instead. This keeps the same file
 * from showing up more than once whether it arrived via upload, path attach, or
 * a linked-folder attach.
 */
export async function attachCopiedProjectAsset(
  projectId: string,
  asset: MediaItem,
): Promise<{ project: VideoProject; asset: MediaItem; deduped: boolean }> {
  const root = getVideoProjectRoot(projectId);
  const abs = path.join(root, asset.path);
  const contentHash = await hashFile(abs).catch(() => undefined);
  if (contentHash) {
    asset.metadata = { ...asset.metadata, contentHash };
  }
  // Serialize the read-merge-write so concurrent asset adds to the same project
  // can't clobber each other (the hash above is computed outside the lock).
  let resultAsset = asset;
  let deduped = false;
  const project = await updateProjectDocument(projectId, async (current) => {
    if (contentHash) {
      const duplicate = await findProjectAssetByContentHash(
        root,
        current.assets,
        contentHash,
      );
      if (duplicate) {
        await fs.rm(abs, { force: true }).catch(() => {});
        resultAsset = duplicate;
        deduped = true;
        return current;
      }
    }
    return {
      ...current,
      assets: [...current.assets, asset],
      updatedAt: new Date().toISOString(),
    };
  });
  return { project, asset: resultAsset, deduped };
}

/**
 * Register an existing file as a project asset without copying. Use when
 * the file already lives inside the project's assets dir (e.g. the agentic
 * runtime told the media MCP to write straight there).
 *
 * Throws if the path is not under the project's assets dir — copying belongs
 * to `addProjectAssetFromPath`; this helper is strictly the no-copy path.
 */
export async function registerExistingProjectAsset(
  projectId: string,
  filePath: string,
): Promise<{ project: VideoProject; asset: MediaItem }> {
  const assetsDir = getVideoAssetsDir(projectId);
  const normalizedAssetsDir = path.resolve(assetsDir) + path.sep;
  const resolvedFile = path.resolve(filePath);
  if (!resolvedFile.startsWith(normalizedAssetsDir)) {
    throw new Error(
      `Refusing to register ${filePath}: not inside project assets dir`,
    );
  }
  const asset = await mediaItemFromPath(
    resolvedFile,
    'user',
    getVideoProjectRoot(projectId),
  );
  const project = await getProject(projectId);
  if (project.assets.some((entry) => entry.path === asset.path)) {
    return { project, asset };
  }
  const next = {
    ...project,
    assets: [...project.assets, asset],
    updatedAt: new Date().toISOString(),
  };
  await writeProject(next);
  return { project: next, asset };
}

export async function addProjectAssetFromUpload(
  projectId: string,
  file: File,
): Promise<{ project: VideoProject; asset: MediaItem }> {
  const dest = await allocateAssetPath(projectId, file.name || 'asset');
  // Stream the part to disk rather than `Buffer.from(await file.arrayBuffer())`
  // — a 4K clip is hundreds of MB and the extra full copy pushed the process
  // past its RSS budget, stalling the upload it was meant to finish.
  await streamPipeline(
    Readable.fromWeb(file.stream() as Parameters<typeof Readable.fromWeb>[0]),
    createWriteStream(dest),
  );
  const asset = await mediaItemFromPath(
    dest,
    'user',
    getVideoProjectRoot(projectId),
  );
  const { project, asset: attached } = await attachCopiedProjectAsset(
    projectId,
    asset,
  );
  return { project, asset: attached };
}

export async function addProjectImageAssetFromUpload(
  projectId: string,
  file: File,
): Promise<{ project: VideoProject; asset: MediaItem }> {
  const buffer = Buffer.from(await file.arrayBuffer());
  assertSupportedImageUpload(file, buffer);
  const dest = await allocateAssetPath(
    projectId,
    file.name || `reference${imageExtensionFromName(file.name)}`,
  );
  await fs.writeFile(dest, buffer);
  const asset = await mediaItemFromPath(
    dest,
    'user',
    getVideoProjectRoot(projectId),
  );
  if (asset.kind !== 'image') {
    await fs.rm(dest, { force: true });
    throw new Error(`Unsupported image file: ${file.name || 'upload'}`);
  }
  const project = await getProject(projectId);
  const next = {
    ...project,
    assets: [...project.assets, asset],
    updatedAt: new Date().toISOString(),
  };
  await writeProject(next);
  return { project: next, asset };
}

// Drop every timeline clip that sources the deleted asset so the persisted
// timeline never references media that no longer exists on disk. Recomputes the
// timeline duration from the surviving clips.
function removeTimelineClipsForAsset(
  timeline: VideoTimeline,
  assetId: string,
): VideoTimeline {
  let changed = false;
  const tracks = timeline.tracks.map((track) => {
    const clips = track.clips.filter((clip) => {
      const remove =
        clip.sourceRef.kind === 'asset' && clip.sourceRef.assetId === assetId;
      if (remove) changed = true;
      return !remove;
    });
    return clips.length === track.clips.length
      ? track
      : ({ ...track, clips } as (typeof timeline.tracks)[number]);
  });
  if (!changed) return timeline;
  const durationMs = tracks.reduce(
    (max, track) =>
      track.clips.reduce(
        (clipMax, clip) => Math.max(clipMax, clip.startMs + clip.durationMs),
        max,
      ),
    0,
  );
  return { ...timeline, tracks, durationMs };
}

export async function deleteProjectAsset(
  projectId: string,
  assetId: string,
): Promise<VideoProject> {
  const project = await getProject(projectId);
  const asset = project.assets.find((item) => item.id === assetId);
  const next = {
    ...project,
    assets: project.assets.filter((item) => item.id !== assetId),
    ...(project.timeline
      ? { timeline: removeTimelineClipsForAsset(project.timeline, assetId) }
      : {}),
    updatedAt: new Date().toISOString(),
  };
  await writeProject(next);
  if (asset) {
    const root = getVideoProjectRoot(projectId);
    try {
      await fs.rm(validatePath(asset.path, root, 'write'), {
        force: true,
      });
    } catch (error) {
      logger.warn('video.asset.delete_file_failed', {
        project_id: projectId,
        asset_id: assetId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    if (asset.proxy && asset.proxy.source !== 'asset_catalog') {
      try {
        await fs.rm(validatePath(asset.proxy.path, root, 'write'), {
          force: true,
        });
      } catch (error) {
        logger.warn('video.asset.delete_proxy_failed', {
          project_id: projectId,
          asset_id: assetId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  return next;
}

export function listProviderConfigs(): VideoProviderConfigView[] {
  return VIDEO_PROVIDER_CAPABILITIES.map((capability) => ({
    capability,
    config: getProviderConfig(capability.id),
  }));
}

export function getProviderConfig(providerId: ProviderId): VideoProviderConfig {
  const row = getDatabase()
    .prepare(
      `SELECT id, provider_id, enabled, provider_setting_id,
              default_cost_cents_per_sec, settings_json
       FROM video_provider_configs
       WHERE provider_id = ?`,
    )
    .get(providerId) as
    | {
        id: string;
        provider_id: ProviderId;
        enabled: number;
        provider_setting_id: string | null;
        default_cost_cents_per_sec: number | null;
        settings_json: string;
      }
    | undefined;

  if (!row) {
    const capability = VIDEO_PROVIDER_CAPABILITIES.find(
      (provider) => provider.id === providerId,
    );
    return {
      id: providerId,
      providerId,
      enabled: capability?.status === 'active',
      defaultCostCentsPerSec: capability?.defaultCostPerSecCents,
      settings: {},
    };
  }

  return {
    id: row.id,
    providerId: row.provider_id,
    enabled: row.enabled === 1,
    providerSettingId: row.provider_setting_id ?? undefined,
    defaultCostCentsPerSec: row.default_cost_cents_per_sec ?? undefined,
    settings: safeJson(row.settings_json),
  };
}

export function upsertProviderConfig(
  providerId: ProviderId,
  updates: Partial<Omit<VideoProviderConfig, 'id' | 'providerId'>>,
): VideoProviderConfig {
  const current = getProviderConfig(providerId);
  const next: VideoProviderConfig = {
    ...current,
    ...updates,
    settings: { ...current.settings, ...(updates.settings ?? {}) },
  };
  getDatabase()
    .prepare(
      `INSERT INTO video_provider_configs
        (id, provider_id, enabled, provider_setting_id,
         default_cost_cents_per_sec, settings_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
        enabled = excluded.enabled,
        provider_setting_id = excluded.provider_setting_id,
        default_cost_cents_per_sec = excluded.default_cost_cents_per_sec,
        settings_json = excluded.settings_json,
        updated_at = excluded.updated_at`,
    )
    .run(
      next.id,
      providerId,
      next.enabled ? 1 : 0,
      next.providerSettingId ?? null,
      next.defaultCostCentsPerSec ?? null,
      JSON.stringify(next.settings),
      new Date().toISOString(),
    );
  return next;
}

export async function importSource(
  projectId: string,
  input: ImportSourceInput,
): Promise<{ project: VideoProject; source: SourceMedia; asset: MediaItem }> {
  const dest = await allocateSourcePath(
    projectId,
    input.file?.name ?? (input.path ? path.basename(input.path) : 'source.mp4'),
  );
  if (input.file) {
    await fs.writeFile(dest, Buffer.from(await input.file.arrayBuffer()));
  } else if (input.path) {
    await fs.copyFile(
      validateInputFile(input.path, getVideoProjectRoot(projectId)),
      dest,
      fsConstants.COPYFILE_FICLONE,
    );
  } else {
    throw new Error('Source file or path required');
  }

  const contentHash = await hashFile(dest);

  let source: SourceMedia | undefined;
  let asset: MediaItem | undefined;
  let createdSource = false;
  // Serialize the read-merge-write so two concurrent imports can't clobber each
  // other; the hash above is computed outside the lock.
  const project = await updateProjectDocument(projectId, async (current) => {
    // The same file shouldn't be imported as a second source — reuse the
    // existing one (and its asset) and drop the redundant copy we just wrote.
    const existingSource = (current.sources ?? []).find(
      (candidate) => candidate.contentHash === contentHash,
    );
    const existingAsset = existingSource
      ? current.assets.find((item) => item.id === existingSource.mediaItemId)
      : undefined;
    if (existingSource && existingAsset) {
      await fs.rm(dest, { force: true }).catch(() => {});
      source = existingSource;
      asset = existingAsset;
      return current;
    }

    const newAsset = await mediaItemFromPath(
      dest,
      'user',
      getVideoProjectRoot(projectId),
    );
    newAsset.metadata = { ...newAsset.metadata, contentHash };
    const newSource: SourceMedia = {
      id: randomUUID(),
      mediaItemId: newAsset.id,
      origin: input.origin ?? (input.file ? 'upload' : 'workspace-path'),
      contentHash,
      sourceUrl: input.sourceUrl,
      rights: input.rights,
      analysisStatus: 'idle',
      createdAt: new Date().toISOString(),
    };
    source = newSource;
    asset = newAsset;
    createdSource = true;
    return {
      ...current,
      assets: [...current.assets, newAsset],
      sources: [...(current.sources ?? []), newSource],
      updatedAt: new Date().toISOString(),
    };
  });
  if (createdSource && source) insertSourceRow(projectId, source);
  return { project, source: source!, asset: asset! };
}

/**
 * Ensures a SourceMedia exists for an existing project asset, creating one that
 * points at the asset (no file copy) when absent. Lets features that need a
 * source — e.g. transcription/captions — work on assets that were added via
 * upload or a linked-folder attach rather than the source-import flow. Returns
 * undefined when the asset is missing or has no audio track to transcribe.
 */
export async function ensureSourceForAsset(
  projectId: string,
  assetId: string,
): Promise<SourceMedia | undefined> {
  const project = await getProject(projectId);
  const existing = (project.sources ?? []).find(
    (source) => source.mediaItemId === assetId,
  );
  if (existing) return existing;
  const asset = project.assets.find((item) => item.id === assetId);
  if (!asset || !asset.metadata.audioTrackCount) return undefined;
  const contentHash =
    asset.metadata.contentHash ??
    (await hashFile(
      path.join(getVideoProjectRoot(projectId), asset.path),
    ).catch(() => undefined));
  if (!contentHash) return undefined;

  let source: SourceMedia | undefined;
  let created = false;
  await updateProjectDocument(projectId, (current) => {
    const already = (current.sources ?? []).find(
      (item) => item.mediaItemId === assetId,
    );
    if (already) {
      source = already;
      return current;
    }
    source = {
      id: randomUUID(),
      mediaItemId: assetId,
      origin: 'upload',
      contentHash,
      analysisStatus: 'idle',
      createdAt: new Date().toISOString(),
    };
    created = true;
    return {
      ...current,
      sources: [...(current.sources ?? []), source],
      updatedAt: new Date().toISOString(),
    };
  });
  if (created && source) insertSourceRow(projectId, source);
  return source;
}

export async function enqueueYtDlpImport(
  projectId: string,
  input: YtDlpJobInput,
): Promise<VideoJob> {
  await validateYtDlpUrl(input.url);
  const job: VideoJob = {
    id: randomUUID(),
    projectId,
    kind: 'source-download',
    status: 'queued',
    payload: {
      url: input.url,
      args: buildYtDlpArgs({
        projectId,
        sourceId: randomUUID(),
        url: input.url,
        maxDurationSec: input.maxDurationSec,
        format: input.format ?? 'mp4',
      }),
      maxDurationSec: input.maxDurationSec,
      userConfirmedRights: input.userConfirmedRights,
    },
    caller: 'in-app',
  };
  insertJob(job);
  return job;
}

export async function listSources(projectId: string): Promise<SourceMedia[]> {
  return (await getProject(projectId)).sources ?? [];
}

export async function analyzeSource(
  projectId: string,
  sourceId: string,
): Promise<{ project: VideoProject; analysis: SourceMediaAnalysis }> {
  const project = await getProject(projectId);
  const source = (project.sources ?? []).find((item) => item.id === sourceId);
  if (!source) throw new Error('Source not found');
  const asset = project.assets.find((item) => item.id === source.mediaItemId);
  if (!asset) throw new Error('Source asset not found');
  const durationMs = Math.max(asset.metadata.durationMs, 1000);
  const analysis = buildDeterministicAnalysis(
    source,
    asset.metadata,
    durationMs,
  );
  const analysisArtifacts: AnalysisArtifact[] = [];
  if (asset.metadata.audioTrackCount) {
    const root = getVideoProjectRoot(projectId);
    const cacheDir = getVideoSourceAnalysisCacheDirForRoot(
      root,
      projectId,
      source.contentHash,
    );
    const transcriptResult = await transcribeSourceMedia({
      project,
      source,
      asset,
      workspaceRoot: root,
      cacheDir,
    });
    analysis.transcript = transcriptResult.transcript;
    if (transcriptResult.transcript.words.length > 0) {
      analysis.speechRanges = buildSpeechRangesFromWords(
        transcriptResult.transcript.words,
      );
      const autoCuts = buildAutoCutCandidates(analysis);
      if (autoCuts.candidates.length > 0) {
        analysis.cutCandidates = autoCuts.candidates;
      }
    }
    if (transcriptResult.degraded) {
      analysis.cutCandidates = analysis.cutCandidates.map((candidate) => ({
        ...candidate,
        destructive: false,
        recommendation: 'review-only',
      }));
    }
    const packed = await createPackedTranscriptArtifact({
      source,
      transcript: transcriptResult.transcript,
      cacheDir,
      providerKey: transcriptResult.providerKey,
      generatedAt: transcriptResult.artifact.generatedAt,
    });
    analysisArtifacts.push(transcriptResult.artifact, packed.artifact);
    analysis.artifactIds = analysisArtifacts.map((artifact) => artifact.id);
  }
  const nextSources = (project.sources ?? []).map((item) =>
    item.id === sourceId
      ? { ...item, analysisStatus: 'done' as const, analysisId: analysis.id }
      : item,
  );
  const next = {
    ...project,
    sources: nextSources,
    sourceAnalyses: [
      ...(project.sourceAnalyses ?? []).filter(
        (item) => item.sourceId !== sourceId,
      ),
      analysis,
    ],
    analysisArtifacts:
      analysisArtifacts.length > 0
        ? mergeSourceAnalysisArtifacts(
            project.analysisArtifacts ?? [],
            source,
            analysisArtifacts,
          )
        : project.analysisArtifacts,
    updatedAt: new Date().toISOString(),
  };
  await writeProject(next);
  insertAnalysisRow(projectId, analysis);
  return { project: next, analysis };
}

export async function getPackedTranscript(
  projectId: string,
  sourceId?: string,
) {
  const project = await getProject(projectId);
  const root = getVideoProjectRoot(projectId);
  const artifacts = (project.analysisArtifacts ?? []).filter(
    (artifact) =>
      artifact.kind === 'packed-transcript' &&
      (!sourceId || artifact.sourceMediaId === sourceId),
  );
  return {
    projectId,
    sourceId,
    artifacts: await Promise.all(
      artifacts.map(async (artifact) => ({
        artifact,
        payload: await readAnalysisArtifactCache(root, artifact),
      })),
    ),
  };
}

export async function inspectSourceRange(
  projectId: string,
  sourceId: string,
  input: InspectSourceRangeInput,
  dependencies?: SourceRangeEvidenceDependencies,
) {
  const project = await getProject(projectId);
  const source = (project.sources ?? []).find((item) => item.id === sourceId);
  if (!source) throw new Error('Source not found');
  const asset = project.assets.find((item) => item.id === source.mediaItemId);
  if (!asset) throw new Error('Source asset not found');
  const analysis =
    (project.sourceAnalyses ?? []).find((item) => item.sourceId === sourceId) ??
    null;
  const root = getVideoProjectRoot(projectId);
  const cacheDir = getVideoSourceAnalysisCacheDirForRoot(
    root,
    projectId,
    source.contentHash,
  );
  const evidence = await buildSourceRangeEvidenceArtifact({
    source,
    asset,
    analysis,
    workspaceRoot: root,
    cacheDir,
    startMs: input.startMs,
    endMs: input.endMs,
    frameCount: input.frameCount,
    waveformBins: input.waveformBins,
    dependencies,
  });
  const next = {
    ...project,
    sourceAnalyses: (project.sourceAnalyses ?? []).map((item) =>
      item.sourceId === sourceId
        ? {
            ...item,
            artifactIds: uniqueStrings([
              ...(item.artifactIds ?? []),
              evidence.artifact.id,
            ]),
          }
        : item,
    ),
    analysisArtifacts: [
      ...(project.analysisArtifacts ?? []).filter(
        (artifact) => artifact.id !== evidence.artifact.id,
      ),
      evidence.artifact,
    ],
    updatedAt: new Date().toISOString(),
  };
  await writeProject(next);
  return { project: next, ...evidence };
}

export async function getSourceAnalysis(
  projectId: string,
  sourceId: string,
): Promise<SourceMediaAnalysis | null> {
  const project = await getProject(projectId);
  return (
    (project.sourceAnalyses ?? []).find((item) => item.sourceId === sourceId) ??
    null
  );
}

export async function createCutPlan(
  projectId: string,
  sourceId: string,
  input: {
    candidateIds?: string[];
    mode?: 'cut' | 'speed-up' | 'review-only';
    approved?: boolean;
  },
): Promise<{ project: VideoProject; cutPlan: SourceCutPlan }> {
  const project = await getProject(projectId);
  const analysis = (project.sourceAnalyses ?? []).find(
    (item) => item.sourceId === sourceId,
  );
  if (!analysis) throw new Error('Source analysis not found');
  const selected = input.candidateIds?.length
    ? analysis.cutCandidates.filter((candidate) =>
        input.candidateIds?.includes(candidate.id),
      )
    : analysis.cutCandidates;
  const keepRanges = buildKeepRanges(analysis.durationMs, selected);
  const cutPlan: SourceCutPlan = {
    id: randomUUID(),
    sourceId,
    status: input.approved ? 'approved' : 'draft',
    keepRanges: keepRanges.map((range) => ({
      startMs: range.sourceStartMs,
      endMs: range.sourceEndMs,
      sourceCandidateIds: selected.map((candidate) => candidate.id),
    })),
    cutCandidates: selected,
    timeMap: { sourceId, keepRanges },
    approvedAt: input.approved ? new Date().toISOString() : undefined,
  };
  const next = {
    ...project,
    cutPlans: [...(project.cutPlans ?? []), cutPlan],
    updatedAt: new Date().toISOString(),
  };
  await writeProject(next);
  insertCutPlanRow(projectId, cutPlan);
  return { project: next, cutPlan };
}

export async function applyCutPlan(
  projectId: string,
  cutPlanId: string,
): Promise<{ project: VideoProject; cutPlan: SourceCutPlan }> {
  const project = await getProject(projectId);
  const cutPlan = (project.cutPlans ?? []).find(
    (item) => item.id === cutPlanId,
  );
  if (!cutPlan) throw new Error('Cut plan not found');
  if (cutPlan.status !== 'approved') {
    throw new Error('Cut plan must be approved before apply');
  }
  const source = (project.sources ?? []).find(
    (item) => item.id === cutPlan.sourceId,
  );
  if (!source) throw new Error('Source not found');
  const analysis = (project.sourceAnalyses ?? []).find(
    (item) => item.sourceId === cutPlan.sourceId,
  );
  const timeline =
    project.timeline ?? rebuildTimelineFromStoryboard(project).timeline;
  if (!timeline) throw new Error('Timeline required');
  const compilation = compileSourceCutPlanTimelineOps({
    timeline,
    cutPlan,
    sourceAssetId: source.mediaItemId,
    words: analysis?.transcript?.words,
  });
  if (compilation.ops.length === 0) {
    throw new Error('Cut plan does not match any editable timeline ranges');
  }
  const now = new Date().toISOString();
  const execution = applyProjectTimelineOps(project, {
    ops: compilation.ops,
    source: 'agent',
    summary: `Applied source cut plan ${cutPlan.id}`,
    now,
  });
  const actionArtifact = buildCutPlanActionArtifact(
    source,
    cutPlan,
    compilation.ops,
    compilation.matchedCandidateIds,
    now,
  );
  const applied: SourceCutPlan = {
    ...cutPlan,
    status: 'applied',
    appliedAt: now,
  };
  const next = {
    ...execution.project,
    cutPlans: (execution.project.cutPlans ?? []).map((item) =>
      item.id === cutPlanId ? applied : item,
    ),
    sourceAnalyses: (execution.project.sourceAnalyses ?? []).map((item) =>
      item.sourceId === cutPlan.sourceId
        ? {
            ...item,
            artifactIds: uniqueStrings([
              ...(item.artifactIds ?? []),
              actionArtifact.id,
            ]),
          }
        : item,
    ),
    analysisArtifacts: [
      ...(execution.project.analysisArtifacts ?? []).filter(
        (artifact) => artifact.id !== actionArtifact.id,
      ),
      actionArtifact,
    ],
    updatedAt: execution.project.updatedAt,
  };
  await writeProject(next);
  insertCutPlanRow(projectId, applied);
  return { project: next, cutPlan: applied };
}

export async function getStoryboard(
  projectId: string,
): Promise<Storyboard | null> {
  return (await getProject(projectId)).storyboard ?? null;
}

/**
 * Set the project's output aspect ratio (the source of truth the editor preview,
 * render, and agent all read from `settings.defaultAspectRatios[0]`). Lets the
 * agent match a reference's orientation mid-conversation (e.g. switch a default
 * 16:9 project to 9:16 for a vertical reference).
 */
export async function setVideoProjectAspectRatio(
  projectId: string,
  aspect: AspectRatio,
): Promise<VideoProject> {
  return updateProjectDocument(projectId, (project) => ({
    ...project,
    settings: {
      ...(project.settings ?? {}),
      defaultAspectRatios: [aspect],
    },
    updatedAt: new Date().toISOString(),
  }));
}

export async function setStoryboard(
  projectId: string,
  storyboard: Storyboard,
): Promise<VideoProject> {
  return updateProjectDocument(projectId, (project) =>
    rebuildTimelineFromStoryboard({
      ...project,
      storyboard,
      renderPlan: undefined,
      updatedAt: new Date().toISOString(),
    }),
  );
}

export async function patchStoryboard(
  projectId: string,
  patch: Partial<Storyboard>,
): Promise<{ project: VideoProject; storyboard: Storyboard }> {
  const project = await getProject(projectId);
  const current = project.storyboard;
  if (!current) throw new Error('Storyboard not found');
  const scenes = patch.scenes ?? current.scenes;
  const totalDurationMs =
    patch.totalDurationMs ??
    scenes.reduce((total, scene) => total + scene.durationMs, 0);
  const storyboard: Storyboard = {
    ...current,
    ...patch,
    scenes,
    totalDurationMs,
    costEstimateUsd: estimateStoryboardCostUsd({ scenes }),
    status: current.status === 'approved' ? 'approved' : 'edited',
  };
  const next = await setStoryboard(projectId, storyboard);
  return { project: next, storyboard };
}

export async function approveStoryboard(
  projectId: string,
  opts: { by?: 'user' | 'auto' } = {},
): Promise<{
  project: VideoProject;
  storyboard: Storyboard;
  jobs: VideoJob[];
}> {
  const project = await getProject(projectId);
  const storyboard = project.storyboard;
  if (!storyboard) throw new Error('Storyboard not found');
  validateStoryboardForApproval(project, storyboard);

  const approved: Storyboard = {
    ...storyboard,
    status: 'approved',
    approvedAt: new Date().toISOString(),
    approvedBy: opts.by ?? 'user',
    costEstimateUsd: estimateStoryboardCostUsd(storyboard),
  };
  const jobs = buildStoryboardJobs(projectId, approved);
  const next = await updateProjectDocument(projectId, (current) =>
    rebuildTimelineFromStoryboard({
      ...current,
      storyboard: approved,
      renderPlan: undefined,
      scenes: approved.scenes.map((scene) => ({
        id: scene.id,
        durationMs: scene.durationMs,
        clips:
          scene.assetPlan.kind === 'existing' ||
          scene.assetPlan.kind === 'image-pan'
            ? [
                {
                  id: randomUUID(),
                  mediaId: scene.assetPlan.assetId,
                  trim:
                    scene.assetPlan.kind === 'existing'
                      ? scene.assetPlan.trimMs
                      : undefined,
                },
              ]
            : [],
        transition: scene.transition,
        subtitles: scene.caption
          ? [
              {
                id: randomUUID(),
                text: scene.caption.text,
                startMs: 0,
                endMs: scene.durationMs,
                style: scene.caption.style,
              },
            ]
          : [],
      })),
      updatedAt: new Date().toISOString(),
    }),
  );
  jobs.forEach(insertJob);
  return { project: next, storyboard: approved, jobs };
}

/**
 * Auto-approve a storyboard that costs nothing to produce (all local/existing
 * assets, free providers) so the agent can render local-asset videos without the
 * manual approval gate. The gate's purpose is to confirm spend before paid AI
 * generation — when the estimate is $0 there is nothing to confirm. Paid
 * storyboards are left untouched and still require explicit user approval.
 * Returns true when it auto-approved. Never throws (best-effort).
 */
export async function autoApproveFreeStoryboard(
  projectId: string,
): Promise<boolean> {
  try {
    const project = await getProject(projectId);
    const storyboard = project.storyboard;
    if (!storyboard || storyboard.status === 'approved') return false;
    if (estimateStoryboardCostUsd(storyboard).high > 0) return false;
    await approveStoryboard(projectId, { by: 'auto' });
    return true;
  } catch {
    return false;
  }
}

export async function rejectStoryboard(projectId: string): Promise<{
  project: VideoProject;
  storyboard: Storyboard;
  cancelledJobs: number;
}> {
  const project = await getProject(projectId);
  const storyboard = project.storyboard;
  if (!storyboard) throw new Error('Storyboard not found');
  const draft: Storyboard = {
    ...storyboard,
    status: 'draft',
    approvedAt: undefined,
    approvedBy: undefined,
  };
  const cancelled = cancelProjectJobs(projectId, ['queued', 'running']);
  const next = await setStoryboard(projectId, draft);
  return { project: next, storyboard: draft, cancelledJobs: cancelled };
}

export async function replanStoryboardScene(
  projectId: string,
  sceneId: string,
  hint?: string,
): Promise<{ project: VideoProject; storyboard: Storyboard }> {
  const project = await getProject(projectId);
  const storyboard = project.storyboard;
  if (!storyboard) throw new Error('Storyboard not found');
  const scenes = storyboard.scenes.map((scene) => {
    if (scene.id !== sceneId) return scene;
    const intent = hint?.trim()
      ? `${scene.intent} (${hint.trim()})`
      : `${scene.intent} refined`;
    return {
      ...scene,
      intent,
      caption: scene.caption
        ? { ...scene.caption, text: intent }
        : { text: intent },
      assetPlan:
        scene.assetPlan.kind === 'ai-clip' ||
        scene.assetPlan.kind === 'ai-image'
          ? { ...scene.assetPlan, prompt: intent }
          : scene.assetPlan,
    };
  });
  if (!scenes.some((scene) => scene.id === sceneId)) {
    throw new Error('Storyboard scene not found');
  }
  return patchStoryboard(projectId, { scenes });
}

export async function generateStoryboardDraft(
  projectId: string,
): Promise<{ project: VideoProject; storyboard: Storyboard }> {
  const project = await getProject(projectId);
  const scenes = buildStoryboardScenes(project);
  const totalDurationMs = scenes.reduce(
    (total, scene) => total + scene.durationMs,
    0,
  );
  const storyboard: Storyboard = {
    status: 'draft',
    intent: project.prompt || project.name,
    totalDurationMs,
    costEstimateUsd: estimateStoryboardCostUsd({ scenes }),
    scenes,
  };
  const next = await setStoryboard(projectId, storyboard);
  return { project: next, storyboard };
}

export async function writeProject(project: VideoProject): Promise<void> {
  const root = getVideoProjectRoot(project.id);
  const dir = getVideoProjectDirForRoot(root, project.id);
  await fs.mkdir(dir, { recursive: true });
  const filePath = getVideoProjectJsonPathForRoot(root, project.id);
  const tmpPath = `${filePath}.${randomUUID()}.tmp`;
  const document = withProjectSchemaVersion(project);
  await fs.writeFile(tmpPath, `${JSON.stringify(document, null, 2)}\n`);
  await fs.rename(tmpPath, filePath);
}

function withProjectSchemaVersion(project: VideoProject): VideoProject {
  return project.schemaVersion === VIDEO_PROJECT_SCHEMA_VERSION
    ? project
    : { ...project, schemaVersion: VIDEO_PROJECT_SCHEMA_VERSION };
}

export async function updateProjectDocument(
  projectId: string,
  update: (project: VideoProject) => VideoProject | Promise<VideoProject>,
): Promise<VideoProject> {
  const previous =
    projectDocumentUpdateLocks.get(projectId) ?? Promise.resolve();
  const run = previous
    .catch(() => undefined)
    .then(async () => {
      const next = await update(await getProject(projectId));
      await writeProject(next);
      getDatabase()
        .prepare(
          `UPDATE video_projects
         SET name = ?, template = ?, updated_at = ?, render_status = ?,
             budget_cap_cents = ?, budget_spent_cents = ?
         WHERE id = ?`,
        )
        .run(
          next.name,
          next.template,
          next.updatedAt,
          next.render?.status ?? 'idle',
          Math.round((next.budget?.capUsd ?? 0) * 100),
          Math.round((next.budget?.spentUsd ?? 0) * 100),
          next.id,
        );
      return next;
    });
  const tail = run.catch(() => undefined);
  projectDocumentUpdateLocks.set(projectId, tail);
  try {
    return await run;
  } finally {
    if (projectDocumentUpdateLocks.get(projectId) === tail) {
      projectDocumentUpdateLocks.delete(projectId);
    }
  }
}

function assertSafeId(id: string): void {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new Error('Invalid video project id');
  }
}

async function copyAssetIntoProject(
  projectId: string,
  sourcePath: string,
): Promise<MediaItem> {
  const dest = await allocateAssetPath(projectId, path.basename(sourcePath));
  await fs.copyFile(sourcePath, dest, fsConstants.COPYFILE_FICLONE);
  return mediaItemFromPath(dest, 'user', getVideoProjectRoot(projectId));
}

async function allocateAssetPath(
  projectId: string,
  filename: string,
): Promise<string> {
  const assetDir = getVideoAssetsDir(projectId);
  await fs.mkdir(assetDir, { recursive: true });
  const safeName =
    path.basename(filename).replaceAll('\u0000', '_').replace(/[/\\]/g, '_') ||
    'asset';
  const prefix = randomUUID().replace(/-/g, '').slice(0, 8);
  return path.join(assetDir, `${prefix}_${safeName}`);
}

async function allocateSourcePath(
  projectId: string,
  filename: string,
): Promise<string> {
  const sourceDir = getVideoSourcesDir(projectId);
  await fs.mkdir(sourceDir, { recursive: true });
  const safeName =
    path.basename(filename).replaceAll('\u0000', '_').replace(/[/\\]/g, '_') ||
    'source';
  const prefix = randomUUID().replace(/-/g, '').slice(0, 8);
  return path.join(sourceDir, `${prefix}_${safeName}`);
}

export async function mediaItemFromPath(
  absolutePath: string,
  source: MediaItem['source'],
  root = getVideoWorkspaceRoot(),
): Promise<MediaItem> {
  const metadata = await enrichImageMetadata(
    absolutePath,
    await readMediaMetadata(absolutePath, root),
  );
  return {
    id: randomUUID(),
    kind: inferKind(absolutePath, metadata),
    source,
    path: path.relative(root, absolutePath),
    metadata,
  };
}

async function enrichImageMetadata(
  filePath: string,
  metadata: MediaMetadata,
): Promise<MediaMetadata> {
  if (metadata.width && metadata.height) return metadata;
  if (!IMAGE_METADATA_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
    return metadata;
  }
  try {
    const sharp = (await import('sharp')).default;
    const image = await sharp(filePath).metadata();
    if (!image.width || !image.height) return metadata;
    return { ...metadata, width: image.width, height: image.height };
  } catch (error) {
    logger.warn('video.asset.image_metadata_failed', {
      file: path.basename(filePath),
      error: error instanceof Error ? error.message : String(error),
    });
    return metadata;
  }
}

function inferKind(
  filePath: string,
  metadata: MediaMetadata,
): MediaItem['kind'] {
  const ext = path.extname(filePath).toLowerCase();
  if (metadata.width && metadata.height) {
    return metadata.durationMs > 1000 || ['.mp4', '.mov', '.webm'].includes(ext)
      ? 'video'
      : 'image';
  }
  if (['.wav', '.mp3', '.m4a', '.aac', '.flac', '.ogg'].includes(ext)) {
    return 'audio';
  }
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif'].includes(ext)) {
    return 'image';
  }
  return 'video';
}

function safeJson(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

async function hashFile(filePath: string): Promise<string> {
  // Source videos can be multi-GB; loading the whole file into memory OOMs
  // the sidecar. Stream the file through the hash instead.
  const hash = createHash('sha256');
  await streamPipeline(createReadStream(filePath), hash);
  return hash.digest('hex');
}

function buildDeterministicAnalysis(
  source: SourceMedia,
  metadata: MediaMetadata,
  durationMs: number,
): SourceMediaAnalysis {
  const sceneMidpoint = Math.max(1000, Math.floor(durationMs / 2));
  const candidates: CutCandidate[] = [];
  if (durationMs > 4000) {
    candidates.push({
      id: randomUUID(),
      sourceId: source.id,
      startMs: 0,
      endMs: Math.min(1200, Math.floor(durationMs * 0.1)),
      reason: 'dead-air',
      confidence: 0.7,
      destructive: false,
      evidence: [
        {
          kind: 'heuristic',
          summary: 'Opening handle reserved for silence or setup trimming.',
          score: 0.7,
        },
      ],
      recommendation: 'review-only',
    });
  }
  if (!metadata.audioTrackCount) {
    candidates.push({
      id: randomUUID(),
      sourceId: source.id,
      startMs: sceneMidpoint,
      endMs: Math.min(durationMs, sceneMidpoint + 1000),
      reason: 'low-value',
      confidence: 0.45,
      destructive: false,
      evidence: [
        {
          kind: 'quality',
          summary: 'No audio track detected; review visual-only section.',
          score: 0.45,
        },
      ],
      recommendation: 'review-only',
    });
  }
  return {
    id: randomUUID(),
    sourceId: source.id,
    contentHash: source.contentHash,
    durationMs,
    streams: metadata,
    scenes: [
      {
        id: randomUUID(),
        startMs: 0,
        endMs: sceneMidpoint,
        confidence: 0.6,
        method: 'ffmpeg-scdet',
      },
      {
        id: randomUUID(),
        startMs: sceneMidpoint,
        endMs: durationMs,
        confidence: 0.6,
        method: 'ffmpeg-scdet',
      },
    ],
    speechRanges: metadata.audioTrackCount
      ? [{ startMs: 0, endMs: durationMs, source: 'vad' }]
      : [],
    visualBeats: [
      {
        startMs: 0,
        endMs: durationMs,
        caption: 'Imported source material',
        tags: ['source'],
        source: 'scene-detector',
      },
    ],
    qualitySignals: metadata.audioTrackCount
      ? []
      : [
          {
            startMs: 0,
            endMs: durationMs,
            kind: 'silence',
            score: 1,
            evidence: 'No audio stream detected by ffprobe.',
          },
        ],
    duplicateCandidates: [],
    cutCandidates: candidates,
    generatedAt: new Date().toISOString(),
  };
}

function buildSpeechRangesFromWords(words: SubtitleWord[]): SpeechRange[] {
  const ranges: SpeechRange[] = [];
  const sorted = [...words].sort(
    (a, b) => a.startMs - b.startMs || a.endMs - b.endMs,
  );
  for (const word of sorted) {
    if (!Number.isFinite(word.startMs) || !Number.isFinite(word.endMs)) {
      continue;
    }
    const current = ranges[ranges.length - 1];
    if (!current || word.startMs - current.endMs > 700) {
      ranges.push({
        startMs: Math.max(0, Math.round(word.startMs)),
        endMs: Math.max(0, Math.round(word.endMs)),
        source: 'asr',
      });
      continue;
    }
    current.endMs = Math.max(current.endMs, Math.round(word.endMs));
  }
  return ranges;
}

function mergeSourceAnalysisArtifacts(
  existing: AnalysisArtifact[],
  source: SourceMedia,
  replacements: AnalysisArtifact[],
): AnalysisArtifact[] {
  const replacementKinds = new Set<AnalysisArtifactKind>([
    'transcript-ranges',
    'packed-transcript',
  ]);
  return [
    ...existing.filter(
      (artifact) =>
        !(
          artifact.sourceMediaId === source.id &&
          artifact.contentHash === source.contentHash &&
          replacementKinds.has(artifact.kind)
        ),
    ),
    ...replacements,
  ];
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function buildCutPlanActionArtifact(
  source: SourceMedia,
  cutPlan: SourceCutPlan,
  ops: TimelineOp[],
  matchedCandidateIds: string[],
  generatedAt: string,
): AnalysisArtifact {
  const matchedIds = new Set(matchedCandidateIds);
  const matchedCandidates = cutPlan.cutCandidates.filter((candidate) =>
    matchedIds.has(candidate.id),
  );
  return {
    id: `cut-plan-action-${cutPlan.id}`,
    kind: 'cut-candidates',
    sourceMediaId: source.id,
    contentHash: source.contentHash,
    summary: `Apply ${ops.length} timeline operation${ops.length === 1 ? '' : 's'} from approved source cut plan.`,
    ranges: matchedCandidates.map((candidate) => ({
      id: candidate.id,
      startMs: candidate.startMs,
      endMs: candidate.endMs,
      label: candidate.reason,
      confidence: candidate.confidence,
    })),
    proposedActionBatch: {
      id: cutPlan.id,
      summary: `Apply source cut plan ${cutPlan.id}`,
      ops,
    },
    metadata: {
      cutPlanId: cutPlan.id,
      candidateIds: matchedCandidates.map((candidate) => candidate.id),
      operationCount: ops.length,
    },
    generatedAt,
  };
}

async function readAnalysisArtifactCache(
  root: string,
  artifact: AnalysisArtifact,
): Promise<unknown | null> {
  if (!artifact.cachePath) return null;
  try {
    const resolved = validatePath(artifact.cachePath, root, 'read');
    return JSON.parse(await fs.readFile(resolved, 'utf8')) as unknown;
  } catch (error) {
    logger.warn('video.analysis_artifact.cache_read_failed', {
      artifact_id: artifact.id,
      kind: artifact.kind,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

// Rotating Ken Burns presets so a photo slideshow gets varied, non-monotonous
// motion (alternating zoom-in/out and horizontal pans) instead of static frames.
// Rects are normalized 0..1 sub-regions; the renderer eases from `from` to `to`.
const KEN_BURNS_PRESETS: ReadonlyArray<{
  from: { x: number; y: number; width: number; height: number };
  to: { x: number; y: number; width: number; height: number };
}> = [
  // slow zoom in (center)
  {
    from: { x: 0, y: 0, width: 1, height: 1 },
    to: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
  },
  // slow zoom out (center)
  {
    from: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
    to: { x: 0, y: 0, width: 1, height: 1 },
  },
  // pan left -> right with a gentle zoom
  {
    from: { x: 0, y: 0.05, width: 0.82, height: 0.82 },
    to: { x: 0.18, y: 0.13, width: 0.82, height: 0.82 },
  },
  // pan right -> left with a gentle zoom
  {
    from: { x: 0.18, y: 0.13, width: 0.82, height: 0.82 },
    to: { x: 0, y: 0.05, width: 0.82, height: 0.82 },
  },
];

function defaultKenBurns(index: number): {
  from: { x: number; y: number; width: number; height: number };
  to: { x: number; y: number; width: number; height: number };
} {
  return KEN_BURNS_PRESETS[index % KEN_BURNS_PRESETS.length]!;
}

function buildStoryboardScenes(project: VideoProject): StoryboardScene[] {
  const scriptLines = (project.script ?? project.prompt)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 6);
  const seeds = scriptLines.length
    ? scriptLines
    : [project.prompt || project.name || 'Opening scene'];
  const brollSources = (project.linkedSources ?? []).filter(
    (source) =>
      source.role === 'b-roll' &&
      source.index.state !== 'error' &&
      (source.index.fileCount ?? 0) > 0,
  );
  return seeds.map((line, index) => {
    const asset = project.assets[index % Math.max(project.assets.length, 1)];
    return {
      id: randomUUID(),
      durationMs: project.template === 'ugc-ad' ? 3000 : 5000,
      intent: line,
      transition: index === 0 ? 'cut' : 'dissolve',
      caption: { text: line },
      assetPlan: asset
        ? asset.kind === 'image'
          ? {
              kind: 'image-pan',
              assetId: asset.id,
              kenBurns: defaultKenBurns(index),
            }
          : { kind: 'existing', assetId: asset.id }
        : brollSources.length
          ? {
              kind: 'broll-search',
              query: line,
              provider: 'linked',
              sourceIds: brollSources.map((source) => source.id),
            }
          : {
              kind: 'ai-clip',
              prompt: line,
              provider: 'seedance-2-0-fast',
              aspectRatio: '16:9',
              durationMs: 5000,
            },
    };
  });
}

function buildKeepRanges(durationMs: number, candidates: CutCandidate[]) {
  const cuts = [...candidates]
    .filter((candidate) => candidate.recommendation === 'cut')
    .sort((a, b) => a.startMs - b.startMs);
  const ranges: Array<{
    sourceStartMs: number;
    sourceEndMs: number;
    outputStartMs: number;
    outputEndMs: number;
  }> = [];
  let sourceCursor = 0;
  let outputCursor = 0;
  for (const cut of cuts) {
    if (cut.startMs > sourceCursor) {
      const duration = cut.startMs - sourceCursor;
      ranges.push({
        sourceStartMs: sourceCursor,
        sourceEndMs: cut.startMs,
        outputStartMs: outputCursor,
        outputEndMs: outputCursor + duration,
      });
      outputCursor += duration;
    }
    sourceCursor = Math.max(sourceCursor, cut.endMs);
  }
  if (sourceCursor < durationMs) {
    ranges.push({
      sourceStartMs: sourceCursor,
      sourceEndMs: durationMs,
      outputStartMs: outputCursor,
      outputEndMs: outputCursor + durationMs - sourceCursor,
    });
  }
  return ranges;
}

function insertSourceRow(projectId: string, source: SourceMedia): void {
  getDatabase()
    .prepare(
      `INSERT OR REPLACE INTO video_sources
        (id, project_id, media_item_id, origin, source_url, content_hash,
         analysis_status, provenance_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      source.id,
      projectId,
      source.mediaItemId,
      source.origin,
      source.sourceUrl ?? null,
      source.contentHash,
      source.analysisStatus,
      JSON.stringify({ rights: source.rights }),
      source.createdAt,
    );
}

function insertAnalysisRow(
  projectId: string,
  analysis: SourceMediaAnalysis,
): void {
  getDatabase()
    .prepare(
      `INSERT OR REPLACE INTO video_source_analyses
        (id, project_id, source_id, content_hash, status, result_json,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      analysis.id,
      projectId,
      analysis.sourceId,
      analysis.contentHash,
      'done',
      JSON.stringify(analysis),
      analysis.generatedAt,
      new Date().toISOString(),
    );
}

function insertCutPlanRow(projectId: string, cutPlan: SourceCutPlan): void {
  getDatabase()
    .prepare(
      `INSERT OR REPLACE INTO video_cut_plans
        (id, project_id, source_id, status, payload_json, approved_at,
         applied_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      cutPlan.id,
      projectId,
      cutPlan.sourceId,
      cutPlan.status,
      JSON.stringify(cutPlan),
      cutPlan.approvedAt ?? null,
      cutPlan.appliedAt ?? null,
      new Date().toISOString(),
    );
}

function validateStoryboardForApproval(
  project: VideoProject,
  storyboard: Storyboard,
): void {
  const maxDurationMs =
    project.template === 'ugc-ad'
      ? 15_000
      : project.template === 'custom'
        ? Number.POSITIVE_INFINITY
        : 60_000;
  if (storyboard.totalDurationMs > maxDurationMs) {
    throw new Error('Storyboard exceeds template duration limit');
  }

  const estimate = estimateStoryboardCostCents(storyboard);
  const budgetCapCents = Math.round((project.budget?.capUsd ?? 0) * 100);
  if (estimate.high > budgetCapCents) {
    throw new Error('Storyboard cost exceeds budget cap');
  }

  const assetIds = new Set(project.assets.map((asset) => asset.id));
  for (const scene of storyboard.scenes) {
    if (scene.durationMs <= 0) {
      throw new Error('Storyboard scene duration must be positive');
    }
    const plan = scene.assetPlan;
    if (
      (plan.kind === 'existing' || plan.kind === 'image-pan') &&
      !assetIds.has(plan.assetId)
    ) {
      throw new Error(
        `Storyboard scene references missing asset ${plan.assetId}`,
      );
    }
    if (
      (plan.kind === 'ai-clip' ||
        plan.kind === 'ai-image' ||
        plan.kind === 'broll-search' ||
        plan.kind === 'tts-narration') &&
      !('prompt' in plan || 'query' in plan || 'text' in plan)
    ) {
      throw new Error('Storyboard scene has an incomplete asset plan');
    }
  }
}

function buildStoryboardJobs(
  projectId: string,
  storyboard: Storyboard,
): VideoJob[] {
  return storyboard.scenes.flatMap((scene) => {
    const plan = scene.assetPlan;
    if (plan.kind !== 'ai-clip' && plan.kind !== 'ai-image') return [];
    return [
      {
        id: randomUUID(),
        projectId,
        kind: 'clip-gen',
        status: 'queued',
        payload: {
          sceneId: scene.id,
          assetPlan: plan,
          durationMs:
            plan.kind === 'ai-clip'
              ? (plan.durationMs ?? scene.durationMs)
              : scene.durationMs,
        },
        caller: 'in-app',
      },
    ];
  });
}

function cancelProjectJobs(
  projectId: string,
  statuses: Array<VideoJob['status']>,
): number {
  const result = getDatabase()
    .prepare(
      `UPDATE video_jobs
       SET status = 'cancelled', updated_at = ?
       WHERE project_id = ?
         AND status IN (${statuses.map(() => '?').join(', ')})`,
    )
    .run(new Date().toISOString(), projectId, ...statuses);
  return result.changes;
}

function insertJob(job: VideoJob): void {
  getDatabase()
    .prepare(
      `INSERT INTO video_jobs
        (id, project_id, kind, status, payload_json, result_json,
         started_at, finished_at, cost_cents, caller)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      job.id,
      job.projectId,
      job.kind,
      job.status,
      JSON.stringify(job.payload),
      JSON.stringify(job.result ?? {}),
      job.startedAt ?? null,
      job.finishedAt ?? null,
      job.costCents ?? 0,
      job.caller,
    );
}
