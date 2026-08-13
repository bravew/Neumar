/**
 * Codex CLI Adapter — image generation via the local `codex` binary.
 *
 * Drives a Codex thread with high reasoning effort ("thinking" mode) and asks
 * it to generate an image either:
 *
 *   • via the OpenAI Images API (curl → gpt-image-2 → base64 → file) when an
 *     OPENAI_API_KEY is available, or
 *   • via Codex's native `$imagegen` skill (gpt-image-2) when the binary is
 *     authenticated through a ChatGPT subscription.
 *
 * See doc-dev/plan/2026-04-21-codex-cli-image-generation-adapter.md.
 *
 * @module media-generation/adapters/codex
 */

import { existsSync, readdirSync, realpathSync, statSync } from 'fs';
import { mkdir, writeFile } from 'fs/promises';
import { homedir, tmpdir } from 'os';
import { extname, join, resolve as resolvePath, sep } from 'path';

import { Codex } from '@openai/codex-sdk';
import type {
  Input as CodexInput,
  ModelReasoningEffort,
  ThreadEvent,
  UserInput as CodexUserInput,
} from '@openai/codex-sdk';

import { getSetting } from '@/shared/db/operations';
import { NetworkPolicyDenied, safeFetch } from '@/shared/network-policy/fetch';
import { trustedLocalPolicy } from '@/shared/network-policy/schema';
import { getRunEnv } from '@/shared/services/session-context';
import { logUsage } from '@/shared/services/usage-logger';
import {
  getExtendedPath,
  resolveCodexBinaryPath,
} from '@/shared/utils/codex-binary';
import { createLogger } from '@/shared/utils/logger';

import type {
  GenerateImageParams,
  ImageGenerationResult,
  MediaGenerationAdapter,
  MediaProviderConfig,
} from '../types';

const logger = createLogger('CodexMedia');

const DEFAULT_IMAGE_MODEL = 'gpt-image-2';

/** Codex driver model — used to reason about the image prompt, not to render. */
const DEFAULT_CODEX_REASONING_MODEL = 'gpt-5.5';

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

/**
 * Hard ceiling on a single Codex image-gen run. The SDK's `ThreadOptions`
 * does not expose a max-turns knob, so we cap runaway sessions via
 * `AbortSignal` on the streamed turn instead. Five minutes comfortably
 * covers high-reasoning + subscription-path runs; anything longer is
 * almost certainly a looping agent.
 */
const CODEX_RUN_TIMEOUT_MS = 5 * 60_000;

/** 50 MB ceiling on a downloaded reference image — well above any sane source. */
const MAX_REFERENCE_IMAGE_BYTES = 50 * 1024 * 1024;

/**
 * Presence of the Codex OAuth token file. Absence is a reliable signal to
 * avoid the subscription-only code path; presence doesn't guarantee the token
 * is still valid.
 */
function hasCodexSubscriptionAuth(): boolean {
  return existsSync(join(homedir(), '.codex', 'auth.json'));
}

function mapThinkingEffort(params: GenerateImageParams): ModelReasoningEffort {
  if (params.quality && /hd|max|ultra/i.test(params.quality)) return 'xhigh';
  return 'high';
}

