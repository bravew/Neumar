/**
 * Trust rules for media the user keeps outside the workspace.
 *
 * A video project may reference a master in place — footage on an external
 * drive, a photo library — instead of copying it in. Those paths are persisted
 * in `project.json`, so they are re-checked on every read rather than trusted
 * because they passed once at import.
 *
 * This lives outside both the video and ffmpeg trees because both enforce it:
 * the video layer when it resolves an asset to bytes, the ffmpeg executor when
 * that path reaches ffprobe/ffmpeg. Keeping one implementation means the two
 * cannot drift into disagreeing about the same file.
 *
 * @module shared/utils/external-media-trust
 */

import { existsSync, realpathSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { getAppDir, getHomeDir } from '@/config/constants';

import { getSetting } from '@/shared/db/operations';
import { expandPath } from '@/shared/utils/paths';

/** Credential stores that are never readable as media, even inside a trusted root. */
const SENSITIVE_LOCAL_PATHS = [
  '~/.ssh',
  '~/.aws',
  '~/.azure',
  '~/.config/gcloud',
  '~/.docker',
  '~/.kube',
  '~/.gnupg',
  '~/.npmrc',
  '~/.pypirc',
  '~/.netrc',
  '~/.git-credentials',
];

/**
 * Roots a user may legitimately keep media under. Broader than the workspace
 * on purpose — `/Volumes` is what makes an external drive usable on macOS.
 */
function trustedRoots(): string[] {
  const roots = [getHomeDir(), getAppDir()];
  const workDir = getSetting('workDir');
  if (workDir) roots.push(path.resolve(expandPath(workDir)));
  roots.push(os.tmpdir());
  if (process.platform === 'darwin') roots.push('/Volumes');
  return roots.map((root) => normalizePath(realpathIfExists(root)));
}

export function isTrustedLocalRoot(filePath: string): boolean {
  return trustedRoots().some((root) => isEqualOrChild(filePath, root));
}

export function sensitivePathMatch(filePath: string): string | null {
  // Callers pass a realpath'd file, so the sensitive root has to be realpath'd
  // too or the comparison silently misses whenever a parent is a symlink —
  // `/var` -> `/private/var` on macOS being the common case.
  const normalized = normalizePath(realpathIfExists(filePath));
  for (const sensitive of SENSITIVE_LOCAL_PATHS) {
    const resolved = normalizePath(
      realpathIfExists(expandPath(sensitive.replace(/^~/, getHomeDir()))),
    );
    if (
      normalized === resolved ||
      normalized.startsWith(`${resolved}${path.sep}`)
    ) {
      return sensitive;
    }
  }
  return null;
}

/**
 * Resolve `rawPath` to a real file the caller is allowed to read as media, or
 * throw explaining which rule it broke. Symlinks are resolved before the trust
 * check so a link inside a trusted root cannot reach outside one.
 */
export function assertSafeExternalMediaFile(rawPath: string): string {
  const resolved = path.resolve(expandPath(rawPath.trim()));
  if (!existsSync(resolved)) {
    throw new Error(`External media file not found: ${resolved}`);
  }
  const real = realpathSync(resolved);
  if (!statSync(real).isFile()) {
    throw new Error('External media must be a file');
  }
  if (!isTrustedLocalRoot(real)) {
    throw new Error('External media is outside trusted local roots');
  }
  const sensitive = sensitivePathMatch(real);
  if (sensitive) {
    throw new Error(`External media cannot use sensitive path ${sensitive}`);
  }
  return real;
}

/** The same rules, reported rather than thrown. */
export function isSafeExternalMediaFile(rawPath: string): boolean {
  try {
    assertSafeExternalMediaFile(rawPath);
    return true;
  } catch {
    return false;
  }
}

export function isEqualOrChild(filePath: string, parentPath: string): boolean {
  const normalizedPath = normalizePath(filePath);
  const normalizedParent = normalizePath(parentPath);
  const relative = path.relative(normalizedParent, normalizedPath);
  return (
    relative === '' ||
    (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative))
  );
}

export function normalizePath(input: string): string {
  const resolved = path.resolve(input);
  return process.platform === 'win32' || process.platform === 'darwin'
    ? resolved.toLowerCase()
    : resolved;
}

export function realpathIfExists(input: string): string {
  const resolved = path.resolve(input);
  return existsSync(resolved) ? realpathSync(resolved) : resolved;
}
