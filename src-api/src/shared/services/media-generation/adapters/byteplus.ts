/**
 * BytePlus ModelArk Adapter
 *
 * Implements media generation using BytePlus ModelArk APIs:
 *   - Seedream (image generation):  POST /api/v3/images/generations
 *   - Seedance (video generation):  POST /api/v3/contents/generations/tasks
 *                                   GET  /api/v3/contents/generations/tasks/{id}
 *
 * API Reference:
 *   Image — https://docs.byteplus.com/en/docs/ModelArk/1541523
 *   Video — https://docs.byteplus.com/en/docs/ModelArk/1520757
 *           https://docs.byteplus.com/en/docs/ModelArk/1521309
 *
 * @module media-generation/adapters/byteplus
 */

import { logUsage } from '@/shared/services/usage-logger';
import { createLogger } from '@/shared/utils/logger';
import { sleep } from '@/shared/utils/sleep';

import type {
  GenerateImageParams,
  GenerateVideoParams,
  ImageGenerationResult,
  LipsyncParams,
  MediaGenerationAdapter,
  MediaProviderConfig,
  VideoTaskCreatedResult,
  VideoTaskStatusResult,
} from '../types';

const logger = createLogger('BytePlusMedia');

// ============================================================================
// Constants
// ============================================================================

/** Default image model when none is found in provider config — Seedream 5. */
const DEFAULT_IMAGE_MODEL = 'seedream-5-0-260128';
/** Default video model when none is found in provider config — Seedance 2.0 fast. */
const DEFAULT_VIDEO_MODEL = 'dreamina-seedance-2-0-fast-260128';
const DEFAULT_OMNIHUMAN_MODEL = 'omnihuman-v1-5';

/** Patterns to identify image-generation models (both generation and editing) */
const IMAGE_MODEL_PATTERN = /seedream|seededit/i;
/** Pattern to identify editing-specific models (SeedEdit) */
const EDIT_MODEL_PATTERN = /seededit/i;
/** Patterns to identify video-generation models */
const VIDEO_MODEL_PATTERN = /seedance/i;
const OMNIHUMAN_MODEL_PATTERN = /omnihuman/i;
/** Pattern to identify Seedance 2.0 / 2.0-fast (incl. `dreamina-seedance-2-0-*`). */
const SEEDANCE_V2_PATTERN = /seedance-2/i;
/** Pattern to identify Seedance 2.0-fast (resolution-limited variant). */
const SEEDANCE_V2_FAST_PATTERN = /seedance-2-0-fast/i;

/**
 * BytePlus API requires exact model IDs with date suffixes (e.g., seedance-1-5-pro-251215).
 * Users may have older configs with short names (e.g., seedance-1-5-pro).
 * This map normalises known short names → full API model IDs.
 */
const MODEL_ALIAS_MAP: Record<string, string> = {
  'seedance-1-5-pro': 'seedance-1-5-pro-251215',
  'seedance-2-0': 'dreamina-seedance-2-0-260128',
  'seedance-2-0-fast': 'dreamina-seedance-2-0-fast-260128',
  'seedream-5-0': 'seedream-5-0-260128',
  'seedream-5-0-lite': 'seedream-5-0-lite-260128',
  'seedream-4-5': 'seedream-4-5-251128',
};

/** Seedance 2.0 duration bounds (seconds) — per BytePlus docs. */
const SEEDANCE_V2_MIN_DURATION = 4;
const SEEDANCE_V2_MAX_DURATION = 15;
/**
 * Seedance 2.0 supported output resolutions — per BytePlus docs.
 * 2.0 (non-fast) also accepts `1080p`; 2.0-fast is capped at 720p.
 */
const SEEDANCE_V2_ALLOWED_RESOLUTIONS = new Set(['480p', '720p', '1080p']);
const SEEDANCE_V2_FAST_ALLOWED_RESOLUTIONS = new Set(['480p', '720p']);
/** Seedance 2.0 prompt length cap — per the official prompt guide. */
const SEEDANCE_V2_MAX_PROMPT_LEN = 2000;

/**
 * Conform a prompt to the Seedance 2.0 prompt guide.
 *
 * The guide recommends the cinematic formula "Action + Scene + Style + Camera"
 * and — for multimodal inputs — referring to assets by lowercase 1-based
 * position ("image 1", "video 1"). We do NOT rewrite the caller's prompt —
 * already crafted it); we only:
 *   - Append a concise anchoring hint when frame tagging is ambiguous and the
 *     caller hasn't already spelled it out. Narrow, additive edits only.
 *   - Clamp to the documented 2000-character limit.
 *
 * See: https://docs.byteplus.com/en/docs/ModelArk/2222480
 */
