/**
 * OpenAI Adapter
 *
 * Implements media generation using OpenAI APIs:
 *   - DALL-E 3 / GPT-Image (image generation):  POST /v1/images/generations
 *   - Sora (video generation):  POST /v1/videos/generations (when available)
 *
 * API Reference:
 *   Image — https://platform.openai.com/docs/api-reference/images/create
 *
 * @module media-generation/adapters/openai
 */

import { safeFetch } from '@/shared/network-policy/fetch';
import { trustedLocalPolicy } from '@/shared/network-policy/schema';
import { logUsage } from '@/shared/services/usage-logger';
import { createLogger } from '@/shared/utils/logger';
import { validateBaseUrlForFetch } from '@/shared/utils/url-validator';

import type {
  GenerateImageParams,
  GenerateVideoParams,
  ImageGenerationResult,
  MediaGenerationAdapter,
  MediaProviderConfig,
  VideoTaskCreatedResult,
  VideoTaskStatusResult,
} from '../types';

const logger = createLogger('OpenAIMedia');

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_IMAGE_MODEL = 'dall-e-3';
/**
 * Default model for /v1/images/edits. DALL-E 3 cannot edit; only gpt-image-1
 * and dall-e-2 expose the edits endpoint. gpt-image-1 is preferred (better
 * fidelity, larger sizes, mask alpha respected).
 */
const DEFAULT_EDIT_MODEL = 'gpt-image-1';
const DEFAULT_VIDEO_MODEL = 'sora';

const IMAGE_MODEL_PATTERN = /dall-e|gpt-image|chatgpt-image/i;
/** Models that the /v1/images/edits endpoint will accept. */
const EDIT_MODEL_PATTERN = /gpt-image|dall-e-2/i;
const VIDEO_MODEL_PATTERN = /sora/i;

const REFERENCE_IMAGE_FETCH_TIMEOUT_MS = 30_000;
const REQUEST_TIMEOUT_MS = 5 * 60_000;

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

/**
 * Resolve a reference value (https URL or data: URI) into a Blob suitable for
 * multipart upload to /v1/images/edits.
 *
 * Local file paths are pre-converted to data: URIs by media-server.ts's
 * `resolveReferenceImage` before reaching the adapter, so this helper only
 * needs to handle https + data.
 */
async function loadImageAsBlob(
  ref: string,
  fallbackName: string,
): Promise<{
  blob: Blob;
  filename: string;
  mime: string;
  bytes: Buffer;
  info?: ImageInfo;
}> {
  if (ref.startsWith('data:')) {
    const match = /^data:([^;,]+)(?:;base64)?,(.*)$/i.exec(ref);
    if (!match) {
      throw new Error(
        'Invalid data: URI for reference image — expected "data:<mime>;base64,<payload>"',
      );
    }
    const mime = match[1] ?? 'image/png';
    const payload = match[2] ?? '';
    const isBase64 = /;base64/i.test(ref);
    const buf = isBase64
      ? Buffer.from(payload, 'base64')
      : Buffer.from(decodeURIComponent(payload), 'utf-8');
    const ext = mime.includes('jpeg')
      ? 'jpg'
      : mime.includes('webp')
        ? 'webp'
        : 'png';
    const info = readImageInfo(buf, mime);
    return {
      blob: new Blob([new Uint8Array(buf)], { type: mime }),
      filename: `${fallbackName}.${ext}`,
      mime,
      bytes: buf,
      info,
    };
  }

  if (ref.startsWith('https://')) {
    const check = await validateBaseUrlForFetch(ref);
    if (!check.valid) {
      throw new Error(
        `Refusing to fetch reference image: ${check.reason ?? 'blocked URL'}`,
      );
    }
    const res = await safeFetch(ref, trustedLocalPolicy(), {
      timeoutMs: REFERENCE_IMAGE_FETCH_TIMEOUT_MS,
    });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(
        `Failed to fetch reference image (${res.status}): ${ref.slice(0, 120)}`,
      );
    }
    const ct = res.headers['content-type']?.split(';')[0]?.trim();
    const mime = ct && ct.startsWith('image/') ? ct : 'image/png';
    const buf = res.body;
    const ext = mime.includes('jpeg')
      ? 'jpg'
      : mime.includes('webp')
        ? 'webp'
        : 'png';
    const info = readImageInfo(buf, mime);
    return {
      blob: new Blob([new Uint8Array(buf)], { type: mime }),
      filename: `${fallbackName}.${ext}`,
      mime,
      bytes: buf,
      info,
    };
  }

  throw new Error(
    'Reference image must be an https:// URL or data: URI by the time it reaches the adapter.',
  );
}

