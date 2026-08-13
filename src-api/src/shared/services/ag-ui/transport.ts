import { EventType, type BaseEvent } from '@ag-ui/core';
import { EventEncoder } from '@ag-ui/encoder';
import type { SSEStreamingApi } from 'hono/streaming';

import { taskEventBus } from '@/shared/services/task-event-bus';
import { createLogger } from '@/shared/utils/logger';

import { journalAGUIEvent } from './journal';
import type { AGUIEventPersister } from './persistence';

const logger = createLogger('AGUITransport');

const KEEPALIVE_INTERVAL_MS = 15_000;
/** SSE comment line — ignored by clients, resets proxy/load-balancer idle timers */
const KEEPALIVE_PING = ': ping\n\n';

/**
 * Runs an AG-UI event generator in a detached async task.
 *
 * Consumes every event from the generator unconditionally — publishing to
 * taskEventBus and persisting via AGUIEventPersister — regardless of whether
 * the originating SSE client is still connected.
 *
 * Returns a Promise that resolves when the generator completes.
 * The caller should NOT await this — fire-and-forget so the SSE handler
 * can subscribe independently.
 */
export function runDetachedPipeline(
  events: AsyncGenerator<BaseEvent>,
  busKey: string,
  persister: AGUIEventPersister,
  onTerminal?: () => void,
  context?: { threadId: string; runId: string },
): Promise<void> {
  return (async () => {
    let lastSeq = -1;
    try {
      for await (const event of events) {
        const seq = (event as BaseEvent & { seq?: number }).seq;
        if (typeof seq === 'number') lastSeq = Math.max(lastSeq, seq);
        if (context?.runId) journalAGUIEvent(context.runId, event);
        taskEventBus.publish(busKey, event);
        persister.handleEvent(event);

        const evtType = (event as { type?: string }).type;
        if (
          evtType === EventType.RUN_FINISHED ||
          evtType === EventType.RUN_ERROR
        ) {
          onTerminal?.();
        }
      }
    } catch (err) {
      logger.error('Detached pipeline error', {
        busKey,
        error: err instanceof Error ? err.message : String(err),
      });
      // Publish a synthetic RUN_ERROR so subscribers know the run failed
      const errorEvent = {
        type: EventType.RUN_ERROR,
        threadId: context?.threadId,
        runId: context?.runId,
        message: err instanceof Error ? err.message : String(err),
        timestamp: Date.now(),
        seq: lastSeq + 1,
      } as BaseEvent;
      if (context?.runId) journalAGUIEvent(context.runId, errorEvent);
      taskEventBus.publish(busKey, errorEvent);
      persister.handleEvent(errorEvent);
      onTerminal?.();
    }
  })();
}

/**
 * Subscribes to a task's event bus and writes events to an SSE stream.
 *
 * This is a passive consumer — it reads from the bus (which is fed by
 * runDetachedPipeline) and writes to the SSE stream. When the client
 * disconnects, it simply stops writing without affecting the pipeline.
 */
export async function subscribeSSEToBus(
  sseStream: SSEStreamingApi,
  busKey: string,
  acceptHeader: string,
  abortSignal?: AbortSignal,
): Promise<void> {
  const encoder = new EventEncoder({ accept: acceptHeader });

  const keepAliveTimer = setInterval(async () => {
    if (abortSignal?.aborted) return;
    try {
      await sseStream.write(KEEPALIVE_PING);
    } catch {
      // Stream already closed
    }
  }, KEEPALIVE_INTERVAL_MS);

  try {
    await new Promise<void>((resolve) => {
      if (abortSignal?.aborted) {
        resolve();
        return;
      }

      const unsubscribe = taskEventBus.subscribe(busKey, (message) => {
        const isTerminal =
          (message as { type?: string }).type === EventType.RUN_FINISHED ||
          (message as { type?: string }).type === EventType.RUN_ERROR;

        try {
          const encoded = encoder.encode(message as BaseEvent);
          sseStream
            .write(encoded)
            .then(() => {
              // Resolve after terminal event is flushed
              if (isTerminal) {
                unsubscribe();
                resolve();
              }
            })
            .catch(() => {
              // Write failed (client gone) — unsubscribe and resolve
              unsubscribe();
              resolve();
            });
        } catch {
          unsubscribe();
          resolve();
        }
      });

      abortSignal?.addEventListener(
        'abort',
        () => {
          unsubscribe();
          resolve();
        },
        { once: true },
      );
    });
  } finally {
    clearInterval(keepAliveTimer);
  }
}

/**
 * Writes a sequence of AG-UI events to a Hono SSE stream.
 *
 * @deprecated Use runDetachedPipeline + subscribeSSEToBus for new code.
 * Kept for backward compatibility with code paths that don't need decoupling.
 *
 * - Uses @ag-ui/encoder for proper "data: {...}\n\n" SSE formatting.
 * - Emits a keep-alive ping every 15 s to prevent proxy timeouts during slow agents.
 * - Respects abortSignal: stops writing if the client disconnects.
 * - Optional `onEvent` callback: called for every event (e.g., to publish to TaskEventBus).
 */
export async function writeAGUIStream(
  sseStream: SSEStreamingApi,
  events: AsyncGenerator<BaseEvent>,
  acceptHeader: string,
  abortSignal?: AbortSignal,
  onEvent?: (event: BaseEvent) => void,
): Promise<void> {
  // Single encoder instance per stream — encoder is stateful (Accept header negotiation)
  const encoder = new EventEncoder({ accept: acceptHeader });

  let keepAliveTimer: ReturnType<typeof setInterval> | undefined;
  keepAliveTimer = setInterval(async () => {
    if (abortSignal?.aborted) return;
    try {
      await sseStream.write(KEEPALIVE_PING);
    } catch {
      // Stream already closed — the event loop will exit naturally on next iteration
    }
  }, KEEPALIVE_INTERVAL_MS);

  try {
    for await (const event of events) {
      if (abortSignal?.aborted) {
        logger.debug('Client disconnected, stopping AG-UI stream', {
          runId: (event as { runId?: string }).runId,
        });
        break;
      }
      await sseStream.write(encoder.encode(event));
      onEvent?.(event);
    }
  } finally {
    clearInterval(keepAliveTimer);
  }
}
