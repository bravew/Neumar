/**
 * Files API Routes
 *
 * Provides HTTP endpoints for file system operations.
 * Uses Node.js fs module for reliable filesystem access.
 */

import { exec, execFile } from 'child_process';
import { constants as fsConstants } from 'fs';
import * as fs from 'fs/promises';
import { createReadStream, statSync } from 'node:fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';

import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import type { RunMode } from '@/core/agent/runtime-state';

import {
  APP_DIR_NAME,
  getAllSkillsDirs,
  getBundledSkillsDir,
  getClaudeSkillsDir,
  getAppDir,
  getHomeDir,
} from '@/config/constants';

import { getSetting } from '@/shared/db/operations';
import { trustedLocalPolicy } from '@/shared/network-policy/schema';
import { detectBinaries } from '@/shared/services/ffmpeg';
import { loadSkillFromDir } from '@/shared/skills/loader';
import { parseMarkdownFrontmatter } from '@/shared/utils/frontmatter';
import { createLogger } from '@/shared/utils/logger';
import { expandPath } from '@/shared/utils/paths';
import {
  safeFetch,
  validateBaseUrlForFetch,
} from '@/shared/utils/url-validator';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const logger = createLogger('FilesAPI');

const files = new Hono();

interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  children?: FileEntry[];
}

/**
 * Trusted roots for file access in this desktop application.
 * Re-computed per request so that a changed workDir setting takes effect
 * without server restart.
 */
function getAllowedRoots(): string[] {
  const norm = (p: string) =>
    process.platform === 'win32' ? p.toLowerCase() : p;
  const roots = new Set<string>();
  roots.add(norm(getHomeDir()));
  roots.add(norm(getAppDir()));

  // Use the configured workDir (resolves correctly in Tauri sidecar)
  const workDir = getSetting('workDir');
  if (workDir) roots.add(norm(path.resolve(expandPath(workDir))));

  const tempDir =
    process.platform === 'win32'
      ? process.env.TEMP || process.env.TMP || 'C:\\Windows\\Temp'
      : '/tmp';
  roots.add(norm(tempDir));

  if (process.platform === 'darwin') roots.add('/Volumes/');

  return [...roots];
}

/**
 * Check that a resolved absolute path falls within a trusted root.
 *
 * Trusted roots: user home, app data dir, configured workDir, temp dir,
 * and /Volumes/ on macOS (external drives are valid for desktop use).
 */
function isAllowedPath(resolvedPath: string): boolean {
  const norm = (p: string) =>
    process.platform === 'win32' ? p.toLowerCase() : p;
  const normalized = norm(resolvedPath);
  return getAllowedRoots().some((root) => normalized.startsWith(root));
}

/**
 * Common files/folders to ignore (similar to .gitignore patterns)
 */
const IGNORED_NAMES = new Set([
  // Dependencies
  'node_modules',
  'bower_components',
  'jspm_packages',
  'vendor',
  '__pycache__',
  '.pnpm',

  // Build outputs
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.output',
  '.vercel',
  '.netlify',

  // Cache directories
  '.cache',
  '.parcel-cache',
  '.turbo',
  '.swc',
  '.eslintcache',
  '.stylelintcache',

  // IDE/Editor
  '.idea',
  '.vscode',
  '.vs',
  '*.sublime-*',

  // OS files
  '.DS_Store',
  'Thumbs.db',
  'desktop.ini',

  // Logs
  'logs',
  '*.log',
  'npm-debug.log*',
  'yarn-debug.log*',
  'yarn-error.log*',

  // Environment/secrets
  '.env.local',
  '.env.*.local',

  // Test coverage
  'coverage',
  '.nyc_output',

  // Temporary files
  'tmp',
  'temp',
  '.tmp',
  '.temp',

  // Lock files (optional, but often noisy)
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'composer.lock',
  'Cargo.lock',
]);

/**
 * Check if a file/folder should be ignored
 */
function shouldIgnore(name: string): boolean {
  // Skip hidden files/folders (starting with .)
  if (name.startsWith('.')) return true;

  // Check exact match
  if (IGNORED_NAMES.has(name)) return true;

  // Check pattern matches (for wildcards like *.log)
  const lowerName = name.toLowerCase();
  if (lowerName.endsWith('.log')) return true;
  if (lowerName.endsWith('.lock')) return true;
  if (lowerName.startsWith('npm-debug')) return true;
  if (lowerName.startsWith('yarn-debug')) return true;
  if (lowerName.startsWith('yarn-error')) return true;

  return false;
}

/**
 * Recursively read a directory
 */
async function readDirRecursive(
  dirPath: string,
  depth: number = 0,
  maxDepth: number = 3,
): Promise<FileEntry[]> {
  if (depth > maxDepth) return [];

  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const files: FileEntry[] = [];

    for (const entry of entries) {
      // Skip ignored files/folders
      if (shouldIgnore(entry.name)) continue;

      const fullPath = path.join(dirPath, entry.name);
      const isDirectory = entry.isDirectory();

      const file: FileEntry = {
        name: entry.name,
        path: fullPath,
        isDir: isDirectory,
      };

      // Recursively read subdirectories
      if (isDirectory && depth < maxDepth) {
        try {
          file.children = await readDirRecursive(fullPath, depth + 1, maxDepth);
        } catch {
          file.children = [];
        }
      }

      files.push(file);
    }

    // Sort: directories first, then by name
    return files.sort((a, b) => {
      if (a.isDir && !b.isDir) return -1;
      if (!a.isDir && b.isDir) return 1;
      return a.name.localeCompare(b.name);
    });
  } catch (err) {
    logger.error(`Failed to read ${dirPath}:`, err);
    return [];
  }
}

/**
 * Read directory contents recursively
 * POST /files/readdir
 * Body: { path: string, maxDepth?: number }
 */
const readdirSchema = z.object({
  path: z.string().min(1),
  maxDepth: z.number().int().min(0).max(5).optional().default(3),
});

files.post('/readdir', zValidator('json', readdirSchema), async (c) => {
  try {
    const { path: dirPath, maxDepth } = c.req.valid('json');

    // Security check: resolve to prevent path traversal, then verify allowed
    const resolvedDir = path.resolve(expandPath(dirPath));
    if (!isAllowedPath(resolvedDir)) {
      logger.warn('readdir access denied:', {
        original: dirPath,
        resolved: resolvedDir,
        home: getHomeDir(),
      });
      return c.json(
        { error: 'Access denied: path must be within home directory' },
        403,
      );
    }

    // Check if directory exists
    try {
      const stat = await fs.stat(resolvedDir);
      if (!stat.isDirectory()) {
        return c.json(
          { success: false, error: 'Path is not a directory', files: [] },
          400,
        );
      }
    } catch {
      return c.json(
        { success: false, error: 'Directory does not exist', files: [] },
        200,
      );
    }

    const files = await readDirRecursive(resolvedDir, 0, maxDepth);

    return c.json({
      success: true,
      path: resolvedDir,
      files,
    });
  } catch (error) {
    logger.error('Error:', error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        files: [],
      },
      500,
    );
  }
});

/**
 * Check if a path exists and get its type
 * POST /files/stat
 * Body: { path: string }
 */
files.post('/stat', async (c) => {
  try {
    const body = await c.req.json<{ path: string }>();
    const { path: filePath } = body;

    if (!filePath) {
      return c.json({ error: 'Path is required' }, 400);
    }

    const resolvedPath = path.resolve(expandPath(filePath));
    if (!isAllowedPath(resolvedPath)) {
      return c.json({ exists: false });
    }

    try {
      const stat = await fs.stat(resolvedPath);
      return c.json({
        exists: true,
        isFile: stat.isFile(),
        isDirectory: stat.isDirectory(),
        size: stat.size,
        mtime: stat.mtime.toISOString(),
      });
    } catch {
      return c.json({ exists: false });
    }
  } catch (error) {
    return c.json(
      {
        error: error instanceof Error ? error.message : String(error),
      },
      500,
    );
  }
});

/**
 * Find a file by name within a directory (recursive, max depth 5).
 * Useful when an artifact path is relative/incorrect but the file exists
 * somewhere in the workspace tree.
 * POST /files/find-file
 * Body: { name: string, searchDir: string }
 */
const FindFileSchema = z.object({
  name: z.string().min(1),
  searchDir: z.string().min(1),
});

files.post('/find-file', zValidator('json', FindFileSchema), async (c) => {
  try {
    const { name, searchDir } = c.req.valid('json');

    // Security check — resolve to prevent path traversal via ..
    const resolvedDir = path.resolve(searchDir);
    if (!isAllowedPath(resolvedDir)) {
      return c.json({ error: 'Access denied' }, 403);
    }

    async function searchRecursive(
      dir: string,
      target: string,
      depth: number,
    ): Promise<string | null> {
      if (depth > 5) return null;
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith('.') || entry.name === 'node_modules')
            continue;
          const fullPath = path.join(dir, entry.name);
          if (entry.isFile() && entry.name === target) {
            return fullPath;
          }
          if (entry.isDirectory()) {
            const found = await searchRecursive(fullPath, target, depth + 1);
            if (found) return found;
          }
        }
      } catch {
        // ignore unreadable dirs
      }
      return null;
    }

    const found = await searchRecursive(resolvedDir, name, 0);
    return c.json({ found });
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : String(error) },
      500,
    );
  }
});

/**
 * Read file contents
 * POST /files/read
 * Body: { path: string }
 */