function buildSeedanceV2Prompt(
  prompt: string,
  ctx: {
    hasBothFrames: boolean;
    hasReferenceOnly: boolean;
  },
): string {
  const trimmed = prompt.trim();
  const lower = trimmed.toLowerCase();

  const mentionsFrameAnchoring =
    lower.includes('first frame') ||
    lower.includes('last frame') ||
    lower.includes('first_frame') ||
    lower.includes('last_frame') ||
    lower.includes('image 1') ||
    lower.includes('image 2');

  const mentionsReference =
    lower.includes('reference image') ||
    lower.includes('image 1') ||
    lower.includes('@image');

  let hint = '';
  if (ctx.hasBothFrames && !mentionsFrameAnchoring) {
    hint =
      ' The shot begins exactly on image 1 (first frame) and ends exactly on image 2 (last frame); motion is the smooth transition between them.';
  } else if (ctx.hasReferenceOnly && !mentionsReference) {
    hint =
      ' Preserve the visual identity and style of image 1; describe motion only, not static content already visible in it.';
  }

  // Truncate the caller's prompt BEFORE appending the hint so the hint is never
  // split mid-sentence when the combined string exceeds the 2000-char cap.
  const maxSourceLen = SEEDANCE_V2_MAX_PROMPT_LEN - hint.length;
  let out = trimmed;
  if (out.length > maxSourceLen) {
    logger.warn(
      `🎬 Seedance 2.0 prompt exceeds ${maxSourceLen} chars (${out.length}); truncating before hint.`,
    );
    out = out.slice(0, maxSourceLen);
  }

  return out + hint;
}

/** Max time to wait for a single HTTP request (ms) */
const REQUEST_TIMEOUT_MS = 120_000;

/**
 * Known API path prefixes that may already be included in the base URL.
 * When detected, we strip them so the adapter can always use full absolute paths.
 */
const API_PATH_PREFIX = '/api/v3';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Pick the best matching model from the provider's model list.
 * Prefers the **last** match because model lists are typically ordered
 * from oldest/basic to newest/best (e.g., seedance-1-0-lite → seedance-1-5-pro).
 * Falls back to the default if no model matches.
 *
 * Applies MODEL_ALIAS_MAP to normalise short names → full API model IDs.
 */
function pickModel(
  models: string[],
  pattern: RegExp,
  fallback: string,
): string {
  const matches = models.filter((m) => pattern.test(m));
  const raw = matches.length > 0 ? matches[matches.length - 1]! : fallback;
  // Normalise: if the selected model has a known alias, use the full API model ID
  return MODEL_ALIAS_MAP[raw] ?? raw;
}

/**
 * Normalise the base URL:
 *   - Remove trailing slashes
 *   - Strip `/api/v3` suffix if present (the adapter's paths already include it)
 *
 * This handles the common case where the frontend stores:
 *   `https://ark.ap-southeast.bytepluses.com/api/v3`
 * while the adapter needs to construct:
 *   `https://ark.ap-southeast.bytepluses.com/api/v3/images/generations`
 */
function normalizeBaseUrl(baseUrl: string): string {
  let url = baseUrl.replace(/\/+$/, '');
  if (url.endsWith(API_PATH_PREFIX)) {
    url = url.slice(0, -API_PATH_PREFIX.length);
  }
  return url;
}

/**
 * Structured error thrown by {@link byteplusRequest} on non-2xx responses.
 *
 * Exposes the BytePlus error `code` so callers can route terminal errors
 * (content policy, auth, invalid params) vs. retryable transient ones
 * (rate limit, server overload). Matches the shape documented at
 * https://docs.byteplus.com/en/docs/ModelArk/1299023.
 */
class BytePlusApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'BytePlusApiError';
  }

  /** Retryable errors per ModelArk "Handle burst traffic" guidance. */
  get retryable(): boolean {
    if (this.status === 429) return true;
    if (this.status >= 500 && this.status < 600) return true;
    if (this.code === 'ServerOverloaded') return true;
    if (this.code === 'RequestBurstTooFast') return true;
    return false;
  }
}

/**
 * Classification of BytePlus ModelArk content-safety error codes.
 *
 * Side:
 *   - `input`  → filter ran BEFORE generation (fast failure)
 *   - `output` → filter ran AFTER generation (slow: 2-3 min wasted on Seedance)
 * Reason:
 *   - `privacy` → identifiable real people (`.PrivacyInformation` suffix)
 *   - `policy`  → copyright / trademark / IP (`.PolicyViolation` suffix)
 *   - `generic` → base `SensitiveContentDetected` w/o sub-category
 *
 * Source: https://docs.byteplus.com/en/docs/ModelArk/1299023
 */
type ContentPolicyClass = {
  side: 'input' | 'output';
  reason: 'privacy' | 'policy' | 'generic';
};

