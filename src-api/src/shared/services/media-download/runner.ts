/**
 * Run one authorized download batch through yt-dlp.
 *
 * The model never reaches this code with a path: the caller supplies a
 * destination resolver that re-checks the grant, and every write happens
 * inside a staging folder the runtime may write to. Progress comes from
 * yt-dlp's structured `--progress-template` lines, not from scraping a
 * terminal, and the final file is the one yt-dlp reports after its
 * post-processing move. Publication never replaces an existing file, and a
 * failed item does not stop its siblings.
 */

import { constants } from 'node:fs';
import { copyFile, link, lstat, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, isAbsolute, join } from 'node:path';

import {
  applyDownloadUpdate,
  downloadMediaOperationSchema,
  type DownloadActivity,
  type DownloadAsset,
  type DownloadItem,
  type DownloadMediaOperation,
} from '@neumar/video-ir';
import { z } from 'zod';

import { isFfmpegSkillError } from '@/shared/services/ffmpeg-skill/errors';
import { runSupervised } from '@/shared/services/ffmpeg-skill/supervisor';
import { createLogger } from '@/shared/utils/logger';

import { DestinationDenied } from './destination';
import { managedMediaRuntime, type DownloadMediaRuntime } from './runtime';

const logger = createLogger('MediaDownloadRunner');

/** Per-file and per-batch bounds; the proxy and the wrapper enforce them too. */
export const MAX_FILE_BYTES = 2 * 1024 ** 3;
export const MAX_BATCH_BYTES = 4 * 1024 ** 3;
const MAX_STDOUT_BYTES = 8 * 1024 ** 2;
const MAX_BATCH_SECONDS = 30 * 60;
const MAX_STREAMS = 32;

const MIME_BY_EXTENSION: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
};

type FailedItem = Extract<DownloadItem, { phase: 'failed' }>;
type FailureReason = FailedItem['reason'];
type ItemState = DownloadItem extends infer Item
  ? Item extends DownloadItem
    ? Omit<Item, 'itemId' | 'sequence'>
    : never
  : never;
type StreamState = Extract<
  DownloadItem,
  { phase: 'transferring' }
>['streams'][number];

export interface DownloadMediaOptions {
  signal: AbortSignal;
  /** The folder the grant authorizes, resolved and checked by the caller. */
  resolveDestination(operation: DownloadMediaOperation): Promise<string>;
  /** Record the published file and return the asset the card may play. */
  registerAsset(
    operation: DownloadMediaOperation,
    itemId: string,
    grantedRoot: string,
    filePath: string,
  ): Promise<DownloadAsset>;
  emit(activity: DownloadActivity): void;
  /** Host-only seam; never a tool argument or a client-controlled binary. */
  runtime?: DownloadMediaRuntime;
}

class ItemError extends Error {
  constructor(readonly reason: FailureReason) {
    super(reason);
    this.name = 'ItemError';
  }
}

const progressSchema = z.object({
  stream: z.string().min(1).max(128),
  bytes: z.number().int().nonnegative(),
  total: z.number().int().nonnegative().nullish(),
  estimate: z.number().nonnegative().nullish(),
  speed: z.number().nonnegative().nullish(),
  eta: z.number().nonnegative().nullish(),
});

const PROGRESS_PREFIX = 'NDPROGRESS:';
const FINISHED = 'NDFINISH';
const FILE_PREFIX = 'NDFILE:';

/**
 * Fixed argv. `--` ends option parsing so a URL can never become a flag, and
 * the output template keeps the post-merge name inside the staging folder.
 */
