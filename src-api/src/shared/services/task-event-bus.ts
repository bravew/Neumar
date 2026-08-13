/**
 * Task Event Bus
 *
 * In-process pub/sub for streaming agent messages to multiple clients.
 * When an agent task runs, messages are buffered per-task and emitted
 * to any subscriber SSE connections. This enables cross-client observation
 * (e.g., a task started in the browser can be observed in the desktop app).
 *
 * Architecture:
 *   Agent Generator → createSSEStream() → direct SSE to initiating client
 *                                       → taskEventBus.publish(taskId, msg)
 *                                             ↓
 *                              GET /agent/subscribe/:taskId → observer clients
 */

import { EventEmitter } from 'node:events';

import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('TaskEventBus');

/** Maximum number of concurrent active task buffers */
const MAX_ACTIVE_TASKS = 50;

/** Maximum messages to retain per task (ring-buffer style, oldest dropped) */
const MAX_BUFFER_SIZE = 1_000;

/** Time (ms) to keep the buffer after a task completes (allows late joiners) */
const BUFFER_TTL_AFTER_DONE = 60_000; // 1 minute

/** Maximum listeners per EventEmitter before Node warns about fanout. */
const MAX_EVENT_LISTENERS = 100;

interface TaskBuffer {
  events: TaskBufferedEvent[];
  isDone: boolean;
  nextSeq: number;
}

interface SubscribeOptions {
  /** Replay only buffered messages with `seq > afterSeq`. */
  afterSeq?: number;
}

export interface TaskBufferedEvent {
  id: string;
  seq: number;
  message: unknown;
}

class TaskEventBus extends EventEmitter {
  private static instance: TaskEventBus;
  private buffers = new Map<string, TaskBuffer>();

  private constructor() {
    super();
    this.setMaxListeners(MAX_EVENT_LISTENERS);
  }

  static getInstance(): TaskEventBus {
    if (!TaskEventBus.instance) {
      TaskEventBus.instance = new TaskEventBus();
    }
    return TaskEventBus.instance;
  }

  /**
   * Publish a message for a task.
   * Buffers the message and emits to any live subscribers.
   */
  publish(taskId: string, message: unknown): void {
    this.publishWithEnvelope(taskId, message);
  }

  publishWithEnvelope(taskId: string, message: unknown): TaskBufferedEvent {
    let buffer = this.buffers.get(taskId);
    if (!buffer) {
      // Evict if at capacity — prefer completed tasks over active ones
      if (this.buffers.size >= MAX_ACTIVE_TASKS) {
        this.evictOne();
      }
      buffer = { events: [], isDone: false, nextSeq: 0 };
      this.buffers.set(taskId, buffer);
    }

    const seq = buffer.nextSeq;
    buffer.nextSeq += 1;
    const event: TaskBufferedEvent = {
      id: String(seq),
      seq,
      message: withTaskEventSequence(message, seq),
    };

    buffer.events.push(event);

    // Cap buffer size to prevent unbounded memory growth.
    // Messages arrive one at a time, so we only need to drop one.
    if (buffer.events.length > MAX_BUFFER_SIZE) {
      buffer.events.shift();
    }
    this.emit(`task:${taskId}`, event);

    // If this is a terminal message (legacy or AG-UI), schedule buffer cleanup
    const msg = event.message as { type?: string };
    if (
      msg.type === 'done' ||
      msg.type === 'error' ||
      msg.type === 'RUN_FINISHED' ||
      msg.type === 'RUN_ERROR'
    ) {
      buffer.isDone = true;
      setTimeout(() => this.clearTask(taskId), BUFFER_TTL_AFTER_DONE);
    }

    return event;
  }

  /**
   * Subscribe to live messages for a task.
   * First replays all buffered messages, then delivers live events.
   * Returns an unsubscribe function.
   */
  subscribe(
    taskId: string,
    callback: (message: unknown, event: TaskBufferedEvent) => void,
    options: SubscribeOptions = {},
  ): () => void {
    const buffer = this.buffers.get(taskId);

    // Replay buffered messages
    if (buffer) {
      for (const event of buffer.events) {
        if (options.afterSeq !== undefined && event.seq <= options.afterSeq) {
          continue;
        }
        try {
          callback(event.message, event);
        } catch {
          // Ignore errors during replay (client may have disconnected)
        }
      }
    }

    // Subscribe to live events
    const eventName = `task:${taskId}`;
    const listener = (event: TaskBufferedEvent) => {
      callback(event.message, event);
    };
    this.on(eventName, listener);

    return () => {
      this.off(eventName, listener);
    };
  }

  /**
   * Check if a task has an active stream (buffer exists and not done).
   */
  isTaskActive(taskId: string): boolean {
    const buffer = this.buffers.get(taskId);
    return !!buffer && !buffer.isDone;
  }

  /**
   * Get the number of buffered messages for a task.
   */
  getBufferSize(taskId: string): number {
    return this.buffers.get(taskId)?.events.length ?? 0;
  }

  getSeqBounds(taskId: string): {
    minSeq: number | null;
    maxSeq: number | null;
  } {
    const buffer = this.buffers.get(taskId);
    if (!buffer) return { minSeq: null, maxSeq: null };
    const first = buffer.events[0];
    const last = buffer.events[buffer.events.length - 1];
    return {
      minSeq: first?.seq ?? null,
      maxSeq: last?.seq ?? null,
    };
  }

  /**
   * Evict one task buffer to make room for a new task.
   * Prefers completed (isDone) tasks; falls back to oldest active.
   */
  private evictOne(): void {
    let candidate: string | undefined;
    for (const [id, buf] of this.buffers) {
      if (buf.isDone) {
        candidate = id;
        break;
      }
      // Keep the first entry as fallback (oldest by insertion order)
      if (!candidate) candidate = id;
    }
    if (candidate) {
      this.clearTask(candidate);
    }
  }

  /**
   * Clear buffer and listeners for a task.
   * Emits a synthetic done event first so active observers get a clean shutdown signal.
   */
  private clearTask(taskId: string): void {
    const eventName = `task:${taskId}`;
    // Notify active observers before disconnecting them
    if (this.listenerCount(eventName) > 0) {
      const buffer = this.buffers.get(taskId);
      const seq = buffer?.nextSeq ?? 0;
      this.emit(eventName, {
        id: String(seq),
        seq,
        message: withTaskEventSequence({ type: 'done' }, seq),
      } satisfies TaskBufferedEvent);
    }
    this.buffers.delete(taskId);
    this.removeAllListeners(eventName);
    logger.debug(`Cleared buffer for task: ${taskId}`);
  }
}

function withTaskEventSequence(message: unknown, seq: number): unknown {
  if (
    typeof message !== 'object' ||
    message === null ||
    Array.isArray(message)
  ) {
    return message;
  }
  return {
    ...(message as Record<string, unknown>),
    seq,
  };
}

export const taskEventBus = TaskEventBus.getInstance();
