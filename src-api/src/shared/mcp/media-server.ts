/**
 * Media Generation MCP Server
 *
 * Inline MCP server that exposes provider-agnostic media generation tools
 * to the AI agent. The agent calls these tools when users request image
 * or video generation; the router automatically picks the best available
 * provider from the synced settings.
 *
 * Tools:
 *   - media_generate_image   — Generate image(s) from a text prompt
 *   - media_generate_video   — Start an async video generation task
 *   - media_check_video      — Poll status of a video generation task
 *   - media_list_capabilities — List available media generation providers
 *
 * @module mcp/media-server
 */

import { randomUUID } from 'node:crypto';
import { createWriteStream, readFileSync, realpathSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { extname, sep as pathSep } from 'node:path';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import { isAssetsCatalogEnabled } from '@/shared/assets/flags';
import { getAssetRegistry } from '@/shared/assets/registry';
import { getSetting } from '@/shared/db/operations';
import {
  startDesignMediaTask,
  waitDesignMediaTask,
} from '@/shared/services/design-mode/media-dispatcher';
import {
  createVideoTask,
  embedProvenance,
  generateImage,
  getVideoTaskStatus,
  listCapabilities,
  type MediaProvenance,
} from '@/shared/services/media-generation';
import {
  getSessionContext,
  getSessionWorkDir,
  type SessionContext,
} from '@/shared/services/session-context';
import { errorMessage } from '@/shared/utils/errors';
import { createLogger } from '@/shared/utils/logger';
import { extensionFromMime as extensionFromMediaMime } from '@/shared/utils/mime-extension';

const logger = createLogger('MediaMCP');

// ============================================================================
// Reference Image Helpers
// ============================================================================

/** MIME types for common image extensions */
const MIME_MAP: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
};

/**
 * Zod refinement: allow https:// URLs, data: URIs, and local absolute file paths.
 * Local paths (starting with /) are converted to data: URIs in the tool handler.
 * Rejects dangerous schemes like http://, file://, ftp://, etc.
 */
const referenceImageSchema = z
  .string()
  .refine(
    (url) =>
      url.startsWith('https://') ||
      url.startsWith('data:') ||
      url.startsWith('/'),
    {
      message:
        'Must be an https:// URL, data: URI, or an absolute local file path (starting with /)',
    },
  );

/**
 * Convert a reference image value to a form the API can consume.
 *  - https:// URLs → passed through unchanged
 *  - data: URIs    → passed through unchanged
 *  - /absolute/path → read file, encode as data:image/*;base64,...
 *
 * Returns undefined if the input is undefined (no reference image).
 */
