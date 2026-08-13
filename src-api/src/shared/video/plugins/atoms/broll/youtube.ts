import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pipeline as streamPipeline } from 'node:stream/promises';

import { validateInputFile } from '@/shared/services/ffmpeg';
import { createLogger } from '@/shared/utils/logger';
import { getVideoFeatureFlag } from '@/shared/video/flags';
import {
  buildYtDlpArgs,
  classifyYtDlpError,
  validateYtDlpUrl,
} from '@/shared/video/source/ytdlp';
import {
  getProject,
  getVideoProjectDir,
  getVideoProjectRoot,
  mediaItemFromPath,
  updateProjectDocument,
} from '@/shared/video/store';
import { rebuildTimelineFromStoryboard } from '@/shared/video/timeline';
import type {
  MediaItem,
  SourceMedia,
  VideoProject,
} from '@/shared/video/types';

import { YOUTUBE_UNVERIFIED_PROVIDER } from './types';

export interface YoutubeBrollImportInput {
  url: string;
  maxDurationSec?: number;
  format?: 'mp4' | 'best';
  rightsAcknowledged?: boolean;
  persistRightsAck?: boolean;
  rightsNotes?: string;
}

export interface YoutubeBrollRunOptions {
  cwd: string;
  outputDir: string;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface YoutubeBrollRunner {
  run(args: string[], options: YoutubeBrollRunOptions): Promise<void>;
}

export interface YoutubeBrollImportOptions {
  capabilityGranted?: boolean;
  runner?: YoutubeBrollRunner;
  now?: () => Date;
  signal?: AbortSignal;
}

export interface YoutubeBrollImportResult {
  project: VideoProject;
  asset: MediaItem;
  source: SourceMedia;
  args: string[];
}

interface YtDlpInfoJson {
  id?: string;
  title?: string;
  uploader?: string;
  webpage_url?: string;
  duration?: number;
  license?: string;
  thumbnail?: string;
}

const logger = createLogger('VideoYoutubeBroll');
const YOUTUBE_BROLL_TIMEOUT_MS = 5 * 60 * 1000;
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv']);
const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'youtu.be',
  'youtube-nocookie.com',
]);

export async function importYoutubeBroll(
  projectId: string,
  input: YoutubeBrollImportInput,
  options: YoutubeBrollImportOptions = {},
): Promise<YoutubeBrollImportResult> {
  if (!getVideoFeatureFlag('video.plugins')) {
    throw new Error('Video plugin atoms are disabled by video.plugins=false.');
  }
  if (!options.capabilityGranted) {
    throw new Error(
      'YouTube b-roll import requires network:youtube capability.',
    );
  }

  await validateYoutubeBrollUrl(input.url);
  const project = await getProject(projectId);
  if (!hasYoutubeRightsAck(project, input)) {
    throw new Error('YouTube b-roll import requires rights acknowledgement.');
  }

  const sourceId = randomUUID();
  const sourceDir = path.join(
    getVideoProjectDir(projectId),
    'sources',
    sourceId,
  );
  const args = buildYtDlpArgs({
    projectId,
    sourceId,
    url: input.url,
    ...(input.maxDurationSec ? { maxDurationSec: input.maxDurationSec } : {}),
    format: input.format ?? 'mp4',
  });
  assertYtDlpArgsAllowed(args, {
    projectId,
    sourceId,
    url: input.url,
    ...(input.maxDurationSec ? { maxDurationSec: input.maxDurationSec } : {}),
    format: input.format ?? 'mp4',
  });

  await fs.mkdir(sourceDir, { recursive: true });
  await (options.runner ?? new SpawnYtDlpRunner()).run(args, {
    cwd: getVideoProjectDir(projectId),
    outputDir: sourceDir,
    timeoutMs: YOUTUBE_BROLL_TIMEOUT_MS,
    ...(options.signal ? { signal: options.signal } : {}),
  });

  const projectRoot = getVideoProjectRoot(projectId);
  const downloaded = validateInputFile(
    await findDownloadedVideoFile(sourceDir),
    projectRoot,
  );
  const [info, contentHash] = await Promise.all([
    readYtDlpInfo(sourceDir),
    hashFile(downloaded),
  ]);
  const now = options.now?.() ?? new Date();
  const asset = await youtubeBrollAssetFromFile(
    downloaded,
    projectRoot,
    input.url,
    info,
    now,
  );
  const source: SourceMedia = {
    id: sourceId,
    mediaItemId: asset.id,
    origin: 'yt-dlp',
    contentHash,
    sourceUrl: info.webpage_url ?? input.url,
    rights: {
      userConfirmed: true,
      ...(input.rightsNotes?.trim() ? { notes: input.rightsNotes.trim() } : {}),
    },
    analysisStatus: 'idle',
    createdAt: now.toISOString(),
  };

  const saved = await updateProjectDocument(projectId, (current) =>
    rebuildTimelineFromStoryboard({
      ...current,
      assets: [...current.assets, asset],
      sources: [...(current.sources ?? []), source],
      settings: input.persistRightsAck
        ? {
            ...(current.settings ?? {}),
            youtubeRightsAck: {
              accepted: true,
              acceptedAt: now.toISOString(),
              scope: 'project',
            },
          }
        : current.settings,
      updatedAt: now.toISOString(),
    }),
  );

  return { project: saved, asset, source, args };
}

export async function validateYoutubeBrollUrl(url: string): Promise<void> {
  await validateYtDlpUrl(url);
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') {
    throw new Error('YouTube b-roll URL must use HTTPS.');
  }
  const host = parsed.hostname.toLowerCase();
  const allowed =
    YOUTUBE_HOSTS.has(host) ||
    [...YOUTUBE_HOSTS].some((allowedHost) => host.endsWith(`.${allowedHost}`));
  if (!allowed) {
    throw new Error(
      'YouTube b-roll URL must be a youtube.com or youtu.be URL.',
    );
  }
}

