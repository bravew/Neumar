/**
 * Shared Codex CLI binary/path discovery.
 *
 * Used by both the Codex *agent* adapter (`src/extensions/agent/codex/`) and
 * the Codex *media* adapter (`src/shared/services/media-generation/adapters/codex.ts`).
 *
 * @module shared/utils/codex-binary
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

import { createLogger } from './logger';
import {
  getMiseShimBinPaths,
  getMiseNodeBinPaths,
  getNodeVersionManagerBinPaths,
} from './node-install-bins';

const logger = createLogger('CodexBinary');

// ============================================================================
// Extended PATH for sidecar processes
// ============================================================================

/**
 * Tauri sidecar processes start with a minimal PATH (typically missing
 * `/opt/homebrew/bin`, nvm, mise, volta, pnpm). Join common install roots onto
 * the caller's PATH so child processes can locate `codex` and friends.
 *
 * Cached per-process — PATH/HOME are stable for the lifetime of the daemon.
 */
let _cachedExtendedPath: string | undefined;
export function getExtendedPath(): string {
  if (_cachedExtendedPath !== undefined) return _cachedExtendedPath;

  const paths = [process.env.PATH || ''];
  const home = process.env.HOME || homedir();
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || '';
    const localAppData = process.env.LOCALAPPDATA || '';
    paths.push(
      `${appData}\\npm`,
      `${localAppData}\\pnpm`,
      `${home}\\.volta\\bin`,
    );
  } else {
    paths.push(
      '/opt/homebrew/bin',
      '/opt/homebrew/sbin',
      '/usr/local/bin',
      '/usr/local/sbin',
      '/opt/local/bin',
      '/opt/local/sbin',
      '/home/linuxbrew/.linuxbrew/bin',
      '/home/linuxbrew/.linuxbrew/sbin',
      `${home}/.local/bin`,
      `${home}/.npm-global/bin`,
      `${home}/.volta/bin`,
      `${home}/.cargo/bin`,
      `${home}/.bun/bin`,
    );
    paths.push(
      ...getMiseShimBinPaths(home),
      ...getNodeVersionManagerBinPaths(home),
    );
  }
  _cachedExtendedPath = paths.join(process.platform === 'win32' ? ';' : ':');
  return _cachedExtendedPath;
}

// ============================================================================
// Binary discovery
// ============================================================================

let _resolvedCodexPath: string | undefined;

/**
 * Locate the `codex` CLI binary. Search order, fastest first:
 *
 *   1. Known install locations (homebrew, npm, volta, nvm, mise) — cheap filesystem checks.
 *   2. `which`/`where` with extended PATH — one child process, ~5 ms.
 *   3. Login shell `which codex` — only as a last resort; spawns a user shell
 *      with rc files (up to 5 s per attempt), expensive when the binary isn't
 *      installed.
 *
 * Result is memoized after the first call.
 */
export function resolveCodexBinaryPath(): string | undefined {
  if (_resolvedCodexPath !== undefined) return _resolvedCodexPath || undefined;

  const isWin = process.platform === 'win32';
  const binaryName = isWin ? 'codex.cmd' : 'codex';
  const home = isWin ? homedir() : process.env.HOME || homedir();

  const commonPaths = isWin
    ? [
        join(home, 'AppData', 'Roaming', 'npm', 'codex.cmd'),
        join(home, 'AppData', 'Local', 'pnpm', 'codex.cmd'),
      ]
    : [
        '/usr/local/bin/codex',
        '/opt/homebrew/bin/codex',
        join(home, '.local', 'bin', 'codex'),
        join(home, '.npm-global', 'bin', 'codex'),
        join(home, '.volta', 'bin', 'codex'),
        join(home, '.local', 'share', 'mise', 'shims', 'codex'),
      ];

  for (const p of commonPaths) {
    if (existsSync(p)) {
      logger.info(`Found codex at: ${p}`);
      _resolvedCodexPath = p;
      return p;
    }
  }

  if (!isWin) {
    const miseNodeBins = new Set(getMiseNodeBinPaths(home));
    for (const dir of getNodeVersionManagerBinPaths(home)) {
      const p = join(dir, binaryName);
      if (existsSync(p)) {
        const source = miseNodeBins.has(dir) ? 'mise' : 'nvm';
        logger.info(`Found codex at ${source} path: ${p}`);
        _resolvedCodexPath = p;
        return p;
      }
    }
  }

  const extendedEnv = { ...process.env, PATH: getExtendedPath() };

  try {
    const cmd = isWin ? 'where codex' : 'which codex';
    const result = execSync(cmd, {
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 5000,
      env: extendedEnv,
    })
      .trim()
      .split('\n')[0];
    if (result && existsSync(result)) {
      logger.info(`Found codex via which: ${result}`);
      _resolvedCodexPath = result;
      return result;
    }
  } catch {
    /* fall through */
  }

  // Login-shell probes are last — they cost up to 5 s per attempt when the
  // binary isn't installed, so only run them after cheaper strategies fail.
  if (!isWin) {
    for (const shell of ['bash', 'zsh']) {
      try {
        const result = execSync(`${shell} -l -c "which codex"`, {
          encoding: 'utf8',
          stdio: 'pipe',
          timeout: 5000,
          env: extendedEnv,
        }).trim();
        if (result && existsSync(result)) {
          logger.info(`Found codex via ${shell} login shell: ${result}`);
          _resolvedCodexPath = result;
          return result;
        }
      } catch {
        /* try next */
      }
    }
  }

  _resolvedCodexPath = '';
  logger.warn('codex binary not found in PATH or common locations');
  return undefined;
}
