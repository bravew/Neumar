/**
 * Leonardo.ai image adapter.
 *
 * Leonardo uses an async generation job even for image output. This adapter
 * starts a job, polls for completion, and returns the hosted image URL for the
 * existing artifact writer to persist.
 */

import { safeFetch } from '@/shared/network-policy/fetch';
import { trustedLocalPolicy } from '@/shared/network-policy/schema';
import { createLogger } from '@/shared/utils/logger';

import type {
  GenerateImageParams,
  ImageGenerationResult,
  MediaGenerationAdapter,
  MediaProviderConfig,
} from '../types';

const logger = createLogger('LeonardoMedia');

const LEONARDO_BASE_URL = 'https://cloud.leonardo.ai/api/rest/v1';
const POLL_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 2_000;
const DEFAULT_MODEL = 'leonardo-phoenix';

const MODEL_ID_MAP: Record<string, string> = {
  'leonardo-phoenix': 'de7d3faf-762f-48e0-b3b7-9d0ac3a3fcf3',
  'leonardo-kino-xl': 'aa77f04e-3eec-4034-9c07-d0f619684628',
  'leonardo-flux-dev': 'b2614463-296c-462a-9586-aafdb8f00e36',
  'leonardo-flux-schnell': '1dd50843-d653-4516-a8e3-f0238ee453ff',
  'leonardo-anime-pastel': '1aa0f478-51be-4efd-94e8-76bfc8f533af',
};

const ASPECT_RATIOS: Record<string, { width: number; height: number }> = {
  '1:1': { width: 1024, height: 1024 },
  '16:9': { width: 1280, height: 720 },
  '9:16': { width: 720, height: 1280 },
  '4:3': { width: 1024, height: 768 },
  '3:4': { width: 768, height: 1024 },
};

interface LeonardoCreateResponse {
  sdGenerationJob?: { generationId?: string };
  generationId?: string;
  id?: string;
}

interface LeonardoGeneratedImage {
  url?: string;
  imageUrl?: string;
}

interface LeonardoPollResponse {
  generations_by_pk?: {
    status?: string;
    generated_images?: LeonardoGeneratedImage[];
  };
  status?: string;
  generated_images?: LeonardoGeneratedImage[];
  error?: string | { message?: string };
}

function normalizeModel(model: string): string {
  return model.toLowerCase().startsWith('leonardo:')
    ? model.slice('leonardo:'.length)
    : model;
}

function pickModel(models: string[], requested: string | undefined): string {
  if (requested) return normalizeModel(requested);
  const known = models.map(normalizeModel).find((model) => MODEL_ID_MAP[model]);
  return known ?? DEFAULT_MODEL;
}

function parseJson<T>(body: Buffer): T {
  return JSON.parse(body.toString('utf8')) as T;
}

