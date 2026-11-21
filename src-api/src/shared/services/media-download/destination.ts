/**
 * Where a video batch may be saved.
 *
 * The model never names a path. The server derives the folders it may offer
 * from the task and the user's folder permissions, and a chosen folder is
 * re-validated against that same policy at the moment of the write. A folder
 * that cannot be resolved, is not a directory, or has lost its permission is
 * refused rather than replaced by a fallback.
 */

import { lstatSync, mkdirSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

import { z } from 'zod';

import { getSetting, getTask } from '@/shared/db/operations';
import { isPathInsideAnyRoot } from '@/shared/utils/path-validator';

/** A folder the user may choose, with the label the question offers. */
export interface DestinationOption {
  label: string;
  path: string;
  kind: 'task' | 'permitted';
}

/** The folders one task may write downloads to, and why. */
export interface DestinationPolicy {
  taskRoot: string;
  permittedRoots: string[];
}

/** The folder a grant names, bound to the identity it was checked with. */
export interface DestinationGrant {
  directory: string;
  device: string;
  inode: string;
}

/** A refusal a caller reports as `denied`; it never means "use another path". */
export class DestinationDenied extends Error {
  constructor(
    message = 'This download folder is unavailable or not permitted.',
  ) {
    super(message);
    this.name = 'DestinationDenied';
  }
}

const storedFoldersSchema = z.array(
  z.object({
    path: z.string(),
    permissions: z.object({ read: z.boolean(), write: z.boolean() }),
  }),
);
const additionalDirsSchema = z.array(z.string());

function existingDirectory(raw: string): string {
  if (!isAbsolute(raw)) throw new DestinationDenied();
  let real: string;
  try {
    real = realpathSync(raw);
    if (!statSync(real).isDirectory()) throw new Error('not a directory');
  } catch {
    throw new DestinationDenied();
  }
  // The resolved folder is what the grant binds; a caller that named a
  // symlink gets the target's identity, never the link's.
  return real;
}

/**
 * The task's output folder, plus the additional workspace folders the user has
 * explicitly granted read and write. A malformed stored policy is a refusal,
 * not "no restrictions": an unreadable permission list cannot authorize a
 * write.
 */
export function destinationPolicy(taskId: string): DestinationPolicy {
  const task = getTask(taskId);
  if (!task) throw new DestinationDenied('This task no longer exists.');

  let stored: z.infer<typeof storedFoldersSchema>;
  try {
    stored = storedFoldersSchema.parse(
      JSON.parse(getSetting('allowedFolders') ?? '[]'),
    );
  } catch {
    throw new DestinationDenied('The folder permissions could not be read.');
  }

  const permitted: string[] = [];
  const hasWrite = (raw: string): boolean =>
    stored.some(
      (folder) =>
        isAbsolute(folder.path) &&
        resolve(folder.path) === resolve(raw) &&
        folder.permissions.read &&
        folder.permissions.write,
    );

  const taskRoot = existingDirectory(
    task.work_dir && isAbsolute(task.work_dir)
      ? task.work_dir
      : (getSetting('workDir') ?? ''),
  );

  let additional: string[] = [];
  try {
    additional = additionalDirsSchema.parse(
      JSON.parse(task.additional_work_dirs ?? '[]'),
    );
  } catch {
    additional = [];
  }
  for (const raw of additional) {
    if (!hasWrite(raw)) continue;
    try {
      permitted.push(existingDirectory(raw));
    } catch {
      // One folder that moved or lost permission does not hide the others.
    }
  }
  return { taskRoot, permittedRoots: [...new Set(permitted)] };
}

/**
 * The folders the question offers, task folder first. The task's own output
 * folder is created on demand by {@link bindDestination}; listing it does not
 * create anything.
 */
export function destinationOptions(
  policy: DestinationPolicy,
): DestinationOption[] {
  const taskOption: DestinationOption = {
    label: 'Task folder',
    path: join(policy.taskRoot, 'output'),
    kind: 'task',
  };
  const permitted = policy.permittedRoots.map((path): DestinationOption => ({
    label: path,
    path,
    kind: 'permitted',
  }));
  return [taskOption, ...permitted];
}

/**
 * Check a chosen folder against the policy and bind its identity.
 *
 * The chosen folder must be one of the offered folders (or inside the task's
 * output folder), must still resolve to itself, and must still be a directory.
 * `createOutput` creates the task's output folder the first time it is chosen.
 */
export function bindDestination(
  policy: DestinationPolicy,
  chosen: string,
  createOutput = true,
): DestinationGrant {
  if (!isAbsolute(chosen) || resolve(chosen) !== chosen) {
    throw new DestinationDenied();
  }
  const offered = destinationOptions(policy);
  const taskFolder = offered[0]?.path;
  if (!taskFolder) throw new DestinationDenied();
  if (chosen === taskFolder && createOutput) {
    try {
      mkdirSync(chosen, { mode: 0o700 });
    } catch (error) {
      if (
        !(error instanceof Error && 'code' in error && error.code === 'EEXIST')
      ) {
        throw new DestinationDenied();
      }
    }
  }
  let real: string;
  let stat: ReturnType<typeof statSync>;
  try {
    real = realpathSync(chosen);
    stat = statSync(real, { bigint: true });
    if (!stat.isDirectory()) throw new Error('not a directory');
  } catch {
    throw new DestinationDenied();
  }
  // The resolved folder, not the spelling, is what must be inside a root the
  // task may write to. A symlink that lands elsewhere is refused here. The
  // task's own root is not a destination: only its output folder is.
  const roots = [taskFolder, ...policy.permittedRoots];
  if (real === policy.taskRoot || !isPathInsideAnyRoot(roots, real)) {
    throw new DestinationDenied();
  }
  return {
    directory: real,
    device: String(stat.dev),
    inode: String(stat.ino),
  };
}

/** Whether a previously bound folder is still the same directory. */
export function isSameDestination(
  grant: Pick<DestinationGrant, 'directory' | 'device' | 'inode'>,
): boolean {
  try {
    const info = lstatSync(grant.directory, { throwIfNoEntry: false });
    if (!info?.isDirectory()) return false;
    const real = realpathSync(grant.directory);
    if (real !== grant.directory) return false;
    const stat = statSync(real, { bigint: true });
    return (
      String(stat.dev) === grant.device && String(stat.ino) === grant.inode
    );
  } catch {
    return false;
  }
}
