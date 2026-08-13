import { safeFetch } from '@/shared/network-policy/fetch';
import { normalizeHost } from '@/shared/network-policy/host';
import { classifyIp } from '@/shared/network-policy/ip';
import { externalApiPolicy } from '@/shared/network-policy/schema';
import { createLogger } from '@/shared/utils/logger';
import { validateBaseUrl } from '@/shared/utils/url-validator';

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

const logger = createLogger('FalMedia');

const DEFAULT_BASE_URL = 'https://queue.fal.run';
const DEFAULT_IMAGE_MODEL = 'fal-ai/flux/dev';
const DEFAULT_VIDEO_MODEL = 'fal-ai/veo3/fast';
const REQUEST_TIMEOUT_MS = 300_000;
const IMAGE_POLL_TIMEOUT_MS = 300_000;
const IMAGE_POLL_INTERVAL_MS = 1_000;

const IMAGE_MODEL_PATTERN =
  /flux|recraft|ideogram|stable-diffusion|imagen|image/i;
const VIDEO_MODEL_PATTERN =
  /veo|kling|hailuo|runway|ltx|wan|luma|video|seedance/i;

interface FalQueueResponse {
  request_id?: string;
  requestId?: string;
  status?: string;
  error?: string | { message?: string; code?: string };
}

interface FalResultBody {
  response?: FalResultBody;
  data?: FalResultBody;
  images?: Array<string | { url?: string }>;
  image?: string | { url?: string };
  video?: string | { url?: string };
  output?: string | string[] | { url?: string };
  result?: string | { url?: string };
  url?: string;
  status?: string;
  error?: string | { message?: string; code?: string };
  metrics?: {
    total_cost_usd?: number;
    duration_seconds?: number;
  };
}

export class FalMediaAdapter implements MediaGenerationAdapter {
  readonly name = 'fal.ai';
  readonly supportsImage = true;
  readonly supportsImageEdit = true;
  readonly supportsVideo = true;

  constructor(private readonly config: MediaProviderConfig) {
    validateFalBaseUrl(config.baseUrl || DEFAULT_BASE_URL);
  }

  async generateImage(
    params: GenerateImageParams & { model?: string; signal?: AbortSignal },
  ): Promise<ImageGenerationResult> {
    const model = pickFalModel(
      this.config.models,
      params.model,
      IMAGE_MODEL_PATTERN,
      DEFAULT_IMAGE_MODEL,
    );

    try {
      throwIfAborted(params.signal);
      const task = await this.queue(
        model,
        buildImageInput(params),
        params.signal,
      );
      const result = await this.pollUntilComplete(
        model,
        task.requestId,
        params.signal,
      );
      const images = extractImageUrls(result).map((url) => ({
        url,
        size: params.size,
      }));
      if (images.length === 0) {
        throw new Error('upstream_error: no image returned');
      }
      return {
        success: true,
        provider: this.name,
        providerId: 'fal',
        model,
        images,
        seed: params.seed,
        usage: usageFromMetrics(result),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('fal.ai image generation failed:', message);
      return {
        success: false,
        provider: this.name,
        providerId: 'fal',
        model,
        images: [],
        error: message,
      };
    }
  }

  async createVideoTask(
    params: GenerateVideoParams & { model?: string; signal?: AbortSignal },
  ): Promise<VideoTaskCreatedResult> {
    const model = pickFalModel(
      this.config.models,
      params.model,
      VIDEO_MODEL_PATTERN,
      DEFAULT_VIDEO_MODEL,
    );

    try {
      throwIfAborted(params.signal);
      const task = await this.queue(
        model,
        buildVideoInput(params),
        params.signal,
      );
      return {
        success: true,
        provider: this.name,
        providerId: 'fal',
        model,
        taskId: encodeFalTaskId(model, task.requestId),
        seed: params.seed,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('fal.ai video task failed:', message);
      return {
        success: false,
        provider: this.name,
        providerId: 'fal',
        model,
        taskId: '',
        error: message,
      };
    }
  }

  async getVideoTaskStatus(
    taskId: string,
    signal?: AbortSignal,
  ): Promise<VideoTaskStatusResult> {
    const decoded = decodeFalTaskId(taskId);
    const model =
      decoded?.model ??
      pickFalModel(
        this.config.models,
        undefined,
        VIDEO_MODEL_PATTERN,
        DEFAULT_VIDEO_MODEL,
      );
    const requestId = decoded?.requestId ?? taskId;

    try {
      const statusBody = await this.getStatus(model, requestId, signal);
      const status = normalizeFalStatus(statusBody.status);
      if (status !== 'succeeded') {
        return {
          success: status !== 'failed',
          provider: this.name,
          providerId: 'fal',
          taskId,
          status,
          model,
          error: status === 'failed' ? errorMessage(statusBody) : undefined,
        };
      }

      const result = await this.getResult(model, requestId, signal);
      const videoUrl = extractVideoUrl(result);
      return {
        success: Boolean(videoUrl),
        provider: this.name,
        providerId: 'fal',
        taskId,
        status: videoUrl ? 'succeeded' : 'failed',
        videoUrl,
        model,
        usage: usageFromMetrics(result),
        error: videoUrl ? undefined : 'upstream_error: no video URL returned',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        provider: this.name,
        providerId: 'fal',
        taskId,
        status: 'failed',
        model,
        error: message,
      };
    }
  }

  private async queue(
    model: string,
    input: Record<string, unknown>,
    signal?: AbortSignal,
  ) {
    const response = await falRequest<FalQueueResponse>(
      this.url(model),
      this.config.apiKey,
      {
        method: 'POST',
        body: JSON.stringify({ input }),
        signal,
      },
    );
    const requestId = response.request_id ?? response.requestId;
    if (!requestId) {
      throw new Error('upstream_error: fal.ai did not return request_id');
    }
    return { requestId };
  }

  private async getStatus(
    model: string,
    requestId: string,
    signal?: AbortSignal,
  ) {
    return falRequest<FalQueueResponse>(
      `${this.url(model)}/requests/${encodeURIComponent(requestId)}/status`,
      this.config.apiKey,
      { method: 'GET', signal },
    );
  }

  private async getResult(
    model: string,
    requestId: string,
    signal?: AbortSignal,
  ) {
    const body = await falRequest<FalResultBody>(
      `${this.url(model)}/requests/${encodeURIComponent(requestId)}`,
      this.config.apiKey,
      { method: 'GET', signal },
    );
    return unwrapFalBody(body);
  }

  private async pollUntilComplete(
    model: string,
    requestId: string,
    signal?: AbortSignal,
  ) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < IMAGE_POLL_TIMEOUT_MS) {
      throwIfAborted(signal);
      const status = await this.getStatus(model, requestId, signal);
      const normalized = normalizeFalStatus(status.status);
      if (normalized === 'succeeded') {
        return this.getResult(model, requestId, signal);
      }
      if (normalized === 'failed' || normalized === 'cancelled') {
        throw new Error(errorMessage(status));
      }
      await sleepUntilNextPoll(IMAGE_POLL_INTERVAL_MS, signal);
    }
    throw new Error('timeout: fal.ai image generation did not complete');
  }

