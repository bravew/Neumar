/**
 * Media Generation — Shared Types
 *
 * Provider-agnostic interfaces for image and video generation.
 * Every adapter (BytePlus, OpenAI, Gemini, …) implements these
 * so the MCP server never couples to a single vendor.
 *
 * @module media-generation/types
 */

// ============================================================================
// Generation Parameters
// ============================================================================

/** Common parameters shared by all generation requests */
export interface BaseGenerationParams {
  /** Human-readable prompt describing the desired output */
  prompt: string;
  /** Working directory for saving output files (optional — not needed for URL-based results) */
  workDir?: string;
}

/** Parameters for image generation */
export interface GenerateImageParams extends BaseGenerationParams {
  /** Desired output size — resolution keyword or "WxH" */
  size?: string;
  /** Aspect ratio hint (e.g. "16:9", "1:1", "9:16") */
  aspectRatio?: string;
  /** Number of images to generate (default: 1) */
  count?: number;
  /** Whether to add a watermark */
  watermark?: boolean;
  /** Optional reference image URL or base64 for image-to-image */
  referenceImageUrl?: string;
  /**
   * Optional PNG mask (https URL or data: URI) for inpainting. Transparent
   * pixels mark the region to regenerate; opaque pixels are preserved. Must
   * match the reference image dimensions. Provider support:
   *   - OpenAI gpt-image-1 (/v1/images/edits): native mask
   *   - Other providers: ignored
   */
  maskImageUrl?: string;
  /** Quality preset (e.g. "standard", "fast", "hd") */
  quality?: string;
  /** Seed for reproducible generation (provider-dependent). Use the same seed + prompt to get consistent results. */
  seed?: number;
  /** Guidance scale for prompt adherence (provider-dependent, e.g. 1-20). */
  guidanceScale?: number;
}

/** Parameters for video generation */
export interface GenerateVideoParams extends BaseGenerationParams {
  /** Aspect ratio (e.g. "16:9", "9:16", "1:1") */
  aspectRatio?: string;
  /** Duration in seconds */
  duration?: number;
  /** Whether to add a watermark */
  watermark?: boolean;
  /** Optional reference image URL or base64 for image-to-video */
  referenceImageUrl?: string;
  /** Resolution keyword (e.g. "720p", "1080p") */
  resolution?: string;
  /** Seed for reproducible generation (provider-dependent). Use the same seed to get consistent results. */
  seed?: number;
  /** Fix camera position — no camera movement (Seedance-specific). */
  cameraFixed?: boolean;
  /** Last-frame reference image URL or base64 for first+last frame anchoring (Seedance I2V). */
  referenceImageTailUrl?: string;
  /** Generate native audio alongside the video (Seedance 1.5 Pro+). */
  generateAudio?: boolean;
  /** Language for generated audio/voiceover (e.g. "en", "zh", "es"). Seedance 1.5 Pro+. */
  language?: string;
}

export interface LipsyncParams {
  /** Portrait/reference image as an HTTPS URL or data URI. */
  imageUrl: string;
  /** Narration audio. Providers generally accept either hosted URL or base64 bytes. */
  audio: { url: string } | { base64: string };
  /** Optional narration text for providers that accept script hints. */
  text?: string;
  motionScale?: number;
  aspectRatio?: string;
  background?:
    | { kind: 'transparent' | 'color'; color?: string }
    | { kind: 'image'; imageUrl: string };
}

// ============================================================================
// Generation Results
// ============================================================================

/** A single generated image */
export interface GeneratedImage {
  /** Publicly accessible URL (valid for a limited time, typically 24 h) */
  url: string;
  /** Local file path if saved to disk */
  localPath?: string;
  /** WxH of the output image */
  size?: string;
  /** Revised / improved prompt used by the model */
  revisedPrompt?: string;
}

/**
 * Provenance: who actually produced the output vs. what the caller asked for.
 * Surfacing `requestedProvider`/`requestedModel` lets the UI disclose a
 * silent fallback — a transparency requirement under the EU AI Act's
 * Article 50 and the C2PA Content Credentials guidance.
 */
export interface MediaProvenance {
  /** What the caller (user setting or agent) asked for; undefined when auto-ranked */
  requestedProvider?: string;
  /** Requested model name if explicitly provided */
  requestedModel?: string;
  /**
   * Human-readable reason the requested provider was not used.
   * Present only when the actual provider differs from the requested one.
   */
  fallbackReason?: string;
}

