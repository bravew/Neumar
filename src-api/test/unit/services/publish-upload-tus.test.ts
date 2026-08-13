import { describe, expect, it } from 'vitest';

import { TusFallbackUploadSession } from '@/shared/services/publish/upload/tus-fallback';

import {
  createFetchMock,
  emptyResponse,
  headerValue,
} from './publish-upload-helpers';

describe('tus fallback upload session', () => {
  it('uses tus 1.0 creation, patch, query, and abort semantics', async () => {
    const { fetch, calls } = createFetchMock([
      emptyResponse(201, { Location: '/files/1' }),
      emptyResponse(204, { 'Upload-Offset': '5' }),
      emptyResponse(200, { 'Upload-Offset': '5' }),
      emptyResponse(204),
    ]);
    const session = new TusFallbackUploadSession({ fetch });

    let state = await session.start({
      initUrl: 'https://tus.example/uploads',
      totalBytes: 10,
    });
    expect(state.sessionId).toBe('https://tus.example/files/1');
    expect(headerValue(calls[0]?.init?.headers, 'Tus-Resumable')).toBe('1.0.0');

    state = await session.append(state, Buffer.from('hello'), 0);
    expect(state.committedBytes).toBe(5);
    expect(await session.query(state)).toEqual({ committedBytes: 5 });
    await expect(session.abort(state)).resolves.toBeUndefined();
  });
});
