import fs from 'node:fs/promises';
import path from 'node:path';

import { frameRateToNumber, type FrameRate } from '@neumar/video-ir';
import { z } from 'zod';

import { getSetting } from '@/shared/db/operations';
import {
  runStreamingCommand,
  StreamingCommandError,
  type StreamingCommandInput,
  type StreamingCommandResult,
} from '@/shared/process/run-streaming-command';
import { resolveHyperframesCommand } from '@/shared/services/design-mode/hyperframes-command';

import type {
  EngineAvailability,
  EngineRenderInput,
  EngineRenderOutput,
  EngineTemplateRef,
  EngineValidationResult,
  VideoEngineAdapter,
  VideoEngineCapabilities,
} from './types';

export const HYPERFRAMES_REQUIRED_VERSION = '0.8.7';

const HYPERFRAMES_CAPABILITIES: VideoEngineCapabilities = {
  paradigms: ['html-css-gsap'],
  outputFormats: ['mp4', 'webm-alpha', 'png-sequence'],
  maxResolution: { width: 3840, height: 2160 },
  alpha: true,
  audio: 'multi',
  subtitles: 'burn-in',
  renderTarget: ['local-node'],
  fps: [
    { num: 24, den: 1 },
    { num: 25, den: 1 },
    { num: 30_000, den: 1_001 },
    { num: 30, den: 1 },
    { num: 60_000, den: 1_001 },
    { num: 60, den: 1 },
  ],
  licensing: 'Apache-2.0',
  renderSpeedHint: 'faster',
  bestFor: [
    'Deterministic HTML animation',
    'UI and screen-capture compositions',
    'Transparent WebM output',
  ],
  weaknesses: ['Requires the HyperFrames CLI and a compatible browser'],
};

const DoctorSchema = z.object({
  checks: z.array(
    z.object({
      name: z.string(),
      ok: z.boolean(),
      detail: z.string(),
    }),
  ),
  _meta: z.object({ version: z.string() }),
});

type RunCommand = (
  input: StreamingCommandInput,
) => Promise<StreamingCommandResult>;

export interface HyperframesAdapterDeps {
  command?: string;
  runCommand?: RunCommand;
}

export function createHyperframesAdapter(
  deps: HyperframesAdapterDeps = {},
): VideoEngineAdapter {
  const command = deps.command ?? resolveHyperframesCommand();
  const runCommand = deps.runCommand ?? runStreamingCommand;
  return {
    id: 'hyperframes',
    name: 'HyperFrames',
    upstreamVersion: HYPERFRAMES_REQUIRED_VERSION,
    capabilities: HYPERFRAMES_CAPABILITIES,
    probeAvailability: () => probeHyperframes(command, runCommand),
    validate: validateHyperframesTemplate,
    async render(input, ctx) {
      const availability = await probeHyperframes(
        command,
        runCommand,
        ctx.workDir,
      );
      if (!availability.installed) {
        throw new HyperframesEngineError(
          availability.reason,
          availability.detail ??
            `HyperFrames ${availability.reason.replaceAll('-', ' ')}`,
        );
      }
      const validation = validateHyperframesTemplate(input.template);
      const error = validation.issues.find(
        (issue) => issue.severity === 'error',
      );
      if (error) {
        throw new HyperframesEngineError('invalid-input', error.message);
      }

      const startedAt = Date.now();
      const cacheDir = path.join(
        ctx.workDir,
        '.neuma-cache',
        'hyperframes-extract',
      );
      await fs.mkdir(cacheDir, { recursive: true });
      await fs.mkdir(path.dirname(input.config.outputPath), {
        recursive: true,
      });
      const diagnostics: EngineRenderOutput['diagnostics'] = [
        {
          level: 'info',
          message: 'Selected HyperFrames render engine',
          data: {
            cliVersion: availability.version,
            browserVersion: availability.browserVersion,
            command,
          },
        },
      ];
      ctx.onProgress?.(2, 'preparing');
      await runCommand({
        bin: command,
        args: buildHyperframesRenderArgs(input, cacheDir),
        cwd: path.dirname(input.template.sourcePath),
        env: { ...process.env, ...ctx.env },
        signal: ctx.signal,
        onLine: (line) => {
          diagnostics.push({ level: 'info', message: line });
          const pct = progressPercent(line);
          if (pct !== undefined) ctx.onProgress?.(pct, 'rendering');
        },
      });
      const stat = await fs.stat(input.config.outputPath).catch(() => null);
      if (!stat?.isFile() || stat.size === 0) {
        throw new HyperframesEngineError(
          'render-failed',
          `HyperFrames did not write ${input.config.outputPath}`,
        );
      }
      const fps = frameRateToNumber(input.config.fps);
      const durationSec =
        input.config.duration === 'auto' ? 0 : input.config.duration;
      ctx.onProgress?.(100, 'muxing');
      return {
        outputPath: input.config.outputPath,
        meta: {
          durationSec,
          fileSizeBytes: stat.size,
          actualResolution: input.config.resolution,
          fps,
          renderedFrames: Math.max(0, Math.round(durationSec * fps)),
          renderWallClockSec: (Date.now() - startedAt) / 1_000,
          engineVersion: availability.version,
        },
        diagnostics,
      };
    },
  };
}

