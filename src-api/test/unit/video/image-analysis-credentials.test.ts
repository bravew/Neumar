import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const resolveApiCredentials = vi.hoisted(() => vi.fn());
const getSetting = vi.hoisted(() => vi.fn());
const messagesCreate = vi.hoisted(() => vi.fn());

vi.mock('@/shared/utils/provider-resolution', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/shared/utils/provider-resolution')
  >()),
  resolveApiCredentials,
}));

vi.mock('@/shared/db/operations', () => ({ getSetting }));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: messagesCreate };
    constructor(public options: { apiKey: string; baseURL?: string }) {
      lastClientOptions = options;
    }
  },
}));

let lastClientOptions: { apiKey: string; baseURL?: string } | undefined;
let imagePath = '';

async function analyze() {
  const { analyzeImageFocalPoint } =
    await import('@/shared/video/image-analysis');
  return analyzeImageFocalPoint(imagePath, 'image/jpeg');
}

function focalResponse() {
  return {
    content: [
      {
        type: 'text',
        text: '{"description":"skyline","subject":"scene","focusX":0.5,"focusY":0.4,"tightness":0.8}',
      },
    ],
  };
}

describe('image analysis credential resolution', () => {
  beforeEach(async () => {
    vi.resetModules();
    lastClientOptions = undefined;
    resolveApiCredentials.mockReset();
    getSetting.mockReset().mockReturnValue(null);
    messagesCreate.mockReset().mockResolvedValue(focalResponse());
    for (const key of [
      'ANTHROPIC_API_KEY',
      'ANTHROPIC_AUTH_TOKEN',
      'ANTHROPIC_BASE_URL',
      'ANTHROPIC_MODEL',
    ]) {
      vi.stubEnv(key, '');
    }
    const dir = await mkdtemp(path.join(tmpdir(), 'neuma-image-analysis-'));
    imagePath = path.join(dir, 'frame.jpg');
    await writeFile(imagePath, 'jpeg-bytes');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // The Settings UI writes credentials where the provider manager reads them,
  // not to the legacy `anthropicApiKey` setting this module used to check.
  it('uses the credentials the rest of the app resolves', async () => {
    resolveApiCredentials.mockReturnValue({
      apiKey: 'sk-ant-from-provider-manager',
      baseUrl: 'https://api.anthropic.com',
    });

    await expect(analyze()).resolves.toMatchObject({ subject: 'scene' });
    expect(lastClientOptions?.apiKey).toBe('sk-ant-from-provider-manager');
  });

  it('falls back to the legacy setting when the provider manager has none', async () => {
    resolveApiCredentials.mockReturnValue({});
    getSetting.mockImplementation((key: string) =>
      key === 'anthropicApiKey' ? 'sk-ant-legacy' : null,
    );

    await expect(analyze()).resolves.toMatchObject({ subject: 'scene' });
    expect(lastClientOptions?.apiKey).toBe('sk-ant-legacy');
  });

  // Handing an OpenAI key to the Anthropic SDK turns "no credentials" into a
  // 401 from the wrong vendor, which is far harder to act on.
  it('ignores a non-Anthropic provider rather than misusing its key', async () => {
    resolveApiCredentials.mockReturnValue({
      apiKey: 'sk-openai',
      baseUrl: 'https://api.openai.com/v1',
    });

    await expect(analyze()).rejects.toThrow(/needs an Anthropic API key/);
  });

  // A Claude Max/Pro subscription is configured but has no API key, so the old
  // "No Anthropic API key configured" left users with nothing to change.
  it('explains that a subscription cannot authenticate this call', async () => {
    resolveApiCredentials.mockReturnValue({});

    await expect(analyze()).rejects.toThrow(
      /subscription .*cannot authenticate/s,
    );
  });
});
