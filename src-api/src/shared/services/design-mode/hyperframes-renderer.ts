import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

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

  await runRendererProcess({
    bin,
    args,
    cwd: composition.absolutePath,
    onProgress,
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

function runRendererProcess({
  bin,
  args,
  cwd,
  onProgress,
}: {
  bin: string;
  args: string[];
  cwd: string;
  onProgress?: (line: string) => void;
}) {
  const timeoutMs = Number(process.env.NEUMA_HYPERFRAMES_TIMEOUT_MS ?? 600_000);
  return new Promise<void>((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      reject(new Error(`HyperFrames renderer timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve();
    };
    child.on('error', (error) => {
      finish(
        new Error(
          `HyperFrames renderer could not start: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ),
      );
    });
    child.on('close', (code, signal) => {
      if (code === 0) {
        finish();
        return;
      }
      finish(
        new Error(
          `HyperFrames renderer exited with ${
            signal ? `signal ${signal}` : `code ${code ?? 'unknown'}`
          }.`,
        ),
      );
    });
    streamProgress(child.stdout, onProgress);
    streamProgress(child.stderr, onProgress);
  });
}

function streamProgress(
  stream: NodeJS.ReadableStream | null,
  onProgress?: (line: string) => void,
) {
  if (!stream || !onProgress) return;
  let buffered = '';
  stream.setEncoding('utf-8');
  stream.on('data', (chunk) => {
    buffered += String(chunk);
    const lines = buffered.split(/\r?\n/);
    buffered = lines.pop() ?? '';
    lines
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach(onProgress);
  });
  stream.on('end', () => {
    const line = buffered.trim();
    if (line) onProgress(line);
  });
}
