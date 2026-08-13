import { describe, expect, it } from 'vitest';

import {
  getRenderStreamSeqBounds,
  isRenderStreamActive,
  publishRenderStatus,
  subscribeRenderStream,
  type RenderStreamEvent,
} from '@/shared/video/job-events';
import type { RenderStatus } from '@/shared/video/types';

// Phase 6 M4 — resumable render progress. The bus must (a) replay buffered
// events to a fresh subscriber, (b) replay only events newer than a cursor on
// reconnect (the disconnect→reconnect case), and (c) mark the stream terminal
// on done/error so the UI knows to stop.

function status(
  partial: Partial<RenderStatus> & Pick<RenderStatus, 'status'>,
): RenderStatus {
  return { updatedAt: '2026-06-06T00:00:00.000Z', ...partial };
}

describe('video job-events render stream', () => {
  it('replays buffered events to a new subscriber', () => {
    const projectId = 'jobs-evt-replay';
    publishRenderStatus(projectId, status({ status: 'queued' }));
    publishRenderStatus(projectId, status({ status: 'running', progress: 40 }));

    const received: RenderStreamEvent[] = [];
    const unsub = subscribeRenderStream(projectId, (msg) => received.push(msg));
    unsub();

    expect(received.map((e) => e.status)).toEqual(['queued', 'running']);
    expect(received[1].progress).toBe(40);
  });

  it('resumes from the last sequence on reconnect (afterSeq)', () => {
    const projectId = 'jobs-evt-resume';
    publishRenderStatus(projectId, status({ status: 'running', progress: 10 }));
    publishRenderStatus(projectId, status({ status: 'running', progress: 20 }));

    // First subscriber records the cursor it saw, then "disconnects".
    let lastSeq = -1;
    subscribeRenderStream(projectId, (_msg, evt) => {
      lastSeq = evt.seq;
    })();
    expect(lastSeq).toBe(1);

    // More progress arrives while disconnected.
    publishRenderStatus(projectId, status({ status: 'running', progress: 60 }));
    publishRenderStatus(projectId, status({ status: 'done', progress: 100 }));

    // Reconnect with the cursor — only the missed events replay.
    const replayed: RenderStreamEvent[] = [];
    subscribeRenderStream(projectId, (msg) => replayed.push(msg), {
      afterSeq: lastSeq,
    })();

    expect(replayed.map((e) => e.progress)).toEqual([60, 100]);
  });

  it('marks the stream terminal on done and reports seq bounds', () => {
    const projectId = 'jobs-evt-terminal';
    publishRenderStatus(projectId, status({ status: 'running', progress: 50 }));
    expect(isRenderStreamActive(projectId)).toBe(true);

    publishRenderStatus(projectId, status({ status: 'done', progress: 100 }));
    expect(isRenderStreamActive(projectId)).toBe(false);

    const bounds = getRenderStreamSeqBounds(projectId);
    expect(bounds.minSeq).toBe(0);
    expect(bounds.maxSeq).toBe(1);
  });

  it('maps cancelled to a terminal error envelope but keeps the status', () => {
    const projectId = 'jobs-evt-cancel';
    const received: RenderStreamEvent[] = [];
    subscribeRenderStream(projectId, (msg) => received.push(msg));
    publishRenderStatus(projectId, status({ status: 'cancelled' }));

    expect(received[0].type).toBe('error');
    expect(received[0].status).toBe('cancelled');
    expect(isRenderStreamActive(projectId)).toBe(false);
  });
});