function resolveReferenceImage(value: string | undefined): string | undefined {
  if (!value) return undefined;

  // Already a remote URL or data URI — pass through
  if (value.startsWith('https://') || value.startsWith('data:')) {
    return value;
  }

  // Local file path — read and convert to data URI
  if (value.startsWith('/')) {
    // Path traversal guard: resolve symlinks and verify within tmpdir or workspace
    let resolved: string;
    try {
      resolved = realpathSync(value);
    } catch (err) {
      throw new Error(`Reference image not found: ${path.basename(value)}`, {
        cause: err,
      });
    }
    // Compare against realpath-resolved prefixes too — on macOS `os.tmpdir()`
    // returns `/var/folders/...` but realpathSync follows the `/var → /private/var`
    // symlink, so a literal-prefix check would reject every Slack inbound
    // attachment as "outside permitted directories." Resolve both sides.
    const tmpDir = os.tmpdir();
    const workDir = getSetting('workDir') ?? '';
    const candidates = [tmpDir, workDir, '/tmp'].filter(Boolean);
    const safePrefixes = new Set<string>();
    for (const pfx of candidates) {
      safePrefixes.add(pfx);
      try {
        safePrefixes.add(realpathSync(pfx));
      } catch {
        /* prefix doesn't exist — skip */
      }
    }
    const allowed = [...safePrefixes].some((pfx) =>
      resolved.startsWith(pfx.endsWith(pathSep) ? pfx : pfx + pathSep),
    );
    if (!allowed) {
      throw new Error(
        `Reference image path is outside permitted directories: ${path.basename(value)}`,
      );
    }

    try {
      const ext = extname(value).toLowerCase();
      const mime = MIME_MAP[ext] ?? 'image/png';
      const buffer = readFileSync(resolved);
      const base64 = buffer.toString('base64');
      logger.info(
        `📁 Converted local image to data URI: ${path.basename(value)} (${mime}, ${Math.round(buffer.length / 1024)}KB)`,
      );
      return `data:${mime};base64,${base64}`;
    } catch (error) {
      logger.error(
        `❌ Failed to read local image file: ${path.basename(value)}`,
        error,
      );
      throw new Error(
        `Cannot read reference image at ${path.basename(value)}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }

  return value;
}

/** Map a MIME subtype onto the extension we'll use when naming saved media. */
function extForMime(mime: string): string {
  return extensionFromMediaMime(mime) || '.png';
}

function extFromDataUri(dataUri: string): string {
  return extForMime(dataUri.match(/^data:([^;,]+)/i)?.[1] ?? 'image/png');
}

function extFromContentType(ct: string | null): string {
  if (!ct) return '.png';
  return extForMime(ct.split(';')[0]?.trim() ?? 'image/png');
}

/**
 * Resolve the channel-scoped output directory.
 *
 * `process.cwd()` would be the API server root (the MCP server runs in the
 * parent Node process, not the agent's subprocess), so we read the active
 * turn's workDir from AsyncLocalStorage first, fall back to the global
 * `workDir` setting for desktop runs, and finally to `os.tmpdir()`.
 */
async function resolveOutputDir(): Promise<string | null> {
  // SessionContext can override the output dir entirely (Video Mode does
  // this to land generated source media in <projectDir>/assets/ instead
  // of <projectDir>/output/, which is reserved for final renders).
  const sessionContext = getSessionContext();
  const sessionOverride = sessionContext?.mediaOutputDir;
  const sessionWorkDir = sessionContext?.workDir ?? getSessionWorkDir();
  const settingWorkDir = getSetting('workDir') ?? '';
  const outDir =
    sessionOverride ||
    (sessionWorkDir && path.join(sessionWorkDir, 'output')) ||
    (settingWorkDir && path.join(settingWorkDir, 'output')) ||
    path.join(os.tmpdir(), 'neuma-media');
  try {
    await mkdir(outDir, { recursive: true });
    return outDir;
  } catch (err) {
    logger.warn(`Failed to ensure output dir ${outDir}:`, err);
    return null;
  }
}

async function persistBuffer(
  buf: Buffer,
  prefix: 'image' | 'video',
  ext: string,
  outDir: string,
): Promise<string | null> {
  const filename = `${prefix}_${randomUUID().slice(0, 8)}${ext}`;
  const fullPath = path.join(outDir, filename);
  try {
    await writeFile(fullPath, buf);
    logger.info(
      `💾 Saved ${prefix} to disk: ${filename} (${Math.round(buf.byteLength / 1024)}KB)`,
    );
    return fullPath;
  } catch (err) {
    logger.error(`Failed to persist ${prefix}:`, err);
    return null;
  }
}

/**
 * Persist a base64 `data:` URI to disk. Passing raw base64 through the SDK
 * tool_result stream blows up tokens and stalls the turn (a 2 MB image is
 * ~2.7 MB of text), so we always land it on the filesystem first.
 */
async function saveDataUriToDisk(dataUri: string): Promise<string | null> {
  const commaIdx = dataUri.indexOf(',');
  if (!dataUri.startsWith('data:') || commaIdx < 0) return null;

  const payload = dataUri.slice(commaIdx + 1);
  let buf: Buffer;
  try {
    buf = Buffer.from(payload, 'base64');
  } catch {
    return null;
  }
  if (buf.byteLength === 0) return null;

  const outDir = await resolveOutputDir();
  if (!outDir) return null;
  return persistBuffer(buf, 'image', extFromDataUri(dataUri), outDir);
}

/**
 * Download a hosted media URL server-side and return the local path.
 *
 * Agent-side `curl` frequently fails against provider CDNs (corporate or
 * sandbox proxies reject CONNECT — observed: `curl: (56) CONNECT tunnel
 * failed, 403`), and BytePlus URLs expire in ~24 h. Video downloads stream
 * directly to disk via `pipeline` so 20 MB payloads don't sit in RAM.
 */
async function downloadToDisk(
  url: string,
  opts: { prefix: 'image' | 'video'; ext?: string; timeoutMs: number },
): Promise<string | null> {
  if (!url.startsWith('http://') && !url.startsWith('https://')) return null;
  const outDir = await resolveOutputDir();
  if (!outDir) return null;

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
    if (!res.ok) {
      logger.warn(
        `${opts.prefix} download returned ${res.status}: ${url.slice(0, 80)}`,
      );
      return null;
    }

    if (opts.prefix === 'video' && res.body) {
      // Stream video bodies straight to disk; they can be 20 MB+ and we
      // don't want both an ArrayBuffer and a Buffer copy in memory.
      const ext = opts.ext ?? '.mp4';
      const filename = `video_${randomUUID().slice(0, 8)}${ext}`;
      const fullPath = path.join(outDir, filename);
      await pipeline(
        Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]),
        createWriteStream(fullPath),
      );
      logger.info(`💾 Saved video to disk: ${filename}`);
      return fullPath;
    }

    const ab = await res.arrayBuffer();
    const buf = Buffer.from(ab);
    if (buf.byteLength === 0) return null;
    const ext = opts.ext ?? extFromContentType(res.headers.get('content-type'));
    return persistBuffer(buf, opts.prefix, ext, outDir);
  } catch (err) {
    logger.warn(
      `${opts.prefix} download failed (${err instanceof Error ? err.message : String(err)}): ${url.slice(0, 80)}`,
    );
    return null;
  }
}

const downloadUrlToDisk = (url: string) =>
  downloadToDisk(url, { prefix: 'image', timeoutMs: 60_000 });
const downloadVideoToDisk = (url: string) =>
  downloadToDisk(url, { prefix: 'video', ext: '.mp4', timeoutMs: 180_000 });

/**
 * Compose the user-visible "fallback used" disclosure line. Returns undefined
 * when no fallback occurred so callers can append conditionally.
 */
function formatFallbackNotice(
  provenance: MediaProvenance | undefined,
): string | undefined {
  if (!provenance?.fallbackReason) return undefined;
  const requested = provenance.requestedProvider ?? 'unknown';
  const modelSuffix = provenance.requestedModel
    ? ` / ${provenance.requestedModel}`
    : '';
  return `ℹ️ **Fallback used** — requested **${requested}**${modelSuffix}; reason: ${provenance.fallbackReason}`;
}

interface AssetMetadata {
  provider: string;
  model: string;
  provenance?: MediaProvenance;
  seed?: number;
  prompt?: string;
  revisedPrompt?: string;
}

/**
 * Emit the provenance HTML-comment line AND kick off in-file metadata
 * embedding for a persisted asset. Used after every successful save so the
 * agent output and the asset bytes agree on who produced the file.
 * Fire-and-forget on disk bookkeeping — never blocks the tool response.
 */
function tagPersistedAsset(savedPath: string, meta: AssetMetadata): string {
  void embedProvenance(savedPath, {
    provider: meta.provider,
    model: meta.model,
    requestedProvider: meta.provenance?.requestedProvider,
    requestedModel: meta.provenance?.requestedModel,
    fallbackReason: meta.provenance?.fallbackReason,
    seed: meta.seed,
    prompt: meta.prompt,
    revisedPrompt: meta.revisedPrompt,
  });
  return serializeAssetProvenance(meta);
}

async function ingestPersistedAsset(
  savedPath: string,
  meta: AssetMetadata & { kind: 'image' | 'video' },
): Promise<void> {
  if (!isAssetsCatalogEnabled()) return;

  try {
    const result = await getAssetRegistry().ingest({
      source: 'ai_gen',
      storagePath: savedPath,
      sourceId: savedPath,
      clientRequestId: `media:${savedPath}`,
      hint: {
        kind: meta.kind,
        title: path.basename(savedPath),
        description: meta.prompt,
        caption: meta.revisedPrompt,
        tags: ['ai-generated', meta.kind],
        provenance: {
          provider: meta.provider,
          model: meta.model,
          requestedProvider: meta.provenance?.requestedProvider,
          requestedModel: meta.provenance?.requestedModel,
          fallbackReason: meta.provenance?.fallbackReason,
          seed: meta.seed,
        },
      },
    });
    logger.debug(
      `Cataloged generated ${meta.kind}: ${result.asset.id} created=${result.created}`,
    );
  } catch (error) {
    logger.warn(
      `Generated media catalog ingest skipped: ${errorMessage(error)}`,
    );
  }
}

/**
 * Encode per-asset provenance as an HTML comment the UI's markdown renderer
 * ignores but our regex parser can pick up. Kept as a single JSON blob
 * (rather than key=value) so additive fields land without breaking parsers.
 */
function serializeAssetProvenance(p: {
  provider: string;
  model: string;
  provenance?: MediaProvenance;
}): string {
  const payload: Record<string, string> = {
    provider: p.provider,
    model: p.model,
  };
  if (p.provenance?.requestedProvider) {
    payload.requestedProvider = p.provenance.requestedProvider;
  }
  if (p.provenance?.requestedModel) {
    payload.requestedModel = p.provenance.requestedModel;
  }
  if (p.provenance?.fallbackReason) {
    payload.fallbackReason = p.provenance.fallbackReason;
  }
  return `<!--neuma:provenance ${JSON.stringify(payload)}-->`;
}

async function persistImageBytes(img: {
  url: string;
  localPath?: string;
}): Promise<string | null> {
  if (img.localPath) return img.localPath;
  if (img.url.startsWith('data:')) return saveDataUriToDisk(img.url);
  if (img.url.startsWith('http://') || img.url.startsWith('https://')) {
    return downloadUrlToDisk(img.url);
  }
  return null;
}

// ============================================================================
// Per-Turn Iteration Budget — keeps agentic generation loops bounded
// ============================================================================

/**
 * Max image generations a single agent turn is allowed to do before the tool
 * starts nudging the agent to stop and hand results back to the user. Keeps
 * the classic "hmm not quite right, let me try again…" self-critique loop
 * from burning through a multi-dollar stack of images.
 */
const IMAGE_BUDGET_PER_TURN = 3;
const VIDEO_BUDGET_PER_TURN = 2;

/**
 * Counters live in a WeakMap keyed by the active `SessionContext` object —
 * `withSessionContext` wraps each agent turn with a fresh `SessionContext`
 * instance, so the counter naturally resets per turn (and gets GC'd when the
 * turn finishes). Sessions outside a turn (no context) just skip tracking.
 */
interface TurnBudget {
  imagesUsed: number;
  imageGenerationCount: number; // number of generate_image calls (not images)
  videosUsed: number;
}
const turnBudgets = new WeakMap<SessionContext, TurnBudget>();

function getTurnBudget(): TurnBudget | null {
  const ctx = getSessionContext();
  if (!ctx) return null;
  let budget = turnBudgets.get(ctx);
  if (!budget) {
    budget = { imagesUsed: 0, imageGenerationCount: 0, videosUsed: 0 };
    turnBudgets.set(ctx, budget);
  }
  return budget;
}

// ============================================================================
// Seed Continuity — auto-reuse seed for iterative editing
// ============================================================================

/**
 * Tracks the last successful generation's seed and provider so that
 * iterative edits (reference_image_url without explicit seed) automatically
 * reuse the same seed for visual consistency.
 *
 * The AI agent *should* pass the seed explicitly (tool description tells it to),
 * but in practice models often omit it. This safety net makes iterative
 * workflows reliable regardless of agent behavior.
 */
interface LastGeneration {
  seed: number;
  provider: string;
  timestamp: number;
  /** Video URL from the completed generation (set by media_check_video on success) */
  videoUrl?: string;
  /** Reference image URL used for this generation (for re-use in follow-up edits) */
  referenceImageUrl?: string;
  /** Motion prompt used for this generation — reuse for consistent video edits */
  prompt?: string;
  /** Last-frame URL from the completed generation — chained as the next scene's first frame. */
  lastFrameUrl?: string;
}

let lastImageGeneration: LastGeneration | undefined;
let lastVideoGeneration: LastGeneration | undefined;

/**
 * Tracks the most recent FAILED video generation so we can proactively block
 * retries that are guaranteed to fail. Output-side content-safety scans on
 * Seedance run AFTER ~2-3 min of generation; retrying with the same reference
 * image would just burn another 3 min and another billed render.
 *
 * See: https://docs.byteplus.com/en/docs/ModelArk/1299023 (Output*SensitiveContentDetected)
 */
interface LastFailedVideo {
  errorCode: string;
  referenceImageUrl?: string;
  referenceImageTailUrl?: string;
  timestamp: number;
}
let lastFailedVideoGeneration: LastFailedVideo | undefined;

/**
 * Error codes where retrying with the same reference image will fail again —
 * the post-generation safety scan has already judged the output, so identical
 * inputs produce a near-identical output and the same verdict.
 */
const TERMINAL_OUTPUT_SAFETY_CODES =
  /^Output(Text|Image|Video|Audio)SensitiveContentDetected(\.[A-Za-z]+)?$/;

/**
 * Per-task poll counter used to nudge the agent into posting user-facing
 * text heartbeats during long video renders. In chat channels (Slack /
 * Discord / Telegram) tool calls are invisible — only agent text messages
 * are seen. Without heartbeats the user perceives a 2-3 min freeze.
 */
const videoPollCounts = new Map<string, number>();
/** Cap the map size so a runaway agent can't grow it unbounded. */
const VIDEO_POLL_COUNT_MAX_ENTRIES = 256;

/** Max age before last-generation context expires (30 minutes) */
const SEED_MEMORY_TTL_MS = 30 * 60 * 1000;

/**
 * Map app locale (e.g. 'en-US', 'zh-CN') to Seedance language codes.
 * Seedance supports: en, zh, es, ja, de, pt, fr, ko.
 * Returns undefined if no mapping found (let the API use its default).
 */
function mapLocaleToSeedanceLanguage(
  locale: string | null,
): string | undefined {
  if (!locale) return undefined;
  const prefix = locale.split('-')[0]?.toLowerCase();
  const supported = new Set(['en', 'zh', 'es', 'ja', 'de', 'pt', 'fr', 'ko']);
  return prefix && supported.has(prefix) ? prefix : undefined;
}

function getLastImageSeed(): LastGeneration | undefined {
  if (
    lastImageGeneration &&
    Date.now() - lastImageGeneration.timestamp < SEED_MEMORY_TTL_MS
  ) {
    return lastImageGeneration;
  }
  return undefined;
}

function getLastVideoSeed(): LastGeneration | undefined {
  if (
    lastVideoGeneration &&
    Date.now() - lastVideoGeneration.timestamp < SEED_MEMORY_TTL_MS
  ) {
    return lastVideoGeneration;
  }
  return undefined;
}

// ============================================================================
// Tool Definitions
// ============================================================================

export const mediaTools = [
  // ---- Generate Image ----
  tool(
    'media_generate_image',
    `Generate one or more images from a text prompt using the best available image generation provider.

HUMAN-IN-THE-LOOP — Do NOT call this tool as a fallback fix.
- Only call media_generate_image when the user has EXPLICITLY asked for an image, OR has EXPLICITLY agreed (via a button click or chat message) to a proposal you made. Call it ONCE per user turn.
- Specifically forbidden: calling this tool to "stylize / restyle / cartoon-ify" a reference image as an automatic recovery after a failed media_generate_video call. That decision belongs to the user. When a video fails, the tool result already includes a buttons prompt — render it and wait for the user's choice. Never pre-empt the choice by stylizing.
- Also forbidden: silent "refinement loops" where you generate an image, judge it, and generate another without showing the first to the user. Every image costs money and the user is the judge, not you.

Supported providers (auto-detected from user settings):
  - BytePlus Seedream (seedream-5.0, seedream-5.0-lite, seedream-4.5)
  - OpenAI DALL-E 3 / GPT-Image
  - Google Imagen

IMPORTANT — Bounded iteration (per-turn budget: 3 images):
- Default to ONE image per user request. You may generate up to 3 images per turn total (across count>1 or sequential calls) when genuinely useful — user asked for variations ("give me a few options"), distinct styles/ratios are worth comparing, or a first attempt clearly missed a hard constraint and one retry is warranted.
- The tool response tells you your position in the loop — look for **Attempt N this turn** in the header and the **Iteration budget: X/3** footer. When you see "Iteration budget reached" or "final attempt", STOP: do not call this tool again this turn.
- Communicate the iteration flow to the user. Before generating, say what you're about to try (e.g. "Let me try two styles — a dramatic option and a cleaner one."). After each generation, label it for the user:
    • If more attempts are planned: _"🎨 Attempt 1 of 3 — refining the lighting…"_
    • When this is the last one you'll do: _"✅ **Final result** — which of these do you want to keep, or what should change?"_
- NEVER run silent self-critique loops ("hmm, not quite right, let me try again"). Hand intermediate results to the user and let them steer. Each generation costs money.

The tool response looks like:
    **Image 1**:
      File: /absolute/path/to/output/image_xxxxxx.png

The image is ALREADY downloaded to disk by the backend — reference the \`File:\` path directly in your reply or as \`reference_image_url\` for the next edit. Do NOT run \`curl\`/\`wget\` on any URL: outgoing HTTP from the agent sandbox is routinely blocked by proxies ("curl: (56) CONNECT tunnel failed") and BytePlus URLs expire in 24 h anyway. If only a \`URL:\` appears (download fell back), quote the URL to the user and stop — do not retry curl, it will keep failing.

IMPORTANT — Iterative editing / consistency:
- Pass reference_image_url whenever the user's request builds on an EXISTING image — covers BOTH cases:
    (a) the user attached/uploaded an image in the current message or earlier in the thread, AND
    (b) the user is iterating on an image you previously generated.
  Examples that REQUIRE reference_image_url: "make this transparent", "remove the background", "make it waving", "change the color to blue", "use this as a Slides title image", "stylize this", "turn this into a mascot", "create a PNG version of this for X". Whenever the user's text refers to a tangible subject that exists in an attached/prior image (this/it/the photo/the image/the mascot/the robot), the source MUST be passed as reference_image_url — generating from scratch will produce something that looks completely different from what the user sent.
  Only generate WITHOUT reference_image_url when the user explicitly says "ignore the picture" or the request is unrelated to any attached/prior image.
- For attachments on the CURRENT message, the local file path is included in the conversation environment hint as "Current message attachments". Use that path verbatim.
- For prior attachments and your own previous outputs, find the local file path in conversation history.
- Without a reference image, the model generates from scratch and the result will look completely different from the source — this is a confirmed failure mode that wastes the user's time.
- CRITICAL for edits: Write a SHORT, TARGETED edit instruction describing ONLY what to change. Do NOT re-describe the entire scene. Example: instead of "A red sports car on a highway with mountains in the background, change the color to blue", write "Change the car color from red to blue, keep everything else identical." The model uses the reference image for context — re-describing the scene causes unnecessary regeneration.
- For NEW images (no reference), use detailed, descriptive prompts for best results
- Specify size/aspect ratio when the user mentions dimensions
- Transparent backgrounds: only OpenAI gpt-image-1 honors transparency natively (pass provider="OpenAI"). BytePlus/Gemini render a flat white/colored backdrop even when the prompt asks for transparency. When the user wants a true transparent PNG and OpenAI is configured, prefer it. Otherwise the output will need a post-processing alpha-cutout step (use rembg if available, else PIL white→alpha) — verify with \`python3 -c "from PIL import Image; im=Image.open('FILE'); print(im.mode, im.getextrema()[-1] if im.mode=='RGBA' else 'no alpha')"\` before claiming transparency to the user.
- Provider selection — pass the \`provider\` argument whenever the user names a model family:
    * "Seedream" / "Seededit" / "BytePlus" → provider="BytePlus"
    * "DALL-E" / "GPT-Image" / "OpenAI"    → provider="OpenAI"
    * "Imagen" / "Gemini" / "Google"       → provider="Gemini"
  When the user gives no preference, omit \`provider\` and the router will auto-pick (BytePlus Seedream is preferred by default because it returns hosted URLs — Gemini-via-OpenRouter returns multi-megabyte base64 blobs that stall the turn).
\nReturns JSON: { success, provider, model, images: [{ url, size?, revisedPrompt? }], usage? }`,
    {
      prompt: z
        .string()
        .describe(
          'Detailed description of the image to generate. Be specific about style, composition, colors, and subject.',
        ),
      size: z
        .string()
        .optional()
        .describe(
          'Output size. BytePlus: "2K" or "4K" or "WxH". OpenAI: "1024x1024", "1792x1024", "1024x1792".',
        ),
      aspect_ratio: z
        .string()
        .optional()
        .describe(
          'Aspect ratio hint (e.g. "16:9", "1:1", "9:16"). Used when size is not specified.',
        ),
      count: z
        .number()
        .min(1)
        .max(15)
        .optional()
        .describe(
          'Number of images to generate. Default: 1. Set 2-3 when multiple variations are genuinely useful (user asked for options, or distinct styles/ratios are worth comparing). Do not exceed 3 without an explicit user request. Max: 15 for BytePlus.',
        ),
      quality: z
        .string()
        .optional()
        .describe(
          'Quality preset: "standard" (default) or "fast" (BytePlus) / "hd" (OpenAI).',
        ),
      reference_image_url: referenceImageSchema
        .optional()
        .describe(
          'Reference image for image-to-image editing. CRITICAL for iterative workflows: when the user wants to modify a previously generated image, pass the local file path of that image here (e.g. /path/to/previous-output.png). Also accepts https:// URLs and data: URIs.',
        ),
      mask_image_url: referenceImageSchema
        .optional()
        .describe(
          'Optional PNG mask for inpainting (OpenAI gpt-image-1 only — silently ignored by other providers). Must match the reference_image_url dimensions. Transparent pixels mark the region to regenerate; opaque pixels are preserved. Accepts an absolute local file path, https:// URL, or data: URI.',
        ),
      seed: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe(
          'Seed for reproducible generation. IMPORTANT: When iterating on a previous image, reuse the same seed from the previous result to maintain consistency. The seed is returned in the generation result.',
        ),
      guidance_scale: z
        .number()
        .min(1)
        .max(20)
        .optional()
        .describe(
          'Guidance scale for prompt adherence (1-20). Higher values follow the prompt more strictly. For edits, auto-set to 4 (preserves more of the original image) — only override if the user wants more/less change. Supported by BytePlus Seedream.',
        ),
      watermark: z
        .boolean()
        .optional()
        .describe('Whether to add a watermark (default: false).'),
      provider: z
        .string()
        .optional()
        .describe(
          'Preferred provider name. Accepted values include "BytePlus" / "Seedream", "OpenAI" / "DALL-E" / "gpt-image", "Gemini" / "Imagen", feature-gated "nano banana", and "Codex" / "Codex CLI" (routes through the locally installed Codex CLI using gpt-image-2 via the $imagegen skill on a ChatGPT subscription). Auto-detected if omitted. When the user asks to "use codex" or mentions Codex explicitly, pass "codex" here.',
        ),
    },
    async ({
      prompt,
      size,
      aspect_ratio,
      count,
      quality,
      reference_image_url,
      mask_image_url,
      seed,
      guidance_scale,
      watermark,
      provider,
    }) => {
      try {
        // Seed logic:
        //   - Explicit seed from agent → use it (override)
        //   - reference_image_url provided (edit/update) → reuse last seed for consistency
        //   - No reference image (new generation) → fresh random seed
        let effectiveSeed: number;
        if (seed != null) {
          effectiveSeed = seed;
        } else if (reference_image_url && getLastImageSeed()) {
          const last = getLastImageSeed()!;
          effectiveSeed = last.seed;
          logger.info(
            `♻️ Edit detected (reference image provided) — reusing seed ${effectiveSeed} from last generation (provider: ${last.provider})`,
          );
        } else {
          effectiveSeed = Math.floor(Math.random() * 2147483647);
        }

        logger.info(
          `🎨 generate_image called: prompt="${prompt.slice(0, 80)}…", provider=${provider ?? 'auto'}, seed=${effectiveSeed}`,
        );

        // Convert local file paths to data URIs for API consumption
        const resolvedRef = resolveReferenceImage(reference_image_url);
        const resolvedMask = resolveReferenceImage(mask_image_url);

        // A mask without a reference image is meaningless — fail fast rather
        // than silently dropping the mask in the adapter.
        if (resolvedMask && !resolvedRef) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'mask_image_url requires reference_image_url. Pass the source image you want to inpaint as reference_image_url and the mask as mask_image_url.',
              },
            ],
            isError: true,
          };
        }

        // On edits, pin to the last successful provider so a mid-session
        // outage on one adapter doesn't cascade into repeated failures.
        // The user-configured default is applied later in router.ts.
        let effectiveProvider = provider;
        if (!effectiveProvider && reference_image_url && getLastImageSeed()) {
          effectiveProvider = getLastImageSeed()!.provider;
          logger.info(
            `🔄 Routing edit to last successful provider: ${effectiveProvider}`,
          );
        }

        // Mask-based inpainting is only honored by OpenAI gpt-image-1 today.
        // If a mask is provided we override any earlier provider pinning so
        // the mask is actually applied — otherwise the router could silently
        // route to a different adapter that drops it on the floor.
        if (resolvedMask) {
          if (provider && !/^openai/i.test(provider)) {
            logger.warn(
              `mask_image_url provided but caller requested provider=${provider}. Mask is OpenAI-only — switching to OpenAI.`,
            );
          }
          effectiveProvider = 'openai';
        }

        // For edits (reference image provided), use a lower guidance_scale by default
        // to preserve more of the original image. The user can override explicitly.
        const effectiveGuidance =
          guidance_scale ?? (resolvedRef ? 4 : undefined);

        if (resolvedRef && guidance_scale == null) {
          logger.info(
            `🎯 Edit mode: auto-setting guidance_scale=${effectiveGuidance} for better image preservation`,
          );
        }

        // Resolve the session output dir so adapters that write files directly
        // (Codex CLI) can land them in the same location URL-based adapters
        // save to after download. Falls back to '' for adapters that don't
        // need a workdir.
        const sessionOutputDir = (await resolveOutputDir()) ?? '';

        const result = await generateImage({
          prompt,
          size,
          aspectRatio: aspect_ratio,
          count,
          quality,
          referenceImageUrl: resolvedRef,
          maskImageUrl: resolvedMask,
          seed: effectiveSeed,
          guidanceScale: effectiveGuidance,
          watermark,
          provider: effectiveProvider,
          workDir: sessionOutputDir,
        });

        if (!result.success) {
          logger.error(
            `❌ generate_image failed: provider=${result.provider}, model=${result.model}, error=${result.error}`,
          );
          return {
            content: [
              {
                type: 'text' as const,
                text: `Image generation failed: ${result.error}`,
              },
            ],
            isError: true,
          };
        }

        // Store seed for auto-reuse in iterative editing.
        // Prefer the API-returned seed (may differ from our input if the API clamped/modified it).
        const storedSeed = result.seed ?? effectiveSeed;
        lastImageGeneration = {
          seed: storedSeed,
          provider: result.provider,
          timestamp: Date.now(),
        };

        // Increment per-turn budget so the agent can see how many more
        // generations it has left this turn.
        const budget = getTurnBudget();
        if (budget) {
          budget.imageGenerationCount += 1;
          budget.imagesUsed += result.images.length;
        }
        const generationNumber = budget?.imageGenerationCount;
        const imagesRemaining = budget
          ? Math.max(0, IMAGE_BUDGET_PER_TURN - budget.imagesUsed)
          : null;
        const atBudget = budget
          ? budget.imagesUsed >= IMAGE_BUDGET_PER_TURN
          : false;

        const headerPrefix = generationNumber
          ? `🎨 **Attempt ${generationNumber} this turn** — `
          : '';
        const finalMarker = atBudget
          ? ' _(final attempt — iteration budget reached; stop here and ask the user what to do next)_'
          : '';

        // Build a rich text response with image URLs
        const lines = [
          `${headerPrefix}✅ Generated ${result.images.length} image(s) via **${result.provider}** (model: ${result.model})${finalMarker}`,
        ];
        // EU AI Act Art. 50 + IAB disclosure framework both require fallback
        // to be perceptible — surface it inline before the asset list.
        const fallbackNotice = formatFallbackNotice(result.provenance);
        if (fallbackNotice) lines.push(fallbackNotice);
        lines.push('');

        for (let i = 0; i < result.images.length; i++) {
          const img = result.images[i]!;
          lines.push(`**Image ${i + 1}**:`);

          const savedPath = await persistImageBytes(img);

          if (savedPath) {
            lines.push(`  File: ${savedPath}`);
            lines.push(
              `  ${tagPersistedAsset(savedPath, {
                provider: result.provider,
                model: result.model,
                provenance: result.provenance,
                seed: storedSeed,
                prompt,
                revisedPrompt: img.revisedPrompt,
              })}`,
            );
            await ingestPersistedAsset(savedPath, {
              provider: result.provider,
              model: result.model,
              provenance: result.provenance,
              seed: storedSeed,
              prompt,
              revisedPrompt: img.revisedPrompt,
              kind: 'image',
            });
          } else if (img.url.startsWith('data:')) {
            lines.push(
              '  (Image returned as base64 but could not be saved to disk — retry or request a different provider.)',
            );
          } else {
            // URL may still work from the channel side; keep as fallback.
            lines.push(`  URL: ${img.url}`);
          }
          if (img.size) lines.push(`  Size: ${img.size}`);
          if (img.revisedPrompt)
            lines.push(`  Revised prompt: ${img.revisedPrompt}`);
          lines.push('');
        }

        lines.push(
          `Seed: ${storedSeed} (reuse this seed for iterative edits — pass it with reference_image_url to maintain consistency)`,
        );

        if (result.usage) {
          lines.push(`Usage: ${JSON.stringify(result.usage)}`);
        }

        if (budget) {
          if (atBudget) {
            lines.push('');
            lines.push(
              `🛑 **Iteration budget reached** (${budget.imagesUsed}/${IMAGE_BUDGET_PER_TURN} images this turn). Do NOT generate more this turn — present these results, clearly label this as the FINAL attempt, and ask the user which one they like or what to change next.`,
            );
          } else if (imagesRemaining != null) {
            lines.push('');
            lines.push(
              `📊 Iteration budget: ${budget.imagesUsed}/${IMAGE_BUDGET_PER_TURN} images used this turn (${imagesRemaining} remaining). Only use more if the user asked for variations or a hard constraint was missed.`,
            );
          }
        }

        return {
          content: [{ type: 'text' as const, text: lines.join('\n') }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Image generation error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  ),

  // ---- Generate Video ----
  tool(
    'media_generate_video',
    `Start an asynchronous video generation task. Returns a task ID for polling.

Supported providers (auto-detected from user settings):
  - BytePlus Seedance 2.0 / 2.0 fast (dreamina-seedance-2-0-[fast-]260128) — T2V, I2V first+last frame, multimodal reference (up to 9 images / 3 videos / 3 audio), native audio. Duration 4–15s. Resolution 480p / 720p. Aspect ratios: 21:9, 16:9, 4:3, 1:1, 3:4, 9:16, adaptive.
  - BytePlus Seedance 1.x (legacy) — I2V, first+last frame, audio, camerafixed flag.
  - OpenAI Sora
  - Google Veo

Video generation is async — use media_check_video to poll for completion.
Typical generation time: 60-120 seconds depending on duration and quality.

IMPORTANT — Channel UX (Slack / Discord / Telegram / any chat channel):
- As soon as this tool returns, you MUST post ONE short user-facing text message announcing generation started and the expected wait (2-3 min for 5-s 720p clips). Channel users only see your TEXT messages — tool calls and polling loops are invisible to them. Silence = perceived freeze.
- media_check_video will emit "CHANNEL HEARTBEAT" prompts at the ~1 min and ~2 min marks. When you see one, immediately post a one-line progress message to the user BEFORE your next poll (e.g. "⏳ Still rendering — about 1 min in"). Do NOT skip heartbeats; do NOT repeat them beyond what the tool asks.
- On success, send the final video with a short caption. On failure, relay the actionable guidance from the tool result in plain language (do not dump raw error codes).

IMPORTANT — Content safety is HUMAN-IN-THE-LOOP (never auto-fix):
- BytePlus Seedance runs TWO safety scans: (1) an input-side filter before generation (fast fail, ~5s) and (2) an output-side filter AFTER the video is rendered (~2-3 min). Both can reject: InputImage*/OutputVideo* SensitiveContentDetected with a .PrivacyInformation (real person) or .PolicyViolation (copyright/IP) suffix.
- When a safety failure comes back, the tool result includes a HUMAN-IN-THE-LOOP footer with a ready-made \`buttons\` block (Stylize cartoon / Stylize oil painting / Use a different reference / Cancel). You MUST render those buttons (Slack/Discord) or the same 4 options as a numbered list (other channels), tell the user in ONE plain-language sentence what blocked the video, and WAIT for their choice. Stylization costs time + money and changes creative intent — that decision is the user's, not yours.
- Do NOT auto-call media_generate_image to stylize, do NOT retry with a rephrased prompt, do NOT "fix and resubmit" — all of these are confirmed failure modes that waste user time and money. The ONLY correct response is: relay + ask + wait.
- If a prior render hit an OutputVideoSensitiveContentDetected* code, submitting the same reference is deterministic failure; the tool will short-circuit such retries with the same human-in-the-loop prompt.

On success the poller returns a \`Video file:\` line pointing at a local .mp4
already downloaded by the backend. Reference that path in your reply — do
NOT curl the upstream URL (proxies routinely 403 BytePlus CDNs, and the URL
expires in 24 h regardless).

IMPORTANT — Polling behavior (aligned with BytePlus "Handle burst traffic" guidance):
- After starting the task, wait 30 seconds before the first check (use Bash: sleep 30)
- Then back off: 10s → 15s → 15s → 15s… (cap ~15s between polls)
- Do NOT check more frequently — ModelArk rate-limits aggressive polling (≈2 QPS per account)
- Total budget: ~5 minutes for 5-s 720p clips; ~10 minutes for 10–15 s or 1080p renders
- Terminal statuses (succeeded / failed / cancelled / expired) MUST stop the poll loop immediately — never retry them, the task_id is spent
- If the agent sandbox network is flaky, a single failed status check is NOT terminal — the adapter maps transient errors back to "running" so one more poll recovers

CRITICAL — Do NOT spawn a Task/sub-agent to poll media_check_video.
Call media_check_video + Bash(sleep N) DIRECTLY in this conversation turn.
Sub-agents lose their MCP control channel when the parent turn ends and will
fail every subsequent status check with "Stream closed" errors, leaving the
user without a result. Stay in the parent turn until the task resolves or
the retry budget is exhausted.

IMPORTANT — How I2V (image-to-video) works (from Seedance official guide):
- The reference image defines the scene — the prompt describes MOTION, CAMERA, and SOUND only.
- Prompt structure: "subject + movement, background + movement, Camera + movement".
- Example: "The boy looks at the camera and takes off his earphones. Camera slowly pushes in."
- Do NOT describe static elements already visible in the reference image (text, layout, colors).
- Seedance generates consistent results when: same reference image + same motion prompt + same seed.
- Changing ANY of these three produces a DIFFERENT video.

IMPORTANT — Seedance 2.0 prompt conventions (from BytePlus prompt guide https://docs.byteplus.com/en/docs/ModelArk/2222480):
- Use the cinematic formula: ACTION + SCENE + STYLE + CAMERA. Write full sentences, not comma-separated keyword lists.
  Example (T2V): "An orange cat strolls through a Kyoto alley as cherry blossoms drift down, Ukiyo-e style, wide-angle tracking shot pushing in slowly."
  Example (first+last frame): "The woman turns from Image 1 toward Image 2, lifting her chin; warm golden-hour light; slow dolly-in."
- Camera: express intent in natural language ("fixed camera, no movement", "slow dolly-in", "handheld pan left", "360 orbit", "crane up"). Do NOT pass camera_fixed for Seedance 2.0.
- Multimodal references: refer to supplied assets by lowercase 1-based position — "image 1", "image 2", "video 1", "audio 1". (Official Seedance 2.0 convention.)
- First+last frame (I2V): image 1 is the first frame, image 2 is the last frame. Describe the motion BETWEEN them, not the static content of either.
- Single reference image: describe motion only. Do NOT restate static elements already visible (layout, text, colors, clothing) — restatement causes flicker and identity drift.
- Multimodal reference-to-video: state extraction + plot. E.g. "Use the character from image 1 and the environment from image 2; she walks forward through the doorway. Maintain consistency of extracted elements."
- Keep prompts under 2000 characters. Duration 4–15s. Resolution 480p or 720p. Out-of-range values are auto-clamped with a warning.
- Supported prompt languages: English, Chinese, Japanese (no quality penalty across these).

IMPORTANT — Iterative editing / consistency:
- When the user wants to MODIFY a previously generated video, you MUST pass a reference image as reference_image_url.
- CRITICAL — Prompt reuse: To keep the SAME motion/animation, pass prompt="__reuse__" which auto-reuses the last video's motion prompt. This is the key to consistency — same prompt + same seed + updated reference = same motion with new content.
- Workflow for "change text/price in the video":
  1. Update the IMAGE first: media_generate_image with targeted edit prompt (e.g. "Change $2 to $5, keep everything else identical")
  2. Generate video: media_generate_video with prompt="__reuse__" and the updated image as reference_image_url
  3. The motion stays identical. The new content appears because it's in the updated reference image.
- For first+last frame anchoring: pass first frame as reference_image_url and last frame as reference_image_tail_url — constrains start and end states.
- For NEW videos (no reference): use detailed prompts with motion, camera, style, and subject.
- After calling this tool, immediately tell the user that generation has started
- Then call media_check_video periodically to check progress
- When complete, provide the video URL to the user

CRITICAL — Multi-scene / trailer / storyboard workflow:
When the user asks for a sequence of CONNECTED scenes (trailer, montage, story, tutorial,
multi-shot), follow these rules. Ignoring them produces disconnected clips with drifting
characters and incoherent audio.

1. Prefer ONE generation with timeline prompting for short sequences (≤15s total).
   Seedance 2.0 honors [mm:ss-mm:ss] timecode segments within a single prompt, producing
   coherent motion and audio across cuts. Canonical format:
     "image 1 as first frame.
      [00:00-00:03] Wide establishing shot — static camera. Subject doing X.
      [00:03-00:07] Medium cut — slow dolly-in. Subject doing Y.
      [00:07-00:12] Close-up — handheld pan left. Subject doing Z."
   Rules: one camera move + one primary action per segment; 4–6 segments per generation;
   10–15s total. Audio stays coherent because it's one generation.

2. For sequences longer than 15s, chain scenes via last-frame → first-frame, SEQUENTIALLY.
   a. Generate scene 1 (optionally set reference_image_tail_url to anchor its ending).
      Wait for completion — media_check_video must return succeeded.
   b. The check_video result includes \`Last frame: <url>\`. Pass that URL as
      reference_image_url of the next media_generate_video call.
   c. Repeat for each subsequent scene. Reuse the same seed for the whole sequence.
   The tool auto-detects this pattern: a scene whose reference_image_url matches the
   prior scene's last_frame is labelled "Sequence shot" and does NOT count against the
   retry budget. You may chain as many as the user needs.
   NEVER dispatch multiple generate_video calls in parallel for a connected sequence — the
   second call fires before scene 1 finishes, so chaining is impossible and scenes look
   unrelated.

3. Anchor tags for character / style consistency across scenes.
   Pick a short identifier block for every subject/style/palette that must stay stable and
   REPEAT IT VERBATIM at the start of every scene's prompt. Example:
     Anchor: "[BLAZE team — 12 teenage volleyball players in gold-and-black jerseys,
              faces matching image 1, Enercare Centre Toronto, cinematic color grade]"
     Scene 1: "[anchor] walk onto the court in slow motion. Camera slow push-in."
     Scene 2: "[anchor] spike the ball mid-rally. Handheld low-angle tracking right."
   Identical anchor text across every prompt dramatically increases identity consistency.
   Refer to supplied assets by lowercase position tag: "image 1", "video 1", "audio 1".

4. Audio across a sequence.
   Per-scene generate_audio=true produces independent audio tracks that jump-cut on concat.
   For a coherent trailer, either (a) keep the whole piece inside ONE timeline-prompted
   generation (rule 1), or (b) generate scenes with generate_audio=false, then layer a
   single music bed + optional voice-over in the ffmpeg assembly step with
   -filter_complex (amix / adelay / acrossfade). Do NOT use \`-c copy\` if you are mixing
   new audio — it would drop the new tracks.

5. FFmpeg assembly: use xfade, not raw concat, for connected scenes.
   Raw \`ffmpeg -f concat -c copy\` produces hard cuts. For trailers, chain xfade:
     ffmpeg -i s1.mp4 -i s2.mp4 -filter_complex
       "[0:v][1:v]xfade=transition=fade:duration=0.5:offset=4.5[v]" ...
   Pair with acrossfade on the audio streams when mixing.

6. Present the final assembled video to the user — not the individual scene clips.

IMPORTANT — Bounded iteration (per-turn budget: 2 videos):
- Video is expensive. Default to ONE video per user request; only do a second when the first clearly failed a hard constraint or the user asked for a variation.
- The tool response shows **Attempt N this turn** and an **Iteration budget: X/2** footer. When it says "Iteration budget reached" or "final video this turn", STOP. Present the result and ask the user for direction.
- Tell the user which attempt this is ("🎬 Attempt 1 of up to 2 — generating…") and clearly mark the last one as **Final**.
\nReturns JSON: { success, provider, model, taskId }`,
    {
      prompt: z
        .string()
        .describe(
          'Motion/action prompt for the video. For I2V: describe subject movement, camera movement, and mood — NOT static content visible in the reference image. For iterative edits: pass "__reuse__" to keep the same motion from the previous generation. For new videos: include style, camera, action, and subject details.',
        ),
      aspect_ratio: z
        .string()
        .optional()
        .describe(
          'Aspect ratio. Seedance 2.0 supports: "21:9", "16:9", "4:3", "1:1", "3:4", "9:16", "adaptive". Default varies by provider.',
        ),
      duration: z
        .number()
        .min(1)
        .max(60)
        .optional()
        .describe(
          'Video duration in seconds (default: 5). Seedance 2.0 accepts 4–15s (out-of-range values are clamped).',
        ),
      resolution: z
        .string()
        .optional()
        .describe(
          'Resolution. Seedance 2.0: "480p" or "720p" only. Sora/Veo support higher resolutions. Default varies by provider.',
        ),
      reference_image_url: referenceImageSchema
        .optional()
        .describe(
          'Reference image for image-to-video or video iteration. CRITICAL for consistency: when modifying a previous video, pass a keyframe or the original reference image here. Also use this for image-to-video generation. Accepts: absolute local file path, https:// URL, or data: URI.',
        ),
      seed: z
        .number()
        .int()
        .min(-1)
        .optional()
        .describe(
          'Seed for reproducible video generation. Use -1 for random (default). IMPORTANT: When iterating on a previous video, reuse the same seed from the previous result to maintain consistency. Supported by BytePlus Seedance and Google Veo.',
        ),
      reference_image_tail_url: referenceImageSchema
        .optional()
        .describe(
          'Last-frame reference image for first+last frame anchoring (Seedance I2V). When provided alongside reference_image_url, the video is constrained to start at the first image and end at this image. Use ffmpeg to extract the last frame: `ffmpeg -sseof -0.1 -i video.mp4 -frames:v 1 lastframe.png`. Accepts: absolute local file path, https:// URL, or data: URI.',
        ),
      generate_audio: z
        .boolean()
        .optional()
        .describe(
          'Generate native audio alongside the video (Seedance 1.5 Pro+). When true, the model produces synchronized audio matching the video content.',
        ),
      language: z
        .string()
        .optional()
        .describe(
          'Language for generated audio/voiceover (e.g. "en", "zh", "es", "ja", "de", "pt", "fr", "ko"). Defaults to the app\'s language setting. Only specify if the user explicitly requests a different language.',
        ),
      camera_fixed: z
        .boolean()
        .optional()
        .describe(
          'Fix camera position (no camera movement). Seedance 1.x only — for Seedance 2.0, describe camera intent in the prompt instead.',
        ),
      watermark: z
        .boolean()
        .optional()
        .describe('Whether to add a watermark (default: false).'),
      provider: z
        .string()
        .optional()
        .describe('Preferred provider name. Auto-detected if omitted.'),
    },
    async ({
      prompt,
      aspect_ratio,
      duration,
      resolution,
      reference_image_url,
      reference_image_tail_url,
      generate_audio,
      language,
      seed,
      camera_fixed,
      watermark,
      provider,
    }) => {
      try {
        // Proactive guard: if the previous attempt this session failed with an
        // Output*SensitiveContentDetected code AND the incoming reference image
        // is unchanged, short-circuit. The post-generation safety scan has
        // already judged this reference — resubmitting burns another 2-3 min
        // for an identical rejection. Force the agent to stylize first.
        if (
          lastFailedVideoGeneration &&
          Date.now() - lastFailedVideoGeneration.timestamp <
            SEED_MEMORY_TTL_MS &&
          TERMINAL_OUTPUT_SAFETY_CODES.test(
            lastFailedVideoGeneration.errorCode,
          ) &&
          reference_image_url &&
          reference_image_url === lastFailedVideoGeneration.referenceImageUrl &&
          reference_image_tail_url ===
            lastFailedVideoGeneration.referenceImageTailUrl
        ) {
          const blockedCode = lastFailedVideoGeneration.errorCode;
          logger.warn(
            `🛑 Blocked video retry — same reference_image_url previously hit ${blockedCode}. Agent must pre-stylize before retrying.`,
          );
          return {
            content: [
              {
                type: 'text' as const,
                text: [
                  `🛑 Same reference image just failed the provider's safety scan (${blockedCode}). Another attempt would fail again.`,
                  '',
                  'HUMAN-IN-THE-LOOP — STOP. Do NOT auto-retry or auto-stylize. Tell the user in ONE short sentence what blocked the video, then ask them to choose. On Slack/Discord render the choices as a `buttons` block:',
                  '```buttons',
                  'Stylize reference (cartoon) | stylize_cartoon | primary',
                  'Stylize reference (oil painting) | stylize_oil',
                  'Use a different reference | change_reference',
                  'Cancel | cancel | danger',
                  '```',
                  'On other channels, list the same four options as a numbered list. Wait for the user to choose before doing anything else.',
                ].join('\n'),
              },
            ],
            isError: true,
          };
        }

        // Prompt reuse: "__reuse__" means reuse the last video prompt for consistency.
        // This keeps motion/animation identical when only the reference image changed.
        let effectivePrompt = prompt;
        if (prompt === '__reuse__' && getLastVideoSeed()?.prompt) {
          effectivePrompt = getLastVideoSeed()!.prompt!;
          logger.info(
            `♻️ Prompt reuse: using last video prompt for motion consistency: "${effectivePrompt.slice(0, 80)}…"`,
          );
        }

        // Seed logic: reuse last seed only for edits (reference image provided)
        let effectiveSeed: number;
        if (seed != null) {
          effectiveSeed = seed;
        } else if (reference_image_url && getLastVideoSeed()) {
          const last = getLastVideoSeed()!;
          effectiveSeed = last.seed;
          logger.info(
            `♻️ Edit detected (reference image provided) — reusing seed ${effectiveSeed} from last video generation (provider: ${last.provider})`,
          );
        } else {
          effectiveSeed = Math.floor(Math.random() * 2147483647);
        }

        logger.info(
          `🎬 generate_video called: prompt="${effectivePrompt.slice(0, 80)}…", provider=${provider ?? 'auto'}, seed=${effectiveSeed}`,
        );

        // Convert local file paths to data URIs for API consumption
        const resolvedRef = resolveReferenceImage(reference_image_url);
        const resolvedTailRef = resolveReferenceImage(reference_image_tail_url);

        let effectiveProvider = provider;
        if (!effectiveProvider && reference_image_url && getLastVideoSeed()) {
          effectiveProvider = getLastVideoSeed()!.provider;
          logger.info(
            `🔄 Routing video edit to last successful provider: ${effectiveProvider}`,
          );
        }

        const result = await createVideoTask({
          prompt: effectivePrompt,
          aspectRatio: aspect_ratio,
          duration,
          resolution,
          referenceImageUrl: resolvedRef,
          referenceImageTailUrl: resolvedTailRef,
          generateAudio: generate_audio,
          language:
            language ?? mapLocaleToSeedanceLanguage(getSetting('language')),
          seed: effectiveSeed,
          cameraFixed: camera_fixed,
          watermark,
          provider: effectiveProvider,
          workDir: '',
        });

        if (!result.success) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Video generation failed: ${result.error}`,
              },
            ],
            isError: true,
          };
        }

        // Store seed + reference image for auto-reuse in iterative editing.
        // Prefer the API-returned seed (may differ from our input).
        const storedSeed = result.seed ?? effectiveSeed;
        // Sequence chaining: if this call reused the prior scene's last frame as
        // its first frame (or as a `reference_image_tail_url` wrap), it's the
        // next shot in a planned sequence, not a retry of the previous one.
        const priorLastFrame = lastVideoGeneration?.lastFrameUrl;
        const isSequenceContinuation =
          !!priorLastFrame &&
          (reference_image_url === priorLastFrame ||
            reference_image_tail_url === priorLastFrame);
        lastVideoGeneration = {
          seed: storedSeed,
          provider: result.provider,
          timestamp: Date.now(),
          referenceImageUrl: reference_image_url,
          prompt: effectivePrompt,
        };

        const videoBudget = getTurnBudget();
        // Only count retries/variations against the budget — chained shots of
        // a planned sequence are deliberate, not wasted iterations.
        if (videoBudget && !isSequenceContinuation) videoBudget.videosUsed += 1;
        const videoAttempt = videoBudget?.videosUsed;
        const videosAtBudget = videoBudget
          ? videoBudget.videosUsed >= VIDEO_BUDGET_PER_TURN
          : false;
        const attemptPrefix = isSequenceContinuation
          ? '**Sequence shot — not counted against retry budget** — '
          : videoAttempt
            ? `**Attempt ${videoAttempt} this turn** — `
            : '';
        const finalVideoMarker =
          videosAtBudget && !isSequenceContinuation
            ? " _(final video this turn — do not call media_generate_video again this turn unless chaining the next sequence shot via the prior scene's last_frame URL)_"
            : '';

        const lines = [
          `🎬 ${attemptPrefix}Video generation task started via **${result.provider}** (model: ${result.model})${finalVideoMarker}`,
        ];
        const videoFallbackNotice = formatFallbackNotice(result.provenance);
        if (videoFallbackNotice) lines.push(videoFallbackNotice);
        lines.push(
          `Task ID: \`${result.taskId}\``,
          `Seed: ${storedSeed} (reuse for consistency)`,
          `Motion prompt: "${effectivePrompt.slice(0, 120)}…" (pass prompt="__reuse__" to keep this exact motion in follow-up edits)`,
        );
        lines.push(
          '',
          'Use `media_check_video` with this task ID to check progress.',
        );
        lines.push('Typical generation time: 30 seconds to 5 minutes.');

        if (videoBudget) {
          lines.push('');
          if (videosAtBudget) {
            lines.push(
              `🛑 Iteration budget reached (${videoBudget.videosUsed}/${VIDEO_BUDGET_PER_TURN} videos this turn). Present this result as FINAL and ask the user for direction.`,
            );
          } else {
            lines.push(
              `📊 Iteration budget: ${videoBudget.videosUsed}/${VIDEO_BUDGET_PER_TURN} videos used this turn.`,
            );
          }
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: lines.join('\n'),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Video generation error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  ),

  // ---- Check Video Status ----
  tool(
    'media_check_video',
    `Check the status of an async video generation task.

Returns the current status:
  - queued / running  → still processing, wait and check again
  - succeeded         → video is ready, URL is provided
  - failed            → generation failed, error message provided

IMPORTANT: Do NOT call this tool rapidly. Wait at least 15 seconds between calls (use Bash: sleep 15).
The first check should be 30 seconds after starting the task.

POLLING CONTEXT: Always call this tool from the SAME conversation turn that
dispatched the task. Do NOT wrap the polling loop inside a Task/sub-agent —
sub-agents cannot use MCP tools after the parent turn closes and will fail
with "Stream closed" errors.
\nReturns JSON: { success, status: "queued"|"running"|"succeeded"|"failed"|"cancelled", videoUrl?, duration?, resolution?, error? }`,
    {
      task_id: z
        .string()
        .describe('The task ID returned by media_generate_video.'),
    },
    async ({ task_id }) => {
      try {
        logger.debug(`🔍 check_video called: task_id=${task_id}`);
        const result = await getVideoTaskStatus(task_id);

        if (!result.success) {
          // Any status-check failure (404 ResourceNotFound for stale/cross-
          // session IDs, network errors, etc.) routes through the same
          // HITL guard so the agent never auto-pivots to "I'll just stylize
          // and regenerate" without the user's explicit consent.
          return {
            content: [
              {
                type: 'text' as const,
                text: [
                  `Status check failed for task \`${task_id}\`: ${result.error ?? 'unknown error'}`,
                  '',
                  'This task is gone or unreachable — most commonly a stale/hallucinated task_id from a previous session (BytePlus drops task metadata after ~7 days) or a transient network error.',
                  '',
                  'HUMAN-IN-THE-LOOP — STOP. Do NOT start a new video, do NOT call media_generate_image to stylize, do NOT invent a fix. Tell the user the original task cannot be found and ask what they want to do. On Slack/Discord render:',
                  '```buttons',
                  'Start a new video | video_restart | primary',
                  'Cancel | cancel | danger',
                  '```',
                  'On other channels, list the same options as a numbered list. Wait for the user to choose.',
                ].join('\n'),
              },
            ],
            isError: true,
          };
        }

        const lines: string[] = [];

        switch (result.status) {
          case 'queued':
            lines.push(
              `⏳ Task \`${task_id}\` is **queued** — waiting to start.`,
            );
            lines.push(
              'Wait 15 seconds before checking again (use Bash: sleep 15).',
            );
            break;
          case 'running': {
            // Count polls so we can nudge heartbeats at the 1-min and 2-min
            // marks without spamming every check. Eviction keeps the map
            // bounded in long sessions with many distinct task IDs.
            const prev = videoPollCounts.get(task_id) ?? 0;
            const count = prev + 1;
            if (videoPollCounts.size >= VIDEO_POLL_COUNT_MAX_ENTRIES) {
              const firstKey = videoPollCounts.keys().next().value;
              if (firstKey) videoPollCounts.delete(firstKey);
            }
            videoPollCounts.set(task_id, count);
            lines.push(
              `⏳ Task \`${task_id}\` is **running** — generating video...`,
            );
            lines.push(
              'Wait 15 seconds before checking again (use Bash: sleep 15).',
            );
            // Roughly: poll 3 ≈ 1 min in; poll 6 ≈ 2 min in (15-30 s cadence).
            // One heartbeat per tier is enough — more clutters the Slack thread.
            if (count === 3) {
              lines.push('');
              lines.push(
                'CHANNEL HEARTBEAT — Post ONE short user-facing text message NOW (e.g. "⏳ Still rendering — about 1 minute in, typical total 2-3 min"). In Slack/Discord/Telegram, tool calls are invisible to users; only your text is shown. Do NOT skip this — the user is staring at silence. One line is enough; do not repeat every poll.',
              );
            } else if (count === 6) {
              lines.push('');
              lines.push(
                'CHANNEL HEARTBEAT — Post ONE brief update NOW (e.g. "Still rendering — about 2 minutes in, almost there") before your next poll. This will be the last heartbeat prompt for this task; do not add more.',
              );
            }
            break;
          }
          case 'succeeded': {
            videoPollCounts.delete(task_id);
            lines.push(`✅ Task \`${task_id}\` **succeeded**!`);
            const statusFallbackNotice = formatFallbackNotice(
              result.provenance,
            );
            if (statusFallbackNotice) lines.push(statusFallbackNotice);
            if (result.videoUrl || result.localPath) {
              const savedVideo =
                result.localPath ??
                (result.videoUrl
                  ? await downloadVideoToDisk(result.videoUrl)
                  : null);
              if (savedVideo) {
                lines.push(`Video file: ${savedVideo}`);
                lines.push(
                  tagPersistedAsset(savedVideo, {
                    provider: result.provider,
                    model: result.model ?? 'unknown',
                    provenance: result.provenance,
                    seed: result.seed,
                    prompt: lastVideoGeneration?.prompt,
                  }),
                );
                await ingestPersistedAsset(savedVideo, {
                  provider: result.provider,
                  model: result.model ?? 'unknown',
                  provenance: result.provenance,
                  seed: result.seed,
                  prompt: lastVideoGeneration?.prompt,
                  kind: 'video',
                });
              } else {
                lines.push(`Video URL: ${result.videoUrl}`);
              }
              if (lastVideoGeneration) {
                lastVideoGeneration.videoUrl = result.videoUrl;
                if (result.seed != null) {
                  lastVideoGeneration.seed = result.seed;
                }
                if (result.lastFrameUrl) {
                  lastVideoGeneration.lastFrameUrl = result.lastFrameUrl;
                }
              }
            }
            if (result.lastFrameUrl) {
              lines.push(
                `Last frame: ${result.lastFrameUrl} (use as reference_image_url for the NEXT scene in a sequence to chain scenes seamlessly)`,
              );
            }
            if (result.duration) lines.push(`Duration: ${result.duration}s`);
            if (result.resolution)
              lines.push(`Resolution: ${result.resolution}`);
            if (lastVideoGeneration) {
              lines.push(
                `Seed: ${lastVideoGeneration.seed} (reuse for iterative edits)`,
              );
            }
            if (result.usage)
              lines.push(`Usage: ${JSON.stringify(result.usage)}`);
            break;
          }
          case 'failed':
            videoPollCounts.delete(task_id);
            lines.push(`❌ Task \`${task_id}\` **failed**.`);
            if (result.error) lines.push(`Error: ${result.error}`);
            // Record the failure so media_generate_video can short-circuit a
            // doomed retry with the same reference image.
            if (
              result.errorCode &&
              TERMINAL_OUTPUT_SAFETY_CODES.test(result.errorCode)
            ) {
              lastFailedVideoGeneration = {
                errorCode: result.errorCode,
                referenceImageUrl: lastVideoGeneration?.referenceImageUrl,
                referenceImageTailUrl: undefined,
                timestamp: Date.now(),
              };
              // The adapter's `result.error` already carries the
              // HUMAN-IN-THE-LOOP footer (friendlyContentPolicyMessage).
              // Don't add conflicting auto-recovery instructions here —
              // the agent must stop and ask the user, not auto-fix.
            } else {
              lines.push(
                'Terminal state — do NOT retry polling. Relay the error to the user in plain language and stop; do not invent a fix.',
              );
            }
            break;
          case 'cancelled':
            videoPollCounts.delete(task_id);
            lines.push(`🚫 Task \`${task_id}\` was **cancelled**.`);
            lines.push(
              'Terminal state — do NOT retry polling. Inform the user and stop.',
            );
            break;
          case 'expired':
            videoPollCounts.delete(task_id);
            lines.push(
              `⌛ Task \`${task_id}\` **expired** (BytePlus keeps result URLs for ~24 h and task metadata for ~7 days).`,
            );
            lines.push(
              'The video cannot be recovered — regenerate with media_generate_video. Do NOT retry this task_id.',
            );
            break;
        }

        return {
          content: [{ type: 'text' as const, text: lines.join('\n') }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Status check error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  ),

  // ---- DesignMode Media Generate ----
  tool(
    'neuma_media_generate',
    `Start a DesignMode project media task. Returns quickly with a DesignMode task id; call neuma_media_wait until status is done or failed.

Outputs are written inside design-projects/<projectId>/ and recorded with provenance.`,
    {
      projectId: z
        .string()
        .describe('DesignMode project id, e.g. design_abc123.'),
      surface: z.enum(['image', 'video', 'audio', 'document']),
      model: z.string().optional(),
      output: z.string().optional(),
      prompt: z.string(),
      aspect: z.string().optional(),
      lengthSeconds: z.number().int().positive().optional(),
      durationSeconds: z.number().int().positive().optional(),
      audioKind: z
        .enum(['speech', 'voiceover', 'music', 'sfx', 'ambience'])
        .optional(),
      voice: z.string().optional(),
      languageBoost: z
        .string()
        .optional()
        .describe(
          'MiniMax TTS language_boost override, e.g. English, Spanish, Chinese,Yue. Omit unless the user explicitly requests a language boost.',
        ),
      image: z
        .string()
        .optional()
        .describe(
          'Project-relative reference image path for image/video generation.',
        ),
      compositionDir: z
        .string()
        .optional()
        .describe('Project-relative HyperFrames composition directory.'),
    },
    async (args) => {
      try {
        const task = await startDesignMediaTask({
          projectId: args.projectId,
          surface: args.surface,
          model: args.model,
          output: args.output,
          prompt: args.prompt,
          aspect: args.aspect,
          lengthSeconds: args.lengthSeconds,
          durationSeconds: args.durationSeconds,
          audioKind: args.audioKind,
          voice: args.voice,
          languageBoost: args.languageBoost,
          image: args.image,
          compositionDir: args.compositionDir,
        });
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                taskId: task.taskId,
                status: task.state,
                task,
              }),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `DesignMode media generate failed: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  ),

  // ---- DesignMode Media Wait ----
  tool(
    'neuma_media_wait',
    `Long-poll a DesignMode media task for up to roughly 25 seconds.

Exit-code semantics for shell wrappers:
- done: stop and use the returned file
- running: call again with nextSince
- failed/cancelled: stop and surface providerError`,
    {
      taskId: z.string(),
      since: z.number().int().min(0).optional(),
    },
    async ({ taskId, since }) => {
      try {
        const result = await waitDesignMediaTask(taskId, since ?? 0);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
          isError:
            result.status === 'failed' || result.status === 'cancelled'
              ? true
              : undefined,
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `DesignMode media wait failed: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  ),

  // ---- List Capabilities ----
  tool(
    'media_list_capabilities',
    `List all available media generation providers and their capabilities.
Use this to check which providers are configured before generating media.
\nReturns JSON: { imageProviders: string[], videoProviders: string[] }`,
    {},
    async () => {
      try {
        const caps = listCapabilities();

        const lines: string[] = [
          '**Available Media Generation Providers:**',
          '',
        ];

        if (caps.imageProviders.length > 0) {
          lines.push(
            `🎨 **Image generation**: ${caps.imageProviders.join(', ')}`,
          );
        } else {
          lines.push('🎨 **Image generation**: No providers configured');
        }

        if (caps.videoProviders.length > 0) {
          lines.push(
            `🎬 **Video generation**: ${caps.videoProviders.join(', ')}`,
          );
        } else {
          lines.push('🎬 **Video generation**: No providers configured');
        }

        if (
          caps.imageProviders.length === 0 &&
          caps.videoProviders.length === 0
        ) {
          lines.push('');
          lines.push(
            'To enable media generation, add a provider with image/video models in Settings → Models.',
          );
        }

        return {
          content: [{ type: 'text' as const, text: lines.join('\n') }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error listing capabilities: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  ),
];

// ============================================================================
// Export
// ============================================================================

/** All media tool names for allowedTools registration */
export const MEDIA_TOOL_NAMES = mediaTools.map((t) => t.name);

/** Create the Media Generation MCP server instance */
export function createMediaMcpServer() {
  return createSdkMcpServer({
    name: 'media-generation',
    version: '1.0.0',
    tools: mediaTools,
  });
}
