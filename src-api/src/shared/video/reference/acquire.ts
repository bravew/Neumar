import * as childProcess from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { normalizeFrameRate } from '@neumar/video-ir';

import {
  probeFile,
  validateInputFile,
  validatePath,
} from '@/shared/services/ffmpeg';
import type { ProbeResult } from '@/shared/services/ffmpeg';
import { createLogger } from '@/shared/utils/logger';
import { getVideoFeatureFlag } from '@/shared/video/flags';
import { referenceFingerprint } from '@/shared/video/reference/fingerprint';
import {
  STUDY_POLICY_VERSION,
  assertSafeReferenceId,
  createReferenceId,
  ensureReferenceDir,
  relativeToProject,
  removeReferenceArchive,
  validatedReferencePath,
  writeReferenceEnvelope,
  writeReferenceMediaFile,
} from '@/shared/video/reference/store';
import {
  buildYtDlpArgs,
  classifyYtDlpError,
  validateYtDlpUrl,
} from '@/shared/video/source/ytdlp';
import {
  getProject,
  getVideoAssetsDir,
  getVideoProjectDir,
  getVideoProjectRoot,
  hashFile,
  mediaItemFromPath,
  updateProjectDocument,
} from '@/shared/video/store';
import type {
  MediaItem,
  ReferenceProbe,
  VideoProject,
  VideoReference,
} from '@/shared/video/types';

const logger = createLogger('VideoReferenceAcquire');

export const REFERENCE_MAX_DURATION_MS = 10 * 60 * 1000;
export const REFERENCE_STUDY_POLICY_VERSION = STUDY_POLICY_VERSION;

const VIDEO_EXTENSIONS = new Set([
  '.mp4',
  '.mov',
  '.m4v',
  '.webm',
  '.mkv',
  '.avi',
]);

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'youtu.be',
  'youtube-nocookie.com',
]);

export class ReferenceAcquireError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'study-required'
      | 'flag-disabled'
      | 'duration'
      | 'live'
      | 'playlist'
      | 'youtube-capability'
      | 'ytdlp'
      | 'not-found'
      | 'reuse-required' = 'ytdlp',
  ) {
    super(message);
    this.name = 'ReferenceAcquireError';
  }
}

export interface ReferenceDownloader {
  fetch(input: {
    projectId: string;
    url: string;
    destinationDir: string;
  }): Promise<void>;
}

export type ReferenceSpawnFn = typeof childProcess.spawn;

export interface AcquireReferenceInput {
  origin: 'link' | 'upload' | 'workspace-path';
  studyAcknowledged: boolean;
  studyAckOrigin?: 'explicit' | 'project-preference';
  label?: string;
  notes?: string;
  url?: string;
  filePath?: string;
  fileBytes?: Buffer;
  fileName?: string;
  allowLonger?: boolean;
  youtubeCapabilityGranted?: boolean;
  downloader?: ReferenceDownloader;
  spawnFn?: ReferenceSpawnFn;
  now?: () => Date;
}

