/**
 * Active Query Store
 *
 * Maps taskId → active Query object + pending user replies.
 * Used to deliver mid-processing user follow-up messages to the running agent
 * via both PreToolUse hooks (immediate context injection) and streamInput()
 * (proper next-turn processing).
 */

import type { Query } from '@anthropic-ai/claude-agent-sdk';

import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('ActiveQueryStore');

export interface PendingReply {
  content: string;
  timestamp: number;
}

interface ActiveEntry {
  query: Query;
  sessionId: string;
  pendingReplies: PendingReply[];
}

class ActiveQueryStore {
  private static instance: ActiveQueryStore;
  private entries = new Map<string, ActiveEntry>();

  private constructor() {}

  static getInstance(): ActiveQueryStore {
    if (!ActiveQueryStore.instance) {
      ActiveQueryStore.instance = new ActiveQueryStore();
    }
    return ActiveQueryStore.instance;
  }

  /** Register an active query for a task. Called when query() starts. */
  register(taskId: string, queryObj: Query, sessionId: string): void {
    this.entries.set(taskId, {
      query: queryObj,
      sessionId,
      pendingReplies: [],
    });
    logger.info(
      `Registered active query for task ${taskId} (session ${sessionId})`,
    );
  }

  /** Unregister a query when it ends. Called in finally block. */
  unregister(taskId: string): void {
    this.entries.delete(taskId);
    logger.info(`Unregistered active query for task ${taskId}`);
  }

  /** Check if a task has an active query running. */
  has(taskId: string): boolean {
    return this.entries.has(taskId);
  }

  /**
   * Deliver a user reply via streamInput() for next-turn processing.
   * Falls back to pendingReplies (drained by PreToolUse hook) only if streamInput fails.
   */
  async pushReply(taskId: string, reply: PendingReply): Promise<void> {
    const entry = this.entries.get(taskId);
    if (!entry) {
      logger.warn(`pushReply: no active query for task ${taskId}`);
      return;
    }

    try {
      await entry.query.streamInput(
        (async function* () {
          yield {
            type: 'user' as const,
            message: {
              role: 'user' as const,
              content: reply.content,
            },
            parent_tool_use_id: null,
            session_id: entry.sessionId,
          };
        })(),
      );
      logger.info(`streamInput delivered for task ${taskId}`);
    } catch (err) {
      // streamInput failed — fall back to PreToolUse hook delivery
      logger.warn(
        `streamInput failed for task ${taskId}, will use PreToolUse hook:`,
        err,
      );
      entry.pendingReplies.push(reply);
      logger.info(
        `Queued reply for task ${taskId} (${entry.pendingReplies.length} pending)`,
      );
    }
  }

  /**
   * Get the session ID for an active task query.
   * Used to abort the agent session when a task is deleted.
   */
  getSessionId(taskId: string): string | undefined {
    return this.entries.get(taskId)?.sessionId;
  }

  /**
   * Get the Query object for an active task.
   * Used for rewindFiles() and stopTask() during active execution.
   */
  getQuery(taskId: string): Query | undefined {
    return this.entries.get(taskId)?.query;
  }

  /**
   * Atomically drain all pending replies for a task.
   * Called by the PreToolUse hook to inject context at tool boundaries.
   */
  drainPendingReplies(taskId: string): PendingReply[] {
    const entry = this.entries.get(taskId);
    if (!entry || entry.pendingReplies.length === 0) return [];

    const drained = [...entry.pendingReplies];
    entry.pendingReplies = [];
    logger.info(`Drained ${drained.length} pending replies for task ${taskId}`);
    return drained;
  }
}

export const activeQueryStore = ActiveQueryStore.getInstance();
