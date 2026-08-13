import { randomUUID } from 'node:crypto';
import { constants as fsConstants, existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';

import { isIgnoredProjectDirName } from './ignored-project-dirs';
import {
  getDefaultDesignProjectLocationRoot,
  getDesignProjectLocationRoots,
  resolveDesignProjectLocationRoot,
} from './project-locations';
import type { DesignFileEntry, DesignProject } from './types';
import { designProjectSchema } from './types';

const DESIGN_ROOT = 'design-projects';
const TEXT_FILE_MAX_BYTES = 5 * 1024 * 1024;
const FILE_TREE_IGNORED_FILES = new Set(['.DS_Store', 'Thumbs.db']);
const DELETE_PROTECTED_FILES = new Set([
  'project.json',
  'brief.json',
  'history.jsonl',
]);
const RENAME_PROTECTED_FILES = new Set([
  'project.json',
  'brief.json',
  'history.jsonl',
]);

const projectLocks = new Map<string, Promise<unknown>>();

/**
 * Serialize async work per project. Used to avoid lost updates in
 * read-modify-write paths against JSON files (comments, sketches, exports,
 * project.outputs) when multiple requests or media-task completions race.
 */
export async function withProjectLock<T>(
  projectId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = projectLocks.get(projectId) ?? Promise.resolve();
  const next = previous.then(fn, fn);
  let cleanup: Promise<unknown>;
  cleanup = next
    .finally(() => {
      if (projectLocks.get(projectId) === cleanup) {
        projectLocks.delete(projectId);
      }
    })
    .catch(() => undefined);
  projectLocks.set(projectId, cleanup);
  return next;
}

export function getDesignWorkspaceRoot(): string {
  // Prefer the user-configured workspace; fall back to the app data dir
  // (~/.<slug>) so that previously created projects remain readable when the
  // setting is cleared (e.g. between first-run wizard runs).
  return getDefaultDesignProjectLocationRoot();
}

export function getDesignProjectsRoot(workspaceRoot?: string | null): string {
  return path.join(
    resolveDesignProjectLocationRoot(workspaceRoot),
    DESIGN_ROOT,
  );
}

export function getProjectDir(
  projectId: string,
  workspaceRoot?: string | null,
): string {
  assertProjectId(projectId);
  if (workspaceRoot?.trim()) {
    return path.join(getDesignProjectsRoot(workspaceRoot), projectId);
  }
  return findProjectDir(projectId);
}

function findProjectDir(projectId: string): string {
  for (const locationRoot of getDesignProjectLocationRoots()) {
    const projectDir = path.join(locationRoot, DESIGN_ROOT, projectId);
    if (
      existsSync(path.join(projectDir, 'project.json')) ||
      existsSync(projectDir)
    ) {
      return projectDir;
    }
  }
  return path.join(getDesignProjectsRoot(), projectId);
}

export function assertProjectId(projectId: string): void {
  if (!/^design_[a-zA-Z0-9_-]{6,40}$/.test(projectId)) {
    throw new Error('Invalid DesignMode project id');
  }
}

export function normalizeProjectRelativePath(input: string): string {
  if (!input || input.includes('\0')) {
    throw new Error('Path is required');
  }
  const slashPath = input.replace(/\\/g, '/');
  if (slashPath.startsWith('/') || /^[a-zA-Z]:\//.test(slashPath)) {
    throw new Error('Absolute paths are not allowed');
  }
  const normalized = path.posix.normalize(slashPath);
  if (
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized.includes('/../')
  ) {
    throw new Error('Path traversal is not allowed');
  }
  return normalized;
}

export function resolveProjectPath(projectId: string, relativePath: string) {
  const safe = normalizeProjectRelativePath(relativePath);
  const root = getProjectDir(projectId);
  const resolved = path.resolve(root, safe);
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  if (resolved !== root && !resolved.startsWith(prefix)) {
    throw new Error('Path escapes the project directory');
  }
  return { relativePath: safe, absolutePath: resolved };
}

export async function ensureProjectScaffold(project: DesignProject) {
  const root = getProjectDir(project.id, project.workspaceRoot);
  const dirs = [
    '',
    'skill',
    'design-system',
    'craft',
    'prompts',
    'assets/references',
    'assets/generated',
    'artifacts',
    'live-artifacts',
    'exports',
    'provenance',
    'comments',
    'sketches',
  ];
  await Promise.all(
    dirs.map((d) => fs.mkdir(path.join(root, d), { recursive: true })),
  );

  await writeJsonAtomic(path.join(root, 'project.json'), project);
  await writeJsonAtomic(path.join(root, 'brief.json'), project.brief);
  await ensureTextFile(
    path.join(root, 'skill/SKILL.md'),
    snapshotPlaceholder('Skill'),
  );
  await ensureTextFile(
    path.join(root, 'design-system/DESIGN.md'),
    snapshotPlaceholder('Design system'),
  );
  await ensureTextFile(
    path.join(root, 'craft/README.md'),
    snapshotPlaceholder('Craft'),
  );
  await ensureTextFile(path.join(root, 'prompts/resolved-system.md'), '');
  await ensureTextFile(path.join(root, 'prompts/resolved-user.md'), '');
  await ensureTextFile(path.join(root, 'prompts/prompt-template.json'), '{}\n');
  await ensureTextFile(path.join(root, 'provenance/assets.jsonl'), '');
  await ensureTextFile(path.join(root, 'provenance/tasks.jsonl'), '');
  await ensureTextFile(path.join(root, 'history.jsonl'), '');
  await writeJsonIfMissing(path.join(root, 'comments/comments.json'), []);
  await writeJsonIfMissing(path.join(root, 'sketches/overlay.json'), {
    pages: [],
    updatedAt: project.updatedAt,
  });
}

export async function readProjectManifest(
  projectId: string,
): Promise<DesignProject> {
  const raw = await fs.readFile(
    path.join(getProjectDir(projectId), 'project.json'),
    'utf-8',
  );
  return designProjectSchema.parse(JSON.parse(raw));
}

export async function writeProjectManifest(project: DesignProject) {
  await writeJsonAtomic(
    path.join(getProjectDir(project.id, project.workspaceRoot), 'project.json'),
    project,
  );
  await writeJsonAtomic(
    path.join(getProjectDir(project.id, project.workspaceRoot), 'brief.json'),
    project.brief,
  );
}

export async function readProjectTextFile(
  projectId: string,
  relativePath: string,
): Promise<{ path: string; content: string; size: number; updatedAt: string }> {
  const resolved = resolveProjectPath(projectId, relativePath);
  const stat = await fs.stat(resolved.absolutePath);
  if (!stat.isFile()) throw new Error('Path is not a file');
  if (stat.size > TEXT_FILE_MAX_BYTES) {
    throw new Error('File is too large for text preview');
  }
  const content = await fs.readFile(resolved.absolutePath, 'utf-8');
  return {
    path: resolved.relativePath,
    content,
    size: stat.size,
    updatedAt: stat.mtime.toISOString(),
  };
}

export async function writeProjectTextFile(
  projectId: string,
  relativePath: string,
  content: string,
): Promise<{ path: string; size: number }> {
  if (Buffer.byteLength(content, 'utf-8') > TEXT_FILE_MAX_BYTES) {
    throw new Error('Text file write exceeds 5MB');
  }
  const resolved = resolveProjectPath(projectId, relativePath);
  await fs.mkdir(path.dirname(resolved.absolutePath), { recursive: true });
  await writeTextAtomic(resolved.absolutePath, content);
  const stat = await fs.stat(resolved.absolutePath);
  return { path: resolved.relativePath, size: stat.size };
}

export interface DeletedProjectFile {
  path: string;
  trashPath: string;
  size: number;
}

export interface RenamedProjectFile {
  from: string;
  path: string;
  size: number;
  updatedAt: string;
}

export class ProjectFileConflictError extends Error {
  constructor(relativePath: string) {
    super(`Target file already exists: ${relativePath}`);
    this.name = 'ProjectFileConflictError';
  }
}

export async function deleteProjectFiles(
  projectId: string,
  relativePaths: string[],
): Promise<DeletedProjectFile[]> {
  const uniquePaths = [
    ...new Set(relativePaths.map(normalizeProjectRelativePath)),
  ];
  if (uniquePaths.length === 0)
    throw new Error('At least one file is required');
  const deletedAt = new Date().toISOString().replace(/[:.]/g, '-');
  const trashRoot = path.join(
    getProjectDir(projectId),
    '.neuma',
    '.trash',
    deletedAt,
  );
  const deletions: DeletedProjectFile[] = [];

  for (const relativePath of uniquePaths) {
    if (
      DELETE_PROTECTED_FILES.has(relativePath) ||
      relativePath.startsWith('.neuma/')
    ) {
      throw new Error(`File cannot be deleted: ${relativePath}`);
    }
    const resolved = resolveProjectPath(projectId, relativePath);
    const stat = await fs.stat(resolved.absolutePath);
    if (!stat.isFile()) throw new Error(`Path is not a file: ${relativePath}`);
  }

  for (const relativePath of uniquePaths) {
    const resolved = resolveProjectPath(projectId, relativePath);
    const stat = await fs.stat(resolved.absolutePath);
    const trashPath = path.join(trashRoot, relativePath);
    await fs.mkdir(path.dirname(trashPath), { recursive: true });
    await fs.rename(resolved.absolutePath, trashPath);
    deletions.push({
      path: resolved.relativePath,
      trashPath: path
        .relative(getProjectDir(projectId), trashPath)
        .replace(/\\/g, '/'),
      size: stat.size,
    });
  }
  return deletions;
}

export async function renameProjectFile(
  projectId: string,
  fromPath: string,
  toPath: string,
): Promise<RenamedProjectFile> {
  const from = normalizeProjectRelativePath(fromPath);
  const to = normalizeProjectRelativePath(toPath);
  if (from === to) {
    const resolved = resolveProjectPath(projectId, from);
    const stat = await fs.stat(resolved.absolutePath);
    if (!stat.isFile()) throw new Error(`Path is not a file: ${from}`);
    return {
      from,
      path: to,
      size: stat.size,
      updatedAt: stat.mtime.toISOString(),
    };
  }
  if (
    RENAME_PROTECTED_FILES.has(from) ||
    from.startsWith('.neuma/') ||
    to.startsWith('.neuma/')
  ) {
    throw new Error(`File cannot be renamed: ${from}`);
  }

  const source = resolveProjectPath(projectId, from);
  const target = resolveProjectPath(projectId, to);
  const sourceStat = await fs.stat(source.absolutePath);
  if (!sourceStat.isFile()) throw new Error(`Path is not a file: ${from}`);
  await fs.mkdir(path.dirname(target.absolutePath), { recursive: true });
  try {
    await fs.link(source.absolutePath, target.absolutePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new ProjectFileConflictError(to);
    }
    throw error;
  }
  await fs.unlink(source.absolutePath);
  const targetStat = await fs.stat(target.absolutePath);
  return {
    from: source.relativePath,
    path: target.relativePath,
    size: targetStat.size,
    updatedAt: targetStat.mtime.toISOString(),
  };
}

export async function listProjectFiles(
  projectId: string,
  relativePath = '.',
  depth = 0,
  maxDepth = 4,
): Promise<DesignFileEntry[]> {
  const root = getProjectDir(projectId);
  const target =
    relativePath === '.'
      ? root
      : resolveProjectPath(projectId, relativePath).absolutePath;
  const entries = await fs.readdir(target, { withFileTypes: true });
  const out: DesignFileEntry[] = [];
  for (const entry of entries) {
    if (entry.isDirectory() && isIgnoredProjectDirName(entry.name)) continue;
    if (!entry.isDirectory() && FILE_TREE_IGNORED_FILES.has(entry.name))
      continue;
    const abs = path.join(target, entry.name);
    const rel = path.relative(root, abs).replace(/\\/g, '/');
    const stat = await fs.stat(abs);
    const item: DesignFileEntry = {
      name: entry.name,
      path: rel,
      isDir: entry.isDirectory(),
      size: entry.isFile() ? stat.size : undefined,
      updatedAt: stat.mtime.toISOString(),
    };
    if (entry.isDirectory() && depth < maxDepth) {
      item.children = await listProjectFiles(
        projectId,
        rel,
        depth + 1,
        maxDepth,
      );
    }
    out.push(item);
  }
  return out.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export async function appendJsonl(filePath: string, value: unknown) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, `${JSON.stringify(value)}\n`, 'utf-8');
}

