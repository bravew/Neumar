import { act, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CritiqueTheaterMount } from '@/components/design/critique/CritiqueTheaterMount';
import type { PanelEvent } from '@/shared/types/design-mode';

import { renderWithProviders } from './helpers/render-with-providers';

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

describe('CritiqueTheaterMount', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    sources.length = 0;
  });

  it('dark-launches the stream without rendering at M0', () => {
    vi.stubGlobal('EventSource', MockEventSource);

    renderWithProviders(
      <CritiqueTheaterMount
        projectId="design_mount"
        runId="jury_mount"
        enabled
        rolloutPhase="M0"
      />,
    );

    expect(screen.queryByTestId('critique-theater-mount')).toBeNull();
    expect(sources).toHaveLength(1);
  });

  it('disables the M0 dark-launch stream when the env kill switch is off', () => {
    vi.stubGlobal('EventSource', MockEventSource);
    vi.stubEnv('VITE_DESIGNMODE_CRITIQUE_DARK_LAUNCH', '0');

    renderWithProviders(
      <CritiqueTheaterMount
        projectId="design_mount"
        runId="jury_mount"
        enabled
        rolloutPhase="M0"
      />,
    );

    expect(screen.queryByTestId('critique-theater-mount')).toBeNull();
    expect(sources).toHaveLength(0);
  });

  it('subscribes to the run and renders streamed theater state', () => {
    vi.stubGlobal('EventSource', MockEventSource);
    const onComplete = vi.fn();

    renderWithProviders(
      <CritiqueTheaterMount
        projectId="design_mount"
        runId="jury_mount"
        enabled
        onComplete={onComplete}
      />,
    );

    expect(screen.getByTestId('critique-theater-mount')).toBeVisible();
    expect(sources).toHaveLength(1);
    expect(sources[0]?.url).toContain(
      '/design/projects/design_mount/design-jury/jury_mount/events',
    );

    act(() => {
      sources[0]?.emit(started('jury_mount'));
      sources[0]?.emit({
        type: 'panelist_dim',
        runId: 'jury_mount',
        round: 1,
        role: 'designer',
        rating: 8,
      });
      sources[0]?.emit({ type: 'shipped', runId: 'jury_mount' });
    });

    expect(screen.getByText('Designer')).toBeVisible();
    expect(screen.getByText('Shipped')).toBeVisible();
    expect(onComplete).toHaveBeenCalledWith('shipped');
  });
});

function started(runId: string): PanelEvent {
  return {
    type: 'run_started',
    runId,
    protocolVersion: 'design-jury.v1',
    roles: ['designer'],
    startedAt: '2026-05-15T00:00:00.000Z',
  };
}
