import type { ContentGraph } from '@neumar/video-ir';
import { fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders as render } from '../../../__tests__/helpers/render-with-providers';
import type { VideoJob } from '../../../shared/types/video';
import { ContentGraphViewer } from '../ContentGraphViewer';

const graph: ContentGraph = {
  schemaVersion: 1,
  intent: 'explainer',
  synopsis: 'A short explainer.',
  nodes: [
    { id: 'a', kind: 'text', text: 'Intro' },
    { id: 'b', kind: 'text', text: 'Body' },
  ],
  edges: [{ from: 'a', to: 'b', kind: 'sequence' }],
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('ContentGraphViewer', () => {
  it('renders an empty state when there is no graph', () => {
    render(<ContentGraphViewer graph={null} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('summarises intent, node and edge counts', () => {
    render(<ContentGraphViewer graph={graph} />);
    expect(screen.getByText('Intent: explainer')).toBeInTheDocument();
    expect(screen.getByText('3 nodes')).toBeInTheDocument();
    expect(screen.getByText('2 edges')).toBeInTheDocument();
    expect(screen.getAllByText('A short explainer.')).toHaveLength(2);
    expect(
      screen.getByText('A short explainer. -> Intro: Generated from'),
    ).toBeInTheDocument();
    expect(screen.getByText('Intro -> Body: Sequence')).toBeInTheDocument();
    expect(screen.getByTestId('creative-execution-ledger')).toHaveTextContent(
      'No jobs or outputs yet.',
    );
  });

  it('downloads the graph as JSON', () => {
    vi.useFakeTimers();
    const createUrl = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:fake');
    const revokeUrl = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => {});
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});

    render(<ContentGraphViewer graph={graph} projectId="p1" />);
    fireEvent.click(screen.getByText('Debug JSON'));
    fireEvent.click(screen.getByRole('button', { name: 'Download JSON' }));

    expect(createUrl).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeUrl).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revokeUrl).toHaveBeenCalledTimes(1);
  });

  it('renders execution ledger rows for render jobs, agent actions, and outputs', () => {
    render(
      <ContentGraphViewer
        graph={graph}
        jobs={[
          {
            id: 'job-1',
            projectId: 'p1',
            kind: 'render',
            status: 'running',
            payload: {},
            caller: 'agent',
            costCents: 12,
          } satisfies VideoJob,
        ]}
        agentJournal={[
          {
            id: 'journal-1',
            ts: '2026-06-21T12:00:00.000Z',
            tool: 'applyTimelineOps',
            args: {},
            result: { status: 'failed' },
            diff: [],
          },
        ]}
        outputs={[
          {
            aspectRatio: '16:9',
            path: 'renders/final.mp4',
            durationSec: 12,
            fileSize: 1024,
            codec: 'h264',
          },
        ]}
      />,
    );

    expect(screen.getByText('Render job')).toBeInTheDocument();
    expect(screen.getByText('Agent: applyTimelineOps')).toBeInTheDocument();
    expect(screen.getByText('16:9 output')).toBeInTheDocument();
    expect(screen.getByText(/12 cents/)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      '3 ledger items, 1 running, 1 failed.',
    );
  });
});
