import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { createLogger } from '@/shared/utils/logger';

import { getVideoProjectDir } from './store';
import type { VideoProject } from './types';

const logger = createLogger('VideoProjectHistory');

/** Automatic revisions kept per project. Named versions are never pruned. */
export const DEFAULT_AUTOMATIC_RETENTION = 50;

export type ProjectRevisionAuthorKind = 'user' | 'agent' | 'system' | 'restore';

export interface ProjectRevisionEntry {
  /** sha256 of the snapshot bytes. Content-addressed: identical documents share one file. */
  digest: string;
  revision: number;
  createdAt: string;
  authorKind: ProjectRevisionAuthorKind;
  /** Present when an agent run produced this revision. */
  runId?: string;
  reason?: string;
  /** A named version is protected from retention pruning. */
  name?: string;
  counts: {
    tracks: number;
    clips: number;
    assets: number;
  };
  durationMs: number;
}

export interface ProjectRevisionIndex {
  schema: 'neuma.video.project-history.v1';
  entries: ProjectRevisionEntry[];
}

const EMPTY_INDEX: ProjectRevisionIndex = {
  schema: 'neuma.video.project-history.v1',
  entries: [],
};

export function historyDir(projectId: string): string {
  return path.join(getVideoProjectDir(projectId), '.history');
}

function snapshotsDir(projectId: string): string {
  return path.join(historyDir(projectId), 'snapshots');
}

function indexPath(projectId: string): string {
  return path.join(historyDir(projectId), 'index.json');
}

function snapshotPath(projectId: string, digest: string): string {
  // Two-character shard so a long-lived project does not put thousands of
  // files in one directory.
  return path.join(
    snapshotsDir(projectId),
    digest.slice(0, 2),
    `${digest}.json`,
  );
}

export function projectDigest(project: VideoProject): string {
  return createHash('sha256').update(serializeProject(project)).digest('hex');
}

function serializeProject(project: VideoProject): string {
  return `${JSON.stringify(project, null, 2)}\n`;
}

export async function readRevisionIndex(
  projectId: string,
): Promise<ProjectRevisionIndex> {
  try {
    const raw = await fs.readFile(indexPath(projectId), 'utf8');
    const parsed = JSON.parse(raw) as ProjectRevisionIndex;
    if (parsed.schema !== EMPTY_INDEX.schema) return { ...EMPTY_INDEX };
    return { ...parsed, entries: parsed.entries ?? [] };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ...EMPTY_INDEX };
    }
    // A corrupt index must not take the project down with it: the snapshots are
    // still on disk and recoverable by hand.
    logger.warn(
      `Project ${projectId} revision index unreadable, starting a new one: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { ...EMPTY_INDEX };
  }
}

async function writeRevisionIndex(
  projectId: string,
  index: ProjectRevisionIndex,
): Promise<void> {
  const target = indexPath(projectId);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(index, null, 2)}\n`);
  await fs.rename(tmp, target);
}

export interface RecordRevisionInput {
  authorKind: ProjectRevisionAuthorKind;
  runId?: string;
  reason?: string;
  name?: string;
  retention?: number;
}

/**
 * Write a content-addressed snapshot of a project and append it to the index.
 *
 * Ordering matters and is the point of this function: the snapshot file is
 * durable **before** the index names it, and pruning happens only after both
 * are on disk. A crash between the two leaves an unreferenced snapshot, which
 * costs disk; the reverse order would leave the index pointing at a file that
 * does not exist, which costs a restore.
 */
export async function recordProjectRevision(
  project: VideoProject,
  input: RecordRevisionInput,
): Promise<ProjectRevisionEntry> {
  const digest = projectDigest(project);
  const target = snapshotPath(project.id, digest);
  await fs.mkdir(path.dirname(target), { recursive: true });

  // Content-addressed, so an identical document is already stored.
  let exists = true;
  try {
    await fs.access(target);
  } catch {
    exists = false;
  }
  if (!exists) {
    const tmp = `${target}.${randomUUID()}.tmp`;
    await fs.writeFile(tmp, serializeProject(project));
    await fs.rename(tmp, target);
  }

  const entry: ProjectRevisionEntry = {
    digest,
    revision: project.revision,
    createdAt: new Date().toISOString(),
    authorKind: input.authorKind,
    ...(input.runId ? { runId: input.runId } : {}),
    ...(input.reason ? { reason: input.reason } : {}),
    ...(input.name ? { name: input.name } : {}),
    counts: countProject(project),
    durationMs: project.timeline?.durationMs ?? 0,
  };

  const index = await readRevisionIndex(project.id);
  const entries = [...index.entries, entry];
  await writeRevisionIndex(project.id, { ...index, entries });

  // Prune only once the new snapshot and index are both durable.
  await pruneRevisions(
    project.id,
    input.retention ?? DEFAULT_AUTOMATIC_RETENTION,
  );
  return entry;
}

function countProject(project: VideoProject): ProjectRevisionEntry['counts'] {
  const tracks = project.timeline?.tracks ?? [];
  return {
    tracks: tracks.length,
    clips: tracks.reduce((total, track) => total + track.clips.length, 0),
    assets: project.assets.length,
  };
}

/**
 * Drop the oldest automatic revisions past the retention limit. Named versions
 * are protected and do not count toward it — a user who named a version meant
 * to keep it.
 */
