import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  downloadWhatsAppMedia,
  type WhatsAppCloudConfig,
} from '@/shared/services/gateway/channels/whatsapp/cloud';

describe('WhatsApp media download', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('performs metadata lookup and manual redirected media download', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        calls.push(String(input));
        if (String(input).includes('/v20.0/media1')) {
          return new Response(
            JSON.stringify({ url: 'https://meta.example/media' }),
          );
        }
        if (String(input) === 'https://meta.example/media') {
          return new Response('', {
            status: 302,
            headers: { location: 'https://cdn.example/media' },
          });
        }
        return new Response('bytes', { status: 200 });
      }),
    );
    const config: WhatsAppCloudConfig = {
      mode: 'cloud',
      phoneNumberId: 'phone123',
      accessToken: 'token',
      webhookVerifyToken: 'verify',
      appSecret: 'secret',
    };
    const outputPath = path.join(os.tmpdir(), `wa-${Date.now()}.bin`);

    await downloadWhatsAppMedia({ config, mediaId: 'media1', outputPath });

    expect(calls).toEqual([
      'https://graph.facebook.com/v20.0/media1',
      'https://meta.example/media',
      'https://cdn.example/media',
    ]);
    await expect(fs.readFile(outputPath, 'utf8')).resolves.toBe('bytes');
    await fs.unlink(outputPath).catch(() => {});
  });
});
