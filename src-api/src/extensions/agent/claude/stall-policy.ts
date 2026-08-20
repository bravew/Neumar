/**
 * Maximum time to wait for a complete Claude SDK message before aborting.
 * Partial messages are disabled, so large tool inputs can be silent for minutes.
 */
export const CLAUDE_SDK_STALL_ABORT_MS = 10 * 60 * 1_000;

export function hasClaudeSdkStalled(stallMs: number): boolean {
  return stallMs >= CLAUDE_SDK_STALL_ABORT_MS;
}