/** Neutralise the prompt's backtick fences so we can drop it into a code block. */
function escapeForCodeBlock(text: string): string {
  return text.replace(/```/g, '`​``');
}

function buildPrompt(
  kind: 'api-key' | 'subscription',
  params: GenerateImageParams,
  outPrefix: string,
  hasReferenceImage: boolean,
): string {
  const safePrompt = escapeForCodeBlock(params.prompt);
  const header = [
    'You are a non-interactive image generation runner. Do NOT explain.',
    'Do NOT write any files other than the output images. Do NOT commit.',
    '',
  ];
  const trailer = [
    '',
    `After saving, reply with only the saved filenames (${outPrefix}-0.png, ...), one per line.`,
  ];

  let body: string[];
  if (kind === 'api-key') {
    const size = params.size ?? '1024x1024';
    const n = Math.max(1, Math.min(params.count ?? 1, 10));
    const seedLine =
      params.seed != null ? `,\n    "seed": ${Number(params.seed)}` : '';
    body = [
      `Generate ${n} image(s) using the OpenAI Images API with model "${DEFAULT_IMAGE_MODEL}".`,
      'Run exactly this shell pipeline:',
      '',
      '```bash',
      'set -e',
      `curl -sS https://api.openai.com/v1/images/generations \\`,
      `  -H "Authorization: Bearer $OPENAI_API_KEY" \\`,
      `  -H "Content-Type: application/json" \\`,
      `  -d '{`,
      `    "model": "${DEFAULT_IMAGE_MODEL}",`,
      `    "prompt": ${JSON.stringify(safePrompt)},`,
      `    "n": ${n},`,
      `    "size": "${size}",`,
      `    "response_format": "b64_json"${seedLine}`,
      `  }' > response.json`,
      `for i in $(seq 0 ${n - 1}); do`,
      `  jq -r ".data[$i].b64_json" response.json | base64 -d > ${outPrefix}-$i.png`,
      'done',
      'rm -f response.json',
      '```',
    ];
  } else {
    const n = Math.max(1, Math.min(params.count ?? 1, 4));
    if (hasReferenceImage) {
      // The reference image is delivered via the SDK's `local_image` input
      // alongside this text. Tell the model to treat it as the source for an
      // image-to-image edit rather than as inspiration for a fresh render.
      body = [
        `Edit the reference image attached to this turn using the $imagegen skill (image-to-image).`,
        `Apply ONLY the change described below; preserve composition, identity, and color from the reference where the prompt does not contradict.`,
        `Generate ${n} image(s).`,
        '',
        'Change to apply:',
        '```',
        safePrompt,
        '```',
        '',
        `Save each generated image into the current working directory as ${outPrefix}-0.png (and ${outPrefix}-1.png, ... if n > 1).`,
      ];
    } else {
      body = [
        `Generate ${n} image(s) with the $imagegen skill for this prompt:`,
        '',
        '```',
        safePrompt,
        '```',
        '',
        `Save each generated image into the current working directory as ${outPrefix}-0.png (and ${outPrefix}-1.png, ... if n > 1).`,
      ];
    }
  }

  return [...header, ...body, ...trailer].join('\n');
}

/**
 * Confirm an absolute reference-image path lives under one of the directories
 * we trust the agent / MCP layer to populate (staging dir, OS tmpdir, user's
 * workDir). Compares both literal and realpath-resolved prefixes so macOS's
 * `/var → /private/var` symlink doesn't reject legitimate temp paths.
 */
function isPathWithinPermittedPrefix(
  absPath: string,
  stagingDir: string,
): boolean {
  const tmp = tmpdir();
  const work = getSetting('workDir') ?? '';
  const candidates = [stagingDir, tmp, work, '/tmp'].filter(Boolean);

  let resolvedPath: string;
  try {
    resolvedPath = realpathSync(absPath);
  } catch {
    resolvedPath = absPath;
  }

  for (const c of candidates) {
    let resolvedC: string;
    try {
      resolvedC = realpathSync(c);
    } catch {
      resolvedC = c;
    }
    const withSep = (p: string) => (p.endsWith(sep) ? p : p + sep);
    if (
      absPath.startsWith(withSep(c)) ||
      absPath === c ||
      resolvedPath.startsWith(withSep(resolvedC)) ||
      resolvedPath === resolvedC
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Materialise a reference image into `dir` so it can be passed to Codex as a
 * `local_image` input. Accepts data: URIs, https:// URLs, and absolute file
 * paths. Returns the absolute on-disk path, or null if the input couldn't be
 * resolved (caller should fall back to text-only).
 */
async function materialiseReferenceImage(
  ref: string,
  dir: string,
  runId: string,
): Promise<string | null> {
  // Already on disk → require the path to live under a permitted prefix
  // (workDir, tmpdir, or the staging dir) so direct callers of generateImage
  // can't be tricked into reading arbitrary local files (e.g. /etc/ssh/...).
  // The MCP tool layer validates paths before calling the adapter, but
  // integration tests and future routes hit this directly.
  if (ref.startsWith('/')) {
    if (!existsSync(ref)) return null;
    if (!isPathWithinPermittedPrefix(ref, dir)) {
      logger.warn(
        `Reference image path rejected: outside permitted prefixes (${ref})`,
      );
      return null;
    }
    return ref;
  }

  if (ref.startsWith('data:')) {
    const m = ref.match(/^data:([^;,]+);base64,(.+)$/);
    if (!m) return null;
    const mime = m[1]!.toLowerCase();
    const ext =
      mime.includes('jpeg') || mime.includes('jpg')
        ? '.jpg'
        : mime.includes('webp')
          ? '.webp'
          : '.png';
    const out = resolvePath(join(dir, `ref-${runId}${ext}`));
    await writeFile(out, Buffer.from(m[2]!, 'base64'));
    return out;
  }

  if (ref.startsWith('https://')) {
    try {
      // safeFetch: per-hop SSRF validation (blocks private IPs, cloud metadata
      // endpoints, link-local) and DNS-pinned redirects. Plain fetch() here
      // would let an agent-supplied URL hit 169.254.169.254 etc.
      const res = await safeFetch(ref, trustedLocalPolicy(), {
        method: 'GET',
        timeoutMs: 15_000,
      });
      if (res.status < 200 || res.status >= 300) return null;
      // Reject oversized bodies — safeFetch buffers fully, so a multi-GB
      // response would otherwise exhaust process memory.
      if (res.body.byteLength > MAX_REFERENCE_IMAGE_BYTES) return null;
      const ct = res.headers['content-type'] ?? 'image/png';
      const ext =
        ct.includes('jpeg') || ct.includes('jpg')
          ? '.jpg'
          : ct.includes('webp')
            ? '.webp'
            : '.png';
      const out = resolvePath(join(dir, `ref-${runId}${ext}`));
      await writeFile(out, res.body);
      return out;
    } catch (err) {
      if (err instanceof NetworkPolicyDenied) {
        logger.warn(
          `Reference image URL rejected by SSRF policy: ${err.reason}`,
        );
      } else {
        // Surface DNS/TLS/timeout/HTTP transport failures — silently swallowing
        // them makes a failed reference fetch invisible in production logs.
        logger.warn(
          `Reference image fetch failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      return null;
    }
  }

  return null;
}

/** Image files under `dir` whose name begins with `prefix` and whose mtime is >= sinceMs. */
function listMatchingImages(
  dir: string,
  prefix: string,
  sinceMs: number,
): string[] {
  try {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      if (!name.startsWith(prefix)) continue;
      if (!IMAGE_EXTENSIONS.has(extname(name).toLowerCase())) continue;
      const p = resolvePath(join(dir, name));
      try {
        if (statSync(p).mtimeMs >= sinceMs - 1000) out.push(p);
      } catch {
        /* skip */
      }
    }
    return out;
  } catch {
    return [];
  }
}

export class CodexAdapter implements MediaGenerationAdapter {
  readonly name = 'Codex CLI';
  readonly supportsImage = true;
  /**
   * Edit support is subscription-only: the OAuth path materialises the
   * reference image to disk and feeds it to `$imagegen` as a `local_image`
   * input (gpt-image-2 image-to-image mode). The API-key path uses
   * `/v1/images/generations`, which has no input-image surface — silently
   * dropping the reference would produce a from-scratch image, which is
   * worse than letting the router fall back to another adapter.
   *
   * Resolved at runtime so a freshly logged-in subscription is picked up
   * without restarting the server.
   */
  get supportsImageEdit(): boolean {
    return hasCodexSubscriptionAuth();
  }
  /** Codex does not yet offer a reliable video generation surface. */
  readonly supportsVideo = false;

  constructor(private readonly config: MediaProviderConfig) {}

  async generateImage(
    params: GenerateImageParams,
  ): Promise<ImageGenerationResult> {
    const codexPath = resolveCodexBinaryPath();
    if (!codexPath) {
      return {
        success: false,
        provider: this.name,
        model: 'none',
        images: [],
        error:
          'Codex CLI binary not found on PATH. Install with: npm install -g @openai/codex',
      };
    }

    // Per-turn override (Slack App Home PAT) → instance config → server env.
    const apiKey = this.config.apiKey || getRunEnv('OPENAI_API_KEY') || '';
    const hasSubscription = hasCodexSubscriptionAuth();
    if (!apiKey && !hasSubscription) {
      return {
        success: false,
        provider: this.name,
        model: 'none',
        images: [],
        error:
          'Codex CLI has no auth available: run `codex login` to authenticate a ChatGPT subscription, or set OPENAI_API_KEY.',
      };
    }

    // Prefer subscription whenever Codex is logged in — `$imagegen` is bundled
    // with the ChatGPT plan and doesn't need an API key. Fall back to the
    // direct-curl path only when no subscription auth is present.
    const kind: 'api-key' | 'subscription' = hasSubscription
      ? 'subscription'
      : 'api-key';
    const forwardApiKey = kind === 'api-key' && !!apiKey;

    // Image edits only work on the subscription path (see `supportsImageEdit`).
    // The router excludes us when this is the case, but a caller bypassing the
    // router (direct-by-name, tests) would otherwise get a silent text-to-image
    // result that ignores the reference. Fail loudly instead.
    if (kind === 'api-key' && params.referenceImageUrl) {
      return {
        success: false,
        provider: this.name,
        model: DEFAULT_IMAGE_MODEL,
        images: [],
        error:
          'Codex CLI image edits require ChatGPT subscription auth (run `codex login`). The API-key path uses /v1/images/generations, which has no reference-image input.',
      };
    }

    const runId = crypto.randomUUID().slice(0, 8);
    // Treat empty string as "not provided" — the MCP tool passes `workDir: ''`
    // when it doesn't care, and mkdir('') throws ENOENT.
    const workDir =
      params.workDir && params.workDir.trim()
        ? resolvePath(params.workDir)
        : resolvePath(join(tmpdir(), `media-codex-${runId}`));
    await mkdir(workDir, { recursive: true });
    const outPrefix = `out-${runId}`;

    // Materialise the reference image to disk (subscription path only — the
    // API-key path uses /v1/images/generations which doesn't accept inputs;
    // edit support there would require a /v1/images/edits multipart rewrite).
    let refImagePath: string | null = null;
    if (kind === 'subscription' && params.referenceImageUrl) {
      refImagePath = await materialiseReferenceImage(
        params.referenceImageUrl,
        workDir,
        runId,
      );
      if (!refImagePath) {
        logger.warn(
          'Could not materialise reference image — falling back to text-only generation',
        );
      } else {
        logger.info(`Reference image staged at ${refImagePath}`);
      }
    }

    const effort = mapThinkingEffort(params);
    const prompt = buildPrompt(kind, params, outPrefix, !!refImagePath);

    logger.info(
      `Codex image-gen start: model=${DEFAULT_IMAGE_MODEL} effort=${effort} path=${kind} workDir=${workDir}`,
    );

    const startMs = Date.now();

    let codex: Codex;
    try {
      codex = new Codex({
        ...(forwardApiKey ? { apiKey } : {}),
        codexPathOverride: codexPath,
        config: { model: DEFAULT_CODEX_REASONING_MODEL },
        env: {
          // Setting OPENAI_API_KEY on the subscription path would shadow the
          // OAuth token in ~/.codex/auth.json and break `$imagegen`.
          ...(forwardApiKey ? { OPENAI_API_KEY: apiKey } : {}),
          PATH: getExtendedPath(),
          HOME: process.env.HOME ?? homedir(),
          TMPDIR: process.env.TMPDIR ?? '/tmp',
          ...(process.env.HTTP_PROXY
            ? { HTTP_PROXY: process.env.HTTP_PROXY }
            : {}),
          ...(process.env.HTTPS_PROXY
            ? { HTTPS_PROXY: process.env.HTTPS_PROXY }
            : {}),
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        provider: this.name,
        model: DEFAULT_IMAGE_MODEL,
        images: [],
        error: `Failed to initialise Codex client: ${msg}`,
      };
    }

    const discoveredPaths: string[] = [];
    let inputTokens = 0;
    let outputTokens = 0;
    let reasoningOutputTokens = 0;

    try {
      const thread = codex.startThread({
        workingDirectory: workDir,
        sandboxMode: 'workspace-write',
        skipGitRepoCheck: true,
        modelReasoningEffort: effort,
      });

      // Pass the reference image alongside the prompt as a `local_image`
      // input. Codex SDK 0.125+ exposes this as a structured input form
      // ({type:'local_image', path}) which `$imagegen` consumes directly,
      // running gpt-image-2 in image-to-image mode.
      const input: CodexInput = refImagePath
        ? ([
            { type: 'local_image', path: refImagePath },
            { type: 'text', text: prompt },
          ] satisfies CodexUserInput[])
        : prompt;
      const { events } = await thread.runStreamed(input, {
        signal: AbortSignal.timeout(CODEX_RUN_TIMEOUT_MS),
      });
      for await (const event of events as AsyncIterable<ThreadEvent>) {
        if (event.type === 'item.completed') {
          const item = event.item;
          if (item.type === 'file_change') {
            // Confine to workDir: the sandbox already enforces this for writes,
            // but we also surface `localPath` straight to the agent, so a
            // rogue file_change event with an absolute path outside workDir
            // must not leak through.
            const workDirPrefix = workDir.endsWith(sep)
              ? workDir
              : workDir + sep;
            for (const change of item.changes) {
              const abs = change.path.startsWith('/')
                ? change.path
                : resolvePath(join(workDir, change.path));
              if (
                abs.startsWith(workDirPrefix) &&
                IMAGE_EXTENSIONS.has(extname(abs).toLowerCase()) &&
                existsSync(abs)
              ) {
                discoveredPaths.push(abs);
              }
            }
          }
        } else if (event.type === 'turn.completed' && event.usage) {
          inputTokens +=
            (event.usage.input_tokens ?? 0) -
            (event.usage.cached_input_tokens ?? 0);
          outputTokens += event.usage.output_tokens ?? 0;
          reasoningOutputTokens += event.usage.reasoning_output_tokens ?? 0;
        } else if (event.type === 'error' || event.type === 'turn.failed') {
          const errObj = event as unknown as {
            error?: { message?: string };
            message?: string;
          };
          throw new Error(
            errObj.error?.message ?? errObj.message ?? 'Codex thread failed',
          );
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const truncated =
        msg.length > 300 ? msg.slice(0, 300) + '... (truncated)' : msg;
      logger.error('Codex image generation failed:', truncated);
      return {
        success: false,
        provider: this.name,
        model: DEFAULT_IMAGE_MODEL,
        images: [],
        error: truncated,
      };
    }

    // Codex shell-written files don't always surface a file_change event,
    // so fall back to scanning the workdir for files matching our prefix.
    if (discoveredPaths.length === 0) {
      const scanned = listMatchingImages(workDir, outPrefix, startMs);
      discoveredPaths.push(...scanned);
    }

    if (discoveredPaths.length === 0) {
      return {
        success: false,
        provider: this.name,
        model: DEFAULT_IMAGE_MODEL,
        images: [],
        error:
          'Codex finished without writing any image file. Check that the binary has network access and valid auth.',
      };
    }

    const uniquePaths = Array.from(new Set(discoveredPaths)).sort();
    // Codex always writes the file to disk; the MCP layer reuses `localPath`
    // and never reads `url`, so a file:// URL avoids the multi-MB base64
    // encode that fileToDataUrl used to do.
    const images = uniquePaths.map((p) => ({
      url: `file://${p}`,
      localPath: p,
      size: params.size,
    }));

    logUsage({
      callType: 'image',
      provider: 'codex',
      model: DEFAULT_IMAGE_MODEL,
      unitType: 'image',
      unitCount: images.length,
      unitCostMicro: forwardApiKey ? 40_000 : 0, // subscription path is bundled
      latencyMs: Date.now() - startMs,
      inputTokens: inputTokens || undefined,
      outputTokens: outputTokens || undefined,
      reasoningOutputTokens: reasoningOutputTokens || undefined,
    });

    return {
      success: true,
      provider: this.name,
      model: DEFAULT_IMAGE_MODEL,
      images,
      seed: params.seed,
    };
  }
}
