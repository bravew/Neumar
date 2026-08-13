/**
 * Hedra Avatar Adapter
 *
 * Implements image + audio lipsync generation against Hedra's public API.
 * The API is task-based: upload/create input assets, create a generation,
 * then poll the generation status until a video asset URL is available.
 *
 * Docs:
 *   https://www.hedra.com/docs/pages/developer/guides/generate-avatar-video
 */

import { randomUUID } from 'node:crypto';

import type {
  GenerateImageParams,
  ImageGenerationResult,
  LipsyncParams,
  MediaGenerationAdapter,
  MediaProviderConfig,
  VideoTaskCreatedResult,
  VideoTaskStatusResult,
} from '../types';

const DEFAULT_BASE_URL = 'https://api.hedra.com/web-app/public';
const DEFAULT_MODEL = 'hedra-character-3';
const REQUEST_TIMEOUT_MS = 120_000;

type HedraAssetType = 'image' | 'audio';

interface HedraAssetResponse {
  id?: string;
  asset_id?: string;
  url?: string;
  download_url?: string;
  asset?: HedraAssetResponse;
  data?: HedraAssetResponse | HedraAssetResponse[];
  assets?: HedraAssetResponse[];
}

interface HedraGenerationResponse {
  id?: string;
  generation_id?: string;
  status?: string;
  asset_id?: string;
  video_url?: string;
  url?: string;
  error?: string | { message?: string; code?: string };
  data?: HedraGenerationResponse;
}

export class HedraAdapter implements MediaGenerationAdapter {
  readonly name = 'Hedra';
  readonly supportsImage = false;
  readonly supportsImageEdit = false;
  readonly supportsVideo = true;
  readonly supportsLipsync = true;

  private readonly baseUrl: string;
  private readonly model: string;

  constructor(private readonly config: MediaProviderConfig) {
    this.baseUrl = normalizeBaseUrl(config.baseUrl || DEFAULT_BASE_URL);
    this.model =
      config.models.find((model) => /character|hedra/i.test(model)) ??
      DEFAULT_MODEL;
  }

  async generateImage(
    _params: GenerateImageParams,
  ): Promise<ImageGenerationResult> {
    return {
      success: false,
      provider: this.name,
      providerId: this.config.id,
      model: this.model,
      images: [],
      error: 'Hedra supports avatar video generation, not still images.',
    };
  }

  async createLipsyncTask(
    params: LipsyncParams,
    signal?: AbortSignal,
  ): Promise<VideoTaskCreatedResult> {
    try {
      const [imageAssetId, audioAssetId] = await Promise.all([
        this.createAsset('image', params.imageUrl, signal),
        this.createAudioAsset(params.audio, signal),
      ]);
      const generation = await this.request<HedraGenerationResponse>(
        '/generations',
        {
          method: 'POST',
          body: JSON.stringify({
            type: 'video',
            ai_model_id: this.model,
            start_keyframe_id: imageAssetId,
            audio_id: audioAssetId,
            text_prompt: params.text ?? '',
            aspect_ratio: params.aspectRatio,
            motion_scale: params.motionScale,
            background: params.background
              ? normalizeBackground(params.background)
              : undefined,
          }),
        },
        signal,
      );
      const taskId =
        generation.id ?? generation.generation_id ?? generation.data?.id;
      if (!taskId) {
        return this.failureCreated('Hedra did not return a generation id');
      }
      return {
        success: true,
        provider: this.name,
        providerId: this.config.id,
        model: this.model,
        taskId,
      };
    } catch (error) {
      return this.failureCreated(formatHedraError(error));
    }
  }

  async getVideoTaskStatus(
    taskId: string,
    signal?: AbortSignal,
  ): Promise<VideoTaskStatusResult> {
    try {
      const status = await this.request<HedraGenerationResponse>(
        `/generations/${encodeURIComponent(taskId)}/status`,
        undefined,
        signal,
      );
      const payload = status.data ?? status;
      const normalized = normalizeStatus(payload.status);
      const videoUrl =
        payload.video_url ??
        payload.url ??
        (payload.asset_id
          ? await this.resolveAssetUrl(payload.asset_id, signal)
          : undefined);
      return {
        success: normalized !== 'failed',
        provider: this.name,
        providerId: this.config.id,
        taskId,
        status: normalized,
        videoUrl,
        error:
          normalized === 'failed'
            ? formatProviderError(payload.error) || 'Hedra generation failed'
            : undefined,
        model: this.model,
      };
    } catch (error) {
      return {
        success: false,
        provider: this.name,
        providerId: this.config.id,
        taskId,
        status: 'failed',
        error: formatHedraError(error),
        model: this.model,
      };
    }
  }

