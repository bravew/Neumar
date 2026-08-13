/**
 * Google Gemini / Vertex AI Adapter
 *
 * Implements media generation using Google APIs:
 *   - Native Gemini API: POST /v1/images:generate (image), POST /v1/videos:generate (video)
 *   - OpenRouter / proxies: POST /v1/chat/completions with modalities: ["image", "text"]
 *
 * OpenRouter does NOT expose /v1/images/generations for Gemini models.
 * Instead, image generation goes through the chat completions endpoint with
 * the `modalities` parameter. See:
 *   https://openrouter.ai/docs/guides/overview/multimodal/image-generation
 *
 * Video generation is only available via native Gemini API — OpenRouter
 * does not support video output modality.
 *
 * @module media-generation/adapters/gemini
 */

import { logUsage } from '@/shared/services/usage-logger';
import {
  isNativeGeminiUrl,
  normalizeGeminiBaseUrl,
} from '@/shared/utils/gemini';
import { createLogger } from '@/shared/utils/logger';

import {
  NANO_BANANA_MODEL_PATTERN,
  isNanoBananaEnabled,
} from '../feature-flags';
import type {
  GenerateImageParams,
  GenerateVideoParams,
  ImageGenerationResult,
  MediaGenerationAdapter,
  MediaProviderConfig,
  VideoTaskCreatedResult,
  VideoTaskStatusResult,
} from '../types';

const logger = createLogger('GeminiMedia');

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_IMAGE_MODEL = 'imagen-3.0-generate-002';
const DEFAULT_VIDEO_MODEL = 'veo-3.1-generate-preview';

const IMAGE_MODEL_PATTERN = /imagen|gemini.*image/i;
const IMAGE_MODEL_PATTERN_WITH_NANO = new RegExp(
  `${IMAGE_MODEL_PATTERN.source}|${NANO_BANANA_MODEL_PATTERN.source}`,
  'i',
);
const VIDEO_MODEL_PATTERN = /veo/i;

const REQUEST_TIMEOUT_MS = 120_000;

// ============================================================================
// Helpers
// ============================================================================

function pickModel(
  models: string[],
  pattern: RegExp,
  fallback: string,
): string {
  return models.find((m) => pattern.test(m)) ?? fallback;
}

function pickImageModel(models: string[]): string {
  return pickModel(
    models,
    isNanoBananaEnabled() ? IMAGE_MODEL_PATTERN_WITH_NANO : IMAGE_MODEL_PATTERN,
    DEFAULT_IMAGE_MODEL,
  );
}