export async function appendProjectHistory(projectId: string, event: unknown) {
  await appendJsonl(
    path.join(getProjectDir(projectId), 'history.jsonl'),
    event,
  );
}

export async function readJsonFile<T>(
  filePath: string,
  fallback: T,
): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function writeJsonAtomic(filePath: string, value: unknown) {
  await writeTextAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function writeTextAtomic(filePath: string, content: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
  let handle: FileHandle | null = null;
  try {
    handle = await fs.open(temp, 'wx');
    await handle.writeFile(content, 'utf-8');
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(temp, filePath);
    await fsyncDirectory(path.dirname(filePath));
  } catch (error) {
    await handle?.close().catch(() => {});
    await fs.unlink(temp).catch(() => {});
    throw error;
  }
}

export async function copyIntoProject(
  projectId: string,
  source: string,
  relativeDest: string,
) {
  const dest = resolveProjectPath(projectId, relativeDest).absolutePath;
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs
    .copyFile(source, dest, fsConstants.COPYFILE_FICLONE_FORCE)
    .catch(() => fs.copyFile(source, dest));
}

async function ensureTextFile(filePath: string, content: string) {
  try {
    await fs.access(filePath);
  } catch {
    await writeTextAtomic(filePath, content);
  }
}

async function writeJsonIfMissing(filePath: string, value: unknown) {
  try {
    await fs.access(filePath);
  } catch {
    await writeJsonAtomic(filePath, value);
  }
}

function snapshotPlaceholder(label: string): string {
  return `# ${label} snapshot\n\nNo ${label.toLowerCase()} selected yet.\n`;
}

async function fsyncDirectory(dirPath: string) {
  let handle: FileHandle | null = null;
  try {
    handle = await fs.open(dirPath, fsConstants.O_RDONLY);
    await handle.sync();
  } catch {
    // Some filesystems/platforms reject directory fsync. The file write and
    // rename above remain atomic; durability is best-effort on those targets.
  } finally {
    await handle?.close().catch(() => {});
  }
}
