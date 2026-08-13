import { useEffect, useState } from 'react';

import { API_BASE_URL } from '@/config';

import type { PublishJobSnapshot, PublishLeg } from './usePublishJobs';

export interface PublishStreamEvent {
  type: string;
  leg?: PublishLeg;
}

export function usePublishJobStream(jobId?: string) {
  const [snapshot, setSnapshot] = useState<PublishJobSnapshot | null>(null);
  const [lastEvent, setLastEvent] = useState<PublishStreamEvent | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!jobId) return;
    const source = new EventSource(
      `${API_BASE_URL}/publish/jobs/${encodeURIComponent(jobId)}/events`,
    );
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.onmessage = (event) => {
      const parsed = JSON.parse(event.data) as PublishStreamEvent;
      setLastEvent(parsed);
    };
    source.addEventListener('snapshot', (event) => {
      setSnapshot(
        JSON.parse((event as MessageEvent).data) as PublishJobSnapshot,
      );
      setConnected(true);
    });
    for (const type of [
      'chunk_progress',
      'state_change',
      'published',
      'failed',
      'approval_requested',
    ]) {
      source.addEventListener(type, (event) => {
        const parsed = JSON.parse(
          (event as MessageEvent).data,
        ) as PublishStreamEvent;
        setLastEvent(parsed);
        if (parsed.leg) {
          setSnapshot((prev) =>
            prev ? replaceSnapshotLeg(prev, parsed.leg!) : prev,
          );
        }
      });
    }
    return () => source.close();
  }, [jobId]);

  return { snapshot, lastEvent, connected };
}

function replaceSnapshotLeg(
  snapshot: PublishJobSnapshot,
  leg: PublishLeg,
): PublishJobSnapshot {
  return {
    ...snapshot,
    legs: snapshot.legs.map((candidate) =>
      candidate.id === leg.id ? leg : candidate,
    ),
  };
}
