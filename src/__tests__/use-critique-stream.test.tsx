import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useCritiqueReplay } from '@/components/design/critique/use-critique-replay';
import { useCritiqueStream } from '@/components/design/critique/use-critique-stream';
import type { PanelEvent } from '@/shared/types/design-mode';

const sources: MockEventSource[] = [];

class MockEventSource {
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  closed = false;
  url: string;

  constructor(url: string) {
    this.url = url;
    sources.push(this);
  }

  close() {
    this.closed = true;
  }

  addEventListener() {}

  emit(event: PanelEvent) {
    this.onmessage?.({ data: JSON.stringify(event) } as MessageEvent<string>);
  }
}

describe('useCritiqueStream', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    sources.length = 0;
  });

  it('opens an EventSource and closes it on unmount and run swap', () => {
    vi.stubGlobal('EventSource', MockEventSource);
    const { result, rerender, unmount } = renderHook(
      ({ runId }) => useCritiqueStream('design_test', runId, true),
      { initialProps: { runId: 'jury_live1234' } },
    );

    expect(sources).toHaveLength(1);
    act(() => {
      sources[0]?.emit(started('jury_live1234'));
    });
    expect(result.current.phase).toBe('running');

    rerender({ runId: 'jury_next1234' });
    expect(sources[0]?.closed).toBe(true);
    expect(sources).toHaveLength(2);

    unmount();
    expect(sources[1]?.closed).toBe(true);
  });
});

describe('useCritiqueReplay', () => {
  it('reduces a transcript to the same final state as the stream reducer', () => {
    const events: PanelEvent[] = [
      started('jury_replay1234'),
      {
        type: 'panelist_dim',
        runId: 'jury_replay1234',
        round: 1,
        role: 'designer',
        rating: 8,
      },
      { type: 'shipped', runId: 'jury_replay1234' },
    ];
    const { result } = renderHook(() => useCritiqueReplay(events));

    expect(result.current.phase).toBe('shipped');
    expect(result.current.rounds[1]?.panelists.designer.rating).toBe(8);
  });
});

function started(runId: string): PanelEvent {
  return {
    type: 'run_started',
    runId,
    protocolVersion: 'design-jury.v1',
    roles: ['designer'],
    startedAt: '2026-05-12T00:00:00.000Z',
  };
}