/** Result of an image generation call */
export interface ImageGenerationResult {
  success: boolean;
  /** Provider that fulfilled the request */
  provider: string;
  /** Stable provider id used for telemetry/failure envelopes */
  providerId?: string;
  /** Model used */
  model: string;
  /** Generated images */
  images: GeneratedImage[];
  /** Token / credit usage if available */
  usage?: Record<string, number>;
  /** Seed used for this generation (if supported by provider). Reuse for consistent results. */
  seed?: number;
  /** Error message when success is false */
  error?: string;
  /** Provenance metadata for transparency / fallback disclosure */
  provenance?: MediaProvenance;
}

/**
 * Video generation is asynchronous.
 * The initial call returns a task ID; the client polls for completion.
 */
export type VideoTaskStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  // BytePlus ModelArk emits `expired` when a task's generated URL is past its
  // 24h TTL; treat as terminal — the task cannot be recovered, only re-run.
  | 'expired';

/** Result returned when a video generation task is created */
export interface VideoTaskCreatedResult {
  success: boolean;
  /** Provider that accepted the task */
  provider: string;
  /** Stable provider id used for telemetry/failure envelopes */
  providerId?: string;
  /** Model used */
  model: string;
  /** Opaque task identifier for polling */
  taskId: string;
  /** Seed used for this generation (if supported by provider). Reuse for consistent results. */
  seed?: number;
  /** Error message when success is false */
  error?: string;
  /** Provenance metadata for transparency / fallback disclosure */
  provenance?: MediaProvenance;
}

/** Result returned when polling a video task */
export interface VideoTaskStatusResult {
  success: boolean;
  provider: string;
  /** Stable provider id used for telemetry/failure envelopes */
  providerId?: string;
  taskId: string;
  status: VideoTaskStatus;
  /** Video URL — only present when status is 'succeeded' */
  videoUrl?: string;
  /** Last frame URL — for iterative editing (use as reference_image_url in next generation) */
  lastFrameUrl?: string;
  /** Local file path if downloaded */
  localPath?: string;
  /** Duration of the generated video (seconds) */
  duration?: number;
  /** Resolution (e.g. "720p") */
  resolution?: string;
  /** Token / credit usage */
  usage?: Record<string, number>;
  /** Seed used for this generation — may be returned on completion for reproducibility */
  seed?: number;
  /** Error message when status is 'failed' */
  error?: string;
  /**
   * Raw provider error code when status is 'failed' — lets callers
   * route behaviour (e.g. block same-reference retries after an
   * OutputVideoSensitiveContentDetected.PolicyViolation).
   */
  errorCode?: string;
  /** Model used to generate the video (mirrored from the original createVideoTask for convenience). */
  model?: string;
  /** Provenance metadata for transparency / fallback disclosure */
  provenance?: MediaProvenance;
}

// ============================================================================
// Adapter Interface
// ============================================================================

/**
 * Every media-generation provider implements this interface.
 *
 * Methods may throw on transport errors; the caller (MCP server) catches
 * and converts them to user-friendly tool results.
 */
export interface MediaGenerationAdapter {
  /** Human-readable name (e.g. "BytePlus ModelArk") */
  readonly name: string;

  /** Whether this adapter supports image generation */
  readonly supportsImage: boolean;

  /**
   * Whether this adapter honors `referenceImageUrl` (image-to-image / edit).
   * Adapters that silently drop the reference (e.g. text-only paths) MUST set
   * this to false so the router can avoid them when an edit is requested.
   * Defaults to `true` when omitted — set `false` explicitly to opt out.
   */
  readonly supportsImageEdit?: boolean;

  /** Whether this adapter supports video generation */
  readonly supportsVideo: boolean;

  /** Whether this adapter supports image/audio-driven lipsync generation. */
  readonly supportsLipsync?: boolean;

  /** Generate one or more images (synchronous — returns when ready) */
  generateImage?(params: GenerateImageParams): Promise<ImageGenerationResult>;

  /**
   * Start an asynchronous video generation task.
   * Returns immediately with a task ID.
   */
  createVideoTask?(
    params: GenerateVideoParams,
  ): Promise<VideoTaskCreatedResult>;

  /**
   * Start an asynchronous lipsync video task from a portrait and audio track.
   */
  createLipsyncTask?(
    params: LipsyncParams,
    signal?: AbortSignal,
  ): Promise<VideoTaskCreatedResult>;

  /**
   * Poll the status of a previously created video task.
   */
  getVideoTaskStatus?(
    taskId: string,
    signal?: AbortSignal,
  ): Promise<VideoTaskStatusResult>;
}

// ============================================================================
// Provider Config (read from synced settings)
// ============================================================================

/**
 * Minimal provider info needed by adapters.
 * Matches the shape synced from the frontend AIProvider type.
 */
export interface MediaProviderConfig {
  id: string;
  name: string;
  apiKey: string;
  baseUrl: string;
  models: string[];
}
