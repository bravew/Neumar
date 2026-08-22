import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type RemotionAdapterDeps,
  RemotionEngineError,
  createRemotionAdapter,
  neutralizeBlockingResources,
} from '@/shared/video/engines/remotion-adapter';

let workDir: string;

beforeEach(async () => {
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'remotion-adapter-'));
});

afterEach(async () => {
  vi.clearAllMocks();
  await fs.rm(workDir, { recursive: true, force: true });
});

describe('neutralizeBlockingResources', () => {
  it('makes external stylesheet links non-blocking but leaves local links alone', () => {
    const html = [
      '<link rel="stylesheet" href="https://fonts.example/css">',
      '<link rel="stylesheet" href="/local.css">',
      '<link rel="stylesheet" href="//cdn.example/theme.css" media="screen">',
    ].join('\n');

    expect(neutralizeBlockingResources(html)).toContain(
      'href="https://fonts.example/css" media="print" onload="this.media=\'all\'">',
    );
    expect(neutralizeBlockingResources(html)).toContain(
      '<link rel="stylesheet" href="/local.css">',
    );
    expect(neutralizeBlockingResources(html)).toContain(
      '<link rel="stylesheet" href="//cdn.example/theme.css" media="screen">',
    );
  });
});

describe('createRemotionAdapter', () => {
  it('renders bridge HTML through the bundled bridge composition', async () => {
    const sourcePath = path.join(workDir, 'frame.html');
    await fs.writeFile(
      sourcePath,
      '<!doctype html><html><head><link rel="stylesheet" href="https://fonts.example/css"></head><body>Hi</body></html>',
      'utf8',
    );
    const deps = fakeDeps();
    const adapter = createRemotionAdapter(deps);
    const outputPath = path.join(workDir, 'out.mp4');

    const result = await adapter.render(
      {
        template: {
          id: 'frame-a',
          engineId: 'remotion',
          sourcePath,
        },
        config: {
          format: 'mp4',
          resolution: { width: 640, height: 360 },
          fps: { num: 30, den: 1 },
          duration: 2,
          outputPath,
        },
      },
      { workDir },
    );

    expect(result.outputPath).toBe(outputPath);
    expect(deps.bundleProject).toHaveBeenCalledWith(
      expect.objectContaining({
        entryPoint: expect.stringMatching(/bridge-entry\.(ts|js)$/),
      }),
    );
    expect(deps.selectComposition).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'HtmlFrame',
        inputProps: expect.objectContaining({
          width: 640,
          height: 360,
          durationInFrames: 60,
          html: expect.stringContaining('media="print"'),
        }),
      }),
    );
    expect(deps.renderMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        codec: 'h264',
        outputLocation: expect.stringMatching(/frame-a-.*\.mp4$/),
      }),
    );
  });

  it('renders a native template entry with its composition id and variables', async () => {
    const entryPath = path.join(workDir, 'entry.ts');
    await fs.writeFile(entryPath, 'registerRoot(() => null);', 'utf8');
    const deps = fakeDeps();
    const adapter = createRemotionAdapter(deps);

    await adapter.render(
      {
        template: {
          id: 'frame-data-rollup',
          engineId: 'remotion',
          sourcePath: entryPath,
          mode: 'native',
          nativeCompositionId: 'DataRollup',
        },
        variables: {
          data: { items: [{ label: 'Mon', value: 10 }] },
        },
        config: {
          format: 'webm',
          resolution: { width: 1080, height: 1080 },
          fps: { num: 30, den: 1 },
          duration: 3,
          outputPath: path.join(workDir, 'native.webm'),
        },
      },
      { workDir },
    );

    expect(deps.bundleProject).toHaveBeenCalledWith(
      expect.objectContaining({ entryPoint: entryPath }),
    );
    expect(deps.selectComposition).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'DataRollup',
        inputProps: expect.objectContaining({
          data: { items: [{ label: 'Mon', value: 10 }] },
          width: 1080,
          height: 1080,
          durationInFrames: 90,
        }),
      }),
    );
    expect(deps.renderMedia).toHaveBeenCalledWith(
      expect.objectContaining({ codec: 'vp8' }),
    );
  });

  it('maps an aborted render to a typed cancellation error', async () => {
    const sourcePath = path.join(workDir, 'frame.html');
    await fs.writeFile(sourcePath, '<html><body>Hi</body></html>', 'utf8');
    const deps = fakeDeps({
      renderMedia: async () => {
        throw new Error('renderMedia() got cancelled');
      },
    });
    const adapter = createRemotionAdapter(deps);
    const controller = new AbortController();
    controller.abort();

    await expect(
      adapter.render(
        {
          template: { id: 'frame-a', engineId: 'remotion', sourcePath },
          config: {
            format: 'mp4',
            resolution: { width: 640, height: 360 },
            fps: { num: 30, den: 1 },
            duration: 2,
            outputPath: path.join(workDir, 'out.mp4'),
          },
        },
        { workDir, signal: controller.signal },
      ),
    ).rejects.toMatchObject({
      name: 'RemotionEngineError',
      code: 'cancelled',
    } satisfies Partial<RemotionEngineError>);
  });

  it('does not mask render failures when the abort signal is already set', async () => {
    const sourcePath = path.join(workDir, 'frame.html');
    await fs.writeFile(sourcePath, '<html><body>Hi</body></html>', 'utf8');
    const deps = fakeDeps({
      renderMedia: async () => {
        throw new Error('composition failed before capture');
      },
    });
    const adapter = createRemotionAdapter(deps);
    const controller = new AbortController();
    controller.abort();

    await expect(
      adapter.render(
        {
          template: { id: 'frame-a', engineId: 'remotion', sourcePath },
          config: {
            format: 'mp4',
            resolution: { width: 640, height: 360 },
            fps: { num: 30, den: 1 },
            duration: 2,
            outputPath: path.join(workDir, 'out.mp4'),
          },
        },
        { workDir, signal: controller.signal },
      ),
    ).rejects.toMatchObject({
      name: 'RemotionEngineError',
      code: 'render-failed',
      message: 'composition failed before capture',
    } satisfies Partial<RemotionEngineError>);
  });
});

function fakeDeps(
  overrides: Partial<RemotionAdapterDeps> = {},
): Required<RemotionAdapterDeps> {
  const bundleProject = vi.fn(async () => 'serve-url');
  const selectComposition = vi.fn(async () => ({
    id: 'HtmlFrame',
    width: 640,
    height: 360,
    fps: 30,
    durationInFrames: 60,
    defaultProps: {},
    props: {},
  }));
  const renderMedia = vi.fn(async (options) => {
    if (typeof options.outputLocation === 'string') {
      await fs.writeFile(options.outputLocation, 'mp4');
    }
    options.onProgress?.({
      progress: 1,
    } as Parameters<NonNullable<typeof options.onProgress>>[0]);
  });
  const makeCancelSignal = vi.fn(() => ({
    cancel: vi.fn(),
    cancelSignal: {},
  }));
  return {
    bundleProject,
    selectComposition,
    renderMedia,
    makeCancelSignal,
    ...overrides,
  } as Required<RemotionAdapterDeps>;
}