export function assertYtDlpArgsAllowed(
  args: string[],
  input: {
    projectId: string;
    sourceId: string;
    url: string;
    maxDurationSec?: number;
    format?: 'mp4' | 'best';
  },
): void {
  const expected = buildYtDlpArgs({
    projectId: input.projectId,
    sourceId: input.sourceId,
    url: input.url,
    ...(input.maxDurationSec ? { maxDurationSec: input.maxDurationSec } : {}),
    format: input.format ?? 'mp4',
  });
  if (
    args.length !== expected.length ||
    args.some((arg, index) => arg !== expected[index])
  ) {
    throw new Error('yt-dlp arguments must match the allowlisted plan.');
  }
}

function hasYoutubeRightsAck(
  project: Pick<VideoProject, 'settings'>,
  input: YoutubeBrollImportInput,
): boolean {
  return (
    input.rightsAcknowledged === true ||
    project.settings?.youtubeRightsAck?.accepted === true
  );
}

async function youtubeBrollAssetFromFile(
  filePath: string,
  projectRoot: string,
  sourceUrl: string,
  info: YtDlpInfoJson,
  now: Date,
): Promise<MediaItem> {
  const asset = await mediaItemFromPath(filePath, 'broll', projectRoot);
  const title = info.title?.trim();
  const uploader = info.uploader?.trim();
  return {
    ...asset,
    kind: 'video',
    metadata: {
      ...asset.metadata,
      durationMs:
        asset.metadata.durationMs > 0
          ? asset.metadata.durationMs
          : Math.round((info.duration ?? 0) * 1000),
    },
    provenance: {
      provider: YOUTUBE_UNVERIFIED_PROVIDER,
      hitId: info.id,
      license: info.license?.trim() || 'youtube-unverified',
      attribution: uploader
        ? `YouTube video by ${uploader}`
        : 'YouTube source imported with user rights acknowledgement',
      attributionRequired: true,
      commercialUse: false,
      sourceUrl: info.webpage_url ?? sourceUrl,
      sourceDisplayName: title ?? uploader ?? 'YouTube source',
      sourceFetchedAt: now.toISOString(),
      thumbnailUrl: info.thumbnail,
    },
  };
}

async function findDownloadedVideoFile(sourceDir: string): Promise<string> {
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  const candidates = await Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map(async (entry) => {
        const filePath = path.join(sourceDir, entry.name);
        const ext = path.extname(entry.name).toLowerCase();
        if (!VIDEO_EXTENSIONS.has(ext)) return null;
        const stat = await fs.stat(filePath);
        return { filePath, size: stat.size };
      }),
  );
  const selected = candidates
    .filter((candidate): candidate is { filePath: string; size: number } =>
      Boolean(candidate),
    )
    .sort((a, b) => b.size - a.size)[0];
  if (!selected) {
    throw new Error('yt-dlp completed without a downloaded video file.');
  }
  return selected.filePath;
}

async function readYtDlpInfo(sourceDir: string): Promise<YtDlpInfoJson> {
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  const infoFile = entries.find(
    (entry) => entry.isFile() && entry.name.endsWith('.info.json'),
  );
  if (!infoFile) return {};
  try {
    return JSON.parse(
      await fs.readFile(path.join(sourceDir, infoFile.name), 'utf8'),
    ) as YtDlpInfoJson;
  } catch (error) {
    logger.warn('video.youtube_broll.info_parse_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return {};
  }
}

async function hashFile(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  await streamPipeline(createReadStream(filePath), hash);
  return hash.digest('hex');
}

class SpawnYtDlpRunner implements YoutubeBrollRunner {
  async run(args: string[], options: YoutubeBrollRunOptions): Promise<void> {
    const binary = process.env.YT_DLP_BINARY?.trim() || 'yt-dlp';
    return new Promise((resolve, reject) => {
      const child = spawn(binary, args, {
        cwd: options.cwd,
        stdio: ['ignore', 'ignore', 'pipe'],
        shell: false,
      });
      let stderr = '';
      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error('yt-dlp timed out while importing YouTube b-roll.'));
      }, options.timeoutMs);
      timeout.unref?.();

      const abort = () => {
        child.kill('SIGTERM');
        reject(new Error('yt-dlp import was cancelled.'));
      };
      options.signal?.addEventListener('abort', abort, { once: true });

      child.stderr.on('data', (chunk: Buffer) => {
        stderr = `${stderr}${chunk.toString()}`.slice(-4000);
      });
      child.on('error', (error) => {
        clearTimeout(timeout);
        options.signal?.removeEventListener('abort', abort);
        reject(new Error(`Failed to run yt-dlp: ${error.message}`));
      });
      child.on('close', (code) => {
        clearTimeout(timeout);
        options.signal?.removeEventListener('abort', abort);
        if (code !== 0) {
          // yt-dlp stderr can contain cookies, auth tokens, or session URLs —
          // log it for triage but keep it out of the error that reaches callers.
          // Classify the failure so the agent gets an actionable, secret-free
          // message and a retryable hint instead of an opaque exit code (which
          // it cannot distinguish from a transient error, leading to runaway
          // retry loops).
          const classified = classifyYtDlpError(stderr, code);
          logger.warn('yt-dlp exited non-zero', {
            exitCode: code,
            category: classified.category,
            retryable: classified.retryable,
            stderr: stderr.slice(0, 500),
          });
          reject(new Error(classified.message));
          return;
        }
        resolve();
      });
    });
  }
}
