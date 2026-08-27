/**
 * FFmpeg Command Executor
 *
 * Core utility for running FFmpeg/FFprobe commands with:
 *  - Smart binary detection (system FFmpeg → ffmpeg-static fallback)
 *  - Real-time progress parsing from FFmpeg's -progress pipe
 *  - Structured probe results via ffprobe JSON output
 *  - Session-aware path validation
 *
 * @module services/ffmpeg/executor
 */

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  realpathSync,
  statSync,
} from 'node:fs';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from 'node:path';

import { getExtendedPath } from '@/shared/agent-runtimes/resolve';
import { getSetting } from '@/shared/db/operations';
import { getMemoryBudgetSupervisor } from '@/shared/services/memory-budget';
import { assertSafeExternalMediaFile } from '@/shared/utils/external-media-trust';
import { createLogger } from '@/shared/utils/logger';
import { expandPath } from '@/shared/utils/paths';

import type {
  FFmpegBinaryInfo,
  FFmpegProgress,
  FFmpegResult,
  ProbeResult,
  StreamInfo,
} from './types';

const logger = createLogger('FFmpeg');

// ============================================================================
// Constants
// ============================================================================

/** Maximum execution time for a single FFmpeg operation (30 minutes) */
const MAX_EXECUTION_MS = 30 * 60 * 1_000;

// ============================================================================
// Binary Detection
// ============================================================================

/** Cached binary info to avoid repeated detection */
let cachedBinaryInfo: FFmpegBinaryInfo | null = null;

const FFMPEG_PATH_ENV_KEYS = ['NEUMA_FFMPEG_PATH', 'FFMPEG_PATH'];
const FFPROBE_PATH_ENV_KEYS = ['NEUMA_FFPROBE_PATH', 'FFPROBE_PATH'];
const EXTRA_SEARCH_PATH_ENV = 'NEUMA_FFMPEG_SEARCH_PATHS';

const UNIX_FFMPEG_SEARCH_DIRS = [
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/opt/local/bin',
  '/usr/bin',
  '/bin',
];

const LINUX_FFMPEG_SEARCH_DIRS = [
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
  '/snap/bin',
];

const WINDOWS_FFMPEG_SEARCH_DIRS = [
  'C:\\ffmpeg\\bin',
  'C:\\ProgramData\\chocolatey\\bin',
];

/**
 * Detect FFmpeg and FFprobe binaries.
 * Checks explicit env overrides, PATH, common package-manager locations, then
 * falls back to ffmpeg-static. macOS GUI apps often launch without the user's
 * shell PATH, so Homebrew/MacPorts paths must be searched directly.
 * Caches the result for subsequent calls.
 */
export function detectBinaries(): FFmpegBinaryInfo | null {
  if (cachedBinaryInfo) return cachedBinaryInfo;

  const systemBinaries = detectSystemBinaries();
  if (systemBinaries) {
    cachedBinaryInfo = systemBinaries;
    return cachedBinaryInfo;
  }

  const staticBinaries = detectStaticBinaries();
  if (staticBinaries) {
    cachedBinaryInfo = staticBinaries;
    return cachedBinaryInfo;
  }

  logger.error(
    `FFmpeg not found. Checked PATH plus common install locations (${commonSearchDirs().join(', ')}). Install via: brew install ffmpeg (macOS) or apt install ffmpeg (Linux), or set NEUMA_FFMPEG_PATH.`,
  );
  return null;
}

function detectSystemBinaries(): FFmpegBinaryInfo | null {
  const ffmpegPath =
    resolveConfiguredExecutable(FFMPEG_PATH_ENV_KEYS) ??
    resolveExecutable('ffmpeg');
  if (!ffmpegPath) return null;

  const version = readBinaryVersion(ffmpegPath);
  if (!version) return null;

  const ffprobePath =
    resolveConfiguredExecutable(FFPROBE_PATH_ENV_KEYS) ??
    resolveExecutableInDir('ffprobe', dirname(ffmpegPath)) ??
    resolveExecutable('ffprobe');

  const result: FFmpegBinaryInfo = {
    ffmpegPath,
    ffprobePath: ffprobePath ?? '',
    version,
    source: 'system',
  };
  logger.info(`System FFmpeg detected: ${ffmpegPath} (${version})`);
  return result;
}