export function downloadArgv(input: {
  url: string;
  maxHeight?: number;
  stage: string;
  proxy: string;
  maxFileBytes: number;
}): string[] {
  const cap = input.maxHeight ? `[height<=${input.maxHeight}]` : '';
  return [
    '--ignore-config',
    '--no-plugin-dirs',
    '--no-remote-components',
    '--no-cache-dir',
    '--no-playlist',
    '--playlist-end',
    '1',
    '--no-overwrites',
    '--restrict-filenames',
    '--no-simulate',
    ...(input.proxy ? ['--proxy', input.proxy] : []),
    '--no-js-runtimes',
    '--socket-timeout',
    '20',
    '--retries',
    '1',
    '--max-filesize',
    String(input.maxFileBytes),
    '--downloader',
    'native',
    '-f',
    `bv${cap}+ba/b${cap}`,
    '-P',
    input.stage,
    '-o',
    '%(title).96B [%(id).40B].%(ext)s',
    '--newline',
    '--progress',
    '--progress-delta',
    '0.3',
    '--progress-template',
    // An absent field prints a bare `NA`, which is not JSON; `|null` makes the
    // optional metrics parse as null so the byte count still arrives.
    `download:${PROGRESS_PREFIX}{"stream":%(info.format_id)j,"bytes":%(progress.downloaded_bytes)j,"total":%(progress.total_bytes|null)j,"estimate":%(progress.total_bytes_estimate|null)j,"speed":%(progress.speed|null)j,"eta":%(progress.eta|null)j}`,
    '--progress-template',
    `postprocess:${FINISHED}`,
    '--print',
    `after_move:${FILE_PREFIX}%(filepath)j`,
    '--',
    input.url,
  ];
}

function classify(lines: readonly string[]): FailureReason {
  const text = lines.join('\n').toLowerCase();
  if (/max-filesize|file is larger than/.test(text)) return 'limit';
  if (/http error (404|410)|video unavailable|not available/.test(text)) {
    return 'unavailable';
  }
  return 'download';
}

async function identity(
  path: string,
): Promise<{ device: string; inode: string }> {
  const stat = await lstat(path, { bigint: true });
  return { device: String(stat.dev), inode: String(stat.ino) };
}

async function sameIdentity(
  path: string,
  expected: { device: string; inode: string },
): Promise<boolean> {
  try {
    const stat = await lstat(path, { bigint: true });
    return (
      String(stat.dev) === expected.device &&
      String(stat.ino) === expected.inode
    );
  } catch {
    return false;
  }
}

/** A staging folder the runtime is allowed to write, removed by the caller. */
async function createStage(): Promise<string> {
  return mkdtemp(join(await realpath(tmpdir()), 'media-item-'));
}

/**
 * Remove a private working folder without letting a failure change the item.
 * A leftover temp folder is reported; it must not undo a saved file or stop
 * the siblings that have not started.
 */
