/**
 * OpenAI-compatible media adapters.
 *
 * Covers custom image endpoints and ImageRouter-compatible image/video
 * providers that expose OpenAI-shaped JSON APIs.
 */

import { safeFetch } from '@/shared/network-policy/fetch';
import { trustedLocalPolicy } from '@/shared/network-policy/schema';
import { createLogger } from '@/shared/utils/logger';

import type {
  GenerateImageParams,
  GenerateVideoParams,
  ImageGenerationResult,
  MediaGenerationAdapter,
  MediaProviderConfig,
  VideoTaskCreatedResult,
  VideoTaskStatus,
  VideoTaskStatusResult,
} from '../types';

const logger = createLogger('OpenAICompatibleMedia');

const REQUEST_TIMEOUT_MS = 300_000;
const DEFAULT_IMAGE_MODEL = 'custom-image';
const DEFAULT_IMAGEROUTER_IMAGE_MODEL = 'imagerouter:image';
const DEFAULT_IMAGEROUTER_VIDEO_MODEL = 'imagerouter:video';

interface OpenAICompatibleImageResponse {
  data?: Array<{
    url?: string;
    b64_json?: string;
    revised_prompt?: string;
  }>;
  usage?: Record<string, number>;
}

interface OpenAICompatibleVideoCreateResponse {
  id?: string;
  task_id?: string;
  data?: { id?: string; task_id?: string };
}

interface OpenAICompatibleVideoStatusResponse {
  id?: string;
  status?: string;
  state?: string;
  url?: string;
  video_url?: string;
  output?: string | string[] | { url?: string; video_url?: string };
  data?: {
    status?: string;
    state?: string;
    url?: string;
    video_url?: string;
    output?: string | string[] | { url?: string; video_url?: string };
  };
  error?: string | { message?: string; code?: string };
  usage?: Record<string, number>;
}

type ErrorKind =
  | 'auth_failed'
  | 'quota_exceeded'
  | 'model_not_found'
  | 'invalid_request'
  | 'upstream_error';

function stripProviderPrefix(model: string, providerId: string): string {
  const prefix = `${providerId}:`;
  return model.toLowerCase().startsWith(prefix)
    ? model.slice(prefix.length)
    : model;
}

function pickModel(
  models: string[],
  providerId: string,
  requested: string | undefined,
  fallback: string,
): string {
  if (requested) return stripProviderPrefix(requested, providerId);
  const prefixed = models.find((model) =>
    model.toLowerCase().startsWith(`${providerId}:`),
  );
  if (prefixed) return stripProviderPrefix(prefixed, providerId);
  return models[0] ?? fallback;
}

function joinOpenAIPath(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  if (path.startsWith('/v1/') && /\/v1(?:\/openai)?$/i.test(base)) {
    return `${base}${path.slice(3)}`;
  }
  return `${base}${path}`;
}

function parseJson<T>(body: Buffer): T {
  const text = body.toString('utf8');
  return JSON.parse(text) as T;
}

function classifyStatus(status: number): ErrorKind {
  if (status === 401 || status === 403) return 'auth_failed';
  if (status === 402 || status === 429) return 'quota_exceeded';
  if (status === 404) return 'model_not_found';
  if (status >= 400 && status < 500) return 'invalid_request';
  return 'upstream_error';
}

function normalizedError(status: number, body: Buffer): string {
  let message = body.toString('utf8').slice(0, 500);
  try {
    const parsed = parseJson<{
      error?: string | { message?: string; code?: string };
      message?: string;
    }>(body);
    if (typeof parsed.error === 'string') message = parsed.error;
    else if (parsed.error?.message) message = parsed.error.message;
    else if (parsed.message) message = parsed.message;
  } catch {
    // Keep the raw truncated body.
  }
  return `${classifyStatus(status)}: ${message || `HTTP ${status}`}`;
}

