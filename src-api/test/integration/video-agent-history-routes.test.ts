import { describe, expect, it } from 'vitest';

import { videoRoutes } from '@/app/api/video';

describe('video agent history routes', () => {
  it('returns an empty history for an unknown project', async () => {
    const response = await videoRoutes.request(
      '/projects/agent-history-unknown/agent-history',
    );
    const payload = (await response.json()) as { messages: unknown[] };

    expect(response.status).toBe(200);
    expect(payload.messages).toEqual([]);
  });

  it('persists and reloads the agent conversation per project', async () => {
    const projectId = 'agent-history-roundtrip';
    const messages = [
      { id: 'm1', type: 'user', text: 'make a reel' },
      { id: 'm2', type: 'assistant', text: 'on it' },
    ];

    const put = await videoRoutes.request(
      `/projects/${projectId}/agent-history`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages }),
      },
    );
    expect(put.status).toBe(200);
    expect(await put.json()).toMatchObject({ ok: true, count: 2 });

    const get = await videoRoutes.request(
      `/projects/${projectId}/agent-history`,
    );
    const payload = (await get.json()) as { messages: unknown[] };
    expect(get.status).toBe(200);
    expect(payload.messages).toEqual(messages);
  });

  it('rejects an oversized history payload', async () => {
    const messages = Array.from({ length: 201 }, (_, index) => ({
      id: `m${index}`,
    }));
    const response = await videoRoutes.request(
      '/projects/agent-history-oversized/agent-history',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages }),
      },
    );

    expect(response.status).toBe(400);
  });
});