async function removeQuietly(path: string): Promise<void> {
  try {
    await rm(path, { recursive: true, force: true });
  } catch (error) {
    logger.warn('Could not remove a download working folder', {
      path,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** The path in an `after_move` line; `%(filepath)j` prints a JSON string. */
function reportedPath(payload: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(payload);
    return typeof parsed === 'string' ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export async function runDownloadMedia(
  raw: DownloadMediaOperation,
  options: DownloadMediaOptions,
): Promise<DownloadActivity> {
  const operation = downloadMediaOperationSchema.parse(raw);
  const { taskId, runId, toolCallId, batchId } = operation;
  const scope = { version: 1 as const, taskId, runId, toolCallId, batchId };
  let state: DownloadActivity = {
    ...scope,
    items: operation.input.urls.map((_, index) => ({
      itemId: String(index + 1),
      sequence: 0,
      phase: 'queued',
    })),
  };
  options.emit(state);

  const budget = AbortSignal.timeout(MAX_BATCH_SECONDS * 1000);
  const signal = AbortSignal.any([options.signal, budget]);
  let remaining = MAX_BATCH_BYTES;

  for (const [index, url] of operation.input.urls.entries()) {
    const itemId = String(index + 1);
    let sequence = 0;
    const update = (next: ItemState) => {
      state = applyDownloadUpdate(state, {
        ...scope,
        item: { ...next, itemId, sequence: ++sequence },
      });
      options.emit(state);
    };

    let stage: string | undefined;
    // Bytes this attempt cost the batch, whatever its outcome: a collision or
    // a cancellation still spent what the network delivered.
    let charged = 0;
    // A stop the runner caused itself; the caller's signal is a user stop.
    let internalStop: FailureReason | undefined;
    try {
      signal.throwIfAborted();
      const grantedRoot = await options.resolveDestination(operation);
      const grant = await identity(grantedRoot);
      if (!isAbsolute(grantedRoot)) throw new ItemError('denied');

      const target = new URL(url);
      if (
        target.username ||
        target.password ||
        (target.protocol !== 'http:' && target.protocol !== 'https:')
      ) {
        throw new ItemError('denied');
      }
      const maxFileBytes = Math.min(remaining, MAX_FILE_BYTES);
      if (maxFileBytes <= 0) throw new ItemError('limit');

      stage = await createStage();
      const runtime = options.runtime ?? managedMediaRuntime;
      const prepared = await runtime.prepare(stage, signal, {
        maxFileBytes,
      });

      const streams = new Map<string, StreamState>();
      const stderrLines: string[] = [];
      let finished = false;
      let reported = false;
      let reportedBytes = 0;
      const controller = new AbortController();
      let publishedFile: string | undefined;

      const progress = (line: string) => {
        if (line === FINISHED) {
          if (!finished) {
            finished = true;
            update({ phase: 'postprocessing' });
          }
          return;
        }
        if (line.startsWith(FILE_PREFIX)) {
          publishedFile = reportedPath(line.slice(FILE_PREFIX.length));
          return;
        }
        if (!line.startsWith(PROGRESS_PREFIX) || finished || internalStop) {
          return;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(line.slice(PROGRESS_PREFIX.length));
        } catch {
          return;
        }
        const progressLine = progressSchema.safeParse(parsed);
        if (!progressLine.success) return;
        const { stream, bytes, total, estimate, speed, eta } =
          progressLine.data;
        // Format ids come from untrusted extractors; expose a local ordinal.
        streams.set(stream, {
          streamId: streams.get(stream)?.streamId ?? String(streams.size + 1),
          bytes,
          ...(total != null ? { totalBytes: total } : {}),
          ...(estimate != null
            ? { estimatedTotalBytes: Math.round(estimate) }
            : {}),
          ...(speed != null ? { bytesPerSecond: speed } : {}),
          ...(eta != null ? { etaSeconds: eta } : {}),
        });
        reportedBytes = [...streams.values()].reduce(
          (sum, item) => sum + item.bytes,
          0,
        );
        if (streams.size > MAX_STREAMS || reportedBytes > maxFileBytes) {
          internalStop = 'limit';
          controller.abort();
          return;
        }
        reported = true;
        update({ phase: 'transferring', streams: [...streams.values()] });
      };

      try {
        const result = await runSupervised({
          command: prepared.command,
          args: [
            ...prepared.prefix,
            ...downloadArgv({
              url,
              ...(operation.input.maxHeight
                ? { maxHeight: operation.input.maxHeight }
                : {}),
              stage,
              proxy: prepared.proxy,
              maxFileBytes,
            }),
          ],
          cwd: stage,
          env: {
            PATH: process.env.PATH ?? '/usr/bin:/bin',
            HOME: stage,
            TMPDIR: stage,
            LANG: 'en_US.UTF-8',
          },
          signal: AbortSignal.any([signal, controller.signal]),
          timeoutMs: MAX_BATCH_SECONDS * 1000,
          maxOutputBytes: MAX_STDOUT_BYTES,
          onStdoutProgress: progress,
          onProgress: (line) => {
            stderrLines.push(line);
            if (stderrLines.length > 200) stderrLines.shift();
          },
        });
        if (result.exitCode !== 0) {
          throw new ItemError(internalStop ?? classify(stderrLines));
        }
      } finally {
        charged = Math.max(charged, prepared.received(), reportedBytes);
        await prepared.close();
      }

      signal.throwIfAborted();

      // Only the file yt-dlp reports after its move is a deliverable.
      if (typeof publishedFile !== 'string' || !isAbsolute(publishedFile)) {
        throw new ItemError('download');
      }
      if (!reported && !finished) {
        // A download too fast to report progress still reports postprocessing.
        finished = true;
        update({ phase: 'postprocessing' });
      }
      const resolved = await realpath(publishedFile).catch(() => undefined);
      if (!resolved || dirname(resolved) !== stage)
        throw new ItemError('denied');
      const source = await lstat(resolved);
      const name = basename(resolved);
      const mime = MIME_BY_EXTENSION[extname(name).toLowerCase()];
      if (
        !mime ||
        /[\\\x00-\x1f\x7f]/.test(name) ||
        name.startsWith('.') ||
        name.length > 255 ||
        !source.isFile() ||
        source.nlink !== 1 ||
        source.size === 0
      ) {
        throw new ItemError('download');
      }
      charged = Math.max(charged, source.size);
      if (source.size > maxFileBytes) throw new ItemError('limit');

      const checkGrant = async () => {
        signal.throwIfAborted();
        const current = await options.resolveDestination(operation);
        if (current !== grantedRoot || !(await sameIdentity(current, grant))) {
          throw new ItemError('denied');
        }
      };
      await checkGrant();

      // Copy privately on the destination volume, then publish with link(),
      // which fails rather than replacing a name that already exists.
      const delivery = await mkdtemp(join(grantedRoot, '.media-delivery-'));
      const deliveryIdentity = await identity(delivery);
      const staged = join(delivery, 'final');
      try {
        await copyFile(resolved, staged, constants.COPYFILE_EXCL);
        const stagedIdentity = await identity(staged);
        await checkGrant();
        if (!(await sameIdentity(delivery, deliveryIdentity))) {
          throw new ItemError('denied');
        }
        const destination = join(grantedRoot, name);
        try {
          await link(staged, destination);
        } catch (error) {
          if (
            error &&
            typeof error === 'object' &&
            'code' in error &&
            error.code === 'EEXIST'
          ) {
            throw new ItemError('collision');
          }
          throw error;
        }
        let asset: DownloadAsset;
        try {
          await checkGrant();
          if (!(await sameIdentity(destination, stagedIdentity))) {
            throw new ItemError('denied');
          }
          asset = await options.registerAsset(
            operation,
            itemId,
            grantedRoot,
            destination,
          );
        } catch (error) {
          if (await sameIdentity(destination, stagedIdentity)) {
            await rm(destination, { force: true });
          }
          throw error;
        }
        update({ phase: 'saved', asset });
      } finally {
        if (await sameIdentity(delivery, deliveryIdentity)) {
          await removeQuietly(delivery);
        }
      }
    } catch (error) {
      if (options.signal.aborted) {
        update({ phase: 'cancelled' });
      } else if (error instanceof ItemError) {
        update({ phase: 'failed', reason: error.reason });
      } else if (internalStop) {
        // The runner stopped the child itself (a stream over its cap).
        update({ phase: 'failed', reason: internalStop });
      } else if (budget.aborted) {
        // The batch deadline is a limit, not a user stop.
        update({ phase: 'failed', reason: 'limit' });
      } else if (isFfmpegSkillError(error) && error.kind === 'aborted') {
        update({ phase: 'cancelled' });
      } else {
        update({
          phase: 'failed',
          reason: error instanceof DestinationDenied ? 'denied' : 'download',
        });
      }
    } finally {
      remaining -= charged;
      if (stage) await removeQuietly(stage);
    }
    if (options.signal.aborted) break;
  }

  // A user stop ends the batch; items that never started are settled as
  // cancelled so the card and the persisted snapshot hold no pending work.
  if (options.signal.aborted) {
    for (const item of state.items) {
      if (item.phase !== 'queued' && item.phase !== 'waiting') continue;
      state = applyDownloadUpdate(state, {
        ...scope,
        item: {
          itemId: item.itemId,
          sequence: item.sequence + 1,
          phase: 'cancelled',
        },
      });
    }
    options.emit(state);
  }
  return state;
}