export class HyperframesEngineError extends Error {
  constructor(
    public readonly code:
      | 'not-found'
      | 'version-too-old'
      | 'browser-missing'
      | 'invalid-input'
      | 'render-failed',
    message: string,
  ) {
    super(message);
    this.name = 'HyperframesEngineError';
  }
}

// `process.cwd()` is not the workspace in the Tauri sidecar, so the probe must
// resolve the configured workspace root instead.
function workspaceRoot(): string {
  return getSetting('workDir') ?? process.cwd();
}

export async function probeHyperframes(
  command: string,
  runCommand: RunCommand = runStreamingCommand,
  cwd = workspaceRoot(),
): Promise<EngineAvailability> {
  let version: string;
  try {
    const result = await runCommand({
      bin: command,
      args: ['--version'],
      cwd,
      timeoutMs: 10_000,
    });
    version = parseVersion(result.stdout);
  } catch (error) {
    return {
      installed: false,
      reason:
        error instanceof StreamingCommandError && error.code === 'not-found'
          ? 'not-found'
          : 'not-found',
      detail: error instanceof Error ? error.message : String(error),
    };
  }
  if (compareVersions(version, HYPERFRAMES_REQUIRED_VERSION) < 0) {
    return {
      installed: false,
      reason: 'version-too-old',
      version,
      requiredVersion: HYPERFRAMES_REQUIRED_VERSION,
    };
  }
  try {
    const result = await runCommand({
      bin: command,
      args: ['doctor', '--json'],
      cwd,
      timeoutMs: 30_000,
    });
    const doctor = DoctorSchema.parse(JSON.parse(result.stdout));
    const browser = doctor.checks.find((check) => check.name === 'Chrome');
    if (!browser?.ok) {
      return {
        installed: false,
        reason: 'browser-missing',
        version,
        detail: browser?.detail ?? 'HyperFrames doctor did not report Chrome',
      };
    }
    return {
      installed: true,
      version,
      browserVersion: browser.detail,
    };
  } catch (error) {
    return {
      installed: false,
      reason: 'browser-missing',
      version,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

export function buildHyperframesRenderArgs(
  input: EngineRenderInput,
  framesCacheDir: string,
): string[] {
  const config = input.config;
  const format = config.format === 'webm-alpha' ? 'webm' : config.format;
  const sourceFrameFormat =
    config.sourceFrameFormat ??
    (config.contentKind === 'ui-capture' ? 'png' : 'auto');
  const args = [
    'render',
    path.dirname(input.template.sourcePath),
    '--output',
    path.resolve(config.outputPath),
    '--format',
    format,
    '--fps',
    formatFrameRate(config.fps),
    '--video-frame-format',
    sourceFrameFormat,
    '--frames-cache-dir',
    framesCacheDir,
    '--quality',
    config.quality ?? 'standard',
  ];
  if (input.variables && Object.keys(input.variables).length > 0) {
    args.push('--variables', JSON.stringify(input.variables));
  }
  if (config.strictness === 'strict') args.push('--strict', '--no-best-effort');
  if (config.strictness === 'strict-all') {
    args.push('--strict-all', '--no-best-effort');
  }
  if (config.reproducible) args.push('--docker');
  if (config.format === 'webm-alpha' && config.vp9CpuUsed !== undefined) {
    args.push('--vp9-cpu-used', String(config.vp9CpuUsed));
  }
  return args;
}

function validateHyperframesTemplate(
  template: EngineTemplateRef,
): EngineValidationResult {
  const issues: EngineValidationResult['issues'] = [];
  if (!template.sourcePath) {
    issues.push({
      code: 'missing-source-path',
      message: 'HyperFrames requires an index.html source path',
      severity: 'error',
    });
  } else if (path.basename(template.sourcePath) !== 'index.html') {
    issues.push({
      code: 'invalid-entry',
      message: 'HyperFrames template sourcePath must point to index.html',
      severity: 'error',
    });
  }
  return { ok: issues.length === 0, issues };
}

function parseVersion(stdout: string): string {
  const match = stdout.trim().match(/\d+\.\d+\.\d+/);
  if (!match) throw new Error('HyperFrames returned an invalid version');
  return match[0];
}

function compareVersions(left: string, right: string): number {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    const delta = (a[index] ?? 0) - (b[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

function formatFrameRate(rate: FrameRate): string {
  return rate.den === 1 ? String(rate.num) : `${rate.num}/${rate.den}`;
}

function progressPercent(line: string): number | undefined {
  const percent = line.match(/(?:^|\s)(\d{1,3}(?:\.\d+)?)%/);
  if (percent) return Math.min(99, Math.max(1, Number(percent[1])));
  const frames = line.match(/frame\s+(\d+)\s*\/\s*(\d+)/i);
  if (!frames) return undefined;
  return Math.min(
    99,
    Math.max(1, Math.round((Number(frames[1]) / Number(frames[2])) * 100)),
  );
}
