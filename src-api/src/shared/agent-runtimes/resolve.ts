// Binary resolution + extended PATH for known package-manager bin locations.

import { existsSync, readdirSync } from 'fs';
import { delimiter, join, win32 } from 'path';

import { getSetting } from '@/shared/db/operations';
import {
  getMiseShimBinPaths,
  getNodeVersionManagerBinPaths,
} from '@/shared/utils/node-install-bins';

import type { ResolvedSource } from './types.js';

export interface ResolvedBinary {
  path: string;
  source: ResolvedSource;
}

export interface PathDiscoveryOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  pathExists?: (path: string) => boolean;
  readDir?: (path: string) => string[];
}

interface AgentRuntimeSettingLike {
  id?: unknown;
  type?: unknown;
  config?: {
    executablePath?: unknown;
  };
}

function parseAgentRuntimeSettings(
  raw: string | null,
): AgentRuntimeSettingLike[] {
  if (!raw) return [];
  try {
    let parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'string') parsed = JSON.parse(parsed);
    return Array.isArray(parsed) ? (parsed as AgentRuntimeSettingLike[]) : [];
  } catch {
    return [];
  }
}

export function getConfiguredExecutablePath(agentId: string): string | null {
  const settings = parseAgentRuntimeSettings(getSetting('agentRuntimes'));
  const match = settings.find(
    (setting) => setting.id === agentId || setting.type === agentId,
  );
  const executablePath = match?.config?.executablePath;
  if (typeof executablePath !== 'string') return null;
  const trimmed = executablePath.trim();
  if (!trimmed || trimmed.includes('\0')) return null;
  return trimmed;
}

export function resolveConfiguredBinary(
  agentId: string,
): ResolvedBinary | null {
  const configured = getConfiguredExecutablePath(agentId);
  if (!configured) return null;
  if (!existsSync(configured)) return null;
  return { path: configured, source: 'configured' };
}

export function getExtendedPath(options: PathDiscoveryOptions = {}): string {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const pathExists = options.pathExists ?? existsSync;
  const readDir = options.readDir ?? ((path: string) => readdirSync(path));
  const paths = [getEnvPath(env, platform)];

  if (platform === 'win32') {
    const userProfile = env.USERPROFILE || '';
    const appData = env.APPDATA || '';
    const localAppData = env.LOCALAPPDATA || '';
    const programFiles = env.ProgramFiles || 'C:\\Program Files';
    const programFilesX86 =
      env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

    paths.push(
      `${appData}\\npm`,
      `${localAppData}\\npm`,
      `${userProfile}\\.npm-global`,
      `${userProfile}\\.npm-global\\bin`,
      `${localAppData}\\pnpm`,
      `${appData}\\pnpm`,
      `${localAppData}\\Yarn\\bin`,
      `${appData}\\Yarn\\bin`,
      `${userProfile}\\.volta\\bin`,
      `${localAppData}\\Volta\\bin`,
      `${localAppData}\\mise\\shims`,
      `${programFiles}\\nodejs`,
      `${programFilesX86}\\nodejs`,
      `${userProfile}\\AppData\\Local\\Programs\\node`,
    );

    const nvmHome = env.NVM_HOME || `${appData}\\nvm`;
    try {
      if (pathExists(nvmHome)) {
        const versions = readDir(nvmHome).filter((v) => v.startsWith('v'));
        for (const version of versions) {
          paths.push(`${nvmHome}\\${version}`);
        }
        const nvmSymlink = env.NVM_SYMLINK || `${programFiles}\\nodejs`;
        paths.push(nvmSymlink);
      }
    } catch {
      // nvm-windows not installed
    }

    const fnmDir = `${localAppData}\\fnm_multishells`;
    try {
      pushChildDirs(paths, fnmDir, pathExists, readDir);
    } catch {
      // fnm not installed
    }

    pushWindowsFnmNodeInstallPaths(paths, env, pathExists, readDir);
  } else {
    const home = env.HOME || '';
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
      `${home}/code/node/npm_global/bin`,
    );

    paths.push(
      ...getMiseShimBinPaths(home),
      ...getNodeVersionManagerBinPaths(home),
    );
  }

  return paths.join(getPathDelimiter(platform));
}

// Walk PATH (and PATHEXT on Windows) using existsSync rather than shelling
// out to `which`/`where`. Avoids spawn cost and PATH-spoofing issues.
export function resolveOnPath(
  bin: string,
  options: PathDiscoveryOptions = {},
): ResolvedBinary | null {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const pathExists = options.pathExists ?? existsSync;
  const pathJoin = platform === 'win32' ? win32.join : join;
  const exts: string[] =
    platform === 'win32'
      ? (env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';')
      : [''];
  const extendedPath = getExtendedPath(options);
  const dirs = extendedPath
    .split(getPathDelimiter(platform))
    .filter((d) => d.length > 0);

  for (const dir of dirs) {
    for (const ext of exts) {
      const full = pathJoin(dir, bin + ext);
      try {
        if (pathExists(full)) {
          // We can't tell from existsSync alone whether it came from $PATH
          // proper or from our extended set; mark as 'path' for both since
          // user-facing it's identical. Distinguish 'bundled' / 'wsl'
          // separately.
          return { path: full, source: 'path' };
        }
      } catch {
        // Permission errors on a single dir shouldn't kill the walk.
      }
    }
  }
  return null;
}

function getEnvPath(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string {
  if (env.PATH) return env.PATH;
  if (platform === 'win32') return env.Path || env.path || '';
  return '';
}

function getPathDelimiter(platform: NodeJS.Platform): string {
  return platform === 'win32' ? ';' : delimiter;
}

function pushChildDirs(
  paths: string[],
  root: string,
  pathExists: (path: string) => boolean,
  readDir: (path: string) => string[],
): void {
  if (!root || !pathExists(root)) return;
  for (const child of readDir(root)) {
    paths.push(`${root}\\${child}`);
  }
}

function pushWindowsFnmNodeInstallPaths(
  paths: string[],
  env: NodeJS.ProcessEnv,
  pathExists: (path: string) => boolean,
  readDir: (path: string) => string[],
): void {
  const appData = env.APPDATA || '';
  const localAppData = env.LOCALAPPDATA || '';
  const roots = new Set(
    [
      appData ? `${appData}\\fnm` : '',
      localAppData ? `${localAppData}\\fnm` : '',
      env.FNM_DIR || '',
    ].filter(Boolean),
  );

  for (const root of roots) {
    try {
      const nodeVersionsRoot = `${root}\\node-versions`;
      if (!pathExists(nodeVersionsRoot)) continue;

      for (const version of readDir(nodeVersionsRoot)) {
        const versionRoot = `${nodeVersionsRoot}\\${version}`;
        const installationRoot = `${versionRoot}\\installation`;
        if (pathExists(installationRoot)) {
          paths.push(installationRoot);
        } else if (pathExists(versionRoot)) {
          paths.push(versionRoot);
        }
      }
    } catch {
      // fnm layout is optional; ignore unreadable version roots.
    }
  }
}