function decodeImageResponse(
  data: OpenAICompatibleImageResponse,
): ImageGenerationResult['images'] {
  return (data.data ?? [])
    .map((item) => ({
      url: item.url
        ? item.url
        : item.b64_json
          ? `data:image/png;base64,${item.b64_json}`
          : '',
      revisedPrompt: item.revised_prompt,
    }))
    .filter((item) => item.url);
}

function normalizeVideoStatus(status: string | undefined): VideoTaskStatus {
  const normalized = (status ?? '').toLowerCase();
  if (['complete', 'completed', 'succeeded', 'success'].includes(normalized)) {
    return 'succeeded';
  }
  if (['failed', 'error'].includes(normalized)) return 'failed';
  if (['cancelled', 'canceled'].includes(normalized)) return 'cancelled';
  if (['queued', 'pending'].includes(normalized)) return 'queued';
  return 'running';
}

function pickVideoUrl(
  data: OpenAICompatibleVideoStatusResponse,
): string | undefined {
  const value =
    data.url ??
    data.video_url ??
    data.data?.url ??
    data.data?.video_url ??
    data.output ??
    data.data?.output;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.find((item) => item);
  if (value && typeof value === 'object') return value.url ?? value.video_url;
  return undefined;
}

export abstract class OpenAICompatibleImageAdapter implements MediaGenerationAdapter {
  abstract readonly providerId: string;
  abstract readonly name: string;
  abstract readonly defaultBaseUrl: string;

  readonly supportsImage: boolean = true;
  readonly supportsImageEdit: boolean = false;
  readonly supportsVideo: boolean = false;

  constructor(protected readonly config: MediaProviderConfig) {}

  protected imagePath(): string {
    return '/v1/images/generations';
  }

  protected imageEditPath(): string {
    return '/v1/images/edits';
  }

  protected defaultImageModel(): string {
    return DEFAULT_IMAGE_MODEL;
  }

  async generateImage(
    params: GenerateImageParams & { model?: string },
  ): Promise<ImageGenerationResult> {
    const model = pickModel(
      this.config.models,
      this.providerId,
      params.model,
      this.defaultImageModel(),
    );
    const baseUrl = this.config.baseUrl || this.defaultBaseUrl;
    const isEdit = Boolean(params.referenceImageUrl);
    const url = joinOpenAIPath(
      baseUrl,
      isEdit ? this.imageEditPath() : this.imagePath(),
    );

    try {
      if (isEdit && this.supportsImageEdit === false) {
        throw new Error(
          `${this.name} does not support image edits with a reference image`,
        );
      }

      const body: Record<string, unknown> = {
        model,
        prompt: params.prompt,
        n: params.count ?? 1,
        response_format: 'b64_json',
      };
      if (params.referenceImageUrl) {
        body.images = [{ image_url: params.referenceImageUrl }];
      }
      if (params.size) body.size = params.size;
      if (params.quality) body.quality = params.quality;
      if (params.seed != null) body.seed = params.seed;

      const response = await safeFetch(url, trustedLocalPolicy(), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(body),
        timeoutMs: REQUEST_TIMEOUT_MS,
      });

      if (response.status < 200 || response.status >= 300) {
        throw new Error(normalizedError(response.status, response.body));
      }

      const data = parseJson<OpenAICompatibleImageResponse>(response.body);
      const images = decodeImageResponse(data);
      if (images.length === 0) {
        throw new Error('upstream_error: no image returned');
      }

      return {
        success: true,
        provider: this.name,
        providerId: this.providerId,
        model,
        images,
        usage: data.usage,
        seed: params.seed,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`${this.name} image generation failed:`, message);
      return {
        success: false,
        provider: this.name,
        providerId: this.providerId,
        model,
        images: [],
        error: message,
      };
    }
  }
}

