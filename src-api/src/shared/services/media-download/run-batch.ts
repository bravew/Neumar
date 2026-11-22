/**
 * Start the batch a destination answer chose, as part of the continuation run.
 *
 * The run stays open until the batch settles, so its progress events reach the
 * same persisted stream as the turn that asked: the live view and a reloaded
 * task read one record. The downloader is injected, so the picker and resume
 * route can be driven with a fake runner and no network.
 */

import type {
  DownloadActivity,
  DownloadItem,
  DownloadMediaOperation,
} from '@neumar/video-ir';

import type { AgentMessage } from '@/core/agent/types';

/** What the route needs from the downloader; the real runner implements it. */
export type StartDownloadBatch = (
  operation: DownloadMediaOperation,
  options: { signal: AbortSignal; emit(activity: DownloadActivity): void },
) => Promise<DownloadActivity>;

/** Phases a rejected batch must not overwrite. */
const TERMINAL_PHASES = new Set<DownloadItem['phase']>([
  'saved',
  'failed',
  'cancelled',
]);

/**
 * Merge a download batch into an agent stream.
 *
 * The batch starts when the stream starts. Activity messages are yielded as
 * they arrive, and the agent's `done` is held until the batch settles, so the
 * run cannot close while a download it started is still reporting progress.
 */
export async function* withDownloadBatch(
  source: AsyncIterable<AgentMessage>,
  operation: DownloadMediaOperation,
  start: StartDownloadBatch,
  signal: AbortSignal,
): AsyncGenerator<AgentMessage> {
  const queue: DownloadActivity[] = [];
  let wake: (() => void) | undefined;
  let settled = false;
  let latest: DownloadActivity | undefined;

  const notify = () => {
    const resolve = wake;
    wake = undefined;
    resolve?.();
  };
  /** Resolves on the next emission or settlement. */
  const changed = () =>
    new Promise<void>((resolve) => {
      wake = resolve;
    });

  const emit = (activity: DownloadActivity) => {
    latest = activity;
    queue.push(activity);
    notify();
  };
  start(operation, { signal, emit })
    .catch(() => {
      // A batch that stopped without a final state must not look like it is
      // still running. Items it already settled keep their outcome (a saved
      // file exists); only unfinished items settle, ordered after their last
      // reported state.
      const unfinished = signal.aborted
        ? { phase: 'cancelled' as const }
        : { phase: 'failed' as const, reason: 'download' as const };
      const reportedItems = new Map(
        (latest?.items ?? []).map((item) => [item.itemId, item]),
      );
      emit({
        version: 1,
        taskId: operation.taskId,
        runId: operation.runId,
        toolCallId: operation.toolCallId,
        batchId: operation.batchId,
        items: operation.input.urls.map((_, index) => {
          const itemId = String(index + 1);
          const reported = reportedItems.get(itemId);
          if (reported && TERMINAL_PHASES.has(reported.phase)) return reported;
          return {
            itemId,
            sequence: (reported?.sequence ?? 0) + 1,
            ...unfinished,
          };
        }),
      });
    })
    .finally(() => {
      settled = true;
      notify();
    });

  const drain = function* (): Generator<AgentMessage> {
    while (queue.length > 0) {
      yield {
        type: 'media_download_activity',
        downloadActivity: queue.shift() as DownloadActivity,
      };
    }
  };

  // One pending read of the agent stream at a time, raced against download
  // activity, so progress reaches the client while the agent is waiting.
  const iterator = source[Symbol.asyncIterator]();
  let pending: Promise<IteratorResult<AgentMessage>> | undefined;
  let sourceOpen = true;
  let heldDone: AgentMessage | undefined;
  try {
    while (sourceOpen) {
      yield* drain();
      pending ??= iterator.next();
      const next = await Promise.race([pending, changed()]);
      if (!next) continue;
      pending = undefined;
      if (next.done) {
        sourceOpen = false;
      } else if (next.value.type === 'done') {
        heldDone = next.value;
        break;
      } else {
        yield next.value;
      }
    }
  } finally {
    if (sourceOpen) {
      // Leaving early (the agent's `done` or a consumer that stopped reading)
      // closes the agent stream, as a `for await` break would. With a read
      // still outstanding, `return()` queues behind it, so it is not awaited.
      if (pending) {
        pending.catch(() => undefined);
        void Promise.resolve(iterator.return?.()).catch(() => undefined);
      } else {
        await iterator.return?.();
      }
    }
  }

  while (!settled) {
    yield* drain();
    if (settled) break;
    // Abort is consumed by the runner. Wait for its terminal emission or
    // settlement so process-exit callbacks can run before draining again.
    await changed();
  }
  yield* drain();
  if (heldDone) yield heldDone;
}