interface ImageInfo {
  format: 'png' | 'jpeg' | 'webp';
  width: number;
  height: number;
  hasAlpha?: boolean;
}

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

function readImageInfo(bytes: Buffer, mime: string): ImageInfo | undefined {
  if (
    bytes.length >= 33 &&
    bytes.subarray(0, 8).equals(PNG_SIGNATURE) &&
    bytes.toString('ascii', 12, 16) === 'IHDR'
  ) {
    const colorType = bytes[25];
    return {
      format: 'png',
      width: bytes.readUInt32BE(16),
      height: bytes.readUInt32BE(20),
      hasAlpha: colorType === 4 || colorType === 6 || hasPngTransparency(bytes),
    };
  }

  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    const info = readJpegInfo(bytes);
    if (info) return info;
  }

  if (
    bytes.length >= 30 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  ) {
    const info = readWebpInfo(bytes);
    if (info) return info;
  }

  logger.debug('Unable to read image dimensions from bytes', {
    mime,
    bytes: bytes.length,
  });
  return undefined;
}

function hasPngTransparency(bytes: Buffer): boolean {
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (type === 'tRNS') return true;
    offset += 12 + length;
  }
  return false;
}

function readJpegInfo(bytes: Buffer): ImageInfo | undefined {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1]!;
    offset += 2;
    if (marker === 0xda || marker === 0xd9) break;
    if (offset + 2 > bytes.length) break;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) break;

    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      return {
        format: 'jpeg',
        height: bytes.readUInt16BE(offset + 3),
        width: bytes.readUInt16BE(offset + 5),
        hasAlpha: false,
      };
    }
    offset += length;
  }
  return undefined;
}

function readUint24LE(bytes: Buffer, offset: number): number {
  return (
    bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16)
  );
}

function readWebpInfo(bytes: Buffer): ImageInfo | undefined {
  const chunkType = bytes.toString('ascii', 12, 16);
  if (chunkType === 'VP8X' && bytes.length >= 30) {
    const flags = bytes[20] ?? 0;
    return {
      format: 'webp',
      width: readUint24LE(bytes, 24) + 1,
      height: readUint24LE(bytes, 27) + 1,
      hasAlpha: (flags & 0x10) !== 0,
    };
  }

  if (chunkType === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) {
    const b0 = bytes[21]!;
    const b1 = bytes[22]!;
    const b2 = bytes[23]!;
    const b3 = bytes[24]!;
    return {
      format: 'webp',
      width: 1 + b0 + ((b1 & 0x3f) << 8),
      height: 1 + ((b1 & 0xc0) >> 6) + (b2 << 2) + ((b3 & 0x0f) << 10),
    };
  }

  if (chunkType === 'VP8 ' && bytes.length >= 30) {
    return {
      format: 'webp',
      width: bytes.readUInt16LE(26) & 0x3fff,
      height: bytes.readUInt16LE(28) & 0x3fff,
      hasAlpha: false,
    };
  }

  return undefined;
}

function assertSameDimensions(reference: ImageInfo, mask: ImageInfo): void {
  if (reference.width !== mask.width || reference.height !== mask.height) {
    throw new Error(
      `Mask dimensions (${mask.width}x${mask.height}) must match reference image dimensions (${reference.width}x${reference.height}).`,
    );
  }
}