export class CustomOpenAIImageAdapter extends OpenAICompatibleImageAdapter {
  readonly providerId = 'custom-image';
  readonly name = 'Custom OpenAI Image';
  readonly defaultBaseUrl = 'https://api.openai.com';
  readonly supportsImageEdit = true;
}

export class ImageRouterImageAdapter extends OpenAICompatibleImageAdapter {
  readonly providerId = 'imagerouter';
  readonly name = 'ImageRouter';
  readonly defaultBaseUrl = 'https://api.imagerouter.io/v1/openai';

  protected defaultImageModel(): string {
    return DEFAULT_IMAGEROUTER_IMAGE_MODEL;
  }
}

export class ImageRouterAdapter
  extends ImageRouterImageAdapter
  implements MediaGenerationAdapter
{
  readonly supportsVideo = true;

  private videoPath(taskId?: string): string {
    return taskId
      ? `/v1/videos/generations/${encodeURIComponent(taskId)}`
      : '/v1/videos/generations';
  }

  async createVideoTask(
    params: GenerateVideoParams & { model?: string },
  ): Promise<VideoTaskCreatedResult> {
    const model = pickModel(
      this.config.models,
      this.providerId,
      params.model,
      DEFAULT_IMAGEROUTER_VIDEO_MODEL,
    );
    const url = joinOpenAIPath(
      this.config.baseUrl || this.defaultBaseUrl,
      this.videoPath(),
    );

    try {
      const body: Record<string, unknown> = {
        model,
        prompt: params.prompt,
      };
      if (params.aspectRatio) body.aspect_ratio = params.aspectRatio;
      if (params.duration) body.duration = params.duration;
      if (params.resolution) body.resolution = params.resolution;
      if (params.referenceImageUrl) body.image = params.referenceImageUrl;
      if (params.seed != null) body.seed = params.seed;

      const response = await safeFetch(url, trustedLocalPolicy(), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(body),
        timeoutMs: REQUEST_TIMEOUT_MS,
      });

      if (response.status < 200 || response.status >= 300) {
        throw new Error(normalizedError(response.status, response.body));
      }

      const data = parseJson<OpenAICompatibleVideoCreateResponse>(
        response.body,
      );
      const taskId =
        data.id ?? data.task_id ?? data.data?.id ?? data.data?.task_id;
      if (!taskId) throw new Error('upstream_error: no task id returned');

      return {
        success: true,
        provider: this.name,
        providerId: this.providerId,
        model,
        taskId,
        seed: params.seed,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`${this.name} video task failed:`, message);
      return {
        success: false,
        provider: this.name,
        providerId: this.providerId,
        model,
        taskId: '',
        error: message,
      };
    }
  }

  async getVideoTaskStatus(taskId: string): Promise<VideoTaskStatusResult> {
    const url = joinOpenAIPath(
      this.config.baseUrl || this.defaultBaseUrl,
      this.videoPath(taskId),
    );

    try {
      const response = await safeFetch(url, trustedLocalPolicy(), {
        method: 'GET',
        headers: { authorization: `Bearer ${this.config.apiKey}` },
        timeoutMs: REQUEST_TIMEOUT_MS,
      });

      if (response.status < 200 || response.status >= 300) {
        throw new Error(normalizedError(response.status, response.body));
      }

      const data = parseJson<OpenAICompatibleVideoStatusResponse>(
        response.body,
      );
      const rawStatus =
        data.status ?? data.state ?? data.data?.status ?? data.data?.state;
      const status = normalizeVideoStatus(rawStatus);
      const error =
        typeof data.error === 'string' ? data.error : data.error?.message;

      return {
        success: status !== 'failed',
        provider: this.name,
        providerId: this.providerId,
        taskId,
        status,
        videoUrl: pickVideoUrl(data),
        usage: data.usage,
        error,
        errorCode: typeof data.error === 'object' ? data.error.code : undefined,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        provider: this.name,
        providerId: this.providerId,
        taskId,
        status: 'failed',
        error: message,
      };
    }
  }
}
