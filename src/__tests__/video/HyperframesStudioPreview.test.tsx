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
});
