import path from 'path';

import { runFFmpeg } from '@/shared/services/ffmpeg';

import type { ReformatCache } from './reformat-cache';
import type { ReformatSpec, SourceArtifact } from './types';

export interface ReformatResult {
  derivativePath: string;
  cacheHit: boolean;
  spec: ReformatSpec;
}

export interface ReformatterOptions {
  cache: ReformatCache;
  executor?: (input: {
    source: SourceArtifact;
    spec: ReformatSpec;
    outputPath: string;
  }) => Promise<void>;
}

export class MediaReformatter {
  private readonly cache: ReformatCache;
  private readonly executor: NonNullable<ReformatterOptions['executor']>;

  constructor(options: ReformatterOptions) {
    this.cache = options.cache;
    this.executor = options.executor ?? defaultFfmpegExecutor;
  }

  async run(
    source: SourceArtifact,
    spec: ReformatSpec,
  ): Promise<ReformatResult> {
    const cached = await this.cache.get({ source, spec });
    if (cached) return { derivativePath: cached, cacheHit: true, spec };
    const outputPath = await this.cache.pathFor({ source, spec });
    await this.executor({ source, spec, outputPath });
    return { derivativePath: outputPath, cacheHit: false, spec };
  }
}

export function sourceMatchesReformatSpec(
  source: SourceArtifact,
  spec?: ReformatSpec,
): boolean {
  if (!spec) return true;
  if (spec.targetMime && source.mime !== spec.targetMime) return false;
  const container = spec.container ? `.${spec.container}` : '';
  if (container && path.extname(source.path).toLowerCase() !== container) {
    return false;
  }
  return true;
}

async function defaultFfmpegExecutor(input: {
  source: SourceArtifact;
  spec: ReformatSpec;
  outputPath: string;
}): Promise<void> {
  const args = ['-i', input.source.path];
  if (input.spec.maxDurationSeconds) {
    args.push('-t', String(input.spec.maxDurationSeconds));
  }
  if (input.spec.videoCodec) args.push('-c:v', input.spec.videoCodec);
  if (input.spec.audioCodec) args.push('-c:a', input.spec.audioCodec);
  if (input.spec.aspectRatio) args.push('-aspect', input.spec.aspectRatio);
  args.push(input.outputPath);
  const result = await runFFmpeg(args);
  if (result.exitCode !== 0) {
    throw new Error(`Reformat failed: ${result.stderr}`);
  }
}