function classifyContentPolicyCode(
  code: string,
): ContentPolicyClass | undefined {
  // Strip the sub-category suffix so we can resolve side from the base code.
  const dot = code.indexOf('.');
  const base = dot >= 0 ? code.slice(0, dot) : code;
  const suffix = dot >= 0 ? code.slice(dot + 1) : '';

  let side: 'input' | 'output' | undefined;
  if (base === 'SensitiveContentDetected') side = 'input';
  else if (/^Input(Text|Image|Video|Audio)SensitiveContentDetected$/.test(base))
    side = 'input';
  else if (
    /^Output(Text|Image|Video|Audio)SensitiveContentDetected$/.test(base)
  )
    side = 'output';
  else if (base === 'OutofContextError') side = 'input';
  else return undefined;

  const reason: ContentPolicyClass['reason'] =
    suffix === 'PrivacyInformation'
      ? 'privacy'
      : suffix === 'PolicyViolation'
        ? 'policy'
        : 'generic';
  return { side, reason };
}

/** Error codes that are permanent and should not trigger a retry. */
const AUTH_ERROR_CODES = new Set([
  'AuthenticationError',
  'AccessDenied',
  'AccountOverdueError',
]);

/**
 * Translate a BytePlus error into a concise message suitable for the agent
 * to relay to the end user. Never echoes request IDs or internal details.
 */
/**
 * Build actionable guidance for a content-safety code. Exported so the video
 * status path can reuse it (Output* codes surface in task-status payloads
 * rather than as raw `BytePlusApiError` throws).
 */
/**
 * Human-in-the-loop footer appended to every content-policy message. The
 * agent MUST stop, relay the issue to the user in plain language, and offer
 * discrete choices — never auto-pivot to stylization without consent (cost
 * + creative intent belong to the user).
 *
 * On Slack/Discord the agent should render this as a `buttons` Block Kit
 * element (see CHANNEL_FORMAT_HINTS). The button labels below are exactly
 * what the agent should emit so the payloads stay predictable.
 */
const HITL_FOOTER = `\n\nHUMAN-IN-THE-LOOP — STOP. Do NOT auto-stylize, auto-retry, or invent a fix. Relay the issue to the user in ONE short sentence and ask them to choose. On Slack/Discord, render the choices as a \`buttons\` block:
\`\`\`buttons
Stylize reference (cartoon) | stylize_cartoon | primary
Stylize reference (oil painting) | stylize_oil
Use a different reference | change_reference
Cancel | cancel | danger
\`\`\`
On other channels, list the same four options as a numbered list and ask the user to reply with a number. Proceed only after the user chooses.`;

export function friendlyContentPolicyMessage(code: string): string | undefined {
  const kind = classifyContentPolicyCode(code);
  if (!kind) return undefined;
  if (kind.side === 'output') {
    // Post-generation scan — the filter ran AFTER we spent ~2-3 min rendering.
    // Retrying the same reference is deterministic failure, so the user's
    // choice is strictly: stylize → different reference → cancel.
    if (kind.reason === 'policy') {
      return (
        `The provider's post-generation safety scan blocked the video because the output resembles protected characters/celebrities/branding (${code}). Retrying with the same reference will fail again (~2-3 min wasted each attempt).` +
        HITL_FOOTER
      );
    }
    if (kind.reason === 'privacy') {
      return (
        `The provider's post-generation safety scan blocked the video because the output contains identifiable real people (${code}). Retrying with the same reference will fail again.` +
        HITL_FOOTER
      );
    }
    return (
      `The provider's post-generation safety scan blocked the video (${code}). Identical inputs will produce the same verdict.` +
      HITL_FOOTER
    );
  }
  // Input-side: fast failure, cheap to retry — but still the user's call.
  if (kind.reason === 'privacy') {
    return (
      'The provider blocked the request because the reference image contains identifiable real people (privacy protection).' +
      HITL_FOOTER
    );
  }
  if (kind.reason === 'policy') {
    return (
      `The provider blocked the request as likely copyright/IP (${code}). Named IP or celebrities in the prompt or reference image triggered this.` +
      HITL_FOOTER
    );
  }
  return (
    `The provider blocked the request for content-safety reasons (${code}).` +
    HITL_FOOTER
  );
}