  private url(model: string) {
    const base = (this.config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    return `${base}/${stripFalModelPrefix(model)}`;
  }
}

function buildImageInput(params: GenerateImageParams) {
  const input: Record<string, unknown> = {
    prompt: params.prompt,
  };
  if (params.referenceImageUrl) input.image_url = params.referenceImageUrl;
  if (params.count) input.num_images = params.count;
  if (params.size) input.image_size = params.size;
  if (params.aspectRatio) input.aspect_ratio = params.aspectRatio;
  if (params.seed != null) input.seed = params.seed;
  if (params.guidanceScale != null) input.guidance_scale = params.guidanceScale;
  return input;
}

function buildVideoInput(params: GenerateVideoParams) {
  const input: Record<string, unknown> = {
    prompt: params.prompt,
  };
  if (params.referenceImageUrl) input.image_url = params.referenceImageUrl;
  if (params.aspectRatio) input.aspect_ratio = params.aspectRatio;
  if (params.duration) input.duration = params.duration;
  if (params.resolution) input.resolution = params.resolution;
  if (params.seed != null) input.seed = params.seed;
  return input;
}

async function falRequest<T>(
  url: string,
  apiKey: string,
  init: {
    method: 'GET' | 'POST';
    body?: string;
    signal?: AbortSignal;
  },
): Promise<T> {
  const response = await safeFetch(url, externalApiPolicy(), {
    method: init.method,
    headers: {
      authorization: `Key ${apiKey}`,
      'content-type': 'application/json',
    },
    body: init.body,
    timeoutMs: REQUEST_TIMEOUT_MS,
    signal: init.signal,
  });

  let body: unknown = {};
  try {
    body = JSON.parse(response.body.toString('utf8')) as unknown;
  } catch {
    body = { error: response.body.toString('utf8').slice(0, 500) };
  }

  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `upstream_error: HTTP ${response.status} ${errorMessage(body)}`,
    );
  }
  return body as T;
}

function validateFalBaseUrl(baseUrl: string) {
  const syncCheck = validateBaseUrl(baseUrl);
  if (!syncCheck.valid) {
    throw new Error(`fal.ai base URL validation failed: ${syncCheck.reason}`);
  }
  const parsed = new URL(baseUrl);
  if (parsed.protocol !== 'https:') {
    throw new Error('fal.ai base URL must use HTTPS');
  }
  const hostname = normalizeHost(parsed.hostname);
  const literalIp = classifyIp(hostname);
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    literalIp?.isPrivateOrSpecial
  ) {
    throw new Error(
      'fal.ai base URL cannot target localhost or private networks',
    );
  }
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new Error('cancelled: fal.ai request aborted by caller');
  }
}

