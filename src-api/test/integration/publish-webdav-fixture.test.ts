import { describe, expect, it } from 'vitest';

import { WebDavClient } from '@/shared/integrations/storage/webdav';

describe('publish WebDAV fixture', () => {
  it('keeps target untouched until the final MOVE', async () => {
    const files = new Map<string, string>([['target.txt', 'old']]);
    const moves: string[] = [];
    const fetch = async (
      input: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      const url = new URL(String(input));
      const key = decodeURIComponent(url.pathname.replace(/^\/dav\/?/, ''));
      switch (init?.method) {
        case 'HEAD':
          return new Response(null, { status: files.has(key) ? 200 : 404 });
        case 'MKCOL':
          return new Response(null, { status: 201 });
        case 'PUT':
          files.set(key, await new Response(init.body).text());
          expect(files.get('target.txt')).toBe('old');
          return new Response(null, { status: 201 });
        case 'MOVE': {
          const destination = new URL(
            String(new Headers(init.headers).get('Destination')),
          );
          const destinationKey = decodeURIComponent(
            destination.pathname.replace(/^\/dav\/?/, ''),
          );
          files.set(destinationKey, files.get(key) ?? '');
          files.delete(key);
          moves.push(`${key}->${destinationKey}`);
          return new Response(null, { status: 201 });
        }
        default:
          return new Response(null, { status: 500 });
      }
    };

    const client = new WebDavClient({
      baseUrl: 'https://fixture.example/dav',
      fetch,
    });
    await client.uploadAtomic({
      targetPath: 'target.txt',
      snapshotPath: '_versions/1/target.txt',
      content: new Blob(['new']),
      contentType: 'text/plain',
    });

    expect(files.get('_versions/1/target.txt')).toBe('old');
    expect(files.get('target.txt')).toBe('new');
    expect(moves).toHaveLength(2);
  });
});