async function openaiRequest<T>(
  baseUrl: string,
  apiKey: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const url = `${baseUrl.replace(/\/+$/, '')}${path}`;

  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    redirect: 'error',
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `OpenAI API error ${response.status}: ${text || response.statusText}`,
    );
  }

  return (await response.json()) as T;
}

// ============================================================================
// Response Types
// ============================================================================

interface OpenAIImageResponse {
  created: number;
  data: Array<{
    url?: string;
    b64_json?: string;
    revised_prompt?: string;
  }>;
}

// ============================================================================
// Adapter
// ============================================================================

export class OpenAIAdapter implements MediaGenerationAdapter {
  readonly name = 'OpenAI';
  readonly supportsImage = true;
  /** Sora API availability may vary; set to true when the endpoint is live */
  readonly supportsVideo = true;

  constructor(private readonly config: MediaProviderConfig) {}

  // ---------- Image Generation ----------

  async generateImage(
    params: GenerateImageParams,
  ): Promise<ImageGenerationResult> {
    // Edit / inpaint path — /v1/images/edits requires multipart and a model
    // that supports edits (gpt-image-1 or dall-e-2). DALL-E 3 cannot edit.
    if (params.referenceImageUrl) {
      return this.editImage(params);
    }

    const model = pickModel(
      this.config.models,
      IMAGE_MODEL_PATTERN,
      DEFAULT_IMAGE_MODEL,
    );

    logger.info(`Generating image with model=${model}`);
    const genStart = Date.now();

    try {
      const requestBody: Record<string, unknown> = {
        model,
        prompt: params.prompt,
        n: params.count ?? 1,
        response_format: 'url',
      };

      // Size: DALL-E 3 accepts "1024x1024", "1792x1024", "1024x1792"
      if (params.size) {
        requestBody.size = params.size;
      } else {
        requestBody.size = '1024x1024';
      }

      if (params.quality) {
        requestBody.quality = params.quality;
      }

      // Seed for reproducible generation (GPT-Image supports seed)
      if (params.seed != null) {
        requestBody.seed = params.seed;
      }

      const data = await openaiRequest<OpenAIImageResponse>(
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
        provider: 'openai',
        model,
        unitType: 'image',
        unitCount: images.length,
        unitCostMicro: 40_000, // $0.04/image default
        latencyMs: Date.now() - genStart,
      });

      return {
        success: true,
        provider: this.name,
        model,
        images,
        seed: params.seed,
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      const truncated =
        errMsg.length > 300 ? errMsg.slice(0, 300) + '... (truncated)' : errMsg;
      logger.error('Image generation failed:', truncated);
      return {
        success: false,
        provider: this.name,
        model,
        images: [],
        error: truncated,
      };
    }
  }

  // ---------- Image Edit / Inpaint ----------
  // Routed through /v1/images/edits whenever a reference image is provided.
  // gpt-image-1 supports both image-to-image edits and mask-based inpainting
  // (transparent pixels in `mask` mark the region to regenerate). DALL-E 2 is
  // accepted as a fallback. DALL-E 3 cannot edit.

