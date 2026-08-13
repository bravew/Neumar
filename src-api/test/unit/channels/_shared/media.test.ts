import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  assertImage,
  downloadWithRedirects,
  validateAttachmentSize,
} from '@/shared/channels/_shared/media';

describe('shared media helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('re-attaches auth only on allowed redirect hosts', async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({
          url: String(url),
          headers: (init?.headers as Record<string, string>) ?? {},
        });
        if (calls.length === 1) {
          return new Response(null, {
            status: 302,
            headers: { location: 'https://sub.files.slack.com/next' },
          });
        }
        if (calls.length === 2) {
          return new Response(null, {
            status: 302,
            headers: { location: 'https://cdn.example.com/file.png' },
          });
        }
        return new Response('ok', { status: 200 });
      }),
    );

    const res = await downloadWithRedirects('https://files.slack.com/start', {
      auth: 'Bearer token',
      hosts: ['files.slack.com'],
    });

    expect(res.status).toBe(200);
    expect(calls.map((call) => call.headers.Authorization)).toEqual([
      'Bearer token',
      'Bearer token',
      undefined,
    ]);
  });

  it('rejects non-image responses via the shared image validator', () => {
    const res = new Response('<html></html>', {
      headers: { 'content-type': 'text/html' },
    });

    expect(() => assertImage(res, Buffer.from('<html></html>'))).toThrow(
      /Non-image content-type/,
    );
  });

  it('validates attachment size caps', () => {
    expect(() => validateAttachmentSize(99, 100)).not.toThrow();
    expect(() => validateAttachmentSize(101, 100)).toThrow(/exceeds/);
  });
});
