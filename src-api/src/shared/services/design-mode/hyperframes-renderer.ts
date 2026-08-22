import fs from 'node:fs/promises';
import path from 'node:path';

import { runStreamingCommand } from '@/shared/process/run-streaming-command';

import { resolveProjectPath } from './fs';
import { resolveHyperframesCommand } from './hyperframes-command';

export interface HyperframesRenderInput {
  projectId: string;
  compositionDir: string;
  output?: string;
  onProgress?: (line: string) => void;
}

export async function renderHyperframesComposition({
  projectId,
  compositionDir,
  output,
  onProgress,
}: HyperframesRenderInput): Promise<{
  path: string;
  size: number;
}> {
  const composition = resolveProjectPath(projectId, compositionDir);
  const indexPath = path.join(composition.absolutePath, 'index.html');
  const indexStat = await fs.stat(indexPath).catch(() => null);
  if (!indexStat?.isFile()) {
    throw new Error(
      `HyperFrames composition requires index.html in ${composition.relativePath}.`,
    );
  }

  const outputPath = resolveProjectPath(
    projectId,
    normalizeHyperframesOutput(output),
  );
  await fs.mkdir(path.dirname(outputPath.absolutePath), { recursive: true });

  const bin = resolveHyperframesCommand();
  const args = hyperframesRenderArgs(
    composition.absolutePath,
    outputPath.absolutePath,
  );
  onProgress?.(`HyperFrames renderer: ${bin} ${args.join(' ')}`);

  await runStreamingCommand({
    bin,
    args,
    cwd: composition.absolutePath,
    timeoutMs: Number(process.env.NEUMA_HYPERFRAMES_TIMEOUT_MS ?? 600_000),
    onLine: onProgress,
  });

  const stat = await fs.stat(outputPath.absolutePath).catch(() => null);
  if (!stat?.isFile() || stat.size === 0) {
    throw new Error(
      `HyperFrames renderer finished without writing ${outputPath.relativePath}.`,
    );
  }
  return {
    path: outputPath.relativePath,
    size: stat.size,
  };
}

function normalizeHyperframesOutput(output?: string) {
  const requested = output?.trim() || 'hyperframes-video.mp4';
  const withExt = path.extname(requested) ? requested : `${requested}.mp4`;
  if (withExt.includes('/') || withExt.includes('\\')) return withExt;
  return `assets/generated/${withExt.replace(/[^a-zA-Z0-9._-]/g, '-')}`;
}

function hyperframesRenderArgs(compositionDir: string, outputPath: string) {
  const raw = process.env.NEUMA_HYPERFRAMES_RENDER_ARGS_JSON;
  const template = raw ? parseArgsJson(raw) : defaultHyperframesArgs();
  return template.map((value) =>
    value
      .replaceAll('{compositionDir}', compositionDir)
      .replaceAll('{output}', outputPath),
  );
}

function defaultHyperframesArgs() {
  return ['render', '{compositionDir}', '--output', '{output}'];
}

function parseArgsJson(raw: string) {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      Array.isArray(parsed) &&
      parsed.every((value) => typeof value === 'string')
    ) {
      return parsed;
    }
  } catch {
    // Fall through to a focused error below.
  }
  throw new Error(
    'NEUMA_HYPERFRAMES_RENDER_ARGS_JSON must be a JSON string array.',
  );
}
