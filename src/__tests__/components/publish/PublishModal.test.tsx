import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PublishModal } from '@/components/publish';

import { renderWithProviders } from '../../helpers/render-with-providers';

describe('PublishModal', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates a publish job from selected destinations', async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/publish/destinations')) {
          return jsonResponse({
            items: [
              {
                kind: 'local-archive',
                capabilities: { approvalDefault: false },
              },
            ],
          });
        }
        if (url.includes('/publish/jobs') && init?.method === 'POST') {
          const body = JSON.parse(String(init.body)) as {
            destinations: Array<{ kind: string }>;
          };
          expect(body.destinations).toEqual([
            expect.objectContaining({ kind: 'local-archive' }),
          ]);
          return jsonResponse({
            job: {
              id: 'job-1',
              workspaceId: 'local',
              createdBy: 'human:desktop',
              state: 'drafted',
              source: source(),
              metadata: {},
              destinations: body.destinations,
              createdAt: '2026-05-06T12:00:00.000Z',
              updatedAt: '2026-05-06T12:00:00.000Z',
            },
            legs: [],
          });
        }
        if (url.includes('/publish/jobs')) return jsonResponse({ items: [] });
        return jsonResponse({}, 404);
      },
    );
    vi.stubGlobal('fetch', fetchMock);
    const onCreated = vi.fn();

    renderWithProviders(
      <PublishModal
        open
        onOpenChange={vi.fn()}
        source={source()}
        onCreated={onCreated}
      />,
    );

    fireEvent.click(await screen.findByText('Local archive'));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Launch cut' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
  });

  it('keeps the selected Immich connection id when creating a job', async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/publish/destinations')) {
          return jsonResponse({
            items: [
              {
                kind: 'immich',
                connectionId: 'local_immich_1',
                label: 'Home Immich',
                capabilities: { approvalDefault: false },
              },
            ],
          });
        }
        if (url.includes('/publish/jobs') && init?.method === 'POST') {
          const body = JSON.parse(String(init.body)) as {
            destinations: Array<{ kind: string; connectionId: string }>;
          };
          expect(body.destinations).toEqual([
            expect.objectContaining({
              kind: 'immich',
              connectionId: 'local_immich_1',
            }),
          ]);
          return jsonResponse({
            job: {
              id: 'job-1',
              workspaceId: 'local',
              createdBy: 'human:desktop',
              state: 'drafted',
              source: source(),
              metadata: {},
              destinations: body.destinations,
              createdAt: '2026-05-06T12:00:00.000Z',
              updatedAt: '2026-05-06T12:00:00.000Z',
            },
            legs: [],
          });
        }
        if (url.includes('/publish/jobs')) return jsonResponse({ items: [] });
        return jsonResponse({}, 404);
      },
    );
    vi.stubGlobal('fetch', fetchMock);
    const onCreated = vi.fn();

    renderWithProviders(
      <PublishModal
        open
        onOpenChange={vi.fn()}
        source={source()}
        onCreated={onCreated}
      />,
    );

    fireEvent.click(await screen.findByText('Home Immich'));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
  });
});

function source() {
  return {
    path: '/tmp/video.mp4',
    sha256: 'a'.repeat(64),
    sizeBytes: 100,
    mime: 'video/mp4',
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
