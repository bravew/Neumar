import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PublishHistory } from '@/components/publish';

import { renderWithProviders } from '../../helpers/render-with-providers';

describe('PublishHistory', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders publish jobs from the API', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          items: [
            {
              job: {
                id: 'job-1',
                workspaceId: 'local',
                createdBy: 'human:desktop',
                state: 'drafted',
                source: {
                  path: '/tmp/video.mp4',
                  sha256: 'a'.repeat(64),
                  sizeBytes: 100,
                  mime: 'video/mp4',
                },
                metadata: { title: 'Launch cut' },
                destinations: [],
                createdAt: '2026-05-06T12:00:00.000Z',
                updatedAt: '2026-05-06T12:00:00.000Z',
              },
              legs: [
                {
                  id: 'leg-1',
                  jobId: 'job-1',
                  destinationKind: 'local-archive',
                  connectionId: 'local',
                  state: 'queued',
                  approvalRequired: false,
                  chunkOffsetBytes: 0,
                  totalBytes: 100,
                  attempts: 0,
                  createdAt: '2026-05-06T12:00:00.000Z',
                  updatedAt: '2026-05-06T12:00:00.000Z',
                },
              ],
            },
          ],
        }),
      ),
    );

    renderWithProviders(<PublishHistory />);

    expect(await screen.findByText('Launch cut')).toBeInTheDocument();
    expect(screen.getByText(/drafted/)).toBeInTheDocument();
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