files.post('/read', async (c) => {
  try {
    const body = await c.req.json<{ path: string }>();
    const { path: filePath } = body;

    if (!filePath) {
      return c.json({ error: 'Path is required' }, 400);
    }

    // Security check: expand ~, strip quotes, resolve to prevent path
    // traversal, then verify against trusted roots.
    const resolvedPath = path.resolve(expandPath(filePath));
    if (!isAllowedPath(resolvedPath)) {
      logger.warn(
        `/files/read denied: resolvedPath="${resolvedPath}" allowedRoots=${JSON.stringify(getAllowedRoots())}`,
      );
      return c.json(
        {
          error: 'Access denied',
          detail: `Path "${resolvedPath}" is not under any trusted root.`,
        },
        403,
      );
    }

    const content = await fs.readFile(resolvedPath, 'utf-8');
    return c.json({
      success: true,
      content,
    });
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      500,
    );
  }
});

/**
 * Get all skills directories
 * GET /files/skills-dir
 * Returns paths for both app skills dir and ~/.claude/skills
 */
files.get('/skills-dir', async (c) => {
  const skillsDirs = getAllSkillsDirs();
  const results: { name: string; path: string; exists: boolean }[] = [];

  for (const dir of skillsDirs) {
    try {
      const stat = await fs.stat(dir.path);
      if (stat.isDirectory()) {
        results.push({ name: dir.name, path: dir.path, exists: true });
      } else {
        results.push({ name: dir.name, path: dir.path, exists: false });
      }
    } catch {
      // Directory doesn't exist
      if (dir.name === 'app') {
        // Try to create app skills dir
        try {
          await fs.mkdir(dir.path, { recursive: true });
          results.push({ name: dir.name, path: dir.path, exists: true });
        } catch {
          results.push({ name: dir.name, path: dir.path, exists: false });
        }
      } else {
        // For system directories like claude, just mark as not existing
        results.push({ name: dir.name, path: dir.path, exists: false });
      }
    }
  }

  // Return first existing directory for backward compatibility
  const firstExisting = results.find((r) => r.exists);
  return c.json({
    path: firstExisting?.path || '',
    exists: !!firstExisting,
    directories: results,
  });
});

/**
 * List available skills with metadata
 * GET /files/list-skills
 * Returns skill name, slug, description, and source for all installed skills.
 * Used by the SkillSelector in ChatInput for skill pinning.
 */
files.get('/list-skills', async (c) => {
  const skillsDirs = getAllSkillsDirs();
  const skills: {
    name: string;
    slug: string;
    description: string;
    source: string;
    trigger?: string;
    category?: string;
    icon?: string;
  }[] = [];

  for (const dir of skillsDirs) {
    try {
      const entries = await fs.readdir(dir.path, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue;

        const skillDir = path.join(dir.path, entry.name);
        const loaded = await loadSkillFromDir(skillDir);
        if (!loaded) continue;

        skills.push({
          name: loaded.metadata.name || entry.name,
          slug: entry.name,
          description: loaded.metadata.description,
          source: dir.name,
          trigger: loaded.metadata.trigger,
          category: loaded.metadata.category,
          icon: loaded.metadata.icon,
        });
      }
    } catch {
      // Directory doesn't exist or isn't accessible
    }
  }

  return c.json({ success: true, skills });
});

/**
 * Read file as binary (base64)
 * POST /files/read-binary
 * Body: { path: string }
 */
files.post('/read-binary', async (c) => {
  try {
    const body = await c.req.json<{ path: string }>();
    const { path: filePath } = body;

    if (!filePath) {
      return c.json({ error: 'Path is required' }, 400);
    }

    // Security check: resolve to prevent path traversal, then verify allowed
    const resolvedPath = path.resolve(filePath);
    if (!isAllowedPath(resolvedPath)) {
      return c.json({ error: 'Access denied' }, 403);
    }

    // Check if file exists
    try {
      const stat = await fs.stat(resolvedPath);
      if (!stat.isFile()) {
        return c.json({ error: 'Path is not a file' }, 400);
      }
    } catch {
      return c.json({ error: 'File does not exist' }, 404);
    }

    const content = await fs.readFile(resolvedPath);
    const base64 = content.toString('base64');
    const fileName = path.basename(resolvedPath);

    return c.json({
      success: true,
      fileName,
      content: base64,
      size: content.length,
    });
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      500,
    );
  }
});

/** Max attachment size for in-memory multipart uploads (250 MB). The browser
 *  has to read the file into memory for FormData, so this stays moderate. */
const MAX_ATTACHMENT_SIZE = 250 * 1024 * 1024;

/** Max attachment size when copying from an existing on-disk path (4 GB).
 *  fs.copyFile streams without loading into memory, so the only real limit
 *  is filesystem free space. A 4 GB cap still protects against runaway
 *  copies but no longer silently rejects ordinary video drops. */
const MAX_ATTACHMENT_COPY_SIZE = 4 * 1024 * 1024 * 1024;

/**
 * Schema for the JSON (copy-from-path) branch of /attachment-save.
 * The taskId regex is the same one used by resolveAttachmentsDir — keeping
 * both in one place would require passing a Zod-typed value through the
 * helper, which isn't worth the extra indirection for a single call site.
 */
const attachmentCopySchema = z.object({
  taskId: z
    .string()
    .min(1)
    .regex(/^[a-zA-Z0-9-_]+$/, 'Invalid taskId'),
  sourcePath: z.string().min(1),
  workDir: z.string().optional(),
  name: z.string().optional(),
});

/** Schema for the non-file fields of the multipart upload branch. */
const attachmentUploadFieldsSchema = z.object({
  taskId: z
    .string()
    .min(1)
    .regex(/^[a-zA-Z0-9-_]+$/, 'Invalid taskId'),
  workDir: z.string().optional(),
});

/**
 * Resolve the session attachments directory for a task.
 *
 * Mirrors the frontend's `computeSessionFolder` (src/shared/lib/session.ts)
 * and the backend convention in `src-api/src/app/api/ag-ui.ts:785`:
 *     `${workDir}/sessions/session-${taskId}/attachments`
 *
 * The resolved directory must fall under a trusted root (`isAllowedPath`),
 * otherwise the request is rejected — this prevents a malicious `workDir`
 * in the request body from coercing the server to write outside its sandbox.
 */
function resolveAttachmentsDir(
  taskId: string,
  workDirOverride?: string,
): { dir: string } | { error: string; status: 400 | 403 } {
  if (!taskId || typeof taskId !== 'string') {
    return { error: 'taskId required', status: 400 };
  }
  // UUID-shaped taskIds only — keeps the path component from containing "..".
  if (!/^[a-zA-Z0-9-_]+$/.test(taskId)) {
    return { error: 'Invalid taskId', status: 400 };
  }
  const workDirRaw =
    workDirOverride && workDirOverride.trim().length > 0
      ? workDirOverride
      : (getSetting('workDir') ?? '');
  if (!workDirRaw) {
    return { error: 'No workDir configured', status: 400 };
  }
  const expanded = path.resolve(expandPath(workDirRaw));
  const dir = path.join(
    expanded,
    'sessions',
    `session-${taskId}`,
    'attachments',
  );
  if (!isAllowedPath(dir)) {
    return { error: 'Target path is outside allowed roots', status: 403 };
  }
  return { dir };
}

/** Sanitise a user-supplied filename so it lives at a single path component. */
function safeAttachmentName(name: string): string {
  const base = path.basename(name);
  return base.replace(/[/\\\0]/g, '_').slice(0, 200) || 'attachment';
}

/**
 * Persist a chat attachment into its task's session folder.
 *
 * Two shapes, mirroring /files/video-thumbnail:
 *   - multipart/form-data with `file`, `taskId`, optional `workDir`
 *     → streams the uploaded binary to `session-{taskId}/attachments/`
 *   - application/json `{ taskId, sourcePath, workDir?, name? }`
 *     → copies the existing on-disk file into the session folder
 *
 * Needed because `@tauri-apps/plugin-fs` enforces a build-time scope allowlist
 * (see `src-tauri/capabilities/default.json`). When the user's workDir lives
 * outside that allowlist (e.g. an external drive like `/Volumes/4TB_WD/…`),
 * the frontend can't write directly — the API server has unrestricted fs
 * access and handles the write on its behalf.
 *
 * Responds with `{ path: <absolute_path_on_disk> }` on success.
 */
files.post('/attachment-save', async (c) => {
  try {
    const contentType = c.req.header('content-type') ?? '';

    if (contentType.includes('application/json')) {
      const parsed = attachmentCopySchema.safeParse(await c.req.json());
      if (!parsed.success) {
        return c.json(
          { error: parsed.error.issues.map((i) => i.message).join('; ') },
          400,
        );
      }
      const { taskId, sourcePath, workDir, name } = parsed.data;

      const resolved = resolveAttachmentsDir(taskId, workDir);
      if ('error' in resolved)
        return c.json({ error: resolved.error }, resolved.status);

      const resolvedSource = path.resolve(expandPath(sourcePath));
      if (!isAllowedPath(resolvedSource)) {
        return c.json({ error: 'sourcePath outside allowed roots' }, 403);
      }
      const sourceStat = await fs.stat(resolvedSource);
      if (!sourceStat.isFile()) {
        return c.json({ error: 'sourcePath is not a file' }, 400);
      }
      if (sourceStat.size > MAX_ATTACHMENT_COPY_SIZE) {
        return c.json({ error: 'File too large' }, 413);
      }
      await fs.mkdir(resolved.dir, { recursive: true });
      const prefix = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
      const safeName = safeAttachmentName(
        name ?? path.basename(resolvedSource),
      );
      const destPath = path.join(resolved.dir, `${prefix}_${safeName}`);
      // Prefer the APFS/XFS clone primitive — O(1), no storage duplication.
      // Node falls back to a regular copy when the filesystem doesn't
      // support cloning (ext4, HFS+, NTFS), so this is always safe.
      await fs.copyFile(resolvedSource, destPath, fsConstants.COPYFILE_FICLONE);
      return c.json({ path: destPath });
    }

    const form = await c.req.parseBody();
    const parsed = attachmentUploadFieldsSchema.safeParse({
      taskId: form['taskId'],
      workDir: form['workDir'],
    });
    if (!parsed.success) {
      return c.json(
        { error: parsed.error.issues.map((i) => i.message).join('; ') },
        400,
      );
    }
    const { taskId, workDir } = parsed.data;

    const resolved = resolveAttachmentsDir(taskId, workDir);
    if ('error' in resolved)
      return c.json({ error: resolved.error }, resolved.status);

    const fileEntry = form['file'];
    if (!fileEntry || typeof fileEntry === 'string') {
      return c.json({ error: 'file part required' }, 400);
    }
    const file = fileEntry as File;
    if (file.size > MAX_ATTACHMENT_SIZE) {
      return c.json({ error: 'File too large' }, 413);
    }
    await fs.mkdir(resolved.dir, { recursive: true });
    const prefix = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
    const safeName = safeAttachmentName(file.name || 'attachment');
    const destPath = path.join(resolved.dir, `${prefix}_${safeName}`);
    await fs.writeFile(destPath, Buffer.from(await file.arrayBuffer()));
    return c.json({ path: destPath });
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : String(err) },
      500,
    );
  }
});