function friendlyErrorMessage(err: BytePlusApiError): string {
  const policyMsg = friendlyContentPolicyMessage(err.code);
  if (policyMsg) return policyMsg;
  if (AUTH_ERROR_CODES.has(err.code)) {
    return 'Provider rejected the credentials for this request. Check the BytePlus API key and billing status in Settings.';
  }
  if (
    err.status === 429 ||
    err.code === 'RateLimitExceeded.EndpointRPMExceeded'
  ) {
    return 'Provider is rate-limiting us right now. Wait a moment and try again.';
  }
  if (err.retryable) {
    return 'Provider is temporarily unavailable. Please try again in a minute.';
  }
  if (err.code === 'ResourceNotFound' || err.status === 404) {
    // Typical causes: stale task_id from a previous session (BytePlus keeps
    // task metadata ~7 days), a hallucinated task_id, or a task the user
    // already saw deleted. The MCP layer wraps this with a HITL prompt.
    return 'Provider could not find this task — it may be a stale or hallucinated task ID from a previous session.';
  }
  // Fall through: surface the server message but truncate to keep it tidy.
  const m =
    err.message.length > 240 ? `${err.message.slice(0, 240)}…` : err.message;
  return m;
}

/**
 * Parse an error response body into a {@link BytePlusApiError}.
 * Handles the documented shape `{ error: { code, message, type, request_id } }`
 * as well as legacy/variant payloads where fields sit at the root.
 */
function parseErrorBody(status: number, body: string): BytePlusApiError {
  let code = `HTTP_${status}`;
  let message = body || `HTTP ${status}`;
  let requestId: string | undefined;
  try {
    const parsed = JSON.parse(body) as {
      error?: { code?: string; message?: string; request_id?: string };
      code?: string;
      message?: string;
      request_id?: string;
    };
    const err = parsed.error ?? parsed;
    if (err.code) code = String(err.code);
    if (err.message) message = String(err.message);
    if (err.request_id) requestId = String(err.request_id);
  } catch {
    // Non-JSON body — keep defaults.
  }
  return new BytePlusApiError(status, code, message, requestId);
}

/** Milliseconds for the n-th retry with jittered exponential backoff. */
function backoffDelayMs(attempt: number): number {
  const base = Math.min(30_000, 1000 * 2 ** attempt); // 1s, 2s, 4s, 8s, 16s, 30s cap
  // Add ±25% jitter to avoid thundering-herd when many callers retry in lockstep.
  const jitter = base * (Math.random() * 0.5 - 0.25);
  return Math.max(500, Math.round(base + jitter));
}

/** Max retry attempts for transient errors. Total: 1s+2s+4s+8s ≈ 15s. */
const MAX_RETRY_ATTEMPTS = 4;

/**
 * Make an authenticated request to BytePlus ModelArk.
 *
 * Normalises the base URL so callers don't worry about trailing slashes or
 * `/api/v3` suffixes, parses error bodies into {@link BytePlusApiError}, and
 * retries transient failures (429, 5xx, ServerOverloaded) with jittered
 * exponential backoff per the "Handle burst traffic" guidance.
 */
async function byteplusRequest<T>(
  baseUrl: string,
  apiKey: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const url = `${normalizeBaseUrl(baseUrl)}${path}`;
  logger.debug(`⚡🌐 ${method} ${url}`);

  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (response.ok) {
        return (await response.json()) as T;
      }

      const text = await response.text().catch(() => '');
      const err = parseErrorBody(response.status, text || response.statusText);

      if (!err.retryable || attempt === MAX_RETRY_ATTEMPTS) {
        throw err;
      }

      const delay = backoffDelayMs(attempt);
      logger.warn(
        `⚡🔁 BytePlus ${method} ${path} failed (${response.status} ${err.code}) — retry ${attempt + 1}/${MAX_RETRY_ATTEMPTS} in ${delay}ms`,
      );
      await sleep(delay);
      lastErr = err;
    } catch (err) {
      lastErr = err;
      // Only retry network/timeout errors transparently — structured API
      // errors are already handled above.
      if (err instanceof BytePlusApiError) throw err;
      if (attempt === MAX_RETRY_ATTEMPTS) break;
      const transient =
        err instanceof Error &&
        (err.name === 'AbortError' ||
          err.name === 'TimeoutError' ||
          /ECONNRESET|ENETUNREACH|ETIMEDOUT|EAI_AGAIN|fetch failed/i.test(
            err.message,
          ));
      if (!transient) break;
      const delay = backoffDelayMs(attempt);
      logger.warn(
        `⚡🔁 BytePlus ${method} ${path} network error (${err.message}) — retry ${attempt + 1}/${MAX_RETRY_ATTEMPTS} in ${delay}ms`,
      );
      await sleep(delay);
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error(
        `BytePlus ${method} ${path} failed after ${MAX_RETRY_ATTEMPTS} retries`,
      );
}

// ============================================================================
// Response Types (BytePlus-specific)
// ============================================================================

