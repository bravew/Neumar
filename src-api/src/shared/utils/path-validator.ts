/**
 * Path Validator
 *
 * Validates user-supplied workspace paths to prevent agents
 * from accessing system directories. Also provides per-folder
 * permission checking (Cowork-style consent model).
 *
 * Security mitigations:
 *  - Null-byte injection       → reject paths containing \0
 *  - Path traversal            → reject ".." sequences
 *  - System path protection    → OS-aware blocked path lists
 *  - Symlink evasion           → realpath() re-check after resolution
 *  - Case-insensitive FS       → lowercased comparison on Windows / macOS
 *  - Home directory as workspace → explicitly blocked (too broad)
 */

import { realpathSync } from 'fs';
import { homedir, platform } from 'os';
import { resolve, sep } from 'path';

import { getAppDir } from '@/config/constants';

/** Discriminated union — callers can narrow on `valid` without extra null checks. */
export type ValidationResult =
  | { valid: true; resolved: string }
  | { valid: false; error: string };

/** Operation types for granular permission checks. */
export type OperationType = 'read' | 'write' | 'delete';

/** Folder permission structure matching the frontend's FolderPermission type. */
export interface AllowedFolder {
  path: string;
  permissions: { read: boolean; write: boolean; delete: boolean };
}

/** Result of a permission check. */
export type PermissionCheckResult =
  | { allowed: true }
  | { allowed: false; reason: string };

/** Whether the OS uses a case-insensitive filesystem (Windows & macOS). */
const IS_CASE_INSENSITIVE_FS =
  platform() === 'win32' || platform() === 'darwin';

/**
 * Normalize a path for comparison: on case-insensitive filesystems (Windows,
 * macOS HFS+/APFS) we lowercase so "C:\Windows" matches "c:\windows".
 */
function normalizePath(p: string): string {
  return IS_CASE_INSENSITIVE_FS ? p.toLowerCase() : p;
}

/**
 * System paths that must never be used as a workspace directory.
 *
 * POSIX list covers Linux + macOS system paths.
 * Windows list covers system and program directories. All comparisons are
 * case-insensitive on Windows/macOS (see isBlockedPath).
 */
const POSIX_BLOCKED_PATHS = [
  '/',
  '/etc',
  '/usr',
  '/sys',
  '/proc',
  '/dev',
  '/boot',
  '/sbin',
  '/bin',
  '/var',
  '/tmp',
  '/private', // macOS: /private/etc, /private/var, /private/tmp
  '/System',
  '/Library', // macOS system library
  '/Library/System',
];

const WINDOWS_BLOCKED_PATHS = [
  'C:\\Windows',
  'C:\\Program Files',
  'C:\\Program Files (x86)',
  'C:\\ProgramData',
  'C:\\Recovery',
];

/** Returns the appropriate blocked paths list for the current OS. */
function getBlockedPaths(): string[] {
  return platform() === 'win32' ? WINDOWS_BLOCKED_PATHS : POSIX_BLOCKED_PATHS;
}

/**
 * Check if a resolved path matches or is inside a blocked path.
 * Uses case-insensitive comparison on Windows/macOS.
 */
function isBlockedPath(
  resolved: string,
  blockedPaths: string[],
): string | null {
  const normalizedResolved = normalizePath(resolved);
  for (const blocked of blockedPaths) {
    const normalizedBlocked = normalizePath(blocked);
    if (
      normalizedResolved === normalizedBlocked ||
      normalizedResolved.startsWith(normalizedBlocked + sep)
    ) {
      return blocked;
    }
  }
  return null;
}

/**
 * Cache for validateWorkDir results.
 * Avoids repeated realpathSync() calls that trigger macOS TCC prompts
 * for the same workspace path within the same process.
 */
const validateWorkDirCache = new Map<string, ValidationResult>();

/**
 * Validate a user-supplied workspace path.
 *
 * - Rejects null bytes (prevents null-byte injection attacks)
 * - Rejects empty / whitespace-only paths
 * - Expands `~` to the user's home directory
 * - Blocks `..` traversal sequences
 * - Blocks known system paths (OS-aware, case-insensitive on Windows/macOS)
 * - Resolves symlinks and re-checks against blocked paths
 *
 * Results are cached per raw path to avoid repeated filesystem operations.
 */
export function validateWorkDir(rawPath: string): ValidationResult {
  const cached = validateWorkDirCache.get(rawPath);
  if (cached) return cached;

  const result = validateWorkDirUncached(rawPath);
  validateWorkDirCache.set(rawPath, result);
  return result;
}