/** Max video file size for thumbnail extraction (500 MB) */
const MAX_THUMBNAIL_FILE_SIZE = 500 * 1024 * 1024;

/**
 * Generate a video thumbnail using FFmpeg
 * POST /files/video-thumbnail
 * Body: multipart/form-data with 'video' field, OR JSON { path } for on-disk files
 */
files.post('/video-thumbnail', async (c) => {
  const uid = `vidthumb-${crypto.randomUUID()}`;
  let tmpVideoPath: string | null = null;
  const tmpThumbPath = path.join(os.tmpdir(), `${uid}.jpg`);

  try {
    // Determine the video input path — either an on-disk path or an uploaded file
    let videoInputPath: string;
    const contentType = c.req.header('content-type') ?? '';

    if (contentType.includes('application/json')) {
      // Path-based: file already on disk (Tauri drag-drop)
      const { path: filePath } = await c.req.json<{ path: string }>();
      if (!filePath || typeof filePath !== 'string') {
        return c.json({ success: false, error: 'No file path provided' }, 400);
      }
      const resolvedPath = path.resolve(filePath);
      if (!isAllowedPath(resolvedPath)) {
        return c.json({ success: false, error: 'File path not allowed' }, 403);
      }
      // Verify the file exists and is within size limits
      const stat = await fs.stat(resolvedPath);
      if (stat.size > MAX_THUMBNAIL_FILE_SIZE) {
        return c.json({ success: false, error: 'File too large' }, 400);
      }
      videoInputPath = resolvedPath;
    } else {
      // Upload-based: write to temp file (preserving extension for format detection)
      const body = await c.req.parseBody();
      const videoFile = body['video'];

      if (!videoFile || typeof videoFile === 'string') {
        return c.json({ success: false, error: 'No video file provided' }, 400);
      }

      const file = videoFile as File;
      if (file.size > MAX_THUMBNAIL_FILE_SIZE) {
        return c.json({ success: false, error: 'File too large' }, 400);
      }

      // Preserve the original file extension so ffmpeg can detect the format
      const ext = path.extname(file.name || '').toLowerCase() || '.mp4';
      tmpVideoPath = path.join(os.tmpdir(), `${uid}${ext}`);

      const buffer = Buffer.from(await file.arrayBuffer());
      await fs.writeFile(tmpVideoPath, buffer);
      videoInputPath = tmpVideoPath;
    }

    // Find FFmpeg binary
    const bins = detectBinaries();
    if (!bins) {
      return c.json({ success: false, error: 'FFmpeg not installed' }, 500);
    }

    // Extract a single frame — seek to 3s first (faster), fall back to frame 0
    try {
      await execFileAsync(
        bins.ffmpegPath,
        [
          '-y',
          '-ss',
          '3',
          '-i',
          videoInputPath,
          '-frames:v',
          '1',
          '-q:v',
          '5',
          tmpThumbPath,
        ],
        { timeout: 15_000 },
      );
      await fs.stat(tmpThumbPath);
    } catch {
      await execFileAsync(
        bins.ffmpegPath,
        [
          '-y',
          '-i',
          videoInputPath,
          '-frames:v',
          '1',
          '-q:v',
          '5',
          tmpThumbPath,
        ],
        { timeout: 15_000 },
      );
    }

    const thumbBuffer = await fs.readFile(tmpThumbPath);
    const base64 = thumbBuffer.toString('base64');

    return c.json({
      success: true,
      thumbnail: `data:image/jpeg;base64,${base64}`,
    });
  } catch (error) {
    logger.error('Video thumbnail extraction failed:', error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      500,
    );
  } finally {
    if (tmpVideoPath) await fs.unlink(tmpVideoPath).catch(() => {});
    await fs.unlink(tmpThumbPath).catch(() => {});
  }
});

/**
 * Detect available code editors
 * GET /files/detect-editor
 */
files.get('/detect-editor', async (c) => {
  const platform = process.platform;

  // Common editors to check (in priority order)
  const editors = [
    {
      name: 'Cursor',
      command: 'cursor',
      check: platform === 'darwin' ? 'cursor' : 'cursor.cmd',
    },
    {
      name: 'VS Code',
      command: 'code',
      check: platform === 'darwin' ? 'code' : 'code.cmd',
    },
    {
      name: 'VS Code Insiders',
      command: 'code-insiders',
      check: 'code-insiders',
    },
    {
      name: 'Sublime Text',
      command: platform === 'darwin' ? 'subl' : 'subl',
      check: 'subl',
    },
    { name: 'Atom', command: 'atom', check: 'atom' },
    { name: 'WebStorm', command: 'webstorm', check: 'webstorm' },
    { name: 'PyCharm', command: 'pycharm', check: 'pycharm' },
  ];

  for (const editor of editors) {
    try {
      // Check if editor command exists
      const checkCmd =
        platform === 'win32'
          ? `where ${editor.check}`
          : `which ${editor.check}`;
      await execAsync(checkCmd);
      return c.json({
        success: true,
        editor: editor.name,
        command: editor.command,
      });
    } catch {
      // Editor not found, try next
      continue;
    }
  }

  // No editor found, will use system default
  return c.json({
    success: true,
    editor: 'Default Editor',
    command: null,
  });
});

/**
 * Open a file in code editor
 * POST /files/open-in-editor
 * Body: { path: string }
 */