export async function pruneRevisions(
  projectId: string,
  retention = DEFAULT_AUTOMATIC_RETENTION,
): Promise<ProjectRevisionEntry[]> {
  const index = await readRevisionIndex(projectId);
  const automatic = index.entries.filter((entry) => !entry.name);
  if (automatic.length <= retention) return [];

  const dropCount = automatic.length - retention;
  const dropped = new Set(
    automatic.slice(0, dropCount).map((entry) => entry.digest),
  );
  const kept = index.entries.filter(
    (entry) => Boolean(entry.name) || !dropped.has(entry.digest),
  );
  await writeRevisionIndex(projectId, { ...index, entries: kept });

  // A digest still referenced by a surviving entry keeps its file: two
  // revisions of an identical document share one snapshot.
  const stillReferenced = new Set(kept.map((entry) => entry.digest));
  const removed: ProjectRevisionEntry[] = [];
  for (const entry of index.entries) {
    if (!dropped.has(entry.digest) || stillReferenced.has(entry.digest)) {
      continue;
    }
    await fs.rm(snapshotPath(projectId, entry.digest), { force: true });
    removed.push(entry);
  }
  return removed;
}

export async function readSnapshot(
  projectId: string,
  digest: string,
): Promise<VideoProject> {
  if (!/^[0-9a-f]{64}$/.test(digest)) {
    throw new Error('Invalid project snapshot digest');
  }
  const raw = await fs.readFile(snapshotPath(projectId, digest), 'utf8');
  return JSON.parse(raw) as VideoProject;
}

export interface RevisionComparison {
  from: { digest: string; revision: number };
  to: { digest: string; revision: number };
  tracks: { added: number; removed: number };
  clips: { added: number; removed: number };
  assets: { added: number; removed: number };
  durationDeltaMs: number;
  /** Clip ids present on exactly one side, capped so a summary stays a summary. */
  changedClipIds: string[];
}

const CHANGED_CLIP_SAMPLE = 50;

export async function compareRevisions(
  projectId: string,
  fromDigest: string,
  toDigest: string,
): Promise<RevisionComparison> {
  const [from, to] = await Promise.all([
    readSnapshot(projectId, fromDigest),
    readSnapshot(projectId, toDigest),
  ]);
  const fromClips = clipIds(from);
  const toClips = clipIds(to);
  const added = [...toClips].filter((id) => !fromClips.has(id));
  const removed = [...fromClips].filter((id) => !toClips.has(id));

  return {
    from: { digest: fromDigest, revision: from.revision },
    to: { digest: toDigest, revision: to.revision },
    tracks: {
      added: Math.max(
        0,
        (to.timeline?.tracks.length ?? 0) - (from.timeline?.tracks.length ?? 0),
      ),
      removed: Math.max(
        0,
        (from.timeline?.tracks.length ?? 0) - (to.timeline?.tracks.length ?? 0),
      ),
    },
    clips: { added: added.length, removed: removed.length },
    assets: {
      added: Math.max(0, to.assets.length - from.assets.length),
      removed: Math.max(0, from.assets.length - to.assets.length),
    },
    durationDeltaMs:
      (to.timeline?.durationMs ?? 0) - (from.timeline?.durationMs ?? 0),
    changedClipIds: [...added, ...removed].slice(0, CHANGED_CLIP_SAMPLE),
  };
}

function clipIds(project: VideoProject): Set<string> {
  const ids = new Set<string>();
  for (const track of project.timeline?.tracks ?? []) {
    for (const clip of track.clips) ids.add(clip.id);
  }
  return ids;
}

export async function nameRevision(
  projectId: string,
  digest: string,
  name: string,
): Promise<ProjectRevisionEntry | null> {
  const index = await readRevisionIndex(projectId);
  let updated: ProjectRevisionEntry | null = null;
  const entries = index.entries.map((entry) => {
    if (entry.digest !== digest) return entry;
    updated = { ...entry, name };
    return updated;
  });
  if (!updated) return null;
  await writeRevisionIndex(projectId, { ...index, entries });
  return updated;
}

export interface RestoreResult {
  project: VideoProject;
  /** The snapshot taken of the head before it was replaced. */
  headSnapshot: ProjectRevisionEntry;
  restored: ProjectRevisionEntry;
}

/**
 * Restore a snapshot as a **new** revision on top of the current head.
 *
 * Append-only: the head is snapshotted first, then the selected document is
 * written forward with the next revision number. The head pointer never moves
 * backward, so restoring is undoable by restoring again, and a restore that
 * crashes halfway leaves the project on its current head rather than on a
 * partially rewound one.
 *
 * Idempotent in the sense the plan asks for: restoring the same digest twice
 * produces the same document both times, because the restored content is
 * addressed by its digest and the revision is derived from the head.
 */
export async function restoreRevision(input: {
  projectId: string;
  digest: string;
  currentHead: VideoProject;
  write: (project: VideoProject) => Promise<void>;
}): Promise<RestoreResult> {
  const snapshot = await readSnapshot(input.projectId, input.digest);

  const headSnapshot = await recordProjectRevision(input.currentHead, {
    authorKind: 'system',
    reason: 'Head captured before restore',
  });

  const restoredProject: VideoProject = {
    ...snapshot,
    id: input.currentHead.id,
    // Forward, never backward.
    revision: input.currentHead.revision + 1,
    updatedAt: new Date().toISOString(),
  };
  await input.write(restoredProject);

  const restored = await recordProjectRevision(restoredProject, {
    authorKind: 'restore',
    reason: `Restored revision ${snapshot.revision}`,
  });

  return { project: restoredProject, headSnapshot, restored };
}
