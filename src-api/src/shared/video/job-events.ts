/**
 * Video render job event stream (Phase 6 M4 — resumable progress).
 *
 * Render status updates already funnel through pipeline.ts's
 * `reloadAndUpdateRenderStatus`. This module re-publishes each update onto the
 * shared in-process `taskEventBus` (the same ring-buffer + monotonic-seq pub/sub
 * that backs `/agent/subscribe/:taskId`) so the Video Mode UI can stream render
 * progress over SSE and **resume from the last sequence on reconnect** instead
 * of polling.
 *
 * We deliberately reuse `taskEventBus` rather than standing up a parallel
 * registry (per dev-doc/html-video/06-06/02 § Slice F M4 — "audit-then-extend").
 * The bus buffers up to MAX_BUFFER_SIZE events per channel and evicts the buffer
 * a minute after a terminal event, which matches a render's lifetime.
 *
 * The channel is keyed by **projectId** because there is at most one active
 * render per project (pipeline.ts enforces this via `renderControllers`), and
 * render status is itself project-scoped state.
 */

import { taskEventBus } from '@/shared/services/task-event-bus';

import type { RenderStatus } from './types';

/** Wire shape pushed onto the bus for each render-status update. */
export interface RenderStreamEvent {
  /**
   * Terminal events use `done`/`error` so the bus schedules buffer cleanup
   * (it keys cleanup off `message.type`). `cancelled` maps to the terminal
   * `error` envelope but is still distinguishable via `status`.
   */
  type: 'progress' | 'done' | 'error';
  status: RenderStatus['status'];
  progress?: number;
  message?: string;
  outputPath?: string;
  updatedAt: string;
}

/** Bus channel for a project's render stream. */
function renderChannel(projectId: string): string {
  return `video-render:${projectId}`;
}

function envelopeType(
  status: RenderStatus['status'],
): RenderStreamEvent['type'] {
  if (status === 'done') return 'done';
  if (status === 'error' || status === 'cancelled') return 'error';
  return 'progress';
}

/**
 * Publish a render-status update for a project. Best-effort: a bus failure must
 * never break the render, so callers should not await or rethrow.
 */
export function publishRenderStatus(
  projectId: string,
  render: RenderStatus,
): void {
  const event: RenderStreamEvent = {
    type: envelopeType(render.status),
    status: render.status,
    progress: render.progress,
    message: render.message,
    outputPath: render.outputPath,
    updatedAt: render.updatedAt,
  };
  taskEventBus.publish(renderChannel(projectId), event);
}

/**
 * Subscribe to a project's render stream. Replays buffered events (optionally
 * only those with `seq > afterSeq`) then delivers live ones. Returns an
 * unsubscribe function.
 */
export function subscribeRenderStream(
  projectId: string,
  callback: (
    message: RenderStreamEvent,
    event: { id: string; seq: number },
  ) => void,
  options: { afterSeq?: number } = {},
): () => void {
  return taskEventBus.subscribe(
    renderChannel(projectId),
    (message, event) => callback(message as RenderStreamEvent, event),
    options,
  );
}

/** Min/max buffered sequence numbers for a project's render stream. */
export function getRenderStreamSeqBounds(projectId: string): {
  minSeq: number | null;
  maxSeq: number | null;
} {
  return taskEventBus.getSeqBounds(renderChannel(projectId));
}

/** Whether a project currently has an open (non-terminal) render stream. */
export function isRenderStreamActive(projectId: string): boolean {
  return taskEventBus.isTaskActive(renderChannel(projectId));
}

/** Number of buffered events for a project's render stream. */
export function getRenderStreamBufferSize(projectId: string): number {
  return taskEventBus.getBufferSize(renderChannel(projectId));
}