files.post('/open-in-editor', async (c) => {
  try {
    const body = await c.req.json<{ path: string }>();
    const { path: filePath } = body;

    if (!filePath) {
      return c.json({ error: 'Path is required' }, 400);
    }

    // Security check: resolve to prevent path traversal, then verify allowed
    const resolvedPath = path.resolve(filePath);
    if (!isAllowedPath(resolvedPath)) {
      return c.json({ error: 'Access denied' }, 403);
    }

    // Check if file exists
    try {
      await fs.stat(resolvedPath);
    } catch {
      return c.json({ error: 'File does not exist' }, 404);
    }

    const platform = process.platform;

    // Try to find an editor
    const editors = [
      { name: 'Cursor', command: 'cursor' },
      { name: 'VS Code', command: 'code' },
      { name: 'VS Code Insiders', command: 'code-insiders' },
      { name: 'Sublime Text', command: 'subl' },
    ];

    let editorCommand: string | null = null;
    let editorName = 'Default Editor';

    for (const editor of editors) {
      try {
        const checkCmd =
          platform === 'win32'
            ? `where ${editor.command}`
            : `which ${editor.command}`;
        await execAsync(checkCmd);
        editorCommand = editor.command;
        editorName = editor.name;
        break;
      } catch {
        continue;
      }
    }

    logger.debug(`Opening in editor (${editorName}): ${filePath}`);

    try {
      if (editorCommand) {
        if (platform === 'win32') {
          await execAsync(`${editorCommand} "${resolvedPath}"`, {
            shell: 'cmd.exe',
          });
        } else {
          await execAsync(`${editorCommand} "${resolvedPath}"`);
        }
      } else {
        // Fallback to system default
        if (platform === 'darwin') {
          await execAsync(`open -t "${resolvedPath}"`);
        } else if (platform === 'win32') {
          const escapedPath = resolvedPath.replace(/"/g, '""');
          await execAsync(`cmd /c start "" "${escapedPath}"`, {
            shell: 'cmd.exe',
          });
        } else {
          await execAsync(`xdg-open "${resolvedPath}"`);
        }
      }
      return c.json({ success: true, editor: editorName });
    } catch (execError) {
      logger.error('Failed to open in editor:', execError);
      return c.json({ success: false, error: String(execError) }, 500);
    }
  } catch (error) {
    logger.error('Error:', error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      500,
    );
  }
});

/**
 * Open a file with system default application
 * POST /files/open
 * Body: { path: string }
 */
files.post('/open', async (c) => {
  try {
    const body = await c.req.json<{
      path: string;
      createIfMissing?: boolean;
    }>();
    let { path: filePath } = body;
    const createIfMissing = body.createIfMissing === true;

    if (!filePath) {
      return c.json({ error: 'Path is required' }, 400);
    }

    // Expand ~ to home directory (handles both ~/path and ~\path)
    const homedir = getHomeDir();
    if (filePath.startsWith('~/') || filePath.startsWith('~\\')) {
      filePath = filePath.replace(/^~/, homedir);
    } else if (filePath === '~') {
      filePath = homedir;
    }

    // Normalize path separators for current platform
    if (process.platform === 'win32') {
      filePath = filePath.replace(/\//g, '\\');
    }

    // Security check: resolve to prevent path traversal, then verify allowed
    filePath = path.resolve(filePath);
    if (!isAllowedPath(filePath)) {
      return c.json(
        { error: 'Access denied: path must be within home directory' },
        403,
      );
    }

    // Check if file/directory exists. Only auto-create directories when the
    // caller explicitly opts in via createIfMissing — otherwise we risk
    // mkdir'ing over a missing output file (e.g. `out.mp4`) and clobbering
    // the renderer's ability to write to that path later.
    let isDirectory = false;
    try {
      const stat = await fs.stat(filePath);
      isDirectory = stat.isDirectory();
    } catch {
      if (!createIfMissing) {
        return c.json({ error: 'File does not exist' }, 404);
      }
      try {
        await fs.mkdir(filePath, { recursive: true });
        isDirectory = true;
      } catch {
        return c.json(
          { error: 'File does not exist and could not create directory' },
          404,
        );
      }
    }

    // Open file with system default application
    const platform = process.platform;

    logger.debug(`Opening ${isDirectory ? 'directory' : 'file'}: ${filePath}`);

    try {
      if (platform === 'darwin') {
        // macOS
        await execAsync(`open "${filePath}"`);
      } else if (platform === 'win32') {
        // Windows - use explorer.exe for directories, start for files
        if (isDirectory) {
          // Use explorer to open directories
          await execAsync(`explorer "${filePath}"`, { shell: 'cmd.exe' });
        } else {
          // Use start command with cmd /c for files
          // Escape path properly for Windows cmd
          const escapedPath = filePath.replace(/"/g, '""');
          await execAsync(`cmd /c start "" "${escapedPath}"`, {
            shell: 'cmd.exe',
          });
        }
      } else {
        // Linux
        await execAsync(`xdg-open "${filePath}"`);
      }
      logger.debug('Opened successfully');
      return c.json({ success: true });
    } catch (execError) {
      logger.error('Failed to open:', execError);
      return c.json({ success: false, error: String(execError) }, 500);
    }
  } catch (error) {
    logger.error('Error:', error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      500,
    );
  }
});

/**
 * Delete a directory (typically a session folder)
 * DELETE /files/delete-dir
 * Body: { path: string }
 */
files.delete('/delete-dir', async (c) => {
  try {
    const body = await c.req.json<{ path: string }>();
    const { path: dirPath } = body;

    if (!dirPath) {
      return c.json({ success: false, error: 'Path is required' }, 400);
    }

    // Security: Only allow deleting within app data directory sessions
    const homeDir = getHomeDir();
    const sessionsDir = path.join(homeDir, APP_DIR_NAME, 'sessions');
    const normalizedPath = path.normalize(dirPath);
    const normalizedSessionsDir = path.normalize(sessionsDir);

    // Check if the path is within the sessions directory
    if (!normalizedPath.startsWith(normalizedSessionsDir)) {
      logger.error(
        'Security: Attempt to delete outside sessions directory:',
        dirPath,
      );
      return c.json(
        {
          success: false,
          error:
            'Can only delete directories within app data directory sessions',
        },
        403,
      );
    }

    // Check if directory exists
    try {
      const stat = await fs.stat(dirPath);
      if (!stat.isDirectory()) {
        return c.json(
          { success: false, error: 'Path is not a directory' },
          400,
        );
      }
    } catch {
      // Directory doesn't exist, consider it a success
      return c.json({ success: true });
    }

    // Delete the directory recursively
    await fs.rm(dirPath, { recursive: true, force: true });
    logger.debug('Deleted directory:', dirPath);

    return c.json({ success: true });
  } catch (error) {
    logger.error('Error deleting directory:', error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      500,
    );
  }
});

// ============================================================================
// Skills Catalog
// ============================================================================

interface CatalogEntry {
  owner: string;
  slug: string;
  displayName: string;
  version: string;
  publishedAt: number;
  description?: string;
  builtIn?: boolean;
  modes?: RunMode[];
}

function parseSkillCatalogMarkdown(md: string): {
  name?: string;
  description?: string;
  version?: string;
  modes?: RunMode[];
} {
  const attributes = parseMarkdownFrontmatter(md)?.attributes ?? {};
  return {
    name: stringMetadataValue(attributes.name),
    description: stringMetadataValue(attributes.description),
    version: stringMetadataValue(attributes.version),
    modes: runModesMetadataValue(attributes.modes),
  };
}

function runModesMetadataValue(value: unknown): RunMode[] | undefined {
  const values = Array.isArray(value) ? value : [value];
  if (!values.every(isRunMode)) return undefined;
  return values.length > 0 ? values : undefined;
}

function isRunMode(value: unknown): value is RunMode {
  return value === 'task' || value === 'design' || value === 'video';
}

function stringMetadataValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** Cache TTL for the catalog index (5 minutes) */
const CATALOG_CACHE_TTL_MS = 5 * 60 * 1000;
let catalogCache: { entries: CatalogEntry[]; builtAt: number } | null = null;

/**
 * Resolve the optional community skills catalog directory.
 *
 * - In tests/dev, set SKILLS_CATALOG_DIR to point at a local catalog tree.
 * - In production, no community catalog is shipped; this returns `null` and
 *   the catalog falls back to bundled skills only (see scanBundledSkills).
 */
let resolvedCatalogDir: string | null | undefined = undefined;
function getCommunityCatalogDir(): string | null {
  if (resolvedCatalogDir !== undefined) return resolvedCatalogDir;
  const override = process.env.SKILLS_CATALOG_DIR;
  if (override) {
    try {
      if (statSync(override).isDirectory()) {
        resolvedCatalogDir = override;
        return override;
      }
    } catch {
      // fall through
    }
  }
  resolvedCatalogDir = null;
  return null;
}

/**
 * Scan bundled skills directory (flat: skills/<name>/SKILL.md).
 * Generates catalog entries from SKILL.md YAML frontmatter.
 */
async function scanBundledSkills(): Promise<CatalogEntry[]> {
  const bundledDir = getBundledSkillsDir();
  if (!bundledDir) return [];

  const entries: CatalogEntry[] = [];
  try {
    const dirs = await fs.readdir(bundledDir, { withFileTypes: true });
    for (const entry of dirs) {
      if (!entry.isDirectory()) continue;
      const skillDir = path.join(bundledDir, entry.name);
      try {
        const md = await fs.readFile(path.join(skillDir, 'SKILL.md'), 'utf-8');
        const metadata = parseSkillCatalogMarkdown(md);

        entries.push({
          owner: 'built-in',
          slug: entry.name,
          displayName: metadata.name ?? entry.name,
          description: metadata.description ?? '',
          version: metadata.version ?? '1.0.0',
          publishedAt: 0,
          builtIn: true,
          modes: metadata.modes,
        });
      } catch {
        // No SKILL.md, skip
      }
    }
  } catch (err) {
    logger.debug('Failed to scan bundled skills:', err);
  }
  return entries;
}

/** Scan all _meta.json files and build a sorted index (community + bundled) */
async function buildCatalogIndex(): Promise<CatalogEntry[]> {
  if (
    catalogCache &&
    Date.now() - catalogCache.builtAt < CATALOG_CACHE_TTL_MS
  ) {
    return catalogCache.entries;
  }

  const baseDir = getCommunityCatalogDir();
  const entries: CatalogEntry[] = [];

  // 1. Scan community catalog if present (<owner>/<slug>/_meta.json).
  //    No catalog ships in production — bundled skills below are the default.
  if (baseDir) {
    try {
      const owners = await fs.readdir(baseDir, { withFileTypes: true });

      for (const ownerEntry of owners) {
        if (!ownerEntry.isDirectory()) continue;
        const ownerDir = path.join(baseDir, ownerEntry.name);

        try {
          const skills = await fs.readdir(ownerDir, { withFileTypes: true });
          for (const skillEntry of skills) {
            if (!skillEntry.isDirectory()) continue;
            const metaPath = path.join(ownerDir, skillEntry.name, '_meta.json');
            try {
              const raw = await fs.readFile(metaPath, 'utf-8');
              const meta = JSON.parse(raw) as {
                owner: string;
                slug: string;
                displayName: string;
                latest?: { version: string; publishedAt: number };
              };
              entries.push({
                owner: meta.owner,
                slug: meta.slug,
                displayName: meta.displayName,
                version: meta.latest?.version ?? '0.0.0',
                publishedAt: meta.latest?.publishedAt ?? 0,
              });
            } catch {
              // Skip skills without valid _meta.json
            }
          }
        } catch {
          // Skip unreadable owner dirs
        }
      }
    } catch (err) {
      logger.debug('Community catalog scan skipped:', err);
    }
  }

  // 2. Scan bundled skills (skills/<name>/SKILL.md)
  const bundled = await scanBundledSkills();
  // Prepend bundled skills so they appear first
  entries.unshift(...bundled);

  entries.sort((a, b) => {
    // Built-in skills first, then by publishedAt
    if (a.builtIn && !b.builtIn) return -1;
    if (!a.builtIn && b.builtIn) return 1;
    return b.publishedAt - a.publishedAt;
  });
  catalogCache = { entries, builtAt: Date.now() };
  return entries;
}

/**
 * Browse the skills catalog (paginated)
 * GET /files/skills-catalog?search=&page=1&pageSize=50
 */
files.get('/skills-catalog', async (c) => {
  try {
    const search = (c.req.query('search') ?? '').toLowerCase();
    const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10));
    const pageSize = Math.min(
      100,
      Math.max(1, parseInt(c.req.query('pageSize') ?? '50', 10)),
    );

    const all = await buildCatalogIndex();
    const filtered = search
      ? all.filter(
          (s) =>
            s.displayName.toLowerCase().includes(search) ||
            s.slug.toLowerCase().includes(search) ||
            s.owner.toLowerCase().includes(search),
        )
      : all;

    const total = filtered.length;
    const totalPages = Math.ceil(total / pageSize);
    const start = (page - 1) * pageSize;
    const items = filtered.slice(start, start + pageSize);

    return c.json({ success: true, items, total, page, pageSize, totalPages });
  } catch (error) {
    logger.error('Skills catalog error:', error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        items: [],
        total: 0,
        page: 1,
        pageSize: 50,
        totalPages: 0,
      },
      500,
    );
  }
});

