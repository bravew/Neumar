import { afterEach, describe, expect, it, vi } from 'vitest';

import { IMessageAdapter } from '@/shared/services/gateway/channels/imessage/adapter';

describe('IMessageAdapter outbound', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends text to resolved chat GUIDs with password header', async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push([String(input), init]);
        if (String(input).endsWith('/api/v1/message/text')) {
          return new Response(JSON.stringify({ data: { guid: 'm1' } }), {
            status: 200,
          });
        }
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }),
    );
    const adapter = new IMessageAdapter({
      enabled: true,
      serverUrl: 'http://127.0.0.1:1234',
      password: 'pw',
    });
    Object.assign(adapter as unknown as { connected: boolean }, {
      connected: true,
    });

    await expect(
      adapter.sendMessage('chat_guid:iMessage;-;+15551234567', {
        text: 'hello',
      }),
    ).resolves.toEqual({ success: true, messageId: 'm1' });
    expect(calls[0]![0]).toBe('http://127.0.0.1:1234/api/v1/message/text');
    expect(calls[0]![1]).toMatchObject({
      headers: { 'content-type': 'application/json', password: 'pw' },
    });
  });

  it('downgrades unavailable tapbacks to text replies', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        calls.push(String(input));
        if (String(input).endsWith('/api/v1/message/react')) {
          return new Response('', { status: 404 });
        }
        return new Response(JSON.stringify({ data: { guid: 'fallback' } }), {
          status: 200,
        });
      }),
    );
    const adapter = new IMessageAdapter({
      enabled: true,
      serverUrl: 'http://127.0.0.1:1234',
      password: 'pw',
    });
    Object.assign(adapter as unknown as { connected: boolean }, {
      connected: true,
    });

    await expect(
      adapter.sendReaction({
        chatGuid: 'iMessage;-;+15551234567',
        messageGuid: 'm1',
        emoji: 'thumbs_up',
      }),
    ).resolves.toBe(false);
    expect(calls).toEqual([
      'http://127.0.0.1:1234/api/v1/message/react',
      'http://127.0.0.1:1234/api/v1/message/text',
    ]);
  });
});
