/**
 * Session Manager with LRU Cache
 *
 * Replaces unbounded global Maps with bounded LRU cache for session management.
 * Sessions auto-evict after TTL or when max capacity is reached.
 */

import { LRUCache } from 'lru-cache';

import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('SessionManager');

interface SessionData {
  abortController: AbortController;
  createdAt: number;
  phase: 'planning' | 'executing' | 'idle';
  toolAbortControllers: Map<string, AbortController>;
}

export class SessionManager {
  private sessions: LRUCache<string, SessionData>;
  private cleanupInterval: ReturnType<typeof setInterval>;

  private readonly MAX_SESSIONS = 100;
  private readonly SESSION_TTL = 60 * 60 * 1000; // 1 hour
  private readonly CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes

  constructor() {
    this.sessions = new LRUCache<string, SessionData>({
      max: this.MAX_SESSIONS,
      ttl: this.SESSION_TTL,
      updateAgeOnGet: true,
      updateAgeOnHas: true,
      dispose: (_session, key) => {
        logger.debug(`Evicting session: ${key}`);
      },
    });

    this.cleanupInterval = setInterval(
      () => this.cleanup(),
      this.CLEANUP_INTERVAL,
    );
  }

  add(
    sessionId: string,
    abortController: AbortController,
    phase: 'planning' | 'executing' | 'idle' = 'idle',
  ): void {
    this.sessions.set(sessionId, {
      abortController,
      createdAt: Date.now(),
      phase,
      toolAbortControllers: new Map(),
    });
    logger.debug(`Added session: ${sessionId} (total: ${this.sessions.size})`);
  }

  get(sessionId: string): SessionData | undefined {
    return this.sessions.get(sessionId);
  }

  delete(sessionId: string): boolean {
    const session = this.sessions.peek(sessionId);
    if (session) {
      session.abortController.abort('Session deleted');
      return this.sessions.delete(sessionId);
    }
    return false;
  }

  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /** Create a child AbortController for a specific tool call, linked to the parent session. */
  createToolAbort(
    sessionId: string,
    toolUseId: string,
  ): AbortController | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;

    const child = new AbortController();
    const parent = session.abortController;
    parent.signal.addEventListener(
      'abort',
      () => {
        child.abort('Parent session aborted');
      },
      { once: true },
    );
    session.toolAbortControllers.set(toolUseId, child);
    return child;
  }

  /** Abort a specific tool call. Returns true if the tool was found and aborted. */
  abortTool(sessionId: string, toolUseId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    const controller = session.toolAbortControllers.get(toolUseId);
    if (!controller) return false;

    controller.abort('Tool cancelled by user');
    session.toolAbortControllers.delete(toolUseId);
    logger.debug(`Aborted tool ${toolUseId} in session ${sessionId}`);
    return true;
  }

  /** Remove a tool abort controller after tool completes. */
  cleanupToolAbort(sessionId: string, toolUseId: string): void {
    const session = this.sessions.peek(sessionId);
    if (session) {
      session.toolAbortControllers.delete(toolUseId);
    }
  }

  cleanup(): void {
    // Collect IDs first to avoid modifying during iteration
    const toDelete: string[] = [];
    for (const [id] of this.sessions.entries()) {
      const session = this.sessions.peek(id);
      if (session && session.abortController.signal.aborted) {
        toDelete.push(id);
      }
    }

    for (const id of toDelete) {
      this.sessions.delete(id);
    }

    if (toDelete.length > 0) {
      logger.debug(
        `Cleanup: removed ${toDelete.length} aborted sessions (remaining: ${this.sessions.size})`,
      );
    }
  }

  dispose(): void {
    clearInterval(this.cleanupInterval);
    for (const [, session] of this.sessions.entries()) {
      session.abortController.abort('SessionManager disposed');
    }
    this.sessions.clear();
    logger.info('Disposed all sessions');
  }

  getMetrics() {
    return {
      totalSessions: this.sessions.size,
      maxSessions: this.MAX_SESSIONS,
      utilizationPercent: Math.round(
        (this.sessions.size / this.MAX_SESSIONS) * 100,
      ),
    };
  }
}

// Singleton instance
let sessionManager: SessionManager | null = null;

export function getSessionManager(): SessionManager {
  if (!sessionManager) {
    sessionManager = new SessionManager();
  }
  return sessionManager;
}