export async function acquireReference(
  projectId: string,
  input: AcquireReferenceInput,
): Promise<{ project: VideoProject; reference: VideoReference }> {
  if (!getVideoFeatureFlag('video.referenceAnalysis')) {
    throw new ReferenceAcquireError(
      'Reference analysis is disabled.',
      'flag-disabled',
    );
  }
  if (!input.studyAcknowledged) {
    throw new ReferenceAcquireError(
      'Studying a reference requires an explicit study acknowledgement.',
      'study-required',
    );
  }

  const now = input.now?.() ?? new Date();
  const referenceId = createReferenceId();
  assertSafeReferenceId(referenceId);
  const archive = await ensureReferenceDir(projectId, referenceId);
  const mediaDir = path.join(archive, 'media');
  const projectRoot = getVideoProjectRoot(projectId);

  try {
    let extractor: string | undefined;
    let sourceUrl: string | undefined;
    let mediaAbsolute: string;

    if (input.origin === 'link') {
      if (!input.url) {
        throw new ReferenceAcquireError('A link reference requires a URL.');
      }
      await validateYtDlpUrl(input.url);
      if (isYoutubeUrl(input.url) && input.youtubeCapabilityGranted === false) {
        throw new ReferenceAcquireError(
          'YouTube reference intake requires network:youtube capability.',
          'youtube-capability',
        );
      }
      sourceUrl = input.url;
      const downloader =
        input.downloader ?? createDefaultDownloader(input.spawnFn);
      await downloader.fetch({
        projectId,
        url: input.url,
        destinationDir: mediaDir,
      });
      mediaAbsolute = await findDownloadedVideoFile(mediaDir);
      const info = await readInfoJson(mediaDir);
      extractor = info.extractor ?? info.extractor_key;
      if (info.is_live === true || info.was_live === true) {
        throw new ReferenceAcquireError(
          'Live streams cannot be used as references in this increment.',
          'live',
        );
      }
      if (info.playlist_count && info.playlist_count > 1) {
        throw new ReferenceAcquireError(
          'Playlists cannot be imported as a single reference.',
          'playlist',
        );
      }
    } else if (input.fileBytes) {
      mediaAbsolute = await writeReferenceMediaFile(
        projectId,
        path.join(
          mediaDir,
          input.fileName?.replace(/[/\\]/g, '_') || 'source.mp4',
        ),
        input.fileBytes,
      );
    } else {
      if (!input.filePath) {
        throw new ReferenceAcquireError(
          'A file reference requires a local path.',
        );
      }
      const source = validateInputFile(
        input.filePath,
        projectRoot,
        input.origin === 'workspace-path' ? { allowExternalMedia: true } : {},
      );
      mediaAbsolute = validatedReferencePath(
        projectId,
        path.join(mediaDir, 'source.mp4'),
      );
      await fs.copyFile(source, mediaAbsolute);
    }

    const probed = await probeFile(mediaAbsolute, projectRoot, {
      allowExternalMedia: false,
    });
    const probe = toReferenceProbe(probed);
    if (probe.durationMs > REFERENCE_MAX_DURATION_MS && !input.allowLonger) {
      throw new ReferenceAcquireError(
        `References longer than ${REFERENCE_MAX_DURATION_MS / 1000}s need an explicit override.`,
        'duration',
      );
    }

    const contentHash = await hashFile(mediaAbsolute);
    const mediaPath = relativeToProject(projectId, mediaAbsolute);
    const label =
      input.label?.trim() || path.parse(mediaAbsolute).name || referenceId;

    await writeReferenceEnvelope(projectId, {
      kind: 'probe',
      referenceId,
      sourceFingerprint: referenceFingerprint({ contentHash }),
      derivedFrom: {},
      generatedAt: now.toISOString(),
      producer: 'ffmpeg',
      data: probe,
    });

    const reference: VideoReference = {
      id: referenceId,
      label,
      origin: input.origin,
      ...(sourceUrl ? { sourceUrl } : {}),
      ...(extractor ? { extractor } : {}),
      mediaPath,
      contentHash,
      durationMs: probe.durationMs,
      rights: {
        studyAcknowledged: true,
        reuseAcknowledged: false,
        studyAcknowledgedAt: now.toISOString(),
        studyPolicyVersion: REFERENCE_STUDY_POLICY_VERSION,
        studyAckOrigin: input.studyAckOrigin ?? 'explicit',
        ...(input.notes?.trim() ? { notes: input.notes.trim() } : {}),
      },
      artifactIds: ['probe'],
      createdAt: now.toISOString(),
    };

    const project = await updateProjectDocument(projectId, (current) => ({
      ...current,
      videoReferences: [...(current.videoReferences ?? []), reference],
      updatedAt: now.toISOString(),
    }));

    return { project, reference };
  } catch (error) {
    await removeReferenceArchive(projectId, referenceId).catch(
      (cleanupError) => {
        logger.warn('video.reference.archive_cleanup_failed', {
          project_id: projectId,
          reference_id: referenceId,
          error:
            cleanupError instanceof Error
              ? cleanupError.message
              : String(cleanupError),
        });
      },
    );
    throw error;
  }
}

export async function listReferences(
  projectId: string,
): Promise<VideoReference[]> {
  return (await getProject(projectId)).videoReferences ?? [];
}

export async function getReference(
  projectId: string,
  referenceId: string,
): Promise<VideoReference> {
  const reference = (await listReferences(projectId)).find(
    (item) => item.id === referenceId,
  );
  if (!reference) {
    throw new ReferenceAcquireError('Reference not found.', 'not-found');
  }
  return reference;
}

export async function deleteReference(
  projectId: string,
  referenceId: string,
): Promise<VideoProject> {
  await getReference(projectId, referenceId);
  await removeReferenceArchive(projectId, referenceId);
  return updateProjectDocument(projectId, (current) => ({
    ...current,
    videoReferences: (current.videoReferences ?? []).filter(
      (item) => item.id !== referenceId,
    ),
    updatedAt: new Date().toISOString(),
  }));
}

export async function promoteReference(
  projectId: string,
  referenceId: string,
  reuseAcknowledged: boolean,
): Promise<{
  project: VideoProject;
  asset: MediaItem;
  reference: VideoReference;
}> {
  if (!reuseAcknowledged) {
    throw new ReferenceAcquireError(
      'Promoting a reference into assets requires a separate reuse acknowledgement.',
      'reuse-required',
    );
  }
  const existing = await getReference(projectId, referenceId);
  const projectRoot = getVideoProjectRoot(projectId);
  const mediaAbsolute = validateInputFile(
    path.join(getVideoProjectDir(projectId), existing.mediaPath),
    projectRoot,
  );
  const dest = await copyIntoAssets(projectId, mediaAbsolute);
  const asset = await mediaItemFromPath(dest, 'user', projectRoot);
  const now = new Date().toISOString();
  let promoted: VideoReference = existing;
  const project = await updateProjectDocument(projectId, (current) => {
    promoted = {
      ...existing,
      rights: {
        ...existing.rights,
        reuseAcknowledged: true,
      },
    };
    return {
      ...current,
      assets: [...current.assets, asset],
      videoReferences: (current.videoReferences ?? []).map((item) =>
        item.id === referenceId ? promoted : item,
      ),
      updatedAt: now,
    };
  });
  return { project, asset, reference: promoted };
}

