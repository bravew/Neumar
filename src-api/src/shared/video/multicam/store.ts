import { randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import { createLogger } from '@/shared/utils/logger';

import { getVideoProjectDir } from '../store';
import type { ActivityMap } from './activity';
import { parseMulticamManifest, type MulticamManifest } from './manifest';
import type { ReviewArtifact } from './review';
import type { ShotPlan } from './shot-plan';
import type { SyncMap } from './sync';

const logger = createLogger('VideoMulticamStore');

/**
 * The artifact chain, in the order each one depends on the last:
 *
 *   manifest → sync map → activity map → shot plan
 *
 * They are stored as separate versioned files rather than one blob, so
 * recomputing activity does not invalidate a sync map that is still good, and a
 * cancelled run leaves the artifacts it had already finished.
 */
export type MulticamArtifactKind =
  | 'manifest'
  | 'sync'
  | 'activity'
  | 'shot-plan'
  | 'review';

export interface MulticamArtifactEnvelope<T> {
  kind: MulticamArtifactKind;
  groupId: string;
  /** The fingerprint of everything this artifact was derived from. */
  sourceFingerprint: string;
  generatedAt: string;
  data: T;
}

function multicamDir(projectId: string, groupId: string): string {
  assertSafeGroupId(groupId);
  return path.join(getVideoProjectDir(projectId), 'multicam', groupId);
}

function artifactPath(
  projectId: string,
  groupId: string,
  kind: MulticamArtifactKind,
): string {
  return path.join(multicamDir(projectId, groupId), `${kind}.json`);
}

/** Group ids reach the filesystem, so they get the same treatment as ids elsewhere. */
function assertSafeGroupId(groupId: string): void {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(groupId)) {
    throw new Error(`Invalid multicamera group id "${groupId}"`);
  }
}

async function writeArtifact<T>(
  projectId: string,
  envelope: MulticamArtifactEnvelope<T>,
): Promise<void> {
  const target = artifactPath(projectId, envelope.groupId, envelope.kind);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(envelope, null, 2)}\n`);
  await fs.rename(tmp, target);
}

async function readArtifact<T>(
  projectId: string,
  groupId: string,
  kind: MulticamArtifactKind,
): Promise<MulticamArtifactEnvelope<T> | null> {
  try {
    const raw = await fs.readFile(
      artifactPath(projectId, groupId, kind),
      'utf8',
    );
    return JSON.parse(raw) as MulticamArtifactEnvelope<T>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    logger.warn(
      `Unreadable ${kind} artifact for ${projectId}/${groupId}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

export async function saveManifest(
  projectId: string,
  manifest: MulticamManifest,
  sourceFingerprint: string,
): Promise<void> {
  await writeArtifact(projectId, {
    kind: 'manifest',
    groupId: manifest.id,
    sourceFingerprint,
    generatedAt: new Date().toISOString(),
    data: manifest,
  });
}

export async function loadManifest(
  projectId: string,
  groupId: string,
): Promise<MulticamManifest | null> {
  const envelope = await readArtifact<unknown>(projectId, groupId, 'manifest');
  if (!envelope) return null;
  // Re-parsed on read: a manifest on disk was written by an older build or
  // edited by hand, and neither is a reason to trust its shape.
  const parsed = parseMulticamManifest(envelope.data);
  return parsed;
}

export async function saveSyncMap(
  projectId: string,
  map: SyncMap,
): Promise<void> {
  await writeArtifact(projectId, {
    kind: 'sync',
    groupId: map.manifestId,
    sourceFingerprint: map.sourceFingerprint,
    generatedAt: new Date().toISOString(),
    data: map,
  });
}

export function loadSyncMap(projectId: string, groupId: string) {
  return readArtifact<SyncMap>(projectId, groupId, 'sync');
}

export async function saveActivityMap(
  projectId: string,
  map: ActivityMap,
): Promise<void> {
  await writeArtifact(projectId, {
    kind: 'activity',
    groupId: map.manifestId,
    sourceFingerprint: map.sourceFingerprint,
    generatedAt: new Date().toISOString(),
    data: map,
  });
}

export function loadActivityMap(projectId: string, groupId: string) {
  return readArtifact<ActivityMap>(projectId, groupId, 'activity');
}

export async function saveShotPlan(
  projectId: string,
  plan: ShotPlan,
): Promise<void> {
  await writeArtifact(projectId, {
    kind: 'shot-plan',
    groupId: plan.manifestId,
    sourceFingerprint: plan.sourceFingerprint,
    generatedAt: new Date().toISOString(),
    data: plan,
  });
}

export function loadShotPlan(projectId: string, groupId: string) {
  return readArtifact<ShotPlan>(projectId, groupId, 'shot-plan');
}

export async function saveReview(
  projectId: string,
  review: ReviewArtifact,
): Promise<void> {
  await writeArtifact(projectId, {
    kind: 'review',
    groupId: review.manifestId,
    sourceFingerprint: review.planFingerprint,
    generatedAt: new Date().toISOString(),
    data: review,
  });
}

export function loadReview(projectId: string, groupId: string) {
  return readArtifact<ReviewArtifact>(projectId, groupId, 'review');
}

export async function listMulticamGroups(projectId: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(
      path.join(getVideoProjectDir(projectId), 'multicam'),
      { withFileTypes: true },
    );
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

export function hasMulticamGroups(projectId: string): boolean {
  try {
    return readdirSync(path.join(getVideoProjectDir(projectId), 'multicam'), {
      withFileTypes: true,
    }).some((entry) => entry.isDirectory());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

/**
 * Whether a stored artifact still matches its inputs.
 *
 * A stale artifact is not deleted: it stays readable so a reviewer can see what
 * the last run concluded, and so a cancelled or interrupted analysis can be
 * resumed from the artifacts that are still valid rather than from nothing.
 */
export function artifactIsCurrent(
  envelope: { sourceFingerprint: string } | null,
  expectedFingerprint: string,
): boolean {
  return envelope?.sourceFingerprint === expectedFingerprint;
}
