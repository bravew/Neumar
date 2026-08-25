import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { StreamingCommandInput } from '@/shared/process/run-streaming-command';
import {
  buildHyperframesRenderArgs,
  createHyperframesAdapter,
  probeHyperframes,
} from '@/shared/video/engines/hyperframes-adapter';

let workDir: string;

beforeEach(async () => {
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hyperframes-adapter-'));
});

afterEach(async () => {
  await fs.rm(workDir, { recursive: true, force: true });
});

describe('HyperFrames adapter', () => {
  it('reports typed old-version and browser-missing probe failures', async () => {
    const old = await probeHyperframes('hyperframes', async () => ({
      stdout: '0.8.6\n',
      stderr: '',
    }));
    expect(old).toEqual({
      installed: false,
      reason: 'version-too-old',
      version: '0.8.6',
      requiredVersion: '0.8.7',
    });

    const responses = [
      { stdout: '0.8.7\n', stderr: '' },
      {
        stdout: JSON.stringify({
          checks: [{ name: 'Chrome', ok: false, detail: 'Not found' }],
          _meta: { version: '0.8.7' },
        }),
        stderr: '',
      },
    ];
    const missing = await probeHyperframes('hyperframes', async () =>
      responses.shift()!,
    );
    expect(missing).toMatchObject({
      installed: false,
      reason: 'browser-missing',
      version: '0.8.7',
    });
  });

  it('builds rational fps, UI capture, alpha, cache, and strict flags', () => {
    const args = buildHyperframesRenderArgs(
      {
        template: {
          id: 'ui-demo',
          engineId: 'hyperframes',
          sourcePath: path.join(workDir, 'composition', 'index.html'),
        },
        variables: { title: 'Demo' },
        config: {
          format: 'webm-alpha',
          resolution: { width: 1920, height: 1080 },
          fps: { num: 30_000, den: 1_001 },
          duration: 2,
          outputPath: path.join(workDir, 'out.webm'),
          contentKind: 'ui-capture',
          strictness: 'strict',
          vp9CpuUsed: 4,
        },
      },
      path.join(workDir, 'cache'),
    );
    expect(args).toEqual(
      expect.arrayContaining([
        '--format',
        'webm',
        '--fps',
        '30000/1001',
        '--video-frame-format',
        'png',
        '--no-best-effort',
        '--vp9-cpu-used',
        '4',
      ]),
    );
  });

  it('renders through the CLI with line progress and version diagnostics', async () => {
    const compositionDir = path.join(workDir, 'composition');
    const sourcePath = path.join(compositionDir, 'index.html');
    const outputPath = path.join(workDir, 'output.mp4');
    await fs.mkdir(compositionDir);
    await fs.writeFile(sourcePath, '<html></html>');
    const runCommand = vi.fn(async (input: StreamingCommandInput) => {
      if (input.args[0] === '--version') {
        return { stdout: '0.8.7\n', stderr: '' };
      }
      if (input.args[0] === 'doctor') {
        return {
          stdout: JSON.stringify({
            checks: [
              { name: 'Chrome', ok: true, detail: 'Chrome 140 at /chrome' },
            ],
            _meta: { version: '0.8.7' },
          }),
          stderr: '',
        };
      }
      input.onLine?.('frame 5/10', 'stdout');
      await fs.writeFile(outputPath, 'rendered');
      return { stdout: 'frame 10/10\n', stderr: '' };
    });
    const progress: number[] = [];
    const adapter = createHyperframesAdapter({
      command: 'hyperframes-test',
      runCommand,
    });
    const result = await adapter.render(
      {
        template: {
          id: 'demo',
          engineId: 'hyperframes',
          sourcePath,
        },
        config: {
          format: 'mp4',
          resolution: { width: 1920, height: 1080 },
          fps: { num: 30, den: 1 },
          duration: 1,
          outputPath,
        },
      },
      { workDir, onProgress: (pct) => progress.push(pct) },
    );
    expect(result.meta).toMatchObject({
      fps: 30,
      renderedFrames: 30,
      engineVersion: '0.8.7',
    });
    expect(result.diagnostics[0]?.data).toMatchObject({
      cliVersion: '0.8.7',
      browserVersion: 'Chrome 140 at /chrome',
    });
    expect(progress).toContain(50);
  });
});
