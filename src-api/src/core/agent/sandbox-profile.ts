export type ProcessSandboxMode = 'auto' | 'off' | 'soft' | 'macos-seatbelt';

export interface ProcessSandboxProfile {
  /**
   * auto: use the strongest supported sandbox for the host.
   * soft: validation/env/cwd containment only.
   * off: explicit opt-out for trusted local automation.
   * macos-seatbelt: require sandbox-exec; fail if unavailable.
   */
  mode?: ProcessSandboxMode;
  /** Allow outbound networking from the child. Defaults to false. */
  allowNetwork?: boolean;
  /** Additional read-only paths required by the child runtime. */
  readonlyPaths?: string[];
  /** Additional writable paths. Use sparingly. */
  writablePaths?: string[];
}