/**
 * Get detail for a single catalog skill
 * GET /files/skills-catalog/:owner/:slug
 */
files.get('/skills-catalog/:owner/:slug', async (c) => {
  try {
    const { owner, slug } = c.req.param();

    // Validate owner/slug to prevent path traversal
    const SAFE_NAME = /^[\w][\w.-]*$/;
    if (!SAFE_NAME.test(owner) || !SAFE_NAME.test(slug)) {
      return c.json({ success: false, error: 'Invalid owner or slug' }, 400);
    }

    // Resolve skill directory: bundled (flat) or community (owner/slug)
    let skillDir: string;
    let skillBase: string;
    const isBundled = owner === 'built-in';
    if (isBundled) {
      const bundledDir = getBundledSkillsDir();
      if (!bundledDir) {
        return c.json(
          { success: false, error: 'Bundled skills directory not found' },
          404,
        );
      }
      skillDir = path.join(bundledDir, slug);
      skillBase = bundledDir;
    } else {
      const communityBase = getCommunityCatalogDir();
      if (!communityBase) {
        return c.json(
          { success: false, error: 'Community catalog not configured' },
          404,
        );
      }
      skillBase = communityBase;
      skillDir = path.join(skillBase, owner, slug);
    }

    // Verify resolved path stays within its expected root (defense-in-depth)
    const resolvedSkillDir = path.resolve(skillDir);
    const resolvedBase = path.resolve(skillBase);
    if (!resolvedSkillDir.startsWith(resolvedBase + path.sep)) {
      return c.json({ success: false, error: 'Invalid skill path' }, 400);
    }

    // Read metadata: bundled skills use SKILL.md frontmatter, community uses _meta.json
    let displayName = slug;
    let description = '';
    let version = '1.0.0';
    let publishedAt = 0;
    let history: unknown[] = [];
    let modes: RunMode[] | undefined;

    if (isBundled) {
      try {
        const md = await fs.readFile(path.join(skillDir, 'SKILL.md'), 'utf-8');
        const metadata = parseSkillCatalogMarkdown(md);
        if (metadata.name) displayName = metadata.name;
        if (metadata.description) description = metadata.description;
        if (metadata.version) version = metadata.version;
        modes = metadata.modes;
      } catch {
        return c.json(
          { success: false, error: 'Skill not found in catalog' },
          404,
        );
      }
    } else {
      // Read _meta.json
      let meta: Record<string, unknown>;
      try {
        const raw = await fs.readFile(
          path.join(skillDir, '_meta.json'),
          'utf-8',
        );
        meta = JSON.parse(raw);
      } catch {
        return c.json(
          { success: false, error: 'Skill not found in catalog' },
          404,
        );
      }

      displayName = (meta.displayName as string) ?? slug;
      version = (meta.latest as { version?: string })?.version ?? '0.0.0';
      publishedAt = (meta.latest as { publishedAt?: number })?.publishedAt ?? 0;
      history = (meta.history as unknown[]) ?? [];

      // Read SKILL.md for description
      try {
        const md = await fs.readFile(path.join(skillDir, 'SKILL.md'), 'utf-8');
        const metadata = parseSkillCatalogMarkdown(md);
        description = metadata.description ?? description;
        modes = metadata.modes;
      } catch {
        // No SKILL.md, that's fine
      }
    }

    // List files in the skill dir
    let skillFiles: string[] = [];
    try {
      const dirEntries = await fs.readdir(skillDir);
      skillFiles = dirEntries;
    } catch {
      // ignore
    }

    return c.json({
      success: true,
      skill: {
        owner,
        slug,
        displayName,
        description,
        version,
        publishedAt,
        history,
        files: skillFiles,
        builtIn: isBundled,
        modes,
      },
    });
  } catch (error) {
    logger.error('Skill detail error:', error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      500,
    );
  }
});

/**
 * Install a skill from the catalog (community or bundled)
 * POST /files/install-skill
 * Body: { owner, slug }
 */
files.post('/install-skill', async (c) => {
  try {
    const { owner, slug } = await c.req.json<{ owner: string; slug: string }>();
    if (!owner || !slug) {
      return c.json(
        { success: false, error: 'owner and slug are required' },
        400,
      );
    }

    // Validate owner/slug to prevent path traversal (no slashes, dots-only, or backslashes)
    const SAFE_NAME = /^[\w][\w.-]*$/;
    if (!SAFE_NAME.test(owner) || !SAFE_NAME.test(slug)) {
      return c.json({ success: false, error: 'Invalid owner or slug' }, 400);
    }

    // Resolve source directory: bundled skills use flat layout, community uses owner/slug
    let srcDir: string;
    let srcBase: string;
    if (owner === 'built-in') {
      const bundledDir = getBundledSkillsDir();
      if (!bundledDir) {
        return c.json(
          { success: false, error: 'Bundled skills directory not found' },
          404,
        );
      }
      srcDir = path.join(bundledDir, slug);
      srcBase = bundledDir;
    } else {
      const communityBase = getCommunityCatalogDir();
      if (!communityBase) {
        return c.json(
          { success: false, error: 'Community catalog not configured' },
          404,
        );
      }
      srcBase = communityBase;
      srcDir = path.join(srcBase, owner, slug);
    }

    const dstDir = path.join(getClaudeSkillsDir(), slug);

    // Verify resolved paths stay within their expected roots (defense-in-depth)
    const resolvedSrc = path.resolve(srcDir);
    const resolvedSrcBase = path.resolve(srcBase);
    const resolvedDst = path.resolve(dstDir);
    const resolvedDstBase = path.resolve(getClaudeSkillsDir());
    if (
      !resolvedSrc.startsWith(resolvedSrcBase + path.sep) ||
      !resolvedDst.startsWith(resolvedDstBase + path.sep)
    ) {
      return c.json({ success: false, error: 'Invalid skill path' }, 400);
    }

    // Verify source exists
    try {
      await fs.stat(srcDir);
    } catch {
      return c.json(
        { success: false, error: 'Skill not found in catalog' },
        404,
      );
    }

    // Check if already installed
    try {
      await fs.stat(dstDir);
      return c.json({ success: false, error: 'Skill already installed' }, 409);
    } catch {
      // Not installed, good
    }

    // Ensure parent dir exists
    await fs.mkdir(path.join(getClaudeSkillsDir()), { recursive: true });

    // Copy skill directory
    await fs.cp(srcDir, dstDir, { recursive: true });
    logger.debug(`Installed skill ${owner}/${slug} to ${dstDir}`);

    return c.json({ success: true, path: dstDir });
  } catch (error) {
    logger.error('Install skill error:', error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      500,
    );
  }
});

/**
 * Create a new skill from scratch
 * POST /files/create-skill
 * Body: { name, description? }
 */
files.post('/create-skill', async (c) => {
  try {
    const { name, description } = await c.req.json<{
      name: string;
      description?: string;
    }>();

    if (!name) {
      return c.json({ success: false, error: 'name is required' }, 400);
    }

    // Sanitize name to kebab-case slug
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    if (!slug) {
      return c.json(
        { success: false, error: 'Invalid name — could not generate slug' },
        400,
      );
    }

    const skillDir = path.join(getClaudeSkillsDir(), slug);

    // Check if already exists
    try {
      await fs.stat(skillDir);
      return c.json(
        { success: false, error: 'A skill with this name already exists' },
        409,
      );
    } catch {
      // Doesn't exist, good
    }

    // Ensure parent dir exists
    await fs.mkdir(getClaudeSkillsDir(), { recursive: true });
    await fs.mkdir(skillDir, { recursive: true });

    // Create SKILL.md with template
    const skillMd = `---
name: ${name}
description: ${description || 'A custom skill'}
---

# ${name}

${description || 'Describe what this skill does and how it should be used.'}
`;
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), skillMd, 'utf-8');
    logger.debug(`Created skill "${name}" at ${skillDir}`);

    return c.json({ success: true, slug, path: skillDir });
  } catch (error) {
    logger.error('Create skill error:', error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      500,
    );
  }
});

/**
 * POST /files/extract-skill
 * Body: { taskId, name, description? }
 *
 * Extracts a completed task session into a reusable SKILL.md file
 * using LLM-powered summarization with template fallback.
 */
const ExtractSkillSchema = z.object({
  taskId: z.string().min(1),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
});

files.post(
  '/extract-skill',
  zValidator('json', ExtractSkillSchema),
  async (c) => {
    try {
      const { taskId, name, description } = c.req.valid('json');

      // Sanitize name to kebab-case slug
      const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');

      if (!slug) {
        return c.json(
          { success: false, error: 'Invalid name — could not generate slug' },
          400,
        );
      }

      const skillDir = path.join(getClaudeSkillsDir(), slug);

      // Security check — resolved path must be within allowed directories
      const resolvedSkillDir = path.resolve(skillDir);
      if (!isAllowedPath(resolvedSkillDir)) {
        return c.json({ error: 'Access denied' }, 403);
      }

      // Check if already exists
      try {
        await fs.stat(skillDir);
        return c.json(
          { success: false, error: 'A skill with this name already exists' },
          409,
        );
      } catch {
        // Doesn't exist, good
      }

      // Lazy import to avoid circular deps and keep cold start fast
      const { getTask, getMessagesByTaskId } =
        await import('@/shared/db/operations');
      const { extractSkillContent } =
        await import('@/shared/services/skill-extractor');

      const task = getTask(taskId);
      if (!task) {
        return c.json({ success: false, error: 'Task not found' }, 404);
      }

      const messages = getMessagesByTaskId(taskId);
      if (messages.length === 0) {
        return c.json(
          { success: false, error: 'Task has no messages to extract' },
          400,
        );
      }

      // Generate the SKILL.md content via LLM (with template fallback)
      const content = await extractSkillContent(
        task.prompt,
        messages,
        name,
        description,
      );

      // Write to disk (recursive: true creates parent dirs too)
      await fs.mkdir(skillDir, { recursive: true });
      await fs.writeFile(path.join(skillDir, 'SKILL.md'), content, 'utf-8');
      logger.debug(`Extracted skill "${name}" at ${skillDir}`);

      return c.json({ success: true, slug, path: skillDir, content });
    } catch (error) {
      logger.error('Extract skill error:', error);
      return c.json(
        {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        },
        500,
      );
    }
  },
);

