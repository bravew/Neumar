import { describe, expect, it } from 'vitest';

import { BoxUploadsSession } from '@/shared/services/publish/upload/native-protocols/box-uploads-session';

import {
  createFetchMock,
  headerValue,
  jsonResponse,
} from './publish-upload-helpers';

describe('box uploads session', () => {
  it('sends per-part digests and commits the uploaded parts', async () => {
    const { fetch, calls } = createFetchMock([
      jsonResponse({
        id: 'box-session-1',
        session_endpoints: {
          upload_part: 'https://box.example/part',
          commit: 'https://box.example/commit',
          status: 'https://box.example/status',
          abort: 'https://box.example/abort',
        },
      }),
      jsonResponse({
        part: { part_id: 'part-1', offset: 0, size: 5, sha1: 'sha-1' },
      }),
      jsonResponse({ id: 'box-file-1' }, 201),
    ]);
    const session = new BoxUploadsSession({ fetch });

    let state = await session.start({
      initUrl: 'https://box.example/start',
      totalBytes: 5,
    });
    state = await session.append(state, Buffer.from('hello'), 0);
    expect(headerValue(calls[1]?.init?.headers, 'Digest')).toMatch(/^sha=/);

    await expect(session.finalize(state)).resolves.toMatchObject({
      providerId: 'box-file-1',
    });
  });
});