function sleepUntilNextPoll(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('cancelled: fal.ai request aborted by caller'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('cancelled: fal.ai request aborted by caller'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function pickFalModel(
  models: string[],
  requested: string | undefined,
  pattern: RegExp,
  fallback: string,
) {
  if (requested) return stripFalModelPrefix(requested);
  const prefixedMatch = models.find(
    (model) => /^fal:/i.test(model) && pattern.test(stripFalModelPrefix(model)),
  );
  if (prefixedMatch) return stripFalModelPrefix(prefixedMatch);
  const match = models.find((model) =>
    pattern.test(stripFalModelPrefix(model)),
  );
  if (match) return stripFalModelPrefix(match);
  const prefixed = models.find((model) => /^fal:/i.test(model));
  return prefixed ? stripFalModelPrefix(prefixed) : fallback;
}

function stripFalModelPrefix(model: string) {
  return model.replace(/^fal:/i, '').replace(/^\/+/, '');
}

function normalizeFalStatus(status: string | undefined): VideoTaskStatus {
  const normalized = (status ?? '').toLowerCase();
  if (['completed', 'complete', 'succeeded', 'success'].includes(normalized)) {
    return 'succeeded';
  }
  if (['failed', 'error'].includes(normalized)) return 'failed';
  if (['cancelled', 'canceled'].includes(normalized)) return 'cancelled';
  if (['in_queue', 'queued', 'pending'].includes(normalized)) return 'queued';
  return 'running';
}

function unwrapFalBody(body: FalResultBody): FalResultBody {
  let current = body;
  for (let i = 0; i < 3; i += 1) {
    if (!current.response || typeof current.response !== 'object') break;
    current = current.response;
  }
  return current;
}

function extractImageUrls(body: FalResultBody): string[] {
  const urls: string[] = [];
  for (const image of body.images ?? []) {
    if (typeof image === 'string') urls.push(image);
    else if (image.url) urls.push(image.url);
  }
  const imageUrl = readUrl(body.image);
  if (imageUrl) urls.push(imageUrl);
  const outputUrls = readUrls(body.output);
  urls.push(...outputUrls.filter((url) => !isVideoLikeUrl(url)));
  if (body.url && !isVideoLikeUrl(body.url)) urls.push(body.url);
  return unique(urls);
}

function extractVideoUrl(body: FalResultBody): string | undefined {
  const videoUrl = readUrl(body.video);
  if (videoUrl) return videoUrl;
  const outputUrl = readUrls(body.output).find(isVideoLikeUrl);
  if (outputUrl) return outputUrl;
  const firstOutputUrl = readUrls(body.output)[0];
  if (firstOutputUrl) return firstOutputUrl;
  const resultUrl = readUrl(body.result);
  if (resultUrl && isVideoLikeUrl(resultUrl)) return resultUrl;
  if (body.url && !isImageLikeUrl(body.url)) return body.url;
  return undefined;
}

function readUrl(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const url = (value as { url?: unknown }).url;
    if (typeof url === 'string') return url;
  }
  return undefined;
}

function readUrls(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value))
    return value.filter((item): item is string => typeof item === 'string');
  const url = readUrl(value);
  return url ? [url] : [];
}

function isImageLikeUrl(url: string) {
  return /^data:image\//i.test(url) || /\.(png|jpe?g|webp)(\?|$)/i.test(url);
}

function isVideoLikeUrl(url: string) {
  return /\.(mp4|mov|webm|m4v)(\?|$)/i.test(url);
}

function usageFromMetrics(
  body: FalResultBody,
): Record<string, number> | undefined {
  const cost = body.metrics?.total_cost_usd;
  const duration = body.metrics?.duration_seconds;
  if (typeof cost !== 'number' && typeof duration !== 'number')
    return undefined;
  return {
    ...(typeof cost === 'number' ? { total_cost_usd: cost } : {}),
    ...(typeof duration === 'number' ? { duration_seconds: duration } : {}),
  };
}

function errorMessage(value: unknown) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const error = (value as { error?: unknown }).error;
    if (typeof error === 'string') return error;
    if (error && typeof error === 'object') {
      const message = (error as { message?: unknown }).message;
      if (typeof message === 'string') return message;
    }
  }
  return 'fal.ai request failed';
}

function encodeFalTaskId(model: string, requestId: string) {
  const endpoint = Buffer.from(stripFalModelPrefix(model), 'utf8').toString(
    'base64url',
  );
  return `fal:${endpoint}:${requestId}`;
}

function decodeFalTaskId(taskId: string) {
  const match = /^fal:([^:]+):(.+)$/.exec(taskId);
  if (!match) return null;
  try {
    return {
      model: Buffer.from(match[1]!, 'base64url').toString('utf8'),
      requestId: match[2]!,
    };
  } catch {
    return null;
  }
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}
