/**
 * Denial Tracker
 *
 * Tracks per-session tool denials to prevent agents from repeatedly
 * requesting permission for the same denied operation.
 * After 3 denials for a tool, suggests the agent try a different approach.
 */

import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('DenialTracker');

const DEFAULT_THRESHOLD = 3;

export class DenialTracker {
  private denials = new Map<string, number>();
  private readonly threshold: number;

  constructor(threshold = DEFAULT_THRESHOLD) {
    this.threshold = threshold;
  }

  /**
   * Record a denied tool call.
   * Key: `toolName:inputSummary` (input truncated to 100 chars for dedup).
   */
  record(toolName: string, inputSummary: string): void {
    const key = `${toolName}:${inputSummary.slice(0, 100)}`;
    const count = (this.denials.get(key) ?? 0) + 1;
    this.denials.set(key, count);
    logger.debug(`Denial recorded: ${key} (count=${count})`);
  }

  /**
   * Check if the agent should fall back for this tool.
   * Returns true if any key starting with toolName exceeds the threshold.
   */
  shouldFallback(toolName: string): boolean {
    const prefix = `${toolName}:`;
    for (const [key, count] of this.denials) {
      if (key.startsWith(prefix) && count >= this.threshold) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get total denial count for a tool across all input patterns.
   */
  getDenialCount(toolName: string): number {
    const prefix = `${toolName}:`;
    let total = 0;
    for (const [key, count] of this.denials) {
      if (key.startsWith(prefix)) {
        total += count;
      }
    }
    return total;
  }

  /**
   * Human-readable summary for system message injection.
   * Lists tools that have exceeded the denial threshold.
   */
  getSummary(): string {
    const exceeded: string[] = [];
    const seen = new Set<string>();
    for (const [key, count] of this.denials) {
      const toolName = key.split(':')[0] ?? key;
      if (count >= this.threshold && !seen.has(toolName)) {
        seen.add(toolName);
        exceeded.push(`${toolName} (denied ${count}x)`);
      }
    }
    if (exceeded.length === 0) return '';
    return (
      `The following tools have been repeatedly denied: ${exceeded.join(', ')}. ` +
      `Please try a different approach instead of requesting these tools again.`
    );
  }

  /** Clear all denials (for session restart). */
  reset(): void {
    this.denials.clear();
    logger.debug('Denial tracker reset');
  }
}
