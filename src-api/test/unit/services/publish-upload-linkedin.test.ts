import { describe, expect, it } from 'vitest';

import { LinkedInChunkedUploadSession } from '@/shared/services/publish/upload/native-protocols/linkedin-chunked';

import {
  createFetchMock,
  emptyResponse,
  jsonResponse,
} from './publish-upload-helpers';

describe('linkedin chunked upload session', () => {
  it('uses returned chunk URLs, captures ETags, and finalizes', async () => {
    const { fetch } = createFetchMock([
      jsonResponse({
        value: {
          video: 'urn:li:video:1',
          uploadInstructions: [
            {
              uploadUrl: 'https://linkedin.example/chunk-1',
              firstByte: 0,
              lastByte: 4,
            },
          ],
        },
      }),
      emptyResponse(201, { ETag: 'part-etag-1' }),
      jsonResponse({ done: true }),
    ]);
    const session = new LinkedInChunkedUploadSession({
      fetch,
      finalizeUrl: 'https://linkedin.example/finalize',
    });

    let state = await session.start({
      initUrl: 'https://linkedin.example/videos?action=initializeUpload',
      totalBytes: 5,
    });
    state = await session.append(state, Buffer.from('hello'), 0);

    expect(state.etags).toEqual(['part-etag-1']);
    await expect(session.finalize(state)).resolves.toMatchObject({
      providerId: 'urn:li:video:1',
    });
  });
});
