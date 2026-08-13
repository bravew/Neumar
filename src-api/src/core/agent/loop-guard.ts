/**
 * Loop Guard
 *
 * Backstop against runaway agent loops. `maxTurns` (200) only bounds a run very
 * loosely — long enough for an agent to spend 10+ minutes thrashing on an
 * unsolvable step (observed: 39 sub-agents spawned to re-attempt a YouTube
 * download that was returning HTTP 403). This trips far earlier, on two signals:
 *
 *  1. Identical-call thrashing — the same tool invoked with the same input
 *     repeatedly. There is no legitimate reason to repeat an identical call many
 *     times, so this is safe and universal.
 *  2. Runaway fan-out — a spawning tool (sub-agents) invoked many times in a
 *     single run without the task completing.
 *
 * Once tripped it stays tripped and denies every subsequent tool call, forcing
 * the agent to stop and answer the user in text instead of looping.
 */

import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('LoopGuard');

/** Same (tool + input) seen this many times → identical-call thrashing. */
const DEFAULT_REPEAT_THRESHOLD = 4;
/** A single spawning tool invoked this many times in a run → runaway fan-out. */
const DEFAULT_SPAWN_CAP = 20;
/** Tools whose repeated invocation indicates a runaway fan-out loop. */
const SPAWN_TOOLS = new Set(['Agent', 'Task']);

export class LoopGuard {
  private repeatCounts = new Map<string, number>();
  private toolCounts = new Map<string, number>();
  private stopMessage: string | null = null;

  constructor(
    private readonly repeatThreshold = DEFAULT_REPEAT_THRESHOLD,
    private readonly spawnCap = DEFAULT_SPAWN_CAP,
  ) {}

  /**
   * Record a tool call. Returns a stop message if the run is looping (and the
   * caller should deny the tool), or `null` to proceed. Once tripped, every
   * subsequent call returns the same message.
   */
  check(toolName: string, inputSummary: string): string | null {
    if (this.stopMessage) return this.stopMessage;

    const repeatKey = `${toolName}:${inputSummary.slice(0, 200)}`;
    const repeats = (this.repeatCounts.get(repeatKey) ?? 0) + 1;
    this.repeatCounts.set(repeatKey, repeats);
    const toolTotal = (this.toolCounts.get(toolName) ?? 0) + 1;
    this.toolCounts.set(toolName, toolTotal);

    if (repeats >= this.repeatThreshold) {
      this.stopMessage =
        `Loop detected: ${toolName} has been called with the same input ` +
        `${repeats} times without making progress. Stop retrying — repeating ` +
        `this is not going to succeed. Explain the blocker to the user and ask ` +
        `how they want to proceed.`;
      logger.warn(`Identical-call thrashing: ${repeatKey} (${repeats}x)`);
      return this.stopMessage;
    }

    if (SPAWN_TOOLS.has(toolName) && toolTotal >= this.spawnCap) {
      this.stopMessage =
        `Loop detected: ${toolTotal} ${toolName} calls in a single turn ` +
        `without completing the task. Stop spawning sub-agents — repeating the ` +
        `attempt is not working. Report the blocker to the user and ask how to ` +
        `proceed.`;
      logger.warn(`Runaway fan-out: ${toolName} spawned ${toolTotal}x`);
      return this.stopMessage;
    }

    return null;
  }

  /** Whether the guard has tripped. */
  get isTripped(): boolean {
    return this.stopMessage !== null;
  }

  /** Clear all counts (for session restart). */
  reset(): void {
    this.repeatCounts.clear();
    this.toolCounts.clear();
    this.stopMessage = null;
  }
}