function detectStaticBinaries(): FFmpegBinaryInfo | null {
  try {
    const ffmpegPath = execFileSync(
      process.execPath,
      ['-e', "try{console.log(require('ffmpeg-static'))}catch{}"],
      { encoding: 'utf-8' },
    ).trim();
    if (!ffmpegPath || !isExecutableFile(ffmpegPath)) return null;

    const version = readBinaryVersion(ffmpegPath);
    if (!version) return null;

    const ffprobePath = resolveExecutableInDir('ffprobe', dirname(ffmpegPath));
    const result: FFmpegBinaryInfo = {
      ffmpegPath,
      ffprobePath: ffprobePath ?? '',
      version,
      source: 'ffmpeg-static',
    };
    logger.info(`ffmpeg-static detected: ${ffmpegPath} (${version})`);
    return result;
  } catch {
    return null;
  }
}

function resolveConfiguredExecutable(envKeys: string[]): string | null {
  for (const key of envKeys) {
    const value = process.env[key]?.trim();
    if (!value) continue;
    if (isExecutableFile(value)) return value;
    logger.warn(`${key} is set but is not an executable file: ${value}`);
  }
  return null;
}

function resolveExecutable(name: string): string | null {
  for (const dir of executableSearchDirs()) {
    const found = resolveExecutableInDir(name, dir);
    if (found) return found;
  }
  return null;
}

function resolveExecutableInDir(name: string, dir: string): string | null {
  if (!dir || !isAbsolute(dir)) return null;
  for (const fileName of executableNames(name)) {
    const candidate = join(dir, fileName);
    if (isExecutableFile(candidate)) return candidate;
  }
  return null;
}

function executableSearchDirs(): string[] {
  return uniqueStrings([
    ...splitSearchPath(process.env[EXTRA_SEARCH_PATH_ENV]),
    ...splitSearchPath(getExtendedPath()),
    ...commonSearchDirs(),
  ]).filter(isAbsolute);
}

function commonSearchDirs(): string[] {
  if (process.platform === 'darwin') return UNIX_FFMPEG_SEARCH_DIRS;
  if (process.platform === 'win32') return WINDOWS_FFMPEG_SEARCH_DIRS;
  return LINUX_FFMPEG_SEARCH_DIRS;
}