  private async editImage(
    params: GenerateImageParams,
  ): Promise<ImageGenerationResult> {
    if (!params.referenceImageUrl) {
      // Defensive — should never happen because generateImage gates on this.
      throw new Error('editImage called without referenceImageUrl');
    }

    // Pick an edit-capable model. Prefer one already configured by the user
    // that matches EDIT_MODEL_PATTERN; otherwise fall back to gpt-image-1.
    const model = pickModel(
      this.config.models,
      EDIT_MODEL_PATTERN,
      DEFAULT_EDIT_MODEL,
    );

    logger.info(
      `Editing image with model=${model}${params.maskImageUrl ? ' (mask provided — inpaint)' : ' (image-to-image)'}`,
    );
    const genStart = Date.now();

    try {
      const form = new FormData();
      form.append('model', model);
      form.append('prompt', params.prompt);
      form.append('n', String(params.count ?? 1));

      // Size handling differs per edit model:
      //   gpt-image-1 → 1024x1024 | 1024x1536 | 1536x1024 | auto
      //   dall-e-2    → 256x256 | 512x512 | 1024x1024
      // We pass through whatever the caller specified; OpenAI rejects
      // invalid combinations with a clear 400 we already surface.
      if (params.size) {
        form.append('size', params.size);
      }
      if (params.quality && /gpt-image/i.test(model)) {
        form.append('quality', params.quality);
      }

      const [refImage, mask] = await Promise.all([
        loadImageAsBlob(params.referenceImageUrl, 'reference'),
        params.maskImageUrl
          ? loadImageAsBlob(params.maskImageUrl, 'mask')
          : Promise.resolve(null),
      ]);
      form.append('image', refImage.blob, refImage.filename);

      if (mask) {
        // OpenAI requires the mask to be a PNG with alpha. Hard-block any
        // non-PNG mime so we fail fast with a clear error rather than 400ing
        // halfway through the upload.
        if (!mask.blob.type.includes('png')) {
          throw new Error(
            `Mask must be a PNG with alpha channel; received ${mask.blob.type}`,
          );
        }
        if (!mask.info) {
          throw new Error(
            'Mask dimensions could not be read. Provide a valid PNG mask with an alpha channel.',
          );
        }
        if (!mask.info.hasAlpha) {
          throw new Error(
            'Mask must contain an alpha channel. Transparent pixels mark the area to regenerate.',
          );
        }
        if (!refImage.info) {
          throw new Error(
            'Reference image dimensions could not be read. Provide a valid PNG, JPEG, or WebP reference image.',
          );
        }
        assertSameDimensions(refImage.info, mask.info);
        form.append('mask', mask.blob, 'mask.png');
      }

      const url = `${this.config.baseUrl.replace(/\/+$/, '')}/v1/images/edits`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.config.apiKey}` },
        body: form,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        redirect: 'error',
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(
          `OpenAI API error ${response.status}: ${text || response.statusText}`,
        );
      }

      const data = (await response.json()) as OpenAIImageResponse;

      // gpt-image-1 always returns b64_json (no response_format param);
      // dall-e-2 returns url unless overridden. Handle both.
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
        provider: 'openai',
        model,
        unitType: 'image',
        unitCount: images.length,
        // gpt-image-1 edit pricing is roughly the same per-tile as generation;
        // exact cost is reported by usage.* in the response when available.
        unitCostMicro: 40_000,
        latencyMs: Date.now() - genStart,
      });

      return {
        success: true,
        provider: this.name,
        model,
        images,
        seed: params.seed,
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      const truncated =
        errMsg.length > 300 ? errMsg.slice(0, 300) + '... (truncated)' : errMsg;
      logger.error('Image edit failed:', truncated);
      return {
        success: false,
        provider: this.name,
        model,
        images: [],
        error: truncated,
      };
    }
  }

  // ---------- Video Generation ----------
  // Sora / GPT video API — async task-based (similar to BytePlus)

  async createVideoTask(
    params: GenerateVideoParams,
  ): Promise<VideoTaskCreatedResult> {
    const model = pickModel(
      this.config.models,
      VIDEO_MODEL_PATTERN,
      DEFAULT_VIDEO_MODEL,
    );

    logger.info(`Creating video task with model=${model}`);

    try {
      const requestBody: Record<string, unknown> = {
        model,
        prompt: params.prompt,
      };

      if (params.aspectRatio) requestBody.aspect_ratio = params.aspectRatio;
      if (params.duration) requestBody.duration = params.duration;
      if (params.resolution) requestBody.resolution = params.resolution;
      if (params.seed != null) requestBody.seed = params.seed;

      const data = await openaiRequest<{ id: string }>(
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
      logger.error('Video task creation failed:', truncated);
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
    try {
      const data = await openaiRequest<{
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
        queued: 'queued',
        in_progress: 'running',
        completed: 'succeeded',
        failed: 'failed',
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
      logger.error('Video status check failed:', truncated);
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
