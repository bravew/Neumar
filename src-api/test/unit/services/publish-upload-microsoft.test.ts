import { describe, expect, it } from 'vitest';

import { MicrosoftUploadSession } from '@/shared/services/publish/upload/native-protocols/microsoft-upload-session';

import {
  createFetchMock,
  headerValue,
  jsonResponse,
} from './publish-upload-helpers';

describe('microsoft upload session', () => {
  it('tracks next expected ranges and final drive item metadata', async () => {
    const { fetch, calls } = createFetchMock([
      jsonResponse({
        uploadUrl: 'https://graph.example/upload',
        expirationDateTime: '2026-05-06T13:00:00Z',
      }),
      jsonResponse({ nextExpectedRanges: ['5-'] }, 202),
      jsonResponse({ id: 'item-1', eTag: 'abc', webUrl: 'https://one/item' }),
    ]);
    const session = new MicrosoftUploadSession({ fetch });

    let state = await session.start({
      initUrl: 'https://graph.example/createUploadSession',
      totalBytes: 10,
    });
    expect(state.expiresAt).toBe('2026-05-06T13:00:00Z');

    state = await session.append(state, Buffer.from('hello'), 0);
    expect(state.committedBytes).toBe(5);
    expect(headerValue(calls[1]?.init?.headers, 'Content-Range')).toBe(
      'bytes 0-4/10',
    );

    state = await session.append(state, Buffer.from('world'), 5);
    await expect(session.finalize(state)).resolves.toMatchObject({
      providerId: 'item-1',
      etag: 'abc',
      url: 'https://one/item',
    });
  });
});