async function geminiRequest<T>(
  baseUrl: string,
  apiKey: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const base = normalizeGeminiBaseUrl(baseUrl);
  const native = isNativeGeminiUrl(base);

  // Native Gemini API: auth via query param; Proxy: auth via Bearer header
  const url = native
    ? `${base}${path}${path.includes('?') ? '&' : '?'}key=${encodeURIComponent(apiKey)}`
    : `${base}${path}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (!native) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `Gemini API error ${response.status}: ${text || response.statusText}`,
    );
  }

  return (await response.json()) as T;
}

// ============================================================================
// OpenRouter Chat Completions — Image Generation
// ============================================================================

/**
 * Response shape for OpenRouter chat completions with image output.
 *
 * Images are returned as base64 data URLs in `choices[].message.images[]`.
 * See: https://openrouter.ai/docs/guides/overview/multimodal/image-generation
 */
interface ChatCompletionImageResponse {
  choices: Array<{
    message: {
      role: string;
      content?: string;
      images?: Array<{
        image_url?: { url: string };
        // Some responses use a flat `url` field
        url?: string;
      }>;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

/**
 * Map our aspect ratio / size params to OpenRouter's image_config.
 *
 * OpenRouter supports:
 *   aspect_ratio: "1:1", "2:3", "3:2", "4:3", "16:9", "21:9" (+ extended for 3.1)
 *   image_size:   "0.5K", "1K" (default), "2K", "4K"
 */
function buildImageConfig(
  params: GenerateImageParams,
): Record<string, string> | undefined {
  const config: Record<string, string> = {};

  if (params.aspectRatio) {
    config.aspect_ratio = params.aspectRatio;
  }

  // Map size param to OpenRouter's image_size
  if (params.size) {
    const sizeUpper = params.size.toUpperCase();
    if (/^\d+(\.\d+)?K$/i.test(params.size)) {
      // Already in "2K", "4K" format
      config.image_size = sizeUpper;
    } else if (/^\d+x\d+$/i.test(params.size)) {
      // Convert WxH → approximate K size
      const [w] = params.size.split('x').map(Number);
      if (w && w >= 3840) config.image_size = '4K';
      else if (w && w >= 1920) config.image_size = '2K';
      else if (w && w >= 1024) config.image_size = '1K';
      else config.image_size = '0.5K';
    }
  }

  return Object.keys(config).length > 0 ? config : undefined;
}

/**
 * Generate (or edit) an image via OpenRouter's chat completions endpoint.
 *
 * For generation:
 *   messages: [{ role: "user", content: "prompt" }]
 *
 * For editing (referenceImageUrl provided):
 *   messages: [{ role: "user", content: [
 *     { type: "image_url", image_url: { url: "data:image/png;base64,..." } },
 *     { type: "text", text: "Change the price to $100" }
 *   ]}]
 *
 * The model sees the reference image as context and edits it rather than
 * generating from scratch, preserving visual consistency.
 *
 * See: https://openrouter.ai/docs/guides/overview/multimodal/image-generation
 */
async function generateImageViaChatCompletions(
  baseUrl: string,
  apiKey: string,
  model: string,
  params: GenerateImageParams,
): Promise<ChatCompletionImageResponse> {
  // Build user message content — multipart if reference image provided
  let userContent: string | Array<Record<string, unknown>>;

  if (params.referenceImageUrl) {
    // Image editing: send reference image + text instruction as multipart content
    userContent = [
      {
        type: 'image_url',
        image_url: { url: params.referenceImageUrl },
      },
      { type: 'text', text: params.prompt },
    ];
    logger.info(
      '✨✏️ Editing image via chat completions (reference image provided)',
    );
  } else {
    userContent = params.prompt;
  }

  const requestBody: Record<string, unknown> = {
    model,
    messages: [{ role: 'user', content: userContent }],
    modalities: ['image', 'text'],
  };

  const imageConfig = buildImageConfig(params);
  if (imageConfig) {
    requestBody.image_config = imageConfig;
  }

  return geminiRequest<ChatCompletionImageResponse>(
    baseUrl,
    apiKey,
    'POST',
    '/v1/chat/completions',
    requestBody,
  );
}

/**
 * Extract image URLs from the OpenRouter chat completions response.
 * Images are base64-encoded data URLs in PNG format.
 */
function extractImagesFromChatResponse(
  response: ChatCompletionImageResponse,
): Array<{ url: string; revisedPrompt?: string }> {
  const images: Array<{ url: string; revisedPrompt?: string }> = [];
  const textParts: string[] = [];

  for (const choice of response.choices) {
    const msg = choice.message;

    // Collect text content (may contain revised prompt or description)
    if (msg.content) {
      textParts.push(msg.content);
    }

    // Extract images from the images array
    if (msg.images && Array.isArray(msg.images)) {
      for (const img of msg.images) {
        const url = img.image_url?.url ?? img.url;
        if (url) {
          images.push({ url });
        }
      }
    }
  }

  // Attach text as revisedPrompt to the first image (if any)
  if (images.length > 0 && textParts.length > 0) {
    images[0]!.revisedPrompt = textParts.join('\n');
  }

  return images;
}

// ============================================================================
// Adapter
// ============================================================================

export class GeminiAdapter implements MediaGenerationAdapter {
  readonly name = 'Google Gemini';
  readonly supportsImage = true;
  /** Video generation is only available via native Gemini API */
  readonly supportsVideo: boolean;

  constructor(private readonly config: MediaProviderConfig) {
    this.supportsVideo = isNativeGeminiUrl(
      normalizeGeminiBaseUrl(config.baseUrl),
    );
  }

  // ---------- Image Generation ----------

  async generateImage(
    params: GenerateImageParams,
  ): Promise<ImageGenerationResult> {
    const model = pickImageModel(this.config.models);

    const native = isNativeGeminiUrl(
      normalizeGeminiBaseUrl(this.config.baseUrl),
    );
    logger.info(
      `✨🎨 Generating image with model=${model} (${native ? 'native' : 'chat-completions'})`,
    );
    const genStart = Date.now();

    try {
      if (native) {
        return await this.generateImageNative(model, params, genStart);
      }
      return await this.generateImageViaProxy(model, params, genStart);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      // Truncate to avoid logging full HTML error pages from upstream APIs
      const truncated =
        errMsg.length > 300 ? errMsg.slice(0, 300) + '... (truncated)' : errMsg;
      logger.error('✨❌ Image generation failed:', truncated);
      return {
        success: false,
        provider: this.name,
        model,
        images: [],
        error: truncated,
      };
    }
  }

  /**
   * Native Gemini API — uses /v1/images:generate (Vertex AI format).
   */
  private async generateImageNative(
    model: string,
    params: GenerateImageParams,
    genStart: number,
  ): Promise<ImageGenerationResult> {
    const requestBody: Record<string, unknown> = {
      model,
      prompt: params.prompt,
      n: params.count ?? 1,
      response_format: 'url',
    };

    if (params.size) {
      requestBody.size = params.size;
    }
    if (params.seed != null) {
      requestBody.seed = params.seed;
    }
    // Image-to-image editing: pass reference image
    if (params.referenceImageUrl) {
      requestBody.image = params.referenceImageUrl;
    }

    const data = await geminiRequest<{
      data: Array<{
        url?: string;
        b64_json?: string;
        revised_prompt?: string;
      }>;
    }>(
      this.config.baseUrl,
      this.config.apiKey,
      'POST',
      '/v1/images/generations',
      requestBody,
    );

    const images = (data.data ?? []).map((img) => ({
      url: img.url
        ? img.url
        : img.b64_json
          ? `data:image/png;base64,${img.b64_json}`
          : '',
      revisedPrompt: img.revised_prompt,
    }));

    logUsage({
      callType: 'image',
      provider: 'google',
      model,
      unitType: 'image',
      unitCount: images.length,
      latencyMs: Date.now() - genStart,
    });

    return {
      success: true,
      provider: this.name,
      model,
      images,
      seed: params.seed,
    };
  }

  /**
   * Proxy path (OpenRouter, etc.) — uses /v1/chat/completions with modalities.
   *
   * OpenRouter returns images as base64 data URLs in the response message.
   * See: https://openrouter.ai/docs/guides/overview/multimodal/image-generation
   */
  private async generateImageViaProxy(
    model: string,
    params: GenerateImageParams,
    genStart: number,
  ): Promise<ImageGenerationResult> {
    const response = await generateImageViaChatCompletions(
      this.config.baseUrl,
      this.config.apiKey,
      model,
      params,
    );

    const images = extractImagesFromChatResponse(response);

    if (images.length === 0) {
      // The model responded but didn't produce an image
      const textContent = response.choices?.[0]?.message?.content ?? '';
      const preview =
        textContent.length > 200
          ? textContent.slice(0, 200) + '...'
          : textContent;
      throw new Error(
        `Model responded but no image was generated. Response: ${preview}`,
      );
    }

    logUsage({
      callType: 'image',
      provider: 'google',
      model,
      unitType: 'image',
      unitCount: images.length,
      latencyMs: Date.now() - genStart,
    });

    return {
      success: true,
      provider: this.name,
      model,
      images,
      seed: params.seed,
    };
  }

  // ---------- Video Generation ----------
  // Only available via native Gemini API. OpenRouter does not support
  // video output modality.

  async createVideoTask(
    params: GenerateVideoParams,
  ): Promise<VideoTaskCreatedResult> {
    if (!isNativeGeminiUrl(normalizeGeminiBaseUrl(this.config.baseUrl))) {
      return {
        success: false,
        provider: this.name,
        model: 'none',
        taskId: '',
        error:
          'Video generation is not supported via OpenRouter or proxies. ' +
          'Configure a native Google Gemini API provider (generativelanguage.googleapis.com) for video generation.',
      };
    }

    const model = pickModel(
      this.config.models,
      VIDEO_MODEL_PATTERN,
      DEFAULT_VIDEO_MODEL,
    );

    logger.info(`✨🎬 Creating video task with model=${model}`);

    try {
      const requestBody: Record<string, unknown> = {
        model,
        prompt: params.prompt,
      };

      if (params.aspectRatio) requestBody.aspect_ratio = params.aspectRatio;
      if (params.duration) requestBody.duration = params.duration;

      // Veo supports seed for deterministic generation (uint32, 0-4294967295)
      if (params.seed != null) {
        requestBody.seed = params.seed;
      }

      const data = await geminiRequest<{ id: string }>(
        this.config.baseUrl,
        this.config.apiKey,
        'POST',
        '/v1/videos/generations',
        requestBody,
      );

      return {
        success: true,
        provider: this.name,
        model,
        taskId: data.id,
        seed: params.seed,
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      const truncated =
        errMsg.length > 300 ? errMsg.slice(0, 300) + '... (truncated)' : errMsg;
      logger.error('✨❌ Video task creation failed:', truncated);
      return {
        success: false,
        provider: this.name,
        model,
        taskId: '',
        error: truncated,
      };
    }
  }

  async getVideoTaskStatus(taskId: string): Promise<VideoTaskStatusResult> {
    if (!isNativeGeminiUrl(normalizeGeminiBaseUrl(this.config.baseUrl))) {
      return {
        success: false,
        provider: this.name,
        taskId,
        status: 'failed',
        error: 'Video task polling is not supported via OpenRouter or proxies.',
      };
    }

    try {
      const data = await geminiRequest<{
        id: string;
        status: string;
        video_url?: string;
        error?: { message?: string };
      }>(
        this.config.baseUrl,
        this.config.apiKey,
        'GET',
        `/v1/videos/generations/${encodeURIComponent(taskId)}`,
      );

      const statusMap: Record<string, VideoTaskStatusResult['status']> = {
        QUEUED: 'queued',
        PROCESSING: 'running',
        SUCCEEDED: 'succeeded',
        FAILED: 'failed',
      };

      return {
        success: true,
        provider: this.name,
        taskId,
        status: statusMap[data.status] ?? 'running',
        videoUrl: data.video_url,
        error: data.error?.message,
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      const truncated =
        errMsg.length > 300 ? errMsg.slice(0, 300) + '... (truncated)' : errMsg;
      logger.error('✨❌ Video status check failed:', truncated);
      return {
        success: false,
        provider: this.name,
        taskId,
        status: 'failed',
        error: truncated,
      };
    }
  }
}