interface BytePlusImageResponse {
  model: string;
  created: number;
  data: Array<{ url?: string; b64_json?: string; size?: string }>;
  /** Seed used for this generation — returned by the API for reproducibility */
  seed?: number;
  usage?: {
    generated_images?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
}

interface BytePlusVideoCreateResponse {
  id: string;
  /** Seed used for this generation — returned by the API for reproducibility */
  seed?: number;
}

interface BytePlusVideoStatusResponse {
  id: string;
  model: string;
  status: string; // "queued" | "running" | "succeeded" | "failed" | "cancelled" | "expired"
  content?: {
    video_url?: string;
    /** Seedance 1.x response field. */
    last_frame_url?: string;
    /** Seedance 2.0 response field — kept separate for forward compatibility. */
    last_frame_image_url?: string;
    file_url?: string;
  };
  usage?: { completion_tokens?: number; total_tokens?: number };
  duration?: number;
  resolution?: string;
  /** Seed used for this generation — returned by the API for reproducibility */
  seed?: number;
  /** Terminal-failure detail — docs show `{ code, message }`. */
  error?: { code?: string; message?: string };
}

// ============================================================================
// Adapter
// ============================================================================

export class BytePlusAdapter implements MediaGenerationAdapter {
  readonly name = 'BytePlus ModelArk';
  readonly supportsImage = true;
  readonly supportsVideo = true;
  get supportsLipsync(): boolean {
    return this.config.models.some((model) =>
      OMNIHUMAN_MODEL_PATTERN.test(model),
    );
  }

  constructor(private readonly config: MediaProviderConfig) {}

  // ---------- Image Generation ----------

  async generateImage(
    params: GenerateImageParams,
  ): Promise<ImageGenerationResult> {
    // For edits (reference image provided), prefer SeedEdit model if available —
    // it's purpose-built for image editing with maximum preservation of the original.
    // Falls back to Seedream if no SeedEdit model is configured.
    const isEdit = !!params.referenceImageUrl;
    let model: string;
    if (isEdit) {
      const editModel = pickModel(
        this.config.models,
        EDIT_MODEL_PATTERN,
        '', // no fallback — check if found
      );
      if (editModel && EDIT_MODEL_PATTERN.test(editModel)) {
        model = editModel;
        logger.info(
          `✏️ Edit mode: using SeedEdit model ${model} for better image preservation`,
        );
      } else {
        model = pickModel(
          this.config.models,
          IMAGE_MODEL_PATTERN,
          DEFAULT_IMAGE_MODEL,
        );
      }
    } else {
      model = pickModel(
        this.config.models,
        IMAGE_MODEL_PATTERN,
        DEFAULT_IMAGE_MODEL,
      );
    }

    logger.info(
      `⚡🎨 Generating image with model=${model}, seed=${params.seed ?? 'none'}`,
    );
    const genStart = Date.now();

    try {
      const requestBody: Record<string, unknown> = {
        model,
        prompt: params.prompt,
        response_format: 'url',
        watermark: params.watermark ?? false,
      };

      // Size: accept "2K", "4K", or "WxH"
      if (params.size) {
        if (/^\d+x\d+$/i.test(params.size)) {
          const [w, h] = params.size.split('x');
          requestBody.width = Number(w);
          requestBody.height = Number(h);
        } else {
          requestBody.size = params.size;
        }
      } else {
        requestBody.size = '2K';
      }

      if (params.count && params.count > 1) {
        requestBody.sequential_image_generation = 'auto';
      }

      // Image-to-image: add reference image
      // BytePlus Seedream API uses "image" (not "image_url") for image-to-image editing
      // See: https://docs.byteplus.com/en/docs/ModelArk/1824121
      if (params.referenceImageUrl) {
        requestBody.image = params.referenceImageUrl;
      }

      if (params.quality) {
        requestBody.quality = params.quality;
      }

      // Seed for reproducible generation
      if (params.seed != null) {
        requestBody.seed = params.seed;
      }

      // Guidance scale for prompt adherence strength
      if (params.guidanceScale != null) {
        requestBody.guidance_scale = params.guidanceScale;
      }

      const data = await byteplusRequest<BytePlusImageResponse>(
        this.config.baseUrl,
        this.config.apiKey,
        'POST',
        '/api/v3/images/generations',
        requestBody,
      );

      const images = (data.data ?? []).map((img) => ({
        // Prefer URL; fall back to data-URI if b64_json is provided
        url: img.url
          ? img.url
          : img.b64_json
            ? `data:image/png;base64,${img.b64_json}`
            : '',
        size: img.size,
      }));

      logUsage({
        callType: 'image',
        provider: 'byteplus',
        model,
        unitType: 'image',
        unitCount: images.length,
        outputTokens: data.usage?.output_tokens,
        latencyMs: Date.now() - genStart,
      });

      // Prefer API-returned seed (authoritative) over input seed (may differ if clamped/modified)
      const effectiveSeed = data.seed ?? params.seed;
      if (data.seed != null && data.seed !== params.seed) {
        logger.info(
          `🔀 API returned different seed: requested=${params.seed}, actual=${data.seed}`,
        );
      }

      return {
        success: true,
        provider: this.name,
        model,
        images,
        seed: effectiveSeed,
        usage: data.usage
          ? {
              generated_images: data.usage.generated_images ?? images.length,
              output_tokens: data.usage.output_tokens ?? 0,
              total_tokens: data.usage.total_tokens ?? 0,
            }
          : undefined,
      };
    } catch (error) {
      const friendly =
        error instanceof BytePlusApiError
          ? friendlyErrorMessage(error)
          : error instanceof Error
            ? error.message
            : String(error);
      const status =
        error instanceof BytePlusApiError ? error.status : undefined;
      const code = error instanceof BytePlusApiError ? error.code : undefined;
      logger.error(
        `⚡❌ Image generation failed (status=${status ?? '?'} code=${code ?? '?'}): ${friendly}`,
      );
      return {
        success: false,
        provider: this.name,
        model,
        images: [],
        error: friendly,
      };
    }
  }

