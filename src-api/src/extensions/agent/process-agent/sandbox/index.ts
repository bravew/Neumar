import { execSync } from 'node:child_process';

import {
  createMacosSeatbeltSpawnPlan,
  isMacosSeatbeltAvailable,
} from './macos';
import type { SandboxSpawnPlan, SandboxSpawnRequest } from './types';

export type {
  ProcessSandboxMode,
  ProcessSandboxProfile,
  SandboxSpawnPlan,
  SandboxSpawnRequest,
} from './types';
export { buildMacosSeatbeltProfile, isMacosSeatbeltAvailable } from './macos';

function createSoftSpawnPlan(
  request: SandboxSpawnRequest,
  reason: string,
  enforcement: 'reduced' | 'none' = 'reduced',
): SandboxSpawnPlan {
  return {
    command: request.command,
    args: request.args,
    options: {
      cwd: request.cwd,
      env: request.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
    mode: 'soft',
    reducedIsolation: true,
    reason,
    enforcement,
  };
}

let cachedBwrap: boolean | null = null;
function isLinuxBubblewrapAvailable(): boolean {
  if (process.platform !== 'linux') return false;
  if (cachedBwrap !== null) return cachedBwrap;
  try {
    execSync('command -v bwrap', { stdio: 'ignore' });
    cachedBwrap = true;
  } catch {
    cachedBwrap = false;
  }
  return cachedBwrap;
}

/**
 * Per-platform reduced-isolation reason for `auto` mode when no hard sandbox
 * is available. Surfaces the actionable remediation for the operator instead
 * of a generic "no supported OS sandbox" string.
 */
function platformReducedReason(): string {
  switch (process.platform) {
    case 'darwin':
      return 'macOS sandbox-exec is unavailable on this host (binary missing).';
    case 'linux':
      return isLinuxBubblewrapAvailable()
        ? 'Linux bubblewrap is available but not yet integrated by the process agent.'
        : 'Linux hard sandbox unavailable: install bubblewrap (`bwrap`) or rely on the codex/ASRT providers.';
    case 'win32':
      return 'Windows hard sandbox is not implemented; marketplace process execution is blocked on Windows until AppContainer support ships.';
    default:
      return `No supported OS sandbox for platform "${process.platform}".`;
  }
}

export function createSandboxSpawnPlan(
  request: SandboxSpawnRequest,
): SandboxSpawnPlan {
  const mode = request.profile?.mode ?? 'auto';

  if (mode === 'off') {
    return createSoftSpawnPlan(
      request,
      'sandbox explicitly disabled (off mode requires trusted-local consent)',
      'none',
    );
  }

  if (mode === 'soft') {
    return createSoftSpawnPlan(request, 'soft sandbox mode requested');
  }

  if (mode === 'macos-seatbelt') {
    return createMacosSeatbeltSpawnPlan(request);
  }

  // mode === 'auto'
  if (isMacosSeatbeltAvailable()) {
    return createMacosSeatbeltSpawnPlan(request);
  }

  return createSoftSpawnPlan(request, platformReducedReason());
}
