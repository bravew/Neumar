import { describe, expect, it } from 'vitest';

import { TikTokChunkedUploadSession } from '@/shared/services/publish/upload/native-protocols/tiktok-chunked';

import {
  createFetchMock,
  emptyResponse,
  headerValue,
  jsonResponse,
} from './publish-upload-helpers';

describe('tiktok chunked upload session', () => {
  it('starts inbox/direct post upload and PUTs chunks with content range', async () => {
    const { fetch, calls } = createFetchMock([
      jsonResponse({
        data: {
          publish_id: 'publish-1',
          upload_url: 'https://tiktok.example/upload',
        },
      }),
      emptyResponse(200),
    ]);
    const session = new TikTokChunkedUploadSession({ fetch });

    let state = await session.start({
      initUrl: 'https://tiktok.example/v2/post/publish/inbox/video/init/',
      totalBytes: 5,
    });
    state = await session.append(state, Buffer.from('hello'), 0);

    expect(state.committedBytes).toBe(5);
    expect(headerValue(calls[1]?.init?.headers, 'Content-Range')).toBe(
      'bytes 0-4/5',
    );
    await expect(session.finalize(state)).resolves.toMatchObject({
      providerId: 'publish-1',
    });
  });
});
