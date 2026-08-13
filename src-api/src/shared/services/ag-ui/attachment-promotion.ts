import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import {
  copyFile,
  link,
  mkdir,
  readdir,
  realpath,
  stat,
  utimes,
} from 'node:fs/promises';
import path from 'node:path';

import { createFile, getMessagesByTaskId } from '@/shared/db/operations';
import type { FileType, LibraryFile } from '@/shared/db/types';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('AGUIAttachmentPromotion');

interface AttachmentReference {
  id?: string;
  name?: string;
  path?: string;
  mimeType?: string;
}

interface AttachmentSource {
  id: string;
  name: string;
  path: string;
  mimeType?: string;
}

interface AttachmentPromotionOptions {
  taskId: string;
  runId: string;
  sessionCwd?: string;
}

const MEDIA_GENERATION_TOOLS = new Set([
  'MediaGenerateImage',
  'generate_image',
  'generate_video',
  'media_generate_image',
  'media_generate_video',
  'media_generate_audio',
  'neuma_media_generate',
  'ffmpeg_transcode',
  'ffmpeg_trim',
  'ffmpeg_concat',
  'ffmpeg_add_subtitles',
  'ffmpeg_extract_audio',
  'ffmpeg_resize',
  'ffmpeg_speed',
  'ffmpeg_extract_frames',
  'ffmpeg_watermark',
  'ffmpeg_normalize_audio',
  'ffmpeg_create_gif',
]);

export function normalizeToolName(toolName: string): string {
  return toolName.replace(/^mcp__.+?__/, '');
}

export function isMediaGenerationToolName(toolName: string): boolean {
  return MEDIA_GENERATION_TOOLS.has(normalizeToolName(toolName));
}

function safePathSegment(value: string): string {
  return (
    path
      .basename(value)
      .replace(/[/\\]/g, '_')
      .replaceAll(String.fromCharCode(0), '_')
      .replace(/^\.+$/, '')
      .slice(0, 180) || 'attachment'
  );
}

function stableIdForPath(filePath: string): string {
  return createHash('sha256').update(filePath).digest('hex').slice(0, 16);
}

function isInsideDir(filePath: string, dir: string): boolean {
  const rel = path.relative(dir, filePath);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function fileTypeFromPath(filePath: string): FileType {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(ext))
    return 'image';
  if (['mp4', 'webm', 'mov', 'avi', 'mkv', 'wmv', 'flv'].includes(ext))
    return 'video';
  if (['mp3', 'wav', 'flac', 'ogg', 'aac', 'm4a', 'wma'].includes(ext))
    return 'audio';
  if (['ppt', 'pptx', 'key', 'odp'].includes(ext)) return 'presentation';
  if (['xls', 'xlsx', 'numbers', 'ods'].includes(ext)) return 'spreadsheet';
  if (['html', 'htm'].includes(ext)) return 'website';
  if (
    [
      'js',
      'jsx',
      'ts',
      'tsx',
      'py',
      'go',
      'rs',
      'java',
      'c',
      'cpp',
      'cs',
      'rb',
      'php',
      'swift',
      'sh',
      'sql',
      'css',
      'json',
    ].includes(ext)
  ) {
    return 'code';
  }
  if (['txt', 'md'].includes(ext)) return 'text';
  return 'document';
}

async function canonicalPath(filePath: string): Promise<string> {
  try {
    return await realpath(filePath);
  } catch {
    return filePath;
  }
}

async function destinationMatchesSource(
  sourcePath: string,
  destPath: string,
): Promise<boolean> {
  try {
    const [sourceStat, destStat] = await Promise.all([
      stat(sourcePath),
      stat(destPath),
    ]);
    if (sourceStat.dev === destStat.dev && sourceStat.ino === destStat.ino) {
      return true;
    }
    return (
      sourceStat.size === destStat.size &&
      Math.abs(sourceStat.mtimeMs - destStat.mtimeMs) < 1
    );
  } catch {
    return false;
  }
}

async function linkOrCopy(sourcePath: string, destPath: string): Promise<void> {
  if (await destinationMatchesSource(sourcePath, destPath)) return;

  try {
    await link(sourcePath, destPath);
    return;
  } catch (err) {
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code?: string }).code === 'EEXIST' &&
      (await destinationMatchesSource(sourcePath, destPath))
    ) {
      return;
    }
  }

  await copyFile(sourcePath, destPath, fsConstants.COPYFILE_FICLONE).catch(() =>
    copyFile(sourcePath, destPath),
  );
  const sourceStat = await stat(sourcePath);
  await utimes(destPath, sourceStat.atime, sourceStat.mtime).catch(() => {});
}

