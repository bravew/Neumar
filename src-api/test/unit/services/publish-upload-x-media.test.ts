import { describe, expect, it } from 'vitest';

import { XMediaUploadSession } from '@/shared/services/publish/upload/native-protocols/x-media-upload';

import {
  createFetchMock,
  emptyResponse,
  jsonResponse,
} from './publish-upload-helpers';

describe('x media upload session', () => {
  it('runs INIT, APPEND, FINALIZE, and STATUS commands', async () => {
    const { fetch, calls } = createFetchMock([
      jsonResponse({ media_id_string: 'media-1' }),
      emptyResponse(204),
      jsonResponse({
        media_id_string: 'media-1',
        processing_info: { state: 'pending' },
      }),
      jsonResponse({ processing_info: { state: 'succeeded' } }),
    ]);
    const session = new XMediaUploadSession({ fetch });

    let state = await session.start({
      initUrl: 'https://upload.x.com/1.1/media/upload.json',
      totalBytes: 5,
      mime: 'video/mp4',
    });
    state = await session.append(state, Buffer.from('hello'), 0);
    await expect(session.finalize(state)).resolves.toMatchObject({
      providerId: 'media-1',
      metadata: { state: 'pending' },
    });
    await expect(session.query(state)).resolves.toMatchObject({
      committedBytes: 5,
      metadata: { processing_info: { state: 'succeeded' } },
    });

    expect(String(calls[0]?.init?.body)).toContain('command=INIT');
  });
});