async function copyIntoAssets(
  projectId: string,
  sourcePath: string,
): Promise<string> {
  const assetDir = validatePath(
    getVideoAssetsDir(projectId),
    getVideoProjectRoot(projectId),
    'write',
  );
  await fs.mkdir(assetDir, { recursive: true });
  const dest = validatePath(
    path.join(
      assetDir,
      `${createHash('sha256').update(sourcePath).digest('hex').slice(0, 8)}_${path.basename(sourcePath)}`,
    ),
    getVideoProjectRoot(projectId),
    'write',
  );
  await fs.copyFile(sourcePath, dest);
  return dest;
}

function toReferenceProbe(probed: ProbeResult): ReferenceProbe {
  const video = probed.streams.find((stream) => stream.codecType === 'video');
  const audio = probed.streams.find((stream) => stream.codecType === 'audio');
  const fps =
    video?.fps && Number.isFinite(video.fps) && video.fps > 0 ? video.fps : 24;
  return {
    durationMs: Math.max(0, Math.round(probed.duration * 1000)),
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    frameRate: normalizeFrameRate(fps),
    hasAudio: probed.audioStreamCount > 0,
    audioTrackCount: probed.audioStreamCount,
    containerFormat: probed.formatName,
    ...(video?.codecName ? { videoCodec: video.codecName } : {}),
    ...(audio?.codecName ? { audioCodec: audio.codecName } : {}),
  };
}

function isYoutubeUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      YOUTUBE_HOSTS.has(host) ||
      [...YOUTUBE_HOSTS].some((allowed) => host.endsWith(`.${allowed}`))
    );
  } catch {
    return false;
  }
}

function createDefaultDownloader(
  spawnFn?: ReferenceSpawnFn,
): ReferenceDownloader {
  return {
    async fetch(input) {
      const args = buildYtDlpArgs({
        projectId: input.projectId,
        destinationDir: input.destinationDir,
        url: input.url,
        format: 'mp4',
        formatSort: 'res:720,ext:mp4:m4a',
      });
      await runYtDlp(args, input.projectId, input.destinationDir, spawnFn);
    },
  };
}

async function runYtDlp(
  args: string[],
  projectId: string,
  destinationDir: string,
  spawnFn: ReferenceSpawnFn = childProcess.spawn,
): Promise<void> {
  const binary = process.env.YT_DLP_BINARY?.trim() || 'yt-dlp';
  const cwd = getVideoProjectRoot(projectId);
  validatePath(destinationDir, cwd, 'write');
  await fs.mkdir(destinationDir, { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const child = spawnFn(binary, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });
    let output = '';
    const append = (chunk: Buffer) => {
      output = `${output}${chunk.toString()}`.slice(-4000);
    };
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(
        new ReferenceAcquireError('The reference download timed out.', 'ytdlp'),
      );
    }, 120_000);
    timeout.unref?.();
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(
        new ReferenceAcquireError(
          `Failed to run yt-dlp: ${error.message}`,
          'ytdlp',
        ),
      );
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        const classified = classifyYtDlpError(output, code);
        logger.warn('yt-dlp exited non-zero', {
          exitCode: code,
          category: classified.category,
          retryable: classified.retryable,
        });
        reject(new ReferenceAcquireError(classified.message, 'ytdlp'));
        return;
      }
      resolve();
    });
  });
}

async function findDownloadedVideoFile(dir: string): Promise<string> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const candidates = (
    await Promise.all(
      entries
        .filter((entry) => entry.isFile())
        .map(async (entry) => {
          const filePath = path.join(dir, entry.name);
          if (!VIDEO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
            return null;
          }
          const stat = await fs.stat(filePath);
          return { filePath, size: stat.size };
        }),
    )
  )
    .filter((item): item is { filePath: string; size: number } => Boolean(item))
    .sort((left, right) => right.size - left.size);
  const selected = candidates[0];
  if (!selected) {
    throw new ReferenceAcquireError(
      'The download completed without a video file.',
    );
  }
  return selected.filePath;
}

async function readInfoJson(dir: string): Promise<{
  extractor?: string;
  extractor_key?: string;
  is_live?: boolean;
  was_live?: boolean;
  playlist_count?: number;
}> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const infoFile = entries.find(
    (entry) => entry.isFile() && entry.name.endsWith('.info.json'),
  );
  if (!infoFile) return {};
  try {
    return JSON.parse(
      await fs.readFile(path.join(dir, infoFile.name), 'utf8'),
    ) as {
      extractor?: string;
      extractor_key?: string;
      is_live?: boolean;
      was_live?: boolean;
      playlist_count?: number;
    };
  } catch (error) {
    logger.warn('video.reference.info_parse_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return {};
  }
}
