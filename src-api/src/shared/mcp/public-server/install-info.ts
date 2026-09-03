import { existsSync } from 'node:fs';
import path from 'node:path';

import { branding } from '@/config/branding';

import { PUBLIC_MCP_SERVER_NAME } from '@/shared/mcp/public-server/catalog';
import { readDaemonRecord } from '@/shared/services/external-mcp/daemon-record';
import { getAppDataDir } from '@/shared/utils/paths';

const CACHE_MS = 5_000;
const POSIX_QUOTE = /[\s'"\\$`!#&*()[\]{}|;<>?]/;
const WIN_QUOTE = /[\s"]/;

export interface ExternalMcpInstallInfo {
  serverName: typeof PUBLIC_MCP_SERVER_NAME;
  command: string;
  args: string[];
  env: Record<string, string>;
  daemonUrl: string;
  appDataDir: string;
  binaryExists: boolean;
  platform: NodeJS.Platform;
  buildHint: string | null;
  codexCommand: string;
  claudeCodeCommand: string;
  codexRemoveCommand: string;
  claudeCodeRemoveCommand: string;
  development: boolean;
}

export interface BuildInstallInfoInput {
  daemonUrl: string;
  appDataDir: string;
  command: string;
  prefixArgs?: string[];
  platform?: NodeJS.Platform;
  development?: boolean;
  binaryExists?: boolean;
  buildHint?: string | null;
}

export interface ResolveLaunchBinaryInput {
  execPath?: string;
  argv1?: string;
  binaryName?: string;
  platform?: NodeJS.Platform;
  pkg?: boolean;
}

let cached: {
  key: string;
  expiresAt: number;
  value: ExternalMcpInstallInfo;
} | null = null;

export function quoteCliArg(value: string, platform: NodeJS.Platform): string {
  if (platform === 'win32') {
    if (!WIN_QUOTE.test(value)) return value;
    return `"${value.replace(/"/g, '""')}"`;
  }
  if (!POSIX_QUOTE.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function formatCliCommand(
  parts: readonly string[],
  platform: NodeJS.Platform,
): string {
  return parts.map((part) => quoteCliArg(part, platform)).join(' ');
}

export function resolveLaunchBinary(options: ResolveLaunchBinaryInput = {}): {
  command: string;
  prefixArgs: string[];
  development: boolean;
} {
  const platform = options.platform ?? process.platform;
  const binaryName = options.binaryName ?? branding.api.binaryName;
  let command = options.execPath ?? process.execPath;
  if (platform === 'win32' && !command.toLowerCase().endsWith('.exe')) {
    command = `${command}.exe`;
  }
  const base = path.basename(command).toLowerCase();
  const packaged =
    options.pkg === true ||
    base === binaryName.toLowerCase() ||
    base === `${binaryName.toLowerCase()}.exe`;
  if (packaged) {
    return { command, prefixArgs: [], development: false };
  }
  const argv1 = options.argv1 ?? process.argv[1];
  return {
    command,
    prefixArgs: argv1 ? [argv1] : [],
    development: true,
  };
}

export function buildExternalMcpInstallInfo(
  input: BuildInstallInfoInput,
): ExternalMcpInstallInfo {
  const platform = input.platform ?? process.platform;
  const args = [
    ...(input.prefixArgs ?? []),
    'mcp',
    'server',
    '--daemon-url',
    input.daemonUrl,
  ];
  const env = { NEUMAR_APP_DATA_DIR: input.appDataDir };
  const envArg = `NEUMAR_APP_DATA_DIR=${input.appDataDir}`;
  const launch = [input.command, ...args];
  const binaryExists = input.binaryExists ?? existsSync(input.command);
  const buildHint =
    input.buildHint !== undefined
      ? input.buildHint
      : binaryExists
        ? null
        : `Build the ${branding.api.binaryName} sidecar or open a packaged Neumar app.`;

  return {
    serverName: PUBLIC_MCP_SERVER_NAME,
    command: input.command,
    args,
    env,
    daemonUrl: input.daemonUrl,
    appDataDir: input.appDataDir,
    binaryExists,
    platform,
    buildHint,
    codexCommand: formatCliCommand(
      [
        'codex',
        'mcp',
        'add',
        PUBLIC_MCP_SERVER_NAME,
        '--env',
        envArg,
        '--',
        ...launch,
      ],
      platform,
    ),
    claudeCodeCommand: formatCliCommand(
      [
        'claude',
        'mcp',
        'add',
        '--scope',
        'user',
        PUBLIC_MCP_SERVER_NAME,
        '--env',
        envArg,
        '--',
        ...launch,
      ],
      platform,
    ),
    codexRemoveCommand: formatCliCommand(
      ['codex', 'mcp', 'remove', PUBLIC_MCP_SERVER_NAME],
      platform,
    ),
    claudeCodeRemoveCommand: formatCliCommand(
      ['claude', 'mcp', 'remove', '--scope', 'user', PUBLIC_MCP_SERVER_NAME],
      platform,
    ),
    development: input.development ?? false,
  };
}

export function resetInstallInfoCache(): void {
  cached = null;
}

export function getExternalMcpInstallInfo(
  now = Date.now(),
): ExternalMcpInstallInfo {
  const port = Number(process.env.PORT) || 5126;
  const daemonUrl = readDaemonRecord()?.url ?? `http://127.0.0.1:${port}`;
  if (cached && cached.key === daemonUrl && cached.expiresAt > now) {
    return cached.value;
  }
  const launch = resolveLaunchBinary();
  const info = buildExternalMcpInstallInfo({
    daemonUrl,
    appDataDir: getAppDataDir(),
    command: launch.command,
    prefixArgs: launch.prefixArgs,
    development: launch.development,
  });
  cached = { key: daemonUrl, expiresAt: now + CACHE_MS, value: info };
  return info;
}
