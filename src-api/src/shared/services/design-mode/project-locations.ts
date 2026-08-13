import fs from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import { getAppDir } from '@/config/constants';

import { getSetting, saveSetting } from '@/shared/db/operations';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('DesignProjectLocations');

const DESIGN_PROJECT_LOCATIONS_SETTING = 'designModeProjectLocations';
const DESIGN_ROOT = 'design-projects';
const WIN_ROOT_RE = /^[A-Za-z]:\\?$/;

const BLOCKED_CANONICAL = (() => {
  const raw =
    process.platform === 'win32'
      ? ['C:\\Windows', 'C:\\Program Files', 'C:\\Program Files (x86)']
      : ['/etc', '/proc', '/sys', '/dev', '/boot'];
  const set = new Set<string>(raw);
  for (const item of raw) {
    try {
      set.add(fs.realpathSync.native(item));
    } catch {
      // Keep the literal path when the host does not expose it.
    }
  }
  return [...set];
})();

export interface DesignProjectLocationRecord {
  path: string;
  isDefault: boolean;
  configured: boolean;
  exists: boolean;
  projectCount: number;
  error?: string;
}

export class DesignProjectLocationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DesignProjectLocationError';
  }
}

export function getDefaultDesignProjectLocationRoot(): string {
  const workDir = getSetting('workDir');
  return path.resolve(workDir || getAppDir());
}

export function listDesignProjectLocations(): DesignProjectLocationRecord[] {
  const defaultRoot = getDefaultDesignProjectLocationRoot();
  const records = [
    inspectLocation(defaultRoot, { configured: false, isDefault: true }),
  ];
  const seen = new Set([pathKey(defaultRoot)]);

  for (const storedPath of readStoredLocationPaths()) {
    const key = pathKey(storedPath);
    if (seen.has(key)) continue;
    seen.add(key);
    records.push(
      inspectLocation(storedPath, { configured: true, isDefault: false }),
    );
  }

  return records;
}

export function getDesignProjectLocationRoots(): string[] {
  const roots = [getDefaultDesignProjectLocationRoot()];
  for (const storedPath of readStoredLocationPaths()) {
    const normalized = tryNormalizeDesignProjectLocation(storedPath);
    if (normalized) roots.push(normalized);
  }
  // Always search the app data dir as a fallback. Projects created before a
  // workspace folder was configured were scaffolded there (the default root was
  // the app dir); they must stay discoverable after `workDir` is later set or
  // changed — otherwise a saved project looks "not found" and can't be exported.
  roots.push(path.resolve(getAppDir()));
  return uniqueRoots(roots);
}

export function resolveDesignProjectLocationRoot(
  input?: string | null,
): string {
  if (!input?.trim()) return getDefaultDesignProjectLocationRoot();

  const candidateKey = pathKey(validateLocationPathInput(input));
  for (const root of getDesignProjectLocationRoots()) {
    if (pathKey(root) === candidateKey) return root;
  }

  throw new DesignProjectLocationError(
    'DesignMode project location must be configured before it can be used',
  );
}

export function addDesignProjectLocation(
  input: string,
): DesignProjectLocationRecord {
  const normalized = normalizeDesignProjectLocation(input);
  const defaultKey = pathKey(getDefaultDesignProjectLocationRoot());
  const stored = readStoredLocationPaths();
  const storedKeys = new Set(stored.map(pathKey));

  if (
    pathKey(normalized) !== defaultKey &&
    !storedKeys.has(pathKey(normalized))
  ) {
    saveStoredLocationPaths([...stored, normalized]);
  }

  return inspectLocation(normalized, {
    configured: pathKey(normalized) !== defaultKey,
    isDefault: pathKey(normalized) === defaultKey,
  });
}

export function removeDesignProjectLocation(pathInput: string): void {
  const defaultKey = pathKey(getDefaultDesignProjectLocationRoot());
  const removeKey = pathKey(validateLocationPathInput(pathInput));
  if (removeKey === defaultKey) {
    throw new DesignProjectLocationError(
      'Default DesignMode project location is controlled by the workspace setting',
    );
  }

  const next = readStoredLocationPaths().filter(
    (storedPath) => pathKey(storedPath) !== removeKey,
  );
  saveStoredLocationPaths(next);
}