  // ---------- Video Generation ----------

  async createVideoTask(
    params: GenerateVideoParams,
  ): Promise<VideoTaskCreatedResult> {
    const model = pickModel(
      this.config.models,
      VIDEO_MODEL_PATTERN,
      DEFAULT_VIDEO_MODEL,
    );

    const isV2 = SEEDANCE_V2_PATTERN.test(model);
    logger.info(
      `⚡🎬 Creating video task with model=${model}${isV2 ? ' (Seedance 2.0 schema)' : ''}`,
    );

    try {
      // Tail-only (last_frame without first_frame) is not supported by the
      // BytePlus v2 API — a lone last_frame entry returns a 400. Drop the tail
      // with a warning so the caller at least gets a text-only generation.
      if (params.referenceImageTailUrl && !params.referenceImageUrl) {
        logger.warn(
          '🎬 Seedance 2.0 tail-only image reference is unsupported — dropping last_frame (BytePlus v2 requires a first_frame). Provide referenceImageUrl to anchor the tail.',
        );
        params = { ...params, referenceImageTailUrl: undefined };
      }

      const hasBothFrames =
        !!params.referenceImageUrl && !!params.referenceImageTailUrl;
      const hasReferenceOnly =
        !!params.referenceImageUrl && !params.referenceImageTailUrl;

      const effectivePrompt = isV2
        ? buildSeedanceV2Prompt(params.prompt, {
            hasBothFrames,
            hasReferenceOnly,
          })
        : params.prompt;

      const content: Array<Record<string, unknown>> = [
        { type: 'text', text: effectivePrompt },
      ];

      // Image references. Seedance 2.0 requires a `role` tag to activate
      // first/last-frame anchoring; older Seedance models infer role from order.
      // See: https://docs.byteplus.com/en/docs/ModelArk/2291680
      if (params.referenceImageUrl) {
        const firstEntry: Record<string, unknown> = {
          type: 'image_url',
          image_url: { url: params.referenceImageUrl },
        };
        if (isV2) {
          firstEntry.role = params.referenceImageTailUrl
            ? 'first_frame'
            : 'reference_image';
        }
        content.push(firstEntry);
      }

      if (params.referenceImageTailUrl) {
        const tailEntry: Record<string, unknown> = {
          type: 'image_url',
          image_url: { url: params.referenceImageTailUrl },
        };
        if (isV2) {
          tailEntry.role = 'last_frame';
        }
        content.push(tailEntry);
      }

      const requestBody: Record<string, unknown> = {
        model,
        content,
        watermark: params.watermark ?? false,
        // Request the final frame for iterative editing workflows — the last
        // frame can be re-used as reference_image_url in the next generation.
        return_last_frame: true,
      };

      if (params.aspectRatio) {
        requestBody.ratio = params.aspectRatio;
      }

      // Duration: Seedance 2.0 is constrained to 4–15s (docs); clamp to avoid
      // 400 errors when callers pass values from other providers (Sora/Veo).
      if (params.duration) {
        let duration = params.duration;
        if (isV2) {
          const clamped = Math.min(
            Math.max(duration, SEEDANCE_V2_MIN_DURATION),
            SEEDANCE_V2_MAX_DURATION,
          );
          if (clamped !== duration) {
            logger.warn(
              `🎬 Seedance 2.0 duration ${duration}s out of range [${SEEDANCE_V2_MIN_DURATION}-${SEEDANCE_V2_MAX_DURATION}] — clamping to ${clamped}s`,
            );
            duration = clamped;
          }
        }
        requestBody.duration = duration;
      }

      // Resolution: Seedance 2.0 accepts 480p / 720p / 1080p, but 2.0-fast is
      // capped at 720p (per BytePlus docs). Clamp to the allowed set for the
      // selected variant instead of round-tripping to the API only to fail.
      if (params.resolution) {
        let resolution = params.resolution;
        if (isV2) {
          const allowed = SEEDANCE_V2_FAST_PATTERN.test(model)
            ? SEEDANCE_V2_FAST_ALLOWED_RESOLUTIONS
            : SEEDANCE_V2_ALLOWED_RESOLUTIONS;
          if (!allowed.has(resolution.toLowerCase())) {
            logger.warn(
              `🎬 Seedance 2.0 resolution "${resolution}" unsupported for ${model} — using 720p`,
            );
            resolution = '720p';
          }
        }
        requestBody.resolution = resolution;
      }

      // Seed for reproducible video generation (-1 = random)
      if (params.seed != null) {
        requestBody.seed = params.seed;
      }

      // `camerafixed` is a Seedance 1.x-only flag. Seedance 2.0 expects camera
      // control to be expressed in natural language inside the prompt instead.
      if (params.cameraFixed != null) {
        if (isV2) {
          if (params.cameraFixed) {
            logger.warn(
              `🎬 camera_fixed is not a Seedance 2.0 parameter — express camera intent in the prompt (e.g. "fixed camera, no movement")`,
            );
          }
        } else {
          requestBody.camerafixed = params.cameraFixed;
        }
      }

      // Generate native audio alongside the video (Seedance 1.5 Pro+ and 2.0)
      if (params.generateAudio != null) {
        requestBody.generate_audio = params.generateAudio;
      }

      // Language for generated audio/voiceover (Seedance 1.5 Pro+ and 2.0)
      if (params.language) {
        requestBody.language = params.language;
      }

      const data = await byteplusRequest<BytePlusVideoCreateResponse>(
        this.config.baseUrl,
        this.config.apiKey,
        'POST',
        '/api/v3/contents/generations/tasks',
        requestBody,
      );

      // Prefer API-returned seed over input seed
      const effectiveSeed = data.seed ?? params.seed;
      if (data.seed != null && data.seed !== params.seed) {
        logger.info(
          `🔀 Video API returned different seed: requested=${params.seed}, actual=${data.seed}`,
        );
      }

      return {
        success: true,
        provider: this.name,
        model,
        taskId: data.id,
        seed: effectiveSeed,
      };
    } catch (error) {
      const friendly =
        error instanceof BytePlusApiError
          ? friendlyErrorMessage(error)
          : error instanceof Error
            ? error.message
            : String(error);
      const status =
        error instanceof BytePlusApiError ? error.status : undefined;
      const code = error instanceof BytePlusApiError ? error.code : undefined;
      logger.error(
        `⚡❌ Video task creation failed (status=${status ?? '?'} code=${code ?? '?'}): ${friendly}`,
      );
      return {
        success: false,
        provider: this.name,
        model,
        taskId: '',
        error: friendly,
      };
    }
  }

