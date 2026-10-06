/**
 * Host-owned path policy for one FFmpeg skill operation.
 *
 * Callers name files. They do not name the workspace, the interpreter, or the
 * trusted roots. Every input, output, and nested sidecar is resolved against
 * the session roots, including the nearest existing parent of an output that
 * does not exist yet.
 */

import { realpathSync, statSync } from 'node:fs';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';

import { getSessionContext } from '@/shared/services/session-context';
import { getVideoProjectDir } from '@/shared/video/store';

import { FfmpegSkillError } from './errors';

export interface SkillPathRoots {
  /** Readable roots: workspace, video project, media output, staging. */
  read: string[];
  /** Writable roots: media output (or workspace) and the run staging dir. */
  write: string[];
  /** Directory relative paths resolve against. */
  base: string;
  /** The run's private staging directory. All outputs land here. */
  staging: string;
}

export interface ResolvedPath {
  /** Absolute, symlink-resolved path. */
  real: string;
  /** True when the path exists. */
  exists: boolean;
}

const URL_RE = /^[a-z][a-z0-9+.-]*:/i;
const LOCAL_PROTOCOLS = new Set([
  'file',
  'fd',
  'pipe',
  'concat',
  'subfile',
  'crypto',
]);

/** Roots for the active session plus the private directory this run stages in. */
export function skillPathRoots(stagingDir: string): SkillPathRoots {
  const session = getSessionContext();
  const workDir = session?.workDir?.trim();
  if (!workDir) {
    throw new FfmpegSkillError(
      'path',
      'No session workspace is bound to this run, so media paths cannot be authorized.',
    );
  }
  const read = new Set<string>([resolve(workDir), resolve(stagingDir)]);
  if (session?.mediaOutputDir?.trim()) {
    read.add(resolve(session.mediaOutputDir));
  }
  if (session?.videoProjectId?.trim()) {
    try {
      read.add(resolve(getVideoProjectDir(session.videoProjectId)));
    } catch {
      throw new FfmpegSkillError(
        'path',
        `Video project "${session.videoProjectId}" is not an authorized root.`,
      );
    }
  }
  const write = new Set<string>([resolve(stagingDir)]);
  write.add(resolve(session?.mediaOutputDir?.trim() || workDir));
  return {
    read: [...read],
    write: [...write],
    base: resolve(workDir),
    staging: resolve(stagingDir),
  };
}

/**
 * Resolve one caller-supplied path.
 *
 * `write` also accepts a path whose final component does not exist yet, after
 * the nearest existing parent is confirmed inside a writable root.
 */
export function resolveSkillPath(
  filePath: string,
  roots: SkillPathRoots,
  access: 'read' | 'write',
): ResolvedPath {
  rejectUrl(filePath);
  if (filePath.includes('\0')) {
    throw new FfmpegSkillError('path', 'A path contains a null byte.');
  }
  const absolute = isAbsolute(filePath)
    ? resolve(filePath)
    : resolve(roots.base, filePath);
  const allowed = (access === 'read' ? roots.read : roots.write).map(
    existingReal,
  );

  const nearest = nearestExisting(absolute);
  const realParent = existingReal(nearest);
  if (!allowed.some((root) => isWithin(realParent, root))) {
    throw new FfmpegSkillError(
      'path',
      `"${filePath}" resolves outside the authorized ${access} directories.`,
    );
  }
  const exists = nearest === absolute;
  if (access === 'read' && !exists) {
    throw new FfmpegSkillError('path', `Input not found: ${filePath}`);
  }
  const real = exists
    ? realParent
    : join(realParent, relativeTail(realParent, absolute));
  if (!allowed.some((root) => isWithin(real, root))) {
    throw outside(filePath, access);
  }
  return { real, exists };
}

/**
 * The part of an absolute path below its nearest existing ancestor.
 *
 * Comparing the unresolved path with its real parent fails on macOS, where
 * `/var` is a symlink to `/private/var` and a not-yet-created output therefore
 * looks like it escaped.
 */
function relativeTail(existingParent: string, absolute: string): string {
  const parentName = basename(existingParent);
  const parts = absolute.split(sep);
  const index = parts.lastIndexOf(parentName);
  if (index === -1 || index === parts.length - 1) return basename(absolute);
  return parts.slice(index + 1).join(sep);
}

function outside(filePath: string, access: 'read' | 'write'): FfmpegSkillError {
  return new FfmpegSkillError(
    'path',
    `"${filePath}" is outside the authorized ${access} directories.`,
  );
}

function rejectUrl(value: string): void {
  const candidate = value.trim();
  if (!URL_RE.test(candidate)) return;
  const protocol = candidate.slice(0, candidate.indexOf(':')).toLowerCase();
  if (protocol.length === 1 && process.platform === 'win32') return;
  if (
    LOCAL_PROTOCOLS.has(protocol) ||
    protocol === 'http' ||
    protocol === 'https'
  ) {
    throw new FfmpegSkillError(
      'path',
      `"${value}" uses the ${protocol} protocol. FFmpeg inputs must be local files inside the session workspace.`,
    );
  }
  throw new FfmpegSkillError('path', `"${value}" is not a local file path.`);
}

function nearestExisting(target: string): string {
  let current = target;
  const seen = new Set<string>();
  while (!seen.has(current)) {
    seen.add(current);
    try {
      statSync(current);
      return current;
    } catch {
      const parent = dirname(current);
      if (parent === current) {
        throw new FfmpegSkillError(
          'path',
          `No existing parent directory for "${target}".`,
        );
      }
      current = parent;
    }
  }
  throw new FfmpegSkillError('path', `Could not resolve "${target}".`);
}

function existingReal(target: string): string {
  try {
    return realpathSync(target);
  } catch {
    return resolve(target);
  }
}

function isWithin(target: string, root: string): boolean {
  const rel = relative(root, target);
  return rel === '' || (!!rel && !rel.startsWith('..') && !isAbsolute(rel));
}

/** True when a resolved path is the same file as another resolved path. */
export function samePath(left: string, right: string): boolean {
  return relative(left, right) === '';
}

export function displayPath(filePath: string): string {
  return filePath.split(sep).join('/');
}
