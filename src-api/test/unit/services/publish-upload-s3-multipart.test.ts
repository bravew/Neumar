import { describe, expect, it, vi } from 'vitest';

import {
  S3MultipartUploadSession,
  type S3MultipartTransport,
} from '@/shared/services/publish/upload/native-protocols/s3-multipart';

describe('s3 multipart upload session', () => {
  it('tracks uploaded parts and resumes from listed provider state', async () => {
    const transport: S3MultipartTransport = {
      createMultipartUpload: vi.fn(async () => ({ uploadId: 'upload-1' })),
      uploadPart: vi.fn(async ({ partNumber }) => ({
        etag: `etag-${partNumber}`,
      })),
      listParts: vi.fn(async () => [
        { partNumber: 1, etag: 'etag-1', size: 5 },
        { partNumber: 2, etag: 'etag-2', size: 5 },
      ]),
      completeMultipartUpload: vi.fn(async ({ uploadId, parts }) => ({
        providerId: uploadId,
        etag: parts.map((p) => p.etag).join(','),
      })),
      abortMultipartUpload: vi.fn(async () => undefined),
    };
    const session = new S3MultipartUploadSession(transport);

    let state = await session.start({ totalBytes: 10 });
    state = await session.append(state, Buffer.from('hello'), 0);
    state = await session.append(state, Buffer.from('world'), 5);

    expect(state.etags).toEqual(['etag-1', 'etag-2']);
    await expect(session.query(state)).resolves.toMatchObject({
      committedBytes: 10,
    });
    await expect(session.finalize(state)).resolves.toMatchObject({
      providerId: 'upload-1',
      etag: 'etag-1,etag-2',
    });
    await session.abort(state);
    expect(transport.abortMultipartUpload).toHaveBeenCalledWith('upload-1');
  });
});