  async getVideoTaskStatus(taskId: string): Promise<VideoTaskStatusResult> {
    try {
      const data = await byteplusRequest<BytePlusVideoStatusResponse>(
        this.config.baseUrl,
        this.config.apiKey,
        'GET',
        `/api/v3/contents/generations/tasks/${encodeURIComponent(taskId)}`,
      );

      // Normalise BytePlus status → our enum. Unknown/novel strings land on
      // `failed` so the agent terminates polling rather than looping
      // indefinitely on a status it doesn't understand.
      const statusMap: Record<string, VideoTaskStatusResult['status']> = {
        running: 'running',
        queued: 'queued',
        succeeded: 'succeeded',
        failed: 'failed',
        cancelled: 'cancelled',
        expired: 'expired',
      };
      const normalized = statusMap[data.status];
      if (!normalized) {
        logger.warn(
          `⚠️ Unknown BytePlus video status "${data.status}" for task ${taskId} — treating as failed`,
        );
      }

      // Seedance 2.0 renamed `last_frame_url` → `last_frame_image_url`; accept
      // either so iterative-edit workflows keep working across versions.
      const lastFrameUrl =
        data.content?.last_frame_image_url ?? data.content?.last_frame_url;

      // Log usage once per completed video so per-second Seedance pricing
      // (see pricing.ts unit_type='video_second') is applied. Duration from
      // the provider is authoritative; fall back to 0 if absent.
      if (normalized === 'succeeded' && data.content?.video_url) {
        logUsage({
          callType: 'video',
          provider: 'byteplus',
          model: data.model ?? 'unknown-seedance',
          unitType: 'video_second',
          unitCount: Math.round(data.duration ?? 0),
          outputTokens: data.usage?.completion_tokens,
        });
      }

      // Build a human-readable error that mentions the BytePlus code if
      // present — helps users recognise content-policy vs. quota issues.
      // Route content-policy codes through friendlyContentPolicyMessage so the
      // agent gets actionable guidance (esp. for Output* codes, which are the
      // common "wait 3 min then fail" case on photoreal reference images).
      const errorMsg = (() => {
        if (!data.error?.code && !data.error?.message) {
          return normalized === 'expired'
            ? 'Task output expired (BytePlus keeps video URLs for ~24h) — regenerate the task.'
            : undefined;
        }
        if (data.error.code) {
          const policyMsg = friendlyContentPolicyMessage(data.error.code);
          if (policyMsg) return policyMsg;
          return data.error.message
            ? `[${data.error.code}] ${data.error.message}`
            : `[${data.error.code}]`;
        }
        return data.error.message;
      })();

      return {
        success: true,
        provider: this.name,
        taskId,
        status: normalized ?? 'failed',
        videoUrl: data.content?.video_url,
        lastFrameUrl,
        duration: data.duration,
        resolution: data.resolution,
        seed: data.seed,
        usage: data.usage
          ? {
              completion_tokens: data.usage.completion_tokens ?? 0,
              total_tokens: data.usage.total_tokens ?? 0,
            }
          : undefined,
        error: errorMsg,
        errorCode: data.error?.code,
      };
    } catch (error) {
      const friendly =
        error instanceof BytePlusApiError
          ? friendlyErrorMessage(error)
          : error instanceof Error
            ? error.message
            : String(error);
      const status =
        error instanceof BytePlusApiError ? error.status : undefined;
      const code = error instanceof BytePlusApiError ? error.code : undefined;
      logger.error(
        `⚡❌ Video status check failed (status=${status ?? '?'} code=${code ?? '?'}): ${friendly}`,
      );

      // Transient failures (network, 5xx, rate-limit): report `running` so the
      // caller keeps polling — a single status check hiccup shouldn't kill a
      // 2-minute video task. Permanent errors still map to `failed`.
      const isTransient =
        error instanceof BytePlusApiError ? error.retryable : true;
      return {
        success: isTransient,
        provider: this.name,
        taskId,
        status: isTransient ? 'running' : 'failed',
        error: isTransient
          ? undefined // keep polling quietly
          : friendly,
      };
    }
  }

