import { afterEach, describe, expect, it, vi } from 'vitest';

import { probeBlueBubbles } from '@/shared/services/gateway/channels/imessage/probe';

describe('probeBlueBubbles', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses password header and surfaces version metadata', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: {
              serverVersion: '1.9.7',
              privateApiStatus: true,
            },
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      probeBlueBubbles({
        serverUrl: 'http://127.0.0.1:1234',
        password: 'pw',
      }),
    ).resolves.toMatchObject({
      ok: true,
      host: '127.0.0.1:1234',
      version: '1.9.7',
      accountState: 'true',
    });
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({
      headers: { password: 'pw' },
    });
  });
});
