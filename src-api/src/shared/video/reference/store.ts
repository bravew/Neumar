import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import { validatePath } from '@/shared/services/ffmpeg';
import { createLogger } from '@/shared/utils/logger';
import {
  getVideoProjectDir,
  getVideoProjectRoot,
  getVideoReferenceDir,
} from '@/shared/video/store';
import type {
  ReferenceArtifactEnvelope,
  ReferenceArtifactKind,
} from '@/shared/video/types';

const logger = createLogger('VideoReferenceStore');

export const REFERENCE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,100}$/;
export const STUDY_POLICY_VERSION = 'reference-study.v1';

export function assertSafeReferenceId(referenceId: string): string {
  if (!REFERENCE_ID_PATTERN.test(referenceId)) {
    throw new Error(`Invalid video reference id "${referenceId}"`);
  }
  return referenceId;
}

export function createReferenceId(): string {
  return `ref-${randomUUID().slice(0, 8)}`;
}

export function referenceMediaDir(
  projectId: string,
  referenceId: string,
): string {
  return path.join(getVideoReferenceDir(projectId, referenceId), 'media');
}

export function validatedReferencePath(
  projectId: string,
  target: string,
): string {
  return validatePath(target, getVideoProjectRoot(projectId), 'write');
}

export async function ensureReferenceDir(
  projectId: string,
  referenceId: string,
): Promise<string> {
  const dir = validatedReferencePath(
    projectId,
    getVideoReferenceDir(projectId, referenceId),
  );
  await fs.mkdir(path.join(dir, 'media'), { recursive: true });
  await fs.mkdir(path.join(dir, 'evidence'), { recursive: true });
  return dir;
}

export async function writeReferenceEnvelope<T>(
  projectId: string,
  envelope: ReferenceArtifactEnvelope<T>,
): Promise<void> {
  const fileName = envelopeFileName(envelope.kind);
  const target = validatedReferencePath(
    projectId,
    path.join(getVideoReferenceDir(projectId, envelope.referenceId), fileName),
  );
  await atomicWriteJson(projectId, target, envelope);
}

export async function readReferenceEnvelope<T>(
  projectId: string,
  referenceId: string,
  kind: ReferenceArtifactKind,
): Promise<ReferenceArtifactEnvelope<T> | null> {
  const target = validatedReferencePath(
    projectId,
    path.join(
      getVideoReferenceDir(projectId, referenceId),
      envelopeFileName(kind),
    ),
  );
  try {
    const raw = await fs.readFile(target, 'utf8');
    return JSON.parse(raw) as ReferenceArtifactEnvelope<T>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    logger.warn(
      `Unreadable ${kind} artifact for ${projectId}/${referenceId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
}

export async function atomicWriteJson(
  projectId: string,
  target: string,
  value: unknown,
): Promise<void> {
  const resolved = validatedReferencePath(projectId, target);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  const tmp = `${resolved}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`);
    await fs.rename(tmp, resolved);
  } catch (error) {
    await fs.rm(tmp, { force: true });
    throw error;
  }
}

/**
 * Stage evidence media beside the destination, then rename. Refuse overwrite.
 * Any failure removes the staging directory.
 */
export async function writeReferenceMediaFile(
  projectId: string,
  destination: string,
  bytes: Buffer,
): Promise<string> {
  const resolved = validatedReferencePath(projectId, destination);
  if (existsSync(resolved)) {
    throw new Error(
      `Reference media already exists: ${path.basename(resolved)}`,
    );
  }
  const staging = await fs.mkdtemp(
    path.join(path.dirname(resolved), '.stage-'),
  );
  const staged = path.join(staging, path.basename(resolved));
  try {
    await fs.writeFile(staged, bytes);
    await fs.rename(staged, resolved);
  } catch (error) {
    await fs.rm(staging, { recursive: true, force: true });
    throw error;
  }
  await fs.rm(staging, { recursive: true, force: true });
  return resolved;
}

export async function removeReferenceArchive(
  projectId: string,
  referenceId: string,
): Promise<void> {
  const dir = validatedReferencePath(
    projectId,
    getVideoReferenceDir(projectId, referenceId),
  );
  await fs.rm(dir, { recursive: true, force: true });
}

export function envelopeFileName(kind: ReferenceArtifactKind): string {
  if (kind === 'evidence') return path.join('evidence', 'index.json');
  return `${kind}.json`;
}

export function referenceRunPath(
  projectId: string,
  referenceId: string,
): string {
  return validatedReferencePath(
    projectId,
    path.join(getVideoReferenceDir(projectId, referenceId), 'run.json'),
  );
}

export function referenceProgressPath(
  projectId: string,
  referenceId: string,
): string {
  return validatedReferencePath(
    projectId,
    path.join(getVideoReferenceDir(projectId, referenceId), 'PROGRESS.md'),
  );
}

export async function writeReferenceText(
  projectId: string,
  target: string,
  contents: string,
): Promise<void> {
  const resolved = validatedReferencePath(projectId, target);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  const tmp = `${resolved}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, contents);
    await fs.rename(tmp, resolved);
  } catch (error) {
    await fs.rm(tmp, { force: true });
    throw error;
  }
}

export function relativeToProject(
  projectId: string,
  absolutePath: string,
): string {
  const archiveRoot = getVideoProjectDir(projectId);
  const relative = path.relative(
    archiveRoot,
    validatedReferencePath(projectId, absolutePath),
  );
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Reference path escaped the project directory');
  }
  return relative.replaceAll('\\', '/');
}
