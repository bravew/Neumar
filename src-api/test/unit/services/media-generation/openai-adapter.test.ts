import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OpenAIAdapter } from '@/shared/services/media-generation/adapters/openai';

const PNG_DATA_URI =
  // 1x1 transparent PNG, base64
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

const config = {
  name: 'OpenAI',
  baseUrl: 'https://api.openai.com',
  apiKey: 'sk-test',
  models: ['gpt-image-1', 'dall-e-3'],
};

function fakePngDataUri(width: number, height: number): string {
  const buf = Buffer.alloc(33);
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  buf.writeUInt32BE(13, 8);
  buf.write('IHDR', 12, 'ascii');
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  buf[24] = 8; // bit depth
  buf[25] = 6; // truecolor with alpha
  return `data:image/png;base64,${buf.toString('base64')}`;
}

describe('OpenAIAdapter image edit / inpaint', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            created: 0,
            data: [{ b64_json: 'AAAA' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('routes to /v1/images/edits when a reference image is provided', async () => {
    const adapter = new OpenAIAdapter(config);
    const res = await adapter.generateImage({
      prompt: 'make the sky purple',
      referenceImageUrl: PNG_DATA_URI,
    });

    expect(res.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/images/edits');
    expect((init as RequestInit).method).toBe('POST');

    // Multipart body must include the prompt, the gpt-image-1 model, and an
    // `image` field; mask is optional and absent here.
    const body = (init as RequestInit).body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get('prompt')).toBe('make the sky purple');
    expect(body.get('model')).toBe('gpt-image-1');
    expect(body.get('image')).toBeInstanceOf(Blob);
    expect(body.get('mask')).toBeNull();

    // gpt-image-1 returns b64_json — adapter must normalize to a data: URI.
    expect(res.images[0]?.url.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('passes the mask through to /v1/images/edits when supplied', async () => {
    const adapter = new OpenAIAdapter(config);
    const res = await adapter.generateImage({
      prompt: 'inpaint the cat',
      referenceImageUrl: PNG_DATA_URI,
      maskImageUrl: PNG_DATA_URI,
    });

    expect(res.success).toBe(true);
    const body = (fetchMock.mock.calls[0]![1] as RequestInit).body as FormData;
    expect(body.get('mask')).toBeInstanceOf(Blob);
    const mask = body.get('mask') as Blob;
    expect(mask.type).toContain('png');
  });

  it('rejects a non-PNG mask before issuing the request', async () => {
    const adapter = new OpenAIAdapter(config);
    const res = await adapter.generateImage({
      prompt: 'inpaint',
      referenceImageUrl: PNG_DATA_URI,
      maskImageUrl: 'data:image/jpeg;base64,/9j/AAAA',
    });

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/PNG/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects mismatched mask dimensions before issuing the request', async () => {
    const adapter = new OpenAIAdapter(config);
    const res = await adapter.generateImage({
      prompt: 'inpaint',
      referenceImageUrl: fakePngDataUri(2, 2),
      maskImageUrl: fakePngDataUri(3, 2),
    });

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/dimensions/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses /v1/images/generations for plain text-to-image (no reference)', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ created: 0, data: [{ url: 'https://x/y.png' }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const adapter = new OpenAIAdapter(config);
    const res = await adapter.generateImage({ prompt: 'a cat' });

    expect(res.success).toBe(true);
    expect(fetchMock.mock.calls[0]![0]).toBe(
      'https://api.openai.com/v1/images/generations',
    );
    expect(timeoutSpy).toHaveBeenCalledWith(300_000);
  });

  it('uses the extended timeout for image edit requests', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    const adapter = new OpenAIAdapter(config);
    const res = await adapter.generateImage({
      prompt: 'make the sky purple',
      referenceImageUrl: PNG_DATA_URI,
    });

    expect(res.success).toBe(true);
    expect(fetchMock.mock.calls[0]![0]).toBe(
      'https://api.openai.com/v1/images/edits',
    );
    expect(timeoutSpy).toHaveBeenCalledWith(300_000);
  });
});
