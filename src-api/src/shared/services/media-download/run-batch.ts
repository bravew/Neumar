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
  DownloadMediaOperation,
} from '@neumar/video-ir';

import type { AgentMessage } from '@/core/agent/types';

/** What the route needs from the downloader; the real runner implements it. */
export type StartDownloadBatch = (
  operation: DownloadMediaOperation,
  options: { signal: AbortSignal; emit(activity: DownloadActivity): void },
) => Promise<DownloadActivity>;

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

  const emit = (activity: DownloadActivity) => {
    queue.push(activity);
    wake?.();
  };
  start(operation, { signal, emit })
    .catch(() => {
      // A batch that never reported a state must not look like it is still
      // running; every item settles as failed so the card has an outcome.
      const reason = signal.aborted ? 'cancelled' : 'failed';
      emit({
        version: 1,
        taskId: operation.taskId,
        runId: operation.runId,
        toolCallId: operation.toolCallId,
        batchId: operation.batchId,
        items: operation.input.urls.map((_, index) => ({
          itemId: String(index + 1),
          sequence: index + 1,
          ...(reason === 'cancelled'
            ? { phase: 'cancelled' as const }
            : { phase: 'failed' as const, reason: 'download' as const }),
        })),
      });
    })
    .finally(() => {
      settled = true;
      wake?.();
    });

  const drain = function* (): Generator<AgentMessage> {
    while (queue.length > 0) {
      yield {
        type: 'media_download_activity',
        downloadActivity: queue.shift() as DownloadActivity,
      };
    }
  };

  let heldDone: AgentMessage | undefined;
  for await (const message of source) {
    yield* drain();
    if (message.type === 'done') {
      heldDone = message;
      break;
    }
    yield message;
  }

  while (!settled) {
    yield* drain();
    if (settled) break;
    await new Promise<void>((resolve) => {
      // Abort is consumed by the runner. Wait for its terminal emission or
      // settlement so process-exit callbacks can run before draining again.
      wake = resolve;
    });
  }
  yield* drain();
  if (heldDone) yield heldDone;
}