// ---------- MIME helpers for streaming ----------
const MEDIA_MIME_TYPES: Record<string, string> = {
  // Video
  mp4: 'video/mp4',
  webm: 'video/webm',
  ogg: 'video/ogg',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  mkv: 'video/x-matroska',
  m4v: 'video/x-m4v',
  wmv: 'video/x-ms-wmv',
  flv: 'video/x-flv',
  '3gp': 'video/3gpp',
  // Audio
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  wma: 'audio/x-ms-wma',
  aiff: 'audio/aiff',
  // Images
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  // Documents
  pdf: 'application/pdf',
};

/** Wrap a Node.js ReadStream as a WHATWG ReadableStream for Hono/Web compat. */
function toWebStream(
  nodeStream: ReturnType<typeof createReadStream>,
): ReadableStream<Buffer> {
  return new ReadableStream({
    start(controller) {
      nodeStream.on('data', (chunk: Buffer) => controller.enqueue(chunk));
      nodeStream.on('end', () => controller.close());
      nodeStream.on('error', (err) => controller.error(err));
    },
    cancel() {
      nodeStream.destroy();
    },
  });
}

/**
 * Stream a file directly (supports HTTP Range requests for video/audio seeking).
 * GET /files/stream?path=<absolute-path>
 */
files.get('/stream', async (c) => {
  const filePath = c.req.query('path');
  if (!filePath) {
    return c.json({ error: 'path query parameter is required' }, 400);
  }

  // Security check — expand ~, strip quotes, resolve to prevent path traversal
  const resolvedPath = path.resolve(expandPath(filePath));
  if (!isAllowedPath(resolvedPath)) {
    logger.warn(
      `/files/stream denied: resolvedPath="${resolvedPath}" allowedRoots=${JSON.stringify(getAllowedRoots())}`,
    );
    return c.json(
      {
        error: 'Access denied',
        detail: `Path "${resolvedPath}" is not under any trusted root. Configure a workspace directory that contains this path, or move the file into a trusted location.`,
      },
      403,
    );
  }

  let stat;
  try {
    stat = await fs.stat(resolvedPath);
    if (!stat.isFile()) {
      return c.json({ error: 'Path is not a file' }, 400);
    }
  } catch {
    return c.json({ error: 'File does not exist' }, 404);
  }

  const fileSize = stat.size;
  const ext = path.extname(resolvedPath).slice(1).toLowerCase();
  const contentType = MEDIA_MIME_TYPES[ext] || 'application/octet-stream';

  // Handle Range requests (for video/audio seeking)
  const rangeHeader = c.req.header('Range');
  if (rangeHeader) {
    const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
    if (!match) {
      return new Response('Invalid Range header', { status: 416 });
    }

    const start = parseInt(match[1]!, 10);
    const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;

    if (start >= fileSize || end >= fileSize || start > end) {
      return new Response('Range Not Satisfiable', {
        status: 416,
        headers: { 'Content-Range': `bytes */${fileSize}` },
      });
    }

    const chunkSize = end - start + 1;
    return new Response(
      toWebStream(createReadStream(resolvedPath, { start, end })),
      {
        status: 206,
        headers: {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': String(chunkSize),
          'Content-Type': contentType,
        },
      },
    );
  }

  // Full file response — use ETag based on mtime+size so browsers
  // detect when a file is overwritten (e.g., image regeneration).
  const etag = `"${stat.mtimeMs.toString(36)}-${fileSize.toString(36)}"`;
  const ifNoneMatch = c.req.header('If-None-Match');
  if (ifNoneMatch === etag) {
    return new Response(null, { status: 304 });
  }

  return new Response(toWebStream(createReadStream(resolvedPath)), {
    status: 200,
    headers: {
      'Accept-Ranges': 'bytes',
      'Content-Length': String(fileSize),
      'Content-Type': contentType,
      ETag: etag,
      'Last-Modified': stat.mtime.toUTCString(),
      'Cache-Control': 'no-cache, must-revalidate',
    },
  });
});

// ============================================================================
// File Snapshot Routes (F-022)
// ============================================================================

import crypto from 'crypto';

import type { ContentfulStatusCode } from 'hono/utils/http-status';

import {
  createFileSnapshot,
  countFileSnapshotsByTask,
  getFileSnapshot,
  getFileSnapshotsByTask,
  updateFileSnapshotAfter,
} from '@/shared/db/operations';

const SNAPSHOT_MAX_FILE_SIZE = 1_048_576; // 1 MB
const SNAPSHOT_MAX_PER_TASK = 100;

/** Known binary extensions to skip snapshotting */
const BINARY_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'ico',
  'tiff',
  'svg',
  'mp4',
  'mp3',
  'wav',
  'ogg',
  'webm',
  'mkv',
  'avi',
  'mov',
  'pdf',
  'docx',
  'xlsx',
  'pptx',
  'zip',
  'tar',
  'gz',
  'rar',
  '7z',
  'exe',
  'dll',
  'so',
  'dylib',
  'wasm',
]);

function isBinaryPath(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  return BINARY_EXTENSIONS.has(ext);
}

/**
 * POST /files/snapshot — capture before/after snapshot for a file write.
 * Called by the agent tool handler before and after writing a file.
 */
const snapshotSchema = z.object({
  task_id: z.string().min(1),
  file_path: z.string().min(1),
  phase: z.enum(['before', 'after']),
  snapshot_id: z.string().optional(),
});

files.post('/snapshot', zValidator('json', snapshotSchema), async (c) => {
  try {
    const body = c.req.valid('json');

    if (isBinaryPath(body.file_path)) {
      return c.json({ skipped: true, reason: 'binary file' });
    }

    const resolvedPath = path.resolve(body.file_path);
    if (!isAllowedPath(resolvedPath)) {
      return c.json({ error: 'Path not allowed' }, 403 as ContentfulStatusCode);
    }

    if (body.phase === 'before') {
      // Check per-task limit
      const count = countFileSnapshotsByTask(body.task_id);
      if (count >= SNAPSHOT_MAX_PER_TASK) {
        return c.json({ skipped: true, reason: 'max snapshots reached' });
      }

      let contentBefore: string | null = null;
      try {
        const stat = await fs.stat(resolvedPath);
        if (stat.size > SNAPSHOT_MAX_FILE_SIZE) {
          return c.json({ skipped: true, reason: 'file too large' });
        }
        contentBefore = await fs.readFile(resolvedPath, 'utf-8');
      } catch {
        // File doesn't exist yet — that's OK for new files
      }

      const snapshot = createFileSnapshot({
        id: crypto.randomUUID(),
        task_id: body.task_id,
        file_path: resolvedPath,
        content_before: contentBefore,
      });

      return c.json({ snapshot_id: snapshot.id });
    }

    if (body.phase === 'after' && body.snapshot_id) {
      try {
        const stat = await fs.stat(resolvedPath);
        if (stat.size <= SNAPSHOT_MAX_FILE_SIZE) {
          const contentAfter = await fs.readFile(resolvedPath, 'utf-8');
          updateFileSnapshotAfter(body.snapshot_id, contentAfter);
        }
      } catch {
        // File write may have failed — ignore
      }
      return c.json({ success: true });
    }

    return c.json({ error: 'Invalid phase' }, 400 as ContentfulStatusCode);
  } catch (err) {
    logger.error('Snapshot capture failed:', err);
    return c.json({ error: 'Snapshot failed' }, 500 as ContentfulStatusCode);
  }
});

/** GET /files/snapshots/:taskId — list all snapshots for a task (paths only) */
files.get('/snapshots/:taskId', (c) => {
  try {
    const taskId = c.req.param('taskId');
    const snapshots = getFileSnapshotsByTask(taskId).map((s) => ({
      id: s.id,
      file_path: s.file_path,
      has_before: s.content_before !== null,
      has_after: s.content_after !== null,
      created_at: s.created_at,
    }));
    return c.json({ snapshots });
  } catch (err) {
    logger.error('Failed to list snapshots:', err);
    return c.json(
      { error: 'Failed to list snapshots' },
      500 as ContentfulStatusCode,
    );
  }
});

/** GET /files/snapshots/:taskId/:snapshotId — single snapshot with full content */
files.get('/snapshots/:taskId/:snapshotId', (c) => {
  try {
    const snapshotId = c.req.param('snapshotId');
    const snapshot = getFileSnapshot(snapshotId);
    if (!snapshot) {
      return c.json(
        { error: 'Snapshot not found' },
        404 as ContentfulStatusCode,
      );
    }
    if (snapshot.task_id !== c.req.param('taskId')) {
      return c.json(
        { error: 'Snapshot not found' },
        404 as ContentfulStatusCode,
      );
    }
    return c.json({ snapshot });
  } catch (err) {
    logger.error('Failed to get snapshot:', err);
    return c.json(
      { error: 'Failed to get snapshot' },
      500 as ContentfulStatusCode,
    );
  }
});

// ============================================================================
// Workspace migration
// ============================================================================

