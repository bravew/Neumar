import type { DesignFileEntry } from '@/shared/types/design-mode';

export type FileWorkspaceSortKey = 'name' | 'kind' | 'updatedAt';
export type FileWorkspaceSortDirection = 'asc' | 'desc';
export type FileWorkspaceGroupKey = 'none' | 'kind' | 'updatedAt';
export type FileWorkspaceKindFilter =
  | 'all'
  | 'html'
  | 'image'
  | 'svg'
  | 'pdf'
  | 'audio'
  | 'video';
export type FileWorkspaceGroupId =
  | 'html'
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'other'
  | 'today'
  | 'week'
  | 'older'
  | 'undated'
  | 'all';

export interface FileWorkspaceGroup {
  id: FileWorkspaceGroupId;
  files: DesignFileEntry[];
}

export const IGNORED_PROJECT_DIR_NAMES = new Set([
  '.cache',
  '.deleted',
  '.git',
  '.live-artifacts',
  '.neuma',
  '.neuma-skills',
  '.next',
  '.swiftpm',
  '.tmp',
  '.turbo',
  '.venv',
  '__pycache__',
  'build',
  'coverage',
  'dist',
  'live-artifacts',
  'node_modules',
  'out',
  'target',
  'tmp',
  'vendor',
  'venv',
]);

export function isIgnoredProjectDirName(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  if (!normalized) return false;
  return (
    IGNORED_PROJECT_DIR_NAMES.has(normalized) ||
    normalized.startsWith('deriveddata')
  );
}

export function flattenFiles(files: DesignFileEntry[]): DesignFileEntry[] {
  return files.flatMap((file) => {
    if (file.isDir && isIgnoredProjectDirName(fileEntryName(file))) return [];
    return [file, ...(file.children ? flattenFiles(file.children) : [])];
  });
}

export function directoryEntries(
  files: DesignFileEntry[],
  directoryPath: string | null,
): DesignFileEntry[] {
  const entries = directoryPath
    ? (findFileEntry(files, directoryPath)?.children ?? [])
    : files;
  return entries.filter(
    (file) => !file.isDir || !isIgnoredProjectDirName(fileEntryName(file)),
  );
}

export function parentDirectoryPath(pathValue: string | null): string | null {
  if (!pathValue) return null;
  const index = pathValue.lastIndexOf('/');
  return index > 0 ? pathValue.slice(0, index) : null;
}

export function directoryDisplayName(pathValue: string | null): string {
  if (!pathValue) return '';
  return pathValue.split('/').filter(Boolean).pop() ?? pathValue;
}

function findFileEntry(
  files: DesignFileEntry[],
  pathValue: string,
): DesignFileEntry | null {
  for (const file of files) {
    if (file.path === pathValue) return file;
    const child = file.children
      ? findFileEntry(file.children, pathValue)
      : null;
    if (child) return child;
  }
  return null;
}

function fileEntryName(file: DesignFileEntry): string {
  return file.name || file.path.split('/').pop() || file.path;
}

export function pickInitialFile(
  files: DesignFileEntry[],
  primaryOutputPath?: string,
): string | null {
  if (primaryOutputPath) return primaryOutputPath;
  const paths = files.map((file) => file.path);
  return (
    paths.find((path) => path === 'artifacts/index.html') ??
    paths.find((path) => path === 'artifacts/document.md') ??
    paths.find((path) => path.endsWith('/index.html')) ??
    null
  );
}

export function isScaffoldPath(path: string) {
  return (
    path === 'project.json' ||
    path === 'brief.json' ||
    path.startsWith('prompts/') ||
    path.startsWith('provenance/') ||
    path.startsWith('comments/') ||
    path.startsWith('sketches/')
  );
}

export function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable
  );
}

export function filterDesignFilesByKind(
  files: DesignFileEntry[],
  kindFilter: FileWorkspaceKindFilter,
) {
  if (kindFilter === 'all') return files;
  return files.filter((file) => fileMatchesKindFilter(file.path, kindFilter));
}

export function sortDesignFiles(
  files: DesignFileEntry[],
  sortBy: FileWorkspaceSortKey,
  direction: FileWorkspaceSortDirection,
) {
  const multiplier = direction === 'asc' ? 1 : -1;
  return [...files].sort((a, b) => {
    const result =
      sortBy === 'kind'
        ? fileKindRank(a.path) - fileKindRank(b.path) ||
          a.path.localeCompare(b.path)
        : sortBy === 'updatedAt'
          ? Date.parse(a.updatedAt ?? '') - Date.parse(b.updatedAt ?? '') ||
            a.path.localeCompare(b.path)
          : a.path.localeCompare(b.path);
    return result * multiplier;
  });
}

export function groupDesignFiles(
  files: DesignFileEntry[],
  groupBy: FileWorkspaceGroupKey,
): FileWorkspaceGroup[] {
  if (groupBy === 'none') return [{ id: 'all', files }];
  const groups = new Map<FileWorkspaceGroupId, DesignFileEntry[]>();
  for (const file of files) {
    const id =
      groupBy === 'kind'
        ? fileKindGroup(file.path)
        : modifiedDateGroup(file.updatedAt);
    groups.set(id, [...(groups.get(id) ?? []), file]);
  }
  const order: FileWorkspaceGroupId[] =
    groupBy === 'kind'
      ? ['html', 'text', 'image', 'video', 'audio', 'other']
      : ['today', 'week', 'older', 'undated'];
  return order.flatMap((id) => {
    const groupFiles = groups.get(id) ?? [];
    return groupFiles.length > 0 ? [{ id, files: groupFiles }] : [];
  });
}

function fileKindRank(path: string) {
  return ['html', 'text', 'image', 'video', 'audio', 'other'].indexOf(
    fileKindGroup(path),
  );
}

function fileKindGroup(path: string): FileWorkspaceGroupId {
  const lower = path.toLowerCase();
  if (/\.html?$/.test(lower)) return 'html';
  if (
    /\.(md|markdown|txt|json|jsonl|css|js|jsx|ts|tsx|xml|csv|yaml|yml)$/.test(
      lower,
    )
  ) {
    return 'text';
  }
  if (/\.(png|jpe?g|webp|gif|svg)$/.test(lower)) return 'image';
  if (/\.(mp4|webm|mov)$/.test(lower)) return 'video';
  if (/\.(mp3|wav|m4a|ogg)$/.test(lower)) return 'audio';
  return 'other';
}

function fileMatchesKindFilter(
  path: string,
  kindFilter: Exclude<FileWorkspaceKindFilter, 'all'>,
) {
  const lower = path.toLowerCase();
  if (kindFilter === 'html') return /\.html?$/.test(lower);
  if (kindFilter === 'svg') return /\.svg$/.test(lower);
  if (kindFilter === 'pdf') return /\.pdf$/.test(lower);
  if (kindFilter === 'image') return /\.(png|jpe?g|webp|gif)$/.test(lower);
  if (kindFilter === 'video') return /\.(mp4|webm|mov)$/.test(lower);
  return /\.(mp3|wav|m4a|ogg)$/.test(lower);
}

function modifiedDateGroup(updatedAt?: string): FileWorkspaceGroupId {
  const ms = Date.parse(updatedAt ?? '');
  if (!Number.isFinite(ms)) return 'undated';
  const ageMs = Date.now() - ms;
  if (ageMs < 24 * 60 * 60 * 1000) return 'today';
  if (ageMs < 7 * 24 * 60 * 60 * 1000) return 'week';
  return 'older';
}
