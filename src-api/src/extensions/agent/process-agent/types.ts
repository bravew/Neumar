import type { ProcessSandboxProfile } from './sandbox';

/**
 * Process Agent Types
 */

export interface ProcessAgentConfig {
  /** Executable path or name */
  command: string;
  /** Command arguments */
  args: string[];
  /** Working directory (validated against workspace root) */
  cwd?: string;
  /** Only these env vars passed through */
  envAllowlist: string[];
  /** Stdout parsing strategy */
  parseMode: 'line' | 'json' | 'streaming';
  /** Max execution time in ms (default 120_000) */
  timeout?: number;
  /** Process sandbox profile. Defaults to auto hardening when supported. */
  sandboxProfile?: ProcessSandboxProfile;
}
