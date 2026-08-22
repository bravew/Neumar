import { StrictMode } from 'react';

import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HyperframesStudioPreview } from '@/components/video/html-video/HyperframesStudioPreview';

import { renderWithProviders } from '../helpers/render-with-providers';

afterEach(() => {
  vi.unstubAllGlobals();
  document
    .querySelectorAll('script[data-hyperframes-player]')
    .forEach((script) => script.remove());
});

describe('HyperframesStudioPreview', () => {
  it('balances distinct StrictMode preview subscriptions', async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, _init?: RequestInit) => {
        const url = String(input);
        return new Response(
          JSON.stringify(
            url.endsWith('/open')
              ? {
                  session: {
                    serverUrl: 'http://127.0.0.1:43210',
                    studioUrl: 'http://127.0.0.1:43210/#project/composition',
                  },
                }
              : { stopped: true },
          ),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      },
    );
    vi.stubGlobal('fetch', fetchMock);

    const view = renderWithProviders(
      <StrictMode>
        <HyperframesStudioPreview
          projectId="project-1"
          selectedFrameId="frame-1"
        />
      </StrictMode>,
    );
    expect(await screen.findByText('Open Studio')).toHaveAttribute(
      'href',
      'http://127.0.0.1:43210/#project/composition',
    );
    expect(document.querySelector('hyperframes-player')).toHaveAttribute(
      'src',
      'http://127.0.0.1:43210/composition/index.html',
    );
    view.unmount();

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([url]) => String(url).endsWith('/release')),
      ).toBe(true);
    });
    const subscriberIdsByOperation = fetchMock.mock.calls.reduce(
      (ids, [url, init]) => {
        if (typeof init?.body !== 'string') return ids;
        const value: unknown = JSON.parse(init.body);
        if (
          typeof value === 'object' &&
          value !== null &&
          'subscriberId' in value &&
          typeof value.subscriberId === 'string'
        ) {
          const operation = String(url).endsWith('/open') ? 'open' : 'release';
          ids[operation].add(value.subscriberId);
        }
        return ids;
      },
      { open: new Set<string>(), release: new Set<string>() },
    );
    expect(subscriberIdsByOperation.open.size).toBeGreaterThanOrEqual(1);
    expect(subscriberIdsByOperation.release).toEqual(
      subscriberIdsByOperation.open,
    );
  });

  it('keeps the shared player script until the last preview unmounts', async () => {
    vi.stubGlobal('fetch', stubStudioFetch());

    const first = renderWithProviders(
      <HyperframesStudioPreview projectId="project-1" selectedFrameId="a" />,
    );
    await screen.findByText('Open Studio');
    const second = renderWithProviders(
      <HyperframesStudioPreview projectId="project-2" selectedFrameId="b" />,
    );
    await waitFor(() =>
      expect(screen.getAllByText('Open Studio')).toHaveLength(2),
    );
    expect(
      document.querySelectorAll('script[data-hyperframes-player]'),
    ).toHaveLength(1);

    first.unmount();
    // The second preview still renders `hyperframes-player`, so the custom
    // element definition must survive the first unmount.
    expect(
      document.querySelectorAll('script[data-hyperframes-player]'),
    ).toHaveLength(1);

    second.unmount();
    await waitFor(() =>
      expect(
        document.querySelectorAll('script[data-hyperframes-player]'),
      ).toHaveLength(0),
    );
  });

  it('treats a missing composition as an empty state, not an error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).endsWith('/open')
          ? new Response(
              JSON.stringify({
                error: 'HyperFrames composition requires index.html in /tmp/x.',
                detail: { code: 'invalid-project' },
              }),
              { status: 422, headers: { 'content-type': 'application/json' } },
            )
          : new Response(JSON.stringify({ stopped: false }), { status: 200 }),
      ),
    );

    const { container } = renderWithProviders(
      <HyperframesStudioPreview projectId="project-1" selectedFrameId="a" />,
    );
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('surfaces a typed bridge failure as an error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).endsWith('/open')
          ? new Response(
              JSON.stringify({
                error: 'HyperFrames returned malformed JSON.',
                detail: { code: 'malformed-json' },
              }),
              { status: 502, headers: { 'content-type': 'application/json' } },
            )
          : new Response(JSON.stringify({ stopped: false }), { status: 200 }),
      ),
    );

    renderWithProviders(
      <HyperframesStudioPreview projectId="project-1" selectedFrameId="a" />,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'HyperFrames returned malformed JSON.',
    );
  });
});

function stubStudioFetch() {
  return vi.fn(async (input: RequestInfo | URL) =>
    String(input).endsWith('/open')
      ? new Response(
          JSON.stringify({
            session: {
              serverUrl: 'http://127.0.0.1:43210',
              studioUrl: 'http://127.0.0.1:43210/#project/composition',
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      : new Response(JSON.stringify({ stopped: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
  );
}
