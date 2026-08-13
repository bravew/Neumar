import type { SpawnOptions } from 'node:child_process';

import type {
  ProcessSandboxMode,
  ProcessSandboxProfile,
} from '@/core/agent/sandbox-profile';

export type { ProcessSandboxMode, ProcessSandboxProfile };

export interface SandboxSpawnRequest {
  command: string;
  args: string[];
  cwd: string;
  workspaceRoot: string;
  sessionId: string;
  env: Record<string, string>;
  profile?: ProcessSandboxProfile;
}

export interface SandboxSpawnPlan {
  command: string;
  args: string[];
  options: SpawnOptions;
  mode: Exclude<ProcessSandboxMode, 'auto'>;
  reducedIsolation: boolean;
  reason?: string;
  cleanup?: () => void;
  /**
   * Phase 7 enforcement classification, mirroring SandboxCapabilities.enforcement.
   *  - 'hard'    : OS-enforced boundary in effect (e.g., Seatbelt deny default)
   *  - 'reduced' : best-effort wrapping; child can still escape OS controls
   *  - 'none'    : no isolation (explicitly disabled / off mode)
   */
  enforcement: 'hard' | 'reduced' | 'none';
}
