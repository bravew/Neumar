import type { BaseEvent } from '@ag-ui/core';

import {
  appendAgentRunEvent,
  getAgentRunEventsAfter,
} from '@/shared/db/operations';

function eventSequence(event: BaseEvent): number {
  const seq = (event as BaseEvent & { seq?: unknown }).seq;
  if (typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq < 0) {
    throw new Error('AG-UI journal events require a non-negative integer seq');
  }
  return seq;
}

export function journalAGUIEvent(runId: string, event: BaseEvent): void {
  appendAgentRunEvent({
    runId,
    seq: eventSequence(event),
    eventType: event.type,
    event,
  });
}

export function replayAGUIEvents(runId: string, afterSeq: number): BaseEvent[] {
  return getAgentRunEventsAfter(runId, afterSeq).map(
    (row) => JSON.parse(row.event_json) as BaseEvent,
  );
}