function splitSearchPath(value: string | undefined): string[] {
  return (value ?? '')
    .split(process.platform === 'win32' ? ';' : ':')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function executableNames(name: string): string[] {
  if (process.platform !== 'win32' || /\.[^\\/]+$/.test(name)) return [name];
  const pathExt = process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM';
  return uniqueStrings([
    name,
    ...pathExt
      .split(';')
      .map((ext) => ext.trim())
      .filter(Boolean)
      .map((ext) => `${name}${ext.toLowerCase()}`),
    ...pathExt
      .split(';')
      .map((ext) => ext.trim())
      .filter(Boolean)
      .map((ext) => `${name}${ext.toUpperCase()}`),
  ]);
}

function isExecutableFile(filePath: string): boolean {
  if (!filePath || !isAbsolute(filePath)) return false;
  try {
    const stats = statSync(filePath);
    if (!stats.isFile()) return false;
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function readBinaryVersion(binaryPath: string): string | null {
  const result = spawnSync(binaryPath, ['-version'], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error || result.status !== 0) return null;
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  return output.split('\n')[0]?.trim() || null;
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

/** Clear the cached binary info (useful for testing) */
export function clearBinaryCache(): void {
  cachedBinaryInfo = null;
}

// ============================================================================
// Path Validation
// ============================================================================

/**
 * Opt-in relaxations for a single validation call.
 *
 * Callers that already resolved a path under a different, equally explicit
 * rule pass these so the workspace check does not reject a file the product
 * deliberately allows.
 */
export interface PathValidationOptions {
  /**
   * Accept a read of a master the user keeps outside the workspace — footage
   * on an external drive that a project references in place rather than
   * copying in.
   *
   * This does not skip validation: the path is re-checked against
   * `assertSafeExternalMediaFile`, which still requires a real, non-sensitive
   * file under a trusted root. Only callers holding a `MediaItem` with
   * `origin: 'external'` should set it, so an agent-supplied path cannot reach
   * outside the workspace through a tool that never sees an asset record.
   */
  allowExternalMedia?: boolean;
}

/**
 * Validate that a file path is within the allowed session/workspace roots.
 * Reads may use sibling session folders so an attached source selected in a
 * prior task can be processed in a later task without copying the original.
 * Writes stay confined to the current workDir.
 */
export function validatePath(
  filePath: string,
  workDir: string,
  access: 'read' | 'write' = 'write',
  options: PathValidationOptions = {},
): string {
  const resolved = isAbsolute(filePath)
    ? resolve(filePath)
    : resolve(workDir, filePath);
  const normalizedWorkDir = resolve(workDir);
  const allowedRoots =
    access === 'read'
      ? getReadableRoots(normalizedWorkDir)
      : [normalizedWorkDir];

  // Check the logical path first
  if (!allowedRoots.some((root) => isWithinRoot(resolved, root))) {
    if (access === 'read' && options.allowExternalMedia) {
      return assertSafeExternalMediaFile(resolved);
    }
    throw new Error(
      `Path "${filePath}" is outside the allowed ${access} directories. All files must be within: ${allowedRoots.join(', ')}`,
    );
  }

  // If the path exists, resolve symlinks and re-check to prevent symlink escapes
  if (existsSync(resolved)) {
    const realPath = realpathSync(resolved);
    const realRoots = allowedRoots.map((root) =>
      existsSync(root) ? realpathSync(root) : root,
    );
    if (!realRoots.some((root) => isWithinRoot(realPath, root))) {
      throw new Error(
        `Path "${filePath}" resolves outside the allowed ${access} directories via symlink. All files must be within: ${allowedRoots.join(', ')}`,
      );
    }
  }

  return resolved;
}

function getReadableRoots(workDir: string): string[] {
  const roots = new Set<string>([workDir]);
  addSessionRoot(roots, workDir);

  const configuredWorkDir = getConfiguredWorkDir();
  if (configuredWorkDir) {
    addSessionRoot(roots, configuredWorkDir);
    roots.add(join(configuredWorkDir, 'sessions'));
  }

  return [...roots];
}

function getConfiguredWorkDir(): string | undefined {
  try {
    const configured = getSetting('workDir');
    return configured ? resolve(expandPath(configured)) : undefined;
  } catch {
    return undefined;
  }
}

function addSessionRoot(roots: Set<string>, dir: string): void {
  const base = basename(dir);
  const parent = dirname(dir);
  if (base.startsWith('session-') && basename(parent) === 'sessions') {
    roots.add(parent);
  }
  if (base === 'attachments') {
    const sessionDir = parent;
    const sessionsDir = dirname(sessionDir);
    if (
      basename(sessionDir).startsWith('session-') &&
      basename(sessionsDir) === 'sessions'
    ) {
      roots.add(sessionsDir);
    }
  }
}

function isWithinRoot(target: string, root: string): boolean {
  const rel = relative(root, target);
  return rel === '' || (!!rel && !rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * Validate that an input file exists and is readable.
 */
export function validateInputFile(
  filePath: string,
  workDir: string,
  options: PathValidationOptions = {},
): string {
  const resolved = validatePath(filePath, workDir, 'read', options);

  if (!existsSync(resolved)) {
    throw new Error(`Input file not found: ${resolved}`);
  }

  const stats = statSync(resolved);
  if (!stats.isFile()) {
    throw new Error(`Path is not a file: ${resolved}`);
  }

  return resolved;
}

/**
 * Generate an output path, ensuring it's within the workspace.
 * If no output is specified, generates one based on the input filename and a suffix.
 */
export function resolveOutputPath(
  inputPath: string,
  workDir: string,
  outputPath?: string,
  suffix?: string,
  extension?: string,
): string {
  if (outputPath) {
    return validatePath(outputPath, workDir);
  }

  // Resolve input path to get the base filename, but place output in workDir
  const resolvedInput = isAbsolute(inputPath)
    ? inputPath
    : resolve(workDir, inputPath);
  const inputBasename = basename(resolvedInput);
  const dotIdx = inputBasename.lastIndexOf('.');
  const nameWithoutExt =
    dotIdx > 0 ? inputBasename.slice(0, dotIdx) : inputBasename;
  const originalExt = dotIdx > 0 ? inputBasename.slice(dotIdx) : '';
  const finalExt = extension ? `.${extension}` : originalExt;
  const finalSuffix = suffix || 'output';

  return join(workDir, `${nameWithoutExt}_${finalSuffix}${finalExt}`);
}

// ============================================================================
// FFprobe
// ============================================================================

/**
 * Probe a media file and return structured metadata.
 * Uses ffprobe with JSON output for reliable parsing.
 */
export async function probeFile(
  filePath: string,
  workDir: string,
  options: PathValidationOptions = {},
): Promise<ProbeResult> {
  const bins = detectBinaries();
  if (!bins) {
    throw new Error(
      'FFmpeg/FFprobe is not installed. Please install FFmpeg first.',
    );
  }
  if (!bins.ffprobePath) {
    throw new Error(
      'FFprobe is not available. Install FFmpeg with ffprobe included.',
    );
  }

  const resolvedPath = validateInputFile(filePath, workDir, options);

  return new Promise<ProbeResult>((resolve, reject) => {
    const args = [
      '-v',
      'quiet',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      resolvedPath,
    ];

    const proc = spawn(bins.ffprobePath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(
          new Error(`ffprobe failed (exit ${code}): ${stderr.slice(0, 500)}`),
        );
        return;
      }

      try {
        const raw = JSON.parse(stdout) as Record<string, unknown>;
        resolve(parseProbeOutput(raw, resolvedPath));
      } catch (err) {
        reject(
          new Error(
            `Failed to parse ffprobe output: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to run ffprobe: ${err.message}`));
    });
  });
}

/** Parse raw ffprobe JSON into a structured ProbeResult */
function parseProbeOutput(
  raw: Record<string, unknown>,
  filePath: string,
): ProbeResult {
  const format = (raw.format || {}) as Record<string, unknown>;
  const rawStreams = (raw.streams || []) as Record<string, unknown>[];

  const streams: StreamInfo[] = rawStreams.map((s) => {
    const tags = (s.tags || {}) as Record<string, string>;
    const rFrameRate = s.r_frame_rate as string | undefined;
    let fps: number | undefined;
    if (rFrameRate) {
      const [num, den] = rFrameRate.split('/').map(Number);
      if (num && den) fps = Math.round((num / den) * 100) / 100;
    }

    return {
      index: Number(s.index) || 0,
      codecType: (s.codec_type as StreamInfo['codecType']) || 'data',
      codecName: (s.codec_name as string) || 'unknown',
      codecLongName: s.codec_long_name as string | undefined,
      width: s.width ? Number(s.width) : undefined,
      height: s.height ? Number(s.height) : undefined,
      fps,
      pixelFormat: s.pix_fmt as string | undefined,
      colorTransfer: s.color_transfer as string | undefined,
      colorPrimaries: s.color_primaries as string | undefined,
      colorSpace: s.color_space as string | undefined,
      sampleRate: s.sample_rate ? Number(s.sample_rate) : undefined,
      channels: s.channels ? Number(s.channels) : undefined,
      bitRate: s.bit_rate ? Number(s.bit_rate) : undefined,
      language: tags.language,
      title: tags.title,
    };
  });

  return {
    filePath,
    duration: Number(format.duration) || 0,
    size: Number(format.size) || 0,
    bitRate: Number(format.bit_rate) || 0,
    formatName: (format.format_name as string) || 'unknown',
    formatLongName: format.format_long_name as string | undefined,
    streams,
    videoStreamCount: streams.filter((s) => s.codecType === 'video').length,
    audioStreamCount: streams.filter((s) => s.codecType === 'audio').length,
    subtitleStreamCount: streams.filter((s) => s.codecType === 'subtitle')
      .length,
    raw,
  };
}

// ============================================================================
// FFmpeg Command Execution
// ============================================================================

/**
 * Run an FFmpeg command with real-time progress tracking.
 *
 * @param args - FFmpeg arguments (without the binary path)
 * @param options - Execution options
 * @returns Promise resolving to the operation result
 */
export async function runFFmpeg(
  args: string[],
  options: {
    /** Total duration of input in seconds (for progress calculation) */
    inputDuration?: number;
    /** Callback for progress updates */
    onProgress?: (progress: FFmpegProgress) => void;
    /** Abort signal for cancellation */
    abortSignal?: AbortSignal;
  } = {},
): Promise<{ exitCode: number; stderr: string }> {
  const bins = detectBinaries();
  if (!bins) {
    throw new Error('FFmpeg is not installed. Please install FFmpeg first.');
  }

  const { inputDuration, onProgress, abortSignal } = options;

  // Prepend -y (overwrite) and -hide_banner (clean output)
  const fullArgs = ['-y', '-hide_banner', ...args];

  // If we want progress tracking and have duration, add -progress pipe:1
  const trackProgress = !!onProgress && !!inputDuration;
  if (trackProgress) {
    fullArgs.push('-progress', 'pipe:1', '-stats_period', '2');
  }

  logger.info(`Running: ffmpeg ${fullArgs.join(' ').slice(0, 200)}...`);

  return getMemoryBudgetSupervisor().runWithFfmpegSlot(() => {
    return new Promise<{ exitCode: number; stderr: string }>(
      (resolve, reject) => {
        const proc = spawn(bins.ffmpegPath, fullArgs, {
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stderr = '';
        let progressBuffer = '';

        // Parse progress from stdout (when using -progress pipe:1)
        if (trackProgress) {
          proc.stdout.on('data', (chunk: Buffer) => {
            progressBuffer += chunk.toString();

            // Parse key=value pairs from progress output
            const lines = progressBuffer.split('\n');
            // Keep the last incomplete line in the buffer
            progressBuffer = lines.pop() || '';

            let outTimeUs: number | null = null;
            let frame: number | undefined;
            let speed: number | undefined;
            let totalSize: number | undefined;
            let bitrate: number | undefined;

            for (const line of lines) {
              const [key, val] = line.split('=');
              if (!key || !val) continue;
              const trimmedKey = key.trim();
              const trimmedVal = val.trim();

              switch (trimmedKey) {
                case 'out_time_us':
                  outTimeUs = parseInt(trimmedVal, 10);
                  break;
                case 'frame':
                  frame = parseInt(trimmedVal, 10) || undefined;
                  break;
                case 'speed': {
                  const speedMatch = trimmedVal.match(/([\d.]+)x/);
                  speed = speedMatch?.[1]
                    ? parseFloat(speedMatch[1])
                    : undefined;
                  break;
                }
                case 'total_size':
                  totalSize = parseInt(trimmedVal, 10) || undefined;
                  break;
                case 'bitrate': {
                  const brMatch = trimmedVal.match(/([\d.]+)kbits/);
                  bitrate = brMatch?.[1] ? parseFloat(brMatch[1]) : undefined;
                  break;
                }
              }
            }

            if (outTimeUs !== null && inputDuration) {
              const timeSeconds = outTimeUs / 1_000_000;
              const percent = Math.min(
                100,
                Math.round((timeSeconds / inputDuration) * 1000) / 10,
              );

              onProgress({
                percent,
                timeSeconds,
                frame,
                speed,
                sizeBytes: totalSize,
                bitrateKbps: bitrate,
              });
            }
          });
        }

        // Capture stderr (FFmpeg writes all logging here)
        proc.stderr.on('data', (chunk: Buffer) => {
          stderr += chunk.toString();
          // Keep stderr bounded to avoid memory issues on very long operations
          if (stderr.length > 50_000) {
            stderr = stderr.slice(-30_000);
          }
        });

        // Handle abort signal
        if (abortSignal) {
          const onAbort = () => {
            proc.kill('SIGTERM');
          };
          abortSignal.addEventListener('abort', onAbort, { once: true });
          proc.on('close', () =>
            abortSignal.removeEventListener('abort', onAbort),
          );
        }

        // Timeout protection
        const timeout = setTimeout(() => {
          proc.kill('SIGKILL');
          reject(
            new Error(
              `FFmpeg operation timed out after ${MAX_EXECUTION_MS / 60_000} minutes`,
            ),
          );
        }, MAX_EXECUTION_MS);

        proc.on('close', (code) => {
          clearTimeout(timeout);
          resolve({ exitCode: code ?? 1, stderr });
        });

        proc.on('error', (err) => {
          clearTimeout(timeout);
          reject(new Error(`Failed to spawn FFmpeg process: ${err.message}`));
        });
      },
    );
  }, abortSignal);
}

/**
 * High-level FFmpeg execution with input validation, output probing, and progress tracking.
 * Used by all tool handlers for consistent behavior.
 */
export async function executeFFmpegOperation(
  inputPath: string,
  outputPath: string,
  workDir: string,
  buildArgs: (resolvedInput: string, resolvedOutput: string) => string[],
  options: {
    onProgress?: (progress: FFmpegProgress) => void;
    abortSignal?: AbortSignal;
    /** Skip input probing (for operations like concat that have no single input) */
    skipInputProbe?: boolean;
  } & PathValidationOptions = {},
): Promise<FFmpegResult> {
  const startTime = Date.now();
  const readOptions: PathValidationOptions = {
    allowExternalMedia: options.allowExternalMedia,
  };

  try {
    // Validate and resolve paths
    const resolvedInput = options.skipInputProbe
      ? validatePath(inputPath, workDir, 'read', readOptions)
      : validateInputFile(inputPath, workDir, readOptions);
    const resolvedOutput = validatePath(outputPath, workDir);

    // Ensure the output directory exists (session folders may not be created yet)
    mkdirSync(dirname(resolvedOutput), { recursive: true });

    // Probe input for duration (needed for progress tracking)
    let inputDuration: number | undefined;
    if (!options.skipInputProbe) {
      try {
        const probe = await probeFile(resolvedInput, workDir, readOptions);
        inputDuration = probe.duration;
      } catch {
        // Non-fatal: we just won't have progress percentage
        logger.warn(
          `Could not probe input file for duration: ${resolvedInput}`,
        );
      }
    }

    // Build FFmpeg args from the caller's builder function
    const args = buildArgs(resolvedInput, resolvedOutput);

    // Execute FFmpeg
    const { exitCode, stderr } = await runFFmpeg(args, {
      inputDuration,
      onProgress: options.onProgress,
      abortSignal: options.abortSignal,
    });

    if (exitCode !== 0) {
      // Extract the most useful error from stderr (last few lines)
      const lines = stderr.trim().split('\n');
      const errorLines = lines.slice(-5).join('\n');
      return {
        success: false,
        error: `FFmpeg failed (exit code ${exitCode}): ${errorLines}`,
        elapsedMs: Date.now() - startTime,
      };
    }

    // Verify output exists and probe it
    if (!existsSync(resolvedOutput)) {
      return {
        success: false,
        error: 'FFmpeg completed but output file was not created',
        elapsedMs: Date.now() - startTime,
      };
    }

    const outputStats = statSync(resolvedOutput);
    let outputDuration: number | undefined;
    try {
      const bins = detectBinaries();
      if (bins?.ffprobePath) {
        const probe = await probeFile(resolvedOutput, workDir);
        outputDuration = probe.duration;
      }
    } catch {
      // Non-fatal: output probe failed
    }

    return {
      success: true,
      outputPath: resolvedOutput,
      outputDuration,
      outputSize: outputStats.size,
      elapsedMs: Date.now() - startTime,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      elapsedMs: Date.now() - startTime,
    };
  }
}