  private async createAsset(
    type: HedraAssetType,
    dataUriOrUrl: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const response = await this.request<HedraAssetResponse>(
      '/assets',
      {
        method: 'POST',
        body: JSON.stringify({
          type,
          name: `${type}-${randomUUID()}`,
          data: dataUriOrUrl,
          url: dataUriOrUrl.startsWith('http') ? dataUriOrUrl : undefined,
        }),
      },
      signal,
    );
    const id = assetIdFromResponse(response);
    if (!id) throw new Error(`Hedra did not return a ${type} asset id`);
    return id;
  }

  private async createAudioAsset(
    audio: LipsyncParams['audio'],
    signal?: AbortSignal,
  ): Promise<string> {
    if ('url' in audio) return this.createAsset('audio', audio.url, signal);
    return this.createAsset(
      'audio',
      `data:audio/wav;base64,${audio.base64}`,
      signal,
    );
  }

  private async resolveAssetUrl(
    assetId: string,
    signal?: AbortSignal,
  ): Promise<string | undefined> {
    const response = await this.request<HedraAssetResponse>(
      `/assets?ids=${encodeURIComponent(assetId)}`,
      undefined,
      signal,
    );
    const assets = Array.isArray(response.data)
      ? response.data
      : response.assets;
    const asset =
      assets?.find((entry) => assetIdFromResponse(entry) === assetId) ??
      response.asset ??
      response;
    return asset.download_url ?? asset.url;
  }

  private async request<T>(
    path: string,
    init: RequestInit = {},
    signal?: AbortSignal,
  ): Promise<T> {
    const requestSignal = createRequestSignal(signal, REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: requestSignal.signal,
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.config.apiKey,
          authorization: `Bearer ${this.config.apiKey}`,
          ...(init.headers ?? {}),
        },
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status}: ${text || response.statusText}`,
        );
      }
      if (!text) return {} as T;
      return JSON.parse(text) as T;
    } finally {
      requestSignal.cleanup();
    }
  }

  private failureCreated(error: string): VideoTaskCreatedResult {
    return {
      success: false,
      provider: this.name,
      providerId: this.config.id,
      model: this.model,
      taskId: '',
      error,
    };
  }
}

function createRequestSignal(
  parentSignal: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const abortFromParent = () => controller.abort(parentSignal?.reason);

  if (parentSignal?.aborted) {
    controller.abort(parentSignal.reason);
  } else {
    parentSignal?.addEventListener('abort', abortFromParent, { once: true });
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout);
      parentSignal?.removeEventListener('abort', abortFromParent);
    },
  };
}

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = (baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
  if (trimmed.endsWith('/web-app/public')) return trimmed;
  if (trimmed.includes('api.hedra.com')) return `${trimmed}/web-app/public`;
  return trimmed;
}

function assetIdFromResponse(response: HedraAssetResponse): string | undefined {
  return (
    response.id ??
    response.asset_id ??
    response.asset?.id ??
    response.asset?.asset_id ??
    (Array.isArray(response.data) ? response.data[0]?.id : response.data?.id)
  );
}

function normalizeStatus(
  status: string | undefined,
): VideoTaskStatusResult['status'] {
  const lower = status?.toLowerCase();
  if (lower === 'complete' || lower === 'completed' || lower === 'succeeded') {
    return 'succeeded';
  }
  if (lower === 'failed' || lower === 'error') return 'failed';
  if (lower === 'cancelled' || lower === 'canceled') return 'cancelled';
  if (lower === 'queued' || lower === 'pending') return 'queued';
  return 'running';
}

function normalizeBackground(background: LipsyncParams['background']): unknown {
  if (!background) return undefined;
  if (background.kind === 'transparent') return { type: 'transparent' };
  if (background.kind === 'color') {
    return { type: 'color', color: background.color ?? '#000000' };
  }
  if (background.kind === 'image') {
    return { type: 'image', image_url: background.imageUrl };
  }
  return undefined;
}

function formatProviderError(
  error: HedraGenerationResponse['error'],
): string | undefined {
  if (!error) return undefined;
  if (typeof error === 'string') return error;
  const code = error.code ? `${error.code}: ` : '';
  return `${code}${error.message ?? 'provider rejected the request'}`;
}

function formatHedraError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
