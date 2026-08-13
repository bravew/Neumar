import { describe, expect, it } from 'vitest';

import { InstagramRuploadSession } from '@/shared/services/publish/upload/native-protocols/instagram-rupload';

import {
  createFetchMock,
  emptyResponse,
  headerValue,
  jsonResponse,
} from './publish-upload-helpers';

describe('instagram rupload session', () => {
  it('creates a container and uploads chunks to the rupload URL', async () => {
    const { fetch, calls } = createFetchMock([
      jsonResponse({
        id: 'container-1',
        upload_url: 'https://rupload.facebook.com/container-1',
      }),
      emptyResponse(200),
    ]);
    const session = new InstagramRuploadSession({ fetch });

    let state = await session.start({
      initUrl: 'https://graph.example/ig/media',
      totalBytes: 5,
    });
    state = await session.append(state, Buffer.from('hello'), 0);

    expect(state.committedBytes).toBe(5);
    expect(headerValue(calls[1]?.init?.headers, 'Content-Range')).toBe(
      'bytes 0-4/5',
    );
    await expect(session.finalize(state)).resolves.toMatchObject({
      providerId: 'container-1',
    });
  });
});
