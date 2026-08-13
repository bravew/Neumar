import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/__tests__/helpers/render-with-providers';
import { RenderQueuePanel } from '@/components/video/RenderQueuePanel';
import type { VideoJob } from '@/shared/types/video';

describe('RenderQueuePanel', () => {
  it('does not render an empty queue while polling', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ jobs: [] }));
    globalThis.fetch = fetchMock as typeof fetch;

    renderWithProviders(<RenderQueuePanel projectId="project-1" />);

    expect(screen.queryByText('Render queue')).not.toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByText('Render queue')).not.toBeInTheDocument();
  });

  it('renders active jobs as a floating overlay', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        jobs: [
          {
            id: 'job-1',
            projectId: 'project-1',
            kind: 'render',
            status: 'running',
            payload: { aspectRatios: ['16:9'] },
            caller: 'in-app',
          } satisfies VideoJob,
          {
            id: 'job-2',
            projectId: 'project-1',
            kind: 'render',
            status: 'queued',
            payload: { aspectRatios: ['9:16'] },
            caller: 'in-app',
          } satisfies VideoJob,
        ],
      }),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const { container } = renderWithProviders(
      <RenderQueuePanel projectId="project-1" />,
    );

    await screen.findByText('Render queue');
    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(screen.getByText('16:9')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      '2 render jobs, 2 running',
    );
    expect(
      screen.getByRole('button', {
        name: 'Cancel render job 1 for 16:9',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'Cancel render job 2 for 9:16',
      }),
    ).toBeInTheDocument();
    expect(container.firstElementChild).toHaveClass('absolute');
    expect(container.firstElementChild).toHaveClass('bottom-14');
  });
});

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
