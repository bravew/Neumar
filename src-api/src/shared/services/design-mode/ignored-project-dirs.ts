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

export function pathHasIgnoredProjectDir(filePath: string): boolean {
  return filePath
    .split(/[\\/]+/)
    .some((segment) => isIgnoredProjectDirName(segment));
}
