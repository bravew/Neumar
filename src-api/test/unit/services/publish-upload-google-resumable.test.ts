import { describe, expect, it } from 'vitest';

import { GoogleResumableUploadSession } from '@/shared/services/publish/upload/native-protocols/google-resumable';

import {
  createFetchMock,
  emptyResponse,
  headerValue,
  jsonResponse,
} from './publish-upload-helpers';

describe('google resumable upload session', () => {
  it('starts, persists intermediate offsets, queries, and finalizes', async () => {
    const { fetch, calls } = createFetchMock([
      emptyResponse(200, { Location: 'https://upload.example/session/1' }),
      emptyResponse(308, { Range: 'bytes=0-4' }),
      emptyResponse(308, { Range: 'bytes=0-4' }),
      jsonResponse({ id: 'file-1' }, 200),
    ]);
    const session = new GoogleResumableUploadSession({ fetch });

    let state = await session.start({
      initUrl: 'https://drive.example/init',
      totalBytes: 10,
      mime: 'video/mp4',
    });
    expect(state.sessionId).toBe('https://upload.example/session/1');

    state = await session.append(state, Buffer.from('hello'), 0);
    expect(state.committedBytes).toBe(5);
    expect(headerValue(calls[1]?.init?.headers, 'Content-Range')).toBe(
      'bytes 0-4/10',
    );

    await expect(session.query(state)).resolves.toEqual({ committedBytes: 5 });

    state = await session.append(state, Buffer.from('world'), 5);
    expect(state.committedBytes).toBe(10);
    await expect(session.finalize(state)).resolves.toMatchObject({
      providerId: 'https://upload.example/session/1',
    });
  });
});
