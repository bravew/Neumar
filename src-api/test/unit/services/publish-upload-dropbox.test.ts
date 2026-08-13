import { describe, expect, it } from 'vitest';

import { DropboxUploadSession } from '@/shared/services/publish/upload/native-protocols/dropbox-session';

import {
  createFetchMock,
  emptyResponse,
  jsonResponse,
} from './publish-upload-helpers';

describe('dropbox upload session', () => {
  it('starts, appends with an offset cursor, and finishes with a rev', async () => {
    const { fetch, calls } = createFetchMock([
      jsonResponse({ session_id: 'dbx-session-1' }),
      emptyResponse(200),
      jsonResponse({ id: 'id:file', rev: 'rev-1', path_display: '/video.mp4' }),
    ]);
    const session = new DropboxUploadSession({
      fetch,
      appendUrl: 'https://dropbox.example/append',
      finishUrl: 'https://dropbox.example/finish',
    });

    let state = await session.start({
      initUrl: 'https://dropbox.example/start',
      totalBytes: 10,
      targetPath: '/video.mp4',
    });
    state = await session.append(state, Buffer.from('hello'), 0);

    const appendArg = JSON.parse(
      String(new Headers(calls[1]?.init?.headers).get('Dropbox-API-Arg')),
    );
    expect(appendArg.cursor).toEqual({
      session_id: 'dbx-session-1',
      offset: 0,
    });

    await expect(session.finalize(state)).resolves.toMatchObject({
      providerId: 'id:file',
      revision: 'rev-1',
    });
  });
});