function classifyLeonardoError(status: number, body: Buffer): string {
  if (status === 401 || status === 403) return 'LEONARDO_AUTH_FAILED';
  if (status === 402 || status === 429) return 'LEONARDO_QUOTA_EXCEEDED';
  let detail = body.toString('utf8').slice(0, 400);
  try {
    const parsed = parseJson<{ error?: string | { message?: string } }>(body);
    detail =
      typeof parsed.error === 'string'
        ? parsed.error
        : (parsed.error?.message ?? detail);
  } catch {
    // Keep raw body.
  }
  return `LEONARDO_UPSTREAM_ERROR: ${detail || `HTTP ${status}`}`;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    if (signal) {
      if (signal.aborted) {
        clearTimeout(timer);
        resolve();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

function firstImageUrl(data: LeonardoPollResponse): string | undefined {
  const images =
    data.generations_by_pk?.generated_images ?? data.generated_images ?? [];
  return images.map((image) => image.url ?? image.imageUrl).find(Boolean);
}

export class LeonardoImageAdapter implements MediaGenerationAdapter {
  readonly name = 'Leonardo.ai';
  readonly supportsImage = true;
  readonly supportsImageEdit = false;
  readonly supportsVideo = false;

  constructor(private readonly config: MediaProviderConfig) {}

  async generateImage(
    params: GenerateImageParams & { model?: string; signal?: AbortSignal },
  ): Promise<ImageGenerationResult> {
    const model = pickModel(this.config.models, params.model);
    const modelId = MODEL_ID_MAP[model];

    if (!modelId) {
      return {
        success: false,
        provider: this.name,
        providerId: 'leonardo',
        model,
        images: [],
        error: `Unknown Leonardo model: ${model}`,
      };
    }

    const aspect = ASPECT_RATIOS[params.aspectRatio ?? '1:1'];
    if (!aspect) {
      return {
        success: false,
        provider: this.name,
        providerId: 'leonardo',
        model,
        images: [],
        error: `Leonardo does not support aspect ratio "${params.aspectRatio}". Valid: ${Object.keys(ASPECT_RATIOS).join(', ')}.`,
      };
    }

    try {
      const generationId = await this.startGeneration(
        {
          modelId,
          prompt: params.prompt,
          width: aspect.width,
          height: aspect.height,
          count: params.count ?? 1,
          seed: params.seed,
        },
        params.signal,
      );
      const imageUrl = await this.pollUntilReady(generationId, params.signal);

      return {
        success: true,
        provider: this.name,
        providerId: 'leonardo',
        model,
        images: [{ url: imageUrl, size: `${aspect.width}x${aspect.height}` }],
        seed: params.seed,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Leonardo image generation failed:', message);
      return {
        success: false,
        provider: this.name,
        providerId: 'leonardo',
        model,
        images: [],
        error: message,
      };
    }
  }

  private async startGeneration(
    input: {
      modelId: string;
      prompt: string;
      width: number;
      height: number;
      count: number;
      seed?: number;
    },
    signal?: AbortSignal,
  ): Promise<string> {
    const body: Record<string, unknown> = {
      modelId: input.modelId,
      prompt: input.prompt,
      width: input.width,
      height: input.height,
      num_images: input.count,
    };
    if (input.seed != null) body.seed = input.seed;

    const response = await this.fetchJson<LeonardoCreateResponse>(
      '/generations',
      {
        method: 'POST',
        body: JSON.stringify(body),
        signal,
      },
    );
    const generationId =
      response.sdGenerationJob?.generationId ??
      response.generationId ??
      response.id;
    if (!generationId) {
      throw new Error('LEONARDO_UPSTREAM_ERROR: no generation id returned');
    }
    return generationId;
  }

  private async pollUntilReady(
    generationId: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const deadline = Date.now() + POLL_TIMEOUT_MS;

    while (Date.now() < deadline) {
      if (signal?.aborted) {
        throw new Error('LEONARDO_CANCELLED: generation cancelled by caller');
      }
      const response = await this.fetchJson<LeonardoPollResponse>(
        `/generations/${encodeURIComponent(generationId)}`,
        { method: 'GET', signal },
      );
      const status = (
        response.generations_by_pk?.status ??
        response.status ??
        ''
      ).toUpperCase();
      const imageUrl = firstImageUrl(response);

      if (
        imageUrl &&
        ['COMPLETE', 'COMPLETED', 'FINISHED', 'SUCCEEDED'].includes(status)
      ) {
        return imageUrl;
      }
      if (status === 'FAILED' || status === 'ERROR') {
        const err =
          typeof response.error === 'string'
            ? response.error
            : response.error?.message;
        throw new Error(
          `LEONARDO_UPSTREAM_ERROR: ${err ?? 'generation failed'}`,
        );
      }
      if (imageUrl && !status) return imageUrl;
      await sleep(POLL_INTERVAL_MS, signal);
      if (signal?.aborted) {
        throw new Error('LEONARDO_CANCELLED: generation cancelled by caller');
      }
    }

    throw new Error('LEONARDO_TIMEOUT: generation exceeded 120 seconds');
  }

  private async fetchJson<T>(
    path: string,
    init: { method: 'GET' | 'POST'; body?: string; signal?: AbortSignal },
  ): Promise<T> {
    const url = `${(this.config.baseUrl || LEONARDO_BASE_URL).replace(/\/+$/, '')}${path}`;
    const response = await safeFetch(url, trustedLocalPolicy(), {
      method: init.method,
      headers: {
        authorization: `Bearer ${this.config.apiKey}`,
        'content-type': 'application/json',
      },
      body: init.body,
      timeoutMs: POLL_TIMEOUT_MS,
      maxRedirects: 0,
      signal: init.signal,
    });

    if (response.status < 200 || response.status >= 300) {
      throw new Error(classifyLeonardoError(response.status, response.body));
    }
    return parseJson<T>(response.body);
  }
}

export const LEONARDO_MODEL_IDS = Object.keys(MODEL_ID_MAP);
export const LEONARDO_ASPECT_RATIOS = Object.keys(ASPECT_RATIOS);
