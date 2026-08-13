import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { getAppDir } from '@/config/constants';

import type {
  ProcessSandboxProfile,
  SandboxSpawnPlan,
  SandboxSpawnRequest,
} from './types';

const SANDBOX_EXEC = '/usr/bin/sandbox-exec';

let cachedAvailability: boolean | null = null;
export function isMacosSeatbeltAvailable(): boolean {
  if (cachedAvailability !== null) return cachedAvailability;
  cachedAvailability =
    process.platform === 'darwin' && existsSync(SANDBOX_EXEC);
  return cachedAvailability;
}

function escapeSchemeString(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

function uniqueResolvedPaths(paths: string[]): string[] {
  return [...new Set(paths.map((path) => resolve(path)))];
}

export function buildMacosSeatbeltProfile(
  request: Pick<SandboxSpawnRequest, 'cwd' | 'workspaceRoot'> & {
    profile?: ProcessSandboxProfile;
  },
): string {
  const tmpRoot = process.env.TMPDIR || tmpdir();
  const readOnlyPaths = uniqueResolvedPaths([
    '/bin',
    '/sbin',
    '/usr/bin',
    '/usr/lib',
    '/usr/libexec',
    '/usr/local/bin',
    '/opt/homebrew/bin',
    '/System/Library',
    '/Library/Apple',
    ...(request.profile?.readonlyPaths ?? []),
  ]);
  const writablePaths = uniqueResolvedPaths([
    request.workspaceRoot,
    request.cwd,
    tmpRoot,
    ...(request.profile?.writablePaths ?? []),
  ]);

  const readRules = readOnlyPaths
    .map((path) => `  (subpath "${escapeSchemeString(path)}")`)
    .join('\n');
  const writeRules = writablePaths
    .map((path) => `  (subpath "${escapeSchemeString(path)}")`)
    .join('\n');
  const networkRule = request.profile?.allowNetwork
    ? '(allow network*)'
    : '(deny network*)';

  return `(version 1)
(deny default)
(allow process*)
(allow sysctl-read)
(allow signal (target self))
(allow file-read-metadata)
(allow file-read*
${readRules}
${writeRules})
(allow file-write*
${writeRules})
${networkRule}
(allow mach-lookup
  (global-name "com.apple.system.notification_center")
  (global-name "com.apple.coreservices.launchservicesd"))`;
}

export function createMacosSeatbeltSpawnPlan(
  request: SandboxSpawnRequest,
): SandboxSpawnPlan {
  if (!isMacosSeatbeltAvailable()) {
    throw new Error('macOS sandbox-exec is not available on this host');
  }

  const sandboxDir = join(getAppDir(), 'sandbox');
  mkdirSync(sandboxDir, { recursive: true, mode: 0o700 });
  // Reject any sessionId that could escape sandboxDir via "..", "/", or other
  // path separators. Production sessionIds are UUIDs; this is a defense in
  // depth against an unexpected caller passing untrusted ids.
  if (!/^[A-Za-z0-9._-]+$/.test(request.sessionId)) {
    throw new Error(
      `Invalid sessionId for sandbox profile path: ${request.sessionId}`,
    );
  }
  const profilePath = join(sandboxDir, `${request.sessionId}.sb`);
  writeFileSync(profilePath, buildMacosSeatbeltProfile(request), {
    mode: 0o600,
  });

  return {
    command: SANDBOX_EXEC,
    args: ['-f', profilePath, request.command, ...request.args],
    options: {
      cwd: request.cwd,
      env: request.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
    mode: 'macos-seatbelt',
    reducedIsolation: false,
    // sandbox-exec is officially deprecated by Apple but still the strongest
    // OS-level boundary we can apply to a non-bundled child. Treat as 'hard'
    // until Apple removes it; the audit/UI layer is free to label it as
    // best-effort.
    enforcement: 'hard',
    cleanup: () => {
      rmSync(profilePath, { force: true });
    },
  };
}