/** Internal uncached implementation of validateWorkDir. */
function validateWorkDirUncached(rawPath: string): ValidationResult {
  if (!rawPath || !rawPath.trim()) {
    return { valid: false, error: 'Path cannot be empty' };
  }

  const trimmed = rawPath.trim();

  // Block null-byte injection (can truncate paths in C-based syscalls)
  if (trimmed.includes('\0')) {
    return { valid: false, error: 'Path contains invalid null byte' };
  }

  // Block path traversal — match ".." only as a complete path segment
  // (e.g., "/../", "\..\", leading "../", or trailing "/..")
  // This avoids false positives on legitimate names like "my-project..v2"
  if (/(^|[\\/])\.\.([\\/]|$)/.test(trimmed)) {
    return {
      valid: false,
      error: 'Path must not contain ".." traversal sequences',
    };
  }

  // Expand ~ to home directory (handles both POSIX ~/... and bare ~)
  let expanded = trimmed;
  if (expanded.startsWith('~/') || expanded === '~') {
    expanded = expanded.replace(/^~/, homedir());
  }

  // Resolve to absolute path (normalises separators on Windows)
  const resolved = resolve(expanded);

  // Block using the home directory itself as a workspace (too broad)
  const home = homedir();
  if (normalizePath(resolved) === normalizePath(home)) {
    return {
      valid: false,
      error:
        'Home directory cannot be used as a workspace — choose a subdirectory',
    };
  }

  // Check against blocked system paths
  const blockedPaths = getBlockedPaths();
  const blockedMatch = isBlockedPath(resolved, blockedPaths);
  if (blockedMatch) {
    return {
      valid: false,
      error: `Access to system path "${blockedMatch}" is not allowed`,
    };
  }

  // Resolve symlinks and re-check (best-effort — path may not exist yet)
  try {
    const real = realpathSync(resolved);
    const realBlockedMatch = isBlockedPath(real, blockedPaths);
    if (realBlockedMatch) {
      return {
        valid: false,
        error: `Path resolves to blocked system path "${realBlockedMatch}"`,
      };
    }
    return { valid: true, resolved: real };
  } catch {
    // Path doesn't exist yet — that's OK, just use the resolved path
    return { valid: true, resolved };
  }
}

/**
 * Check whether a target path is within an allowed folder with the required permission.
 *
 * - Delete operations ALWAYS return `{ allowed: false }` — these require
 *   per-operation consent via the existing pendingPermission flow.
 * - Read/write operations check if the target path is within any allowed folder
 *   and that folder grants the requested permission level.
 * - Resolves symlinks (best-effort) for consistent comparison.
 * - Uses case-insensitive comparison on Windows/macOS to match filesystem behaviour.
 */
export function checkPermission(
  targetPath: string,
  operation: OperationType,
  allowedFolders: AllowedFolder[],
): PermissionCheckResult {
  // Delete is never auto-approved — must go through per-operation consent
  if (operation === 'delete') {
    return {
      allowed: false,
      reason: 'Delete operations require explicit per-operation consent',
    };
  }

  if (!allowedFolders || allowedFolders.length === 0) {
    return {
      allowed: false,
      reason: 'No folders have been granted permission',
    };
  }

  // Resolve the target path (try symlinks, fall back to resolve)
  const resolved = normalizePath(tryRealpath(targetPath));

  // Always allow the app's own data directory (sessions, config, etc.)
  const appDir = normalizePath(tryRealpath(getAppDir()));
  if (resolved === appDir || resolved.startsWith(appDir + sep)) {
    return { allowed: true };
  }

  for (const folder of allowedFolders) {
    const folderResolved = normalizePath(tryRealpath(folder.path));
    // Check if targetPath is within (or equal to) the allowed folder
    if (
      resolved === folderResolved ||
      resolved.startsWith(folderResolved + sep)
    ) {
      if (folder.permissions[operation]) {
        return { allowed: true };
      }
      return {
        allowed: false,
        reason: `Folder "${folder.path}" does not grant ${operation} permission`,
      };
    }
  }

  return {
    allowed: false,
    reason: `Path "${targetPath}" is not within any allowed folder`,
  };
}

/**
 * Sensitive paths that agents must never read from.
 * These paths contain credentials, keys, and configurations that could
 * be exfiltrated via prompt injection.
 */
const SENSITIVE_READ_PATHS = [
  '~/.ssh',
  '~/.aws',
  '~/.azure',
  '~/.config/gcloud',
  '~/.docker/config.json',
  '~/.kube/config',
  '~/.gnupg',
  '~/.npmrc',
  '~/.pypirc',
  '~/.netrc',
  '~/.git-credentials',
];

/**
 * Resolve sensitive paths by expanding `~` to the user's home directory.
 */