function parseAttachmentReferences(raw: string | null): AttachmentReference[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is AttachmentReference =>
        item !== null &&
        typeof item === 'object' &&
        typeof (item as AttachmentReference).path === 'string',
    );
  } catch {
    return [];
  }
}

export class AttachmentPromotionService {
  private readonly promotedPaths = new Set<string>();
  private readonly attachmentRoot?: string;

  constructor(private readonly options: AttachmentPromotionOptions) {
    this.attachmentRoot = options.sessionCwd
      ? path.join(options.sessionCwd, 'attachments')
      : undefined;
  }

  async promoteForTool(
    toolName: string,
    sourceToolCallId?: string,
  ): Promise<LibraryFile[]> {
    if (!isMediaGenerationToolName(toolName) || !this.options.sessionCwd) {
      return [];
    }

    let sources: AttachmentSource[];
    try {
      sources = await this.collectAttachmentSources();
    } catch (err) {
      logger.warn('Failed to collect attachments for media generation', {
        taskId: this.options.taskId,
        runId: this.options.runId,
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
    if (sources.length === 0) return [];

    const inputsDir = path.join(
      this.options.sessionCwd,
      'output',
      this.options.runId,
      'inputs',
    );
    try {
      await mkdir(inputsDir, { recursive: true });
    } catch (err) {
      logger.warn('Failed to create promoted attachment input directory', {
        taskId: this.options.taskId,
        runId: this.options.runId,
        inputsDir,
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }

    const promoted: LibraryFile[] = [];
    for (const source of sources) {
      if (this.promotedPaths.has(source.path)) continue;

      const destName = safePathSegment(`${source.id}-${source.name}`);
      const destPath = path.join(inputsDir, destName);
      try {
        await linkOrCopy(source.path, destPath);
        const file = createFile({
          task_id: this.options.taskId,
          name: destName,
          type: fileTypeFromPath(source.name),
          path: await canonicalPath(destPath),
          preview: `Source attachment for ${normalizeToolName(toolName)}`,
          provenance: JSON.stringify({
            generator: 'attachment-promotion',
            runId: this.options.runId,
            sourceToolCallId,
            sourceAttachmentId: source.id,
            sourcePath: source.path,
            mimeType: source.mimeType,
          }),
        });
        promoted.push(file);
        this.promotedPaths.add(source.path);
      } catch (err) {
        logger.warn('Failed to promote attachment for media generation', {
          taskId: this.options.taskId,
          runId: this.options.runId,
          sourcePath: source.path,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return promoted;
  }

  private async collectAttachmentSources(): Promise<AttachmentSource[]> {
    if (!this.attachmentRoot) return [];

    const root = path.resolve(this.attachmentRoot);
    const byPath = new Map<string, AttachmentSource>();
    for (const message of getMessagesByTaskId(this.options.taskId)) {
      for (const ref of parseAttachmentReferences(message.attachments)) {
        await this.addReferenceSource(ref, root, byPath);
      }
    }
    await this.addDirectorySources(root, byPath);
    return [...byPath.values()];
  }

  private async addReferenceSource(
    ref: AttachmentReference,
    root: string,
    byPath: Map<string, AttachmentSource>,
  ): Promise<void> {
    if (!ref.path || !path.isAbsolute(ref.path)) return;
    const sourcePath = path.resolve(ref.path);
    if (!isInsideDir(sourcePath, root)) return;
    try {
      const sourceStat = await stat(sourcePath);
      if (!sourceStat.isFile()) return;
      const canonical = await canonicalPath(sourcePath);
      byPath.set(canonical, {
        id: ref.id ? safePathSegment(ref.id) : stableIdForPath(canonical),
        name: safePathSegment(ref.name ?? path.basename(sourcePath)),
        path: canonical,
        mimeType: ref.mimeType,
      });
    } catch {
      // Ignore stale attachment references.
    }
  }

  private async addDirectorySources(
    root: string,
    byPath: Map<string, AttachmentSource>,
  ): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(root);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.startsWith('.')) continue;
      const sourcePath = path.join(root, entry);
      try {
        const sourceStat = await stat(sourcePath);
        if (!sourceStat.isFile()) continue;
        const canonical = await canonicalPath(sourcePath);
        if (byPath.has(canonical)) continue;
        byPath.set(canonical, {
          id: stableIdForPath(canonical),
          name: safePathSegment(entry),
          path: canonical,
        });
      } catch {
        // Best-effort per attachment.
      }
    }
  }
}