const MigrateWorkspaceSchema = z.object({
  sourcePath: z.string().min(1),
  destPath: z.string().min(1),
});

/** Count files recursively (for progress denominator). Symlinks skipped. */
async function countFiles(dir: string): Promise<number> {
  let count = 0;
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return 0;
  }
  for (const name of names) {
    try {
      const stat = await fs.lstat(path.join(dir, name));
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        count += await countFiles(path.join(dir, name));
      } else {
        count++;
      }
    } catch {
      // skip unreadable entries
    }
  }
  return count;
}

/** Progress callback invoked per-file during copy. */
type MigrationProgress = (
  file: string,
  copied: number,
  total: number,
) => Promise<void> | void;

/**
 * Recursively copy a directory with per-file progress callback.
 * Skips entries that fail individually so a single permission error
 * doesn't abort the entire migration.
 */
async function copyDirRecursive(
  src: string,
  dest: string,
  total: number,
  state: { copied: number; errors: string[] },
  onProgress?: MigrationProgress,
): Promise<void> {
  await fs.mkdir(dest, { recursive: true });

  let names: string[];
  try {
    names = await fs.readdir(src);
  } catch (err) {
    state.errors.push(`Cannot read ${src}: ${String(err)}`);
    return;
  }

  for (const name of names) {
    const srcPath = path.join(src, name);
    const destPath = path.join(dest, name);
    try {
      const stat = await fs.lstat(srcPath);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        await copyDirRecursive(srcPath, destPath, total, state, onProgress);
      } else {
        await fs.copyFile(srcPath, destPath);
        state.copied++;
        await onProgress?.(name, state.copied, total);
      }
    } catch (err) {
      state.errors.push(`${srcPath}: ${String(err)}`);
    }
  }
}

/** Shared validation for migrate-workspace endpoints. */
function validateMigrationPaths(
  sourcePath: string,
  destPath: string,
):
  | { ok: true; resolvedSrc: string; resolvedDest: string }
  | { ok: false; error: string; status: 400 | 403 | 404 } {
  const resolvedSrc = path.resolve(sourcePath.replace(/^~/, os.homedir()));
  const resolvedDest = path.resolve(destPath.replace(/^~/, os.homedir()));

  if (!isAllowedPath(resolvedSrc) || !isAllowedPath(resolvedDest)) {
    return { ok: false, error: 'Path not allowed', status: 403 };
  }
  if (resolvedSrc === resolvedDest) {
    return {
      ok: false,
      error: 'Source and destination are the same',
      status: 400,
    };
  }
  if (resolvedDest.startsWith(resolvedSrc + path.sep)) {
    return {
      ok: false,
      error: 'Destination cannot be inside source',
      status: 400,
    };
  }
  if (resolvedSrc.startsWith(resolvedDest + path.sep)) {
    return {
      ok: false,
      error: 'Source cannot be inside destination',
      status: 400,
    };
  }
  return { ok: true, resolvedSrc, resolvedDest };
}

/**
 * POST /files/migrate-workspace
 *
 * Copy workspace contents from sourcePath to destPath.
 * Uses copy-then-verify pattern (caller can delete source after confirming).
 */
files.post(
  '/migrate-workspace',
  zValidator('json', MigrateWorkspaceSchema),
  async (c) => {
    const { sourcePath, destPath } = c.req.valid('json');
    const validation = validateMigrationPaths(sourcePath, destPath);
    if (!validation.ok) {
      return c.json(
        { error: validation.error },
        validation.status as ContentfulStatusCode,
      );
    }
    const { resolvedSrc, resolvedDest } = validation;

    try {
      const srcStat = await fs.stat(resolvedSrc);
      if (!srcStat.isDirectory()) {
        return c.json(
          { error: 'Source is not a directory' },
          400 as ContentfulStatusCode,
        );
      }
    } catch {
      return c.json(
        { error: 'Source directory does not exist' },
        404 as ContentfulStatusCode,
      );
    }

    await fs.mkdir(resolvedDest, { recursive: true });
    logger.info(`Migrating workspace: ${resolvedSrc} → ${resolvedDest}`);

    const total = await countFiles(resolvedSrc);
    const state = { copied: 0, errors: [] as string[] };
    await copyDirRecursive(resolvedSrc, resolvedDest, total, state);

    logger.info(
      `Migration complete: ${state.copied} files copied, ${state.errors.length} errors`,
    );

    return c.json({
      success: state.errors.length === 0,
      copied: state.copied,
      errors: state.errors.slice(0, 20),
      sourcePath: resolvedSrc,
      destPath: resolvedDest,
    });
  },
);

/**
 * POST /files/migrate-workspace-stream
 *
 * SSE-streaming version of migrate-workspace. Sends per-file progress events
 * so the frontend can display a real-time progress bar.
 *
 * Events:
 *   scan     — { total: number }               (file count done)
 *   progress — { file, copied, total, percent } (per-file)
 *   done     — { success, copied, errors }      (migration complete)
 *   error    — { error: string }                (fatal error)
 */
files.post(
  '/migrate-workspace-stream',
  zValidator('json', MigrateWorkspaceSchema),
  async (c) => {
    const { streamSSE } = await import('hono/streaming');
    const { sourcePath, destPath } = c.req.valid('json');
    const validation = validateMigrationPaths(sourcePath, destPath);
    if (!validation.ok) {
      return c.json(
        { error: validation.error },
        validation.status as ContentfulStatusCode,
      );
    }
    const { resolvedSrc, resolvedDest } = validation;

    try {
      const srcStat = await fs.stat(resolvedSrc);
      if (!srcStat.isDirectory()) {
        return c.json(
          { error: 'Source is not a directory' },
          400 as ContentfulStatusCode,
        );
      }
    } catch {
      return c.json(
        { error: 'Source directory does not exist' },
        404 as ContentfulStatusCode,
      );
    }

    try {
      await fs.mkdir(resolvedDest, { recursive: true });
    } catch (err) {
      return c.json(
        { error: `Cannot create destination: ${String(err)}` },
        500 as ContentfulStatusCode,
      );
    }

    logger.info(
      `Migrating workspace (streaming): ${resolvedSrc} → ${resolvedDest}`,
    );
    let eventId = 0;

    c.header('Cache-Control', 'no-cache');
    c.header('Connection', 'keep-alive');
    c.header('X-Accel-Buffering', 'no');

    return streamSSE(c, async (stream) => {
      // Phase 1: Scan
      const total = await countFiles(resolvedSrc);
      await stream.writeSSE({
        event: 'scan',
        data: JSON.stringify({ total }),
        id: String(eventId++),
      });

      // Phase 2: Copy with progress
      const state = { copied: 0, errors: [] as string[] };
      let lastPercent = -1;

      await copyDirRecursive(
        resolvedSrc,
        resolvedDest,
        total,
        state,
        async (file, copied, t) => {
          const percent = t > 0 ? Math.round((copied / t) * 100) : 100;
          // Throttle: send at most every 1% or every file for small workspaces
          if (percent === lastPercent && t > 100) return;
          lastPercent = percent;
          await stream.writeSSE({
            event: 'progress',
            data: JSON.stringify({ file, copied, total: t, percent }),
            id: String(eventId++),
          });
        },
      );

      // Phase 3: Done
      logger.info(
        `Migration complete: ${state.copied} files, ${state.errors.length} errors`,
      );
      await stream.writeSSE({
        event: 'done',
        data: JSON.stringify({
          success: state.errors.length === 0,
          copied: state.copied,
          errors: state.errors.slice(0, 20),
        }),
        id: String(eventId++),
      });
    });
  },
);

// ============================================================================
// Session migration (sessions only + DB update)
// ============================================================================

const MigrateSessionsSchema = z.object({
  oldWorkDir: z.string().min(1),
  newWorkDir: z.string().min(1),
});

/** Count sessions and estimate total size in bytes. */
async function scanSessions(
  sessionsDir: string,
): Promise<{ count: number; totalBytes: number; names: string[] }> {
  let count = 0;
  let totalBytes = 0;
  const names: string[] = [];
  try {
    const entries = await fs.readdir(sessionsDir);
    for (const name of entries) {
      const entryPath = path.join(sessionsDir, name);
      try {
        const stat = await fs.lstat(entryPath);
        if (stat.isSymbolicLink()) continue;
        if (stat.isDirectory()) {
          count++;
          names.push(name);
          // Approximate size: sum direct children files
          try {
            const files = await fs.readdir(entryPath);
            for (const f of files) {
              try {
                const fStat = await fs.lstat(path.join(entryPath, f));
                if (fStat.isFile()) totalBytes += fStat.size;
              } catch {
                /* skip unreadable */
              }
            }
          } catch {
            /* skip unreadable dirs */
          }
        }
      } catch {
        /* skip unreadable entries */
      }
    }
  } catch {
    /* sessions dir doesn't exist */
  }
  return { count, totalBytes, names };
}

/**
 * GET /files/session-stats
 *
 * Returns session count and estimated size for a given workspace directory.
 * Used by the frontend to show "X sessions (~Y MB)" before migration.
 */
files.get('/session-stats', async (c) => {
  const workDir = c.req.query('workDir');
  if (!workDir) {
    return c.json(
      { error: 'workDir query parameter required' },
      400 as ContentfulStatusCode,
    );
  }
  const resolved = path.resolve(workDir.replace(/^~/, os.homedir()));
  if (!isAllowedPath(resolved)) {
    return c.json({ error: 'Path not allowed' }, 403 as ContentfulStatusCode);
  }
  const sessionsDir = path.join(resolved, 'sessions');
  const sessionStats = await scanSessions(sessionsDir);
  // Also count other migratable folders
  const folders: string[] = [];
  for (const folder of MIGRATABLE_FOLDERS) {
    try {
      const stat = await fs.stat(path.join(resolved, folder));
      if (stat.isDirectory()) folders.push(folder);
    } catch {
      /* doesn't exist */
    }
  }
  return c.json({
    sessionCount: sessionStats.count,
    totalBytes: sessionStats.totalBytes,
    totalMB: Math.round(sessionStats.totalBytes / 1024 / 1024),
    folders,
  });
});