function resolveSensitivePaths(): string[] {
  const home = homedir();
  return SENSITIVE_READ_PATHS.map((p) => resolve(p.replace(/^~/, home)));
}

/**
 * Build filesystem sandbox boundaries for the Claude Agent SDK.
 *
 * Returns `allowWrite`, `denyWrite`, and `denyRead` arrays suitable for
 * the SDK's `sandbox.filesystem` config. This enforces OS-level isolation
 * via macOS Seatbelt / Linux Bubblewrap — a hard boundary that the LLM
 * cannot bypass regardless of prompt injection.
 *
 * @param sessionDir  - The session working directory (always writable)
 * @param userWorkspaceDir - Optional user-selected workspace folder
 *                           (writable if `allowWorkspaceWrite` is true, else read-only)
 * @param allowWorkspaceWrite - Whether the user workspace should be writable
 */
export function buildSandboxFilesystemConfig(
  sessionDir: string,
  userWorkspaceDir?: string,
  allowWorkspaceWrite = false,
): {
  allowWrite: string[];
  denyWrite: string[];
  denyRead: string[];
} {
  const allowWrite = [sessionDir];

  if (userWorkspaceDir && allowWorkspaceWrite) {
    allowWrite.push(userWorkspaceDir);
  }

  // Deny writes to sensitive configuration directories
  const home = homedir();
  const denyWrite = [
    resolve(home, '.ssh'),
    resolve(home, '.aws'),
    resolve(home, '.azure'),
    resolve(home, '.gnupg'),
    resolve(home, '.bashrc'),
    resolve(home, '.zshrc'),
    resolve(home, '.bash_profile'),
    resolve(home, '.profile'),
    resolve(home, '.gitconfig'),
  ];

  // Deny reads to credential stores
  const denyRead = resolveSensitivePaths();

  return { allowWrite, denyWrite, denyRead };
}

/** Commands that take filesystem paths as arguments (module-scope to avoid re-compilation). */
const FS_COMMANDS =
  /\b(find|ls|cat|head|tail|less|more|tree|du|stat|file|readlink|cp|mv|rm|mkdir|touch|chmod|chown)\b/;

/**
 * Validate that a bash command does not access paths outside the allowed boundaries.
 *
 * This is a defense-in-depth measure on top of OS-level sandboxing.
 * Extracts path-like arguments from common filesystem commands and checks
 * them against allowed directories.
 *
 * @returns null if the command is safe, or an error message if it violates boundaries.
 */
export function validateBashCommand(
  command: string,
  allowedDirs: string[],
): string | null {
  if (!FS_COMMANDS.test(command)) {
    return null; // Not a filesystem command — allow
  }

  // Extract absolute paths from the command
  const absolutePathRegex = /(?:^|\s)(\/[^\s;|&><"']+)/g;
  const homePathRegex = /(?:^|\s)(~[^\s;|&><"']*)/g;

  const home = homedir();
  const extractedPaths: string[] = [];

  let match;
  while ((match = absolutePathRegex.exec(command)) !== null) {
    extractedPaths.push(resolve(match[1]!));
  }
  while ((match = homePathRegex.exec(command)) !== null) {
    extractedPaths.push(resolve(match[1]!.replace(/^~/, home)));
  }

  if (extractedPaths.length === 0) {
    return null; // No absolute paths — relative paths are fine (confined to cwd)
  }

  // Check each extracted path against allowed directories
  const normalizedAllowed = allowedDirs.map((d) => normalizePath(resolve(d)));

  for (const extractedPath of extractedPaths) {
    const normalizedPath = normalizePath(extractedPath);
    const isAllowed = normalizedAllowed.some(
      (allowed) =>
        normalizedPath === allowed || normalizedPath.startsWith(allowed + sep),
    );
    if (!isAllowed) {
      return `Command accesses path "${extractedPath}" which is outside allowed directories: ${allowedDirs.join(', ')}`;
    }
  }

  return null;
}

/**
 * Cache for tryRealpath results.
 * Avoids repeated realpathSync() calls for the same path (e.g. appDir)
 * that trigger macOS TCC prompts.
 */
const realpathCache = new Map<string, string>();

/**
 * Best-effort realpath: resolves symlinks when the path exists,
 * falls back to `resolve()` for paths that don't exist yet.
 * Results are cached per path.
 */
function tryRealpath(p: string): string {
  const key = resolve(p);
  const cached = realpathCache.get(key);
  if (cached !== undefined) return cached;

  let result: string;
  try {
    result = realpathSync(key);
  } catch {
    result = key;
  }
  realpathCache.set(key, result);
  return result;
}
