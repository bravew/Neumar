import { describe, expect, it, vi } from 'vitest';

import {
  parseIMessageTarget,
  resolveIMessageChatGuid,
} from '@/shared/services/gateway/channels/imessage/targets';

describe('iMessage targets', () => {
  it('parses chat GUIDs, phone, and email targets', () => {
    expect(parseIMessageTarget('iMessage;-;+15551234567')).toEqual({
      kind: 'chat_guid',
      chatGuid: 'iMessage;-;+15551234567',
    });
    expect(parseIMessageTarget('phone:+1 (555) 123-4567')).toEqual({
      kind: 'phone',
      handle: '+15551234567',
    });
    expect(parseIMessageTarget('email:Ada@Example.com')).toEqual({
      kind: 'email',
      handle: 'ada@example.com',
    });
  });

  it('resolves handles to chat GUIDs via BlueBubbles chat query', async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [
              {
                guid: 'iMessage;-;+15551234567',
                participants: [{ address: '+15551234567' }],
              },
            ],
          }),
          { status: 200 },
        ),
    ) as unknown as typeof fetch;

    await expect(
      resolveIMessageChatGuid({
        serverUrl: 'http://127.0.0.1:1234',
        password: 'pw',
        target: { kind: 'phone', handle: '+15551234567' },
        fetchFn,
      }),
    ).resolves.toBe('iMessage;-;+15551234567');
  });
});