/** Folders to migrate when changing workspace. Ordered by priority. */
const MIGRATABLE_FOLDERS = ['sessions', 'channels', 'logs', 'cache', 'skills'];

/**
 * POST /files/migrate-sessions-stream
 *
 * SSE-streaming workspace data migration. Copies all data folders (sessions,
 * channels, logs, cache, skills) from oldWorkDir to newWorkDir, then updates
 * task.work_dir records in the DB.
 *
 * Events:
 *   scan     — { folders, totalFiles }
 *   progress — { folder, copied, total, percent }
 *   db       — { updatedTasks }
 *   done     — { success, copiedFolders, copiedFiles, updatedTasks, errors }
 */
files.post(
  '/migrate-sessions-stream',
  zValidator('json', MigrateSessionsSchema),
  async (c) => {
    const { streamSSE } = await import('hono/streaming');
    const { getDatabase } = await import('@/shared/db/index');
    const { oldWorkDir, newWorkDir } = c.req.valid('json');

    const resolvedOld = path.resolve(oldWorkDir.replace(/^~/, os.homedir()));
    const resolvedNew = path.resolve(newWorkDir.replace(/^~/, os.homedir()));

    if (!isAllowedPath(resolvedOld) || !isAllowedPath(resolvedNew)) {
      return c.json({ error: 'Path not allowed' }, 403 as ContentfulStatusCode);
    }
    if (resolvedOld === resolvedNew) {
      return c.json(
        { error: 'Source and destination are the same' },
        400 as ContentfulStatusCode,
      );
    }
    if (resolvedNew.startsWith(resolvedOld + path.sep)) {
      return c.json(
        { error: 'Destination cannot be inside source' },
        400 as ContentfulStatusCode,
      );
    }
    if (resolvedOld.startsWith(resolvedNew + path.sep)) {
      return c.json(
        { error: 'Source cannot be inside destination' },
        400 as ContentfulStatusCode,
      );
    }

    // Discover which folders exist in the old workspace
    const foldersToMigrate: string[] = [];
    for (const folder of MIGRATABLE_FOLDERS) {
      try {
        const stat = await fs.stat(path.join(resolvedOld, folder));
        if (stat.isDirectory()) foldersToMigrate.push(folder);
      } catch {
        // doesn't exist — skip
      }
    }

    if (foldersToMigrate.length === 0) {
      return c.json(
        { error: 'No data folders to migrate' },
        404 as ContentfulStatusCode,
      );
    }

    logger.info(
      `Workspace migration: ${resolvedOld} → ${resolvedNew} (folders: ${foldersToMigrate.join(', ')})`,
    );
    let eventId = 0;

    c.header('Cache-Control', 'no-cache');
    c.header('Connection', 'keep-alive');
    c.header('X-Accel-Buffering', 'no');

    return streamSSE(c, async (stream) => {
      const errors: string[] = [];

      // Phase 1: Scan — count total files across all folders
      let totalFiles = 0;
      const folderFileCounts = new Map<string, number>();
      for (const folder of foldersToMigrate) {
        const count = await countFiles(path.join(resolvedOld, folder));
        folderFileCounts.set(folder, count);
        totalFiles += count;
      }
      await stream.writeSSE({
        event: 'scan',
        data: JSON.stringify({
          folders: foldersToMigrate,
          totalFiles,
          sessionCount: foldersToMigrate.includes('sessions')
            ? (await scanSessions(path.join(resolvedOld, 'sessions'))).count
            : 0,
        }),
        id: String(eventId++),
      });

      // Phase 2: Copy each folder
      let copiedFiles = 0;
      let copiedFolders = 0;
      for (const folder of foldersToMigrate) {
        const srcDir = path.join(resolvedOld, folder);
        const destDir = path.join(resolvedNew, folder);
        const folderFileCount = folderFileCounts.get(folder) ?? 0;

        const state = { copied: 0, errors: [] as string[] };
        await copyDirRecursive(
          srcDir,
          destDir,
          folderFileCount,
          state,
          async (_file, copied) => {
            copiedFiles++;
            const percent =
              totalFiles > 0
                ? Math.round((copiedFiles / totalFiles) * 100)
                : 100;
            // Throttle: emit at most every 2%
            if (percent % 2 === 0 || copied === folderFileCount) {
              await stream.writeSSE({
                event: 'progress',
                data: JSON.stringify({
                  folder,
                  copied: copiedFiles,
                  total: totalFiles,
                  percent,
                }),
                id: String(eventId++),
              });
            }
          },
        );
        errors.push(...state.errors);
        copiedFolders++;

        // Clean up source folder after successful copy
        if (state.errors.length === 0) {
          try {
            await fs.rm(srcDir, { recursive: true, force: true });
          } catch {
            // non-critical
          }
        }
      }

      // Phase 3: Update task records in the database
      let updatedTasks = 0;
      try {
        const db = getDatabase();
        const likePattern =
          resolvedOld.replace(/%/g, '\\%').replace(/_/g, '\\_') + '%';
        const result = db
          .prepare(
            `UPDATE tasks SET work_dir = ? || SUBSTR(work_dir, ?) WHERE work_dir LIKE ? ESCAPE '\\'`,
          )
          .run(resolvedNew, resolvedOld.length + 1, likePattern);
        updatedTasks = result.changes;

        logger.info(`Migration: updated ${updatedTasks} task records`);
        await stream.writeSSE({
          event: 'db',
          data: JSON.stringify({ updatedTasks }),
          id: String(eventId++),
        });
      } catch (err) {
        logger.error('Migration DB update failed:', err);
        errors.push(`DB update: ${String(err)}`);
      }

      // Phase 4: Done
      logger.info(
        `Migration complete: ${copiedFolders} folders, ${copiedFiles} files, ${updatedTasks} DB records, ${errors.length} errors`,
      );
      await stream.writeSSE({
        event: 'done',
        data: JSON.stringify({
          success: errors.length === 0,
          copiedFolders,
          copiedFiles,
          copiedSessions: copiedFolders, // backward compat with frontend
          updatedTasks,
          errors: errors.slice(0, 20),
        }),
        id: String(eventId++),
      });
    });
  },
);

/**
 * POST /files/cleanup-workspace
 *
 * Remove old workspace directory after successful migration.
 * Only removes contents, not the directory itself (safety measure).
 */
files.post(
  '/cleanup-workspace',
  zValidator('json', z.object({ path: z.string().min(1) })),
  async (c) => {
    const { path: dirPath } = c.req.valid('json');
    const resolved = path.resolve(dirPath.replace(/^~/, os.homedir()));

    if (!isAllowedPath(resolved)) {
      return c.json({ error: 'Path not allowed' }, 403 as ContentfulStatusCode);
    }

    // Depth guard: prevent deleting home dir or its direct children (e.g. ~/Documents)
    const homeDir = os.homedir();
    const relToHome = path.relative(homeDir, resolved);
    const depth = relToHome.split(path.sep).filter(Boolean).length;
    if (resolved === homeDir || depth < 2) {
      return c.json(
        { error: 'Cannot delete home directory or top-level folders' },
        403 as ContentfulStatusCode,
      );
    }

    try {
      await fs.rm(resolved, { recursive: true, force: true });
      logger.info(`Cleaned up old workspace: ${resolved}`);
      return c.json({ success: true });
    } catch (err) {
      logger.error('Failed to clean up workspace:', err);
      return c.json(
        { error: `Cleanup failed: ${String(err)}` },
        500 as ContentfulStatusCode,
      );
    }
  },
);

/**
 * Proxy download for external URLs — avoids CORS issues when the frontend
 * tries to download images/files from CDNs that don't set Access-Control headers.
 * GET /files/proxy-download?url=<external-url>
 */
files.get(
  '/proxy-download',
  zValidator('query', z.object({ url: z.string().url() })),
  async (c) => {
    const { url } = c.req.valid('query');

    // SSRF validation: block private IPs, cloud metadata, non-HTTPS
    const urlCheck = await validateBaseUrlForFetch(url);
    if (!urlCheck.valid) {
      logger.warn('proxy-download SSRF blocked:', {
        url,
        reason: urlCheck.reason,
      });
      return c.json({ error: 'URL not allowed' }, 400);
    }

    try {
      const response = await safeFetch(url, trustedLocalPolicy(), {
        timeoutMs: 30_000,
      });
      if (response.status < 200 || response.status >= 300) {
        const upstreamStatus = [401, 403, 404].includes(response.status)
          ? response.status
          : 502;
        return c.json(
          { error: `Upstream returned ${response.status}` },
          upstreamStatus as ContentfulStatusCode,
        );
      }

      const contentType =
        response.headers['content-type'] ?? 'application/octet-stream';
      const body = response.body;

      const urlPath = new URL(url).pathname;
      const rawName = urlPath.split('/').pop()?.split('?')[0] || 'download';
      // Sanitize: strip quotes, CR/LF, and non-ASCII to prevent header injection
      const fileName = decodeURIComponent(rawName).replace(
        /["\r\n\x00-\x1f\x7f-\uffff]/g,
        '_',
      );

      return new Response(new Uint8Array(body), {
        headers: {
          'Content-Type': contentType,
          'Content-Disposition': `attachment; filename="${fileName}"`,
          'Content-Length': String(body.byteLength),
        },
      });
    } catch (err) {
      logger.error('Proxy download failed:', err);
      return c.json({ error: 'Failed to fetch URL' }, 502);
    }
  },
);

export { files as filesRoutes };