  async createLipsyncTask(
    params: LipsyncParams,
  ): Promise<VideoTaskCreatedResult> {
    if (!this.supportsLipsync) {
      return {
        success: false,
        provider: this.name,
        model: DEFAULT_OMNIHUMAN_MODEL,
        taskId: '',
        error: 'BytePlus OmniHuman model is not configured for this provider.',
      };
    }

    const model = pickModel(
      this.config.models,
      OMNIHUMAN_MODEL_PATTERN,
      DEFAULT_OMNIHUMAN_MODEL,
    );
    const content: Array<Record<string, unknown>> = [
      {
        type: 'text',
        text: params.text ?? 'Generate a natural talking-head avatar video.',
      },
      {
        type: 'image_url',
        role: 'reference_image',
        image_url: { url: params.imageUrl },
      },
    ];
    if ('url' in params.audio) {
      content.push({
        type: 'audio_url',
        role: 'voice_track',
        audio_url: { url: params.audio.url },
      });
    } else {
      content.push({
        type: 'input_audio',
        role: 'voice_track',
        input_audio: { data: params.audio.base64, format: 'wav' },
      });
    }

    try {
      const data = await byteplusRequest<BytePlusVideoCreateResponse>(
        this.config.baseUrl,
        this.config.apiKey,
        'POST',
        '/api/v3/contents/generations/tasks',
        {
          model,
          content,
          ratio: params.aspectRatio,
          motion_scale: params.motionScale,
          background: normalizeLipsyncBackground(params.background),
          watermark: false,
        },
      );
      return {
        success: true,
        provider: this.name,
        model,
        taskId: data.id,
        seed: data.seed,
      };
    } catch (error) {
      const friendly =
        error instanceof BytePlusApiError
          ? friendlyErrorMessage(error)
          : error instanceof Error
            ? error.message
            : String(error);
      return {
        success: false,
        provider: this.name,
        model,
        taskId: '',
        error: friendly,
      };
    }
  }
}

function normalizeLipsyncBackground(
  background: LipsyncParams['background'],
): unknown {
  if (!background) return undefined;
  if (background.kind === 'transparent') return { type: 'transparent' };
  if (background.kind === 'color') {
    return { type: 'color', color: background.color ?? '#000000' };
  }
  if (background.kind === 'image') {
    return { type: 'image_url', image_url: { url: background.imageUrl } };
  }
  return undefined;
}