export function normalizeDesignProjectLocation(input: string): string {
  const expanded = validateLocationPathInput(input);

  let realPath: string;
  try {
    realPath = fs.realpathSync.native(path.resolve(expanded));
    const stat = fs.statSync(realPath);
    if (!stat.isDirectory()) {
      throw new DesignProjectLocationError(
        `Project location is not a directory: ${input}`,
      );
    }
  } catch (error) {
    if (error instanceof DesignProjectLocationError) throw error;
    throw new DesignProjectLocationError(
      `Project location does not exist or is not accessible: ${input}`,
    );
  }

  if (isBlocked(realPath)) {
    throw new DesignProjectLocationError(
      `System directory is not allowed as a project location: ${input}`,
    );
  }
  return realPath;
}

function validateLocationPathInput(input: string): string {
  if (!input.trim() || input.includes('\0')) {
    throw new DesignProjectLocationError('Project location path is required');
  }
  const expanded = expandHome(input.trim());
  if (!path.isAbsolute(expanded)) {
    throw new DesignProjectLocationError(
      'Project location must be an absolute path',
    );
  }
  return expanded;
}

function tryNormalizeDesignProjectLocation(input: string): string | null {
  try {
    return normalizeDesignProjectLocation(input);
  } catch {
    return null;
  }
}

function inspectLocation(
  input: string,
  options: { configured: boolean; isDefault: boolean },
): DesignProjectLocationRecord {
  const resolved = path.resolve(expandHome(input));
  try {
    const realPath = options.isDefault
      ? resolved
      : normalizeDesignProjectLocation(input);
    const stat = fs.statSync(realPath);
    if (!stat.isDirectory()) {
      throw new DesignProjectLocationError(
        `Project location is not a directory: ${input}`,
      );
    }
    return {
      path: realPath,
      isDefault: options.isDefault,
      configured: options.configured,
      exists: true,
      projectCount: countProjectManifests(realPath),
    };
  } catch (error) {
    return {
      path: resolved,
      isDefault: options.isDefault,
      configured: options.configured,
      exists: false,
      projectCount: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function readStoredLocationPaths(): string[] {
  const raw = getSetting(DESIGN_PROJECT_LOCATIONS_SETTING);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string');
  } catch (error) {
    logger.warn('Ignoring invalid DesignMode project locations setting', error);
    return [];
  }
}

function saveStoredLocationPaths(paths: string[]) {
  saveSetting(
    DESIGN_PROJECT_LOCATIONS_SETTING,
    JSON.stringify(uniqueRoots(paths)),
  );
}

function uniqueRoots(roots: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const root of roots) {
    const key = pathKey(root);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(root);
  }
  return out;
}

function countProjectManifests(root: string): number {
  const projectsRoot = path.join(root, DESIGN_ROOT);
  try {
    return fs
      .readdirSync(projectsRoot, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() &&
          fs.existsSync(path.join(projectsRoot, entry.name, 'project.json')),
      ).length;
  } catch {
    return 0;
  }
}

function pathKey(input: string): string {
  const resolved = path.resolve(expandHome(input));
  try {
    return normalizeKey(fs.realpathSync.native(resolved));
  } catch {
    return normalizeKey(resolved);
  }
}

function normalizeKey(input: string): string {
  return process.platform === 'win32' ? input.toLowerCase() : input;
}

function expandHome(input: string): string {
  if (input === '~') return homedir();
  if (input.startsWith('~/') || input.startsWith('~\\')) {
    return path.join(homedir(), input.slice(2));
  }
  return input;
}

function isFilesystemRoot(candidate: string): boolean {
  if (process.platform === 'win32') return WIN_ROOT_RE.test(candidate);
  return candidate === '/';
}

function isBlocked(realPath: string): boolean {
  if (isFilesystemRoot(realPath)) return true;
  return BLOCKED_CANONICAL.some(
    (blocked) =>
      realPath === blocked ||
      realPath.startsWith(blocked + path.sep) ||
      blocked.startsWith(realPath + path.sep),
  );
}
