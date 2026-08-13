import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { bundle } from '@remotion/bundler';
import {
  renderMedia,
  renderStill,
  selectComposition,
} from '@remotion/renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  renderProjectWithRemotion,
  renderTimelineFramesWithRemotion,
} from '@/shared/video/remotion-renderer';
import type { MediaItem, VideoProject } from '@/shared/video/types';

vi.mock('@remotion/bundler', () => ({
  bundle: vi.fn(
    async ({ onProgress }: { onProgress?: (value: number) => void }) => {
      onProgress?.(0.5);
      return 'serve-url';
    },
  ),
}));

vi.mock('@remotion/renderer', () => ({
  isUserCancelledRender: vi.fn(() => false),
  makeCancelSignal: vi.fn(() => ({
    cancel: vi.fn(),
    cancelSignal: vi.fn(),
  })),
  renderMedia: vi.fn(
    async ({
      inputProps,
      onProgress,
    }: {
      inputProps?: { visualClips?: Array<{ src?: string }> };
      onProgress?: (value: { progress: number }) => void;
    }) => {
      const src = inputProps?.visualClips?.[0]?.src;
      if (src?.startsWith('http://127.0.0.1:')) {
        const response = await fetch(src, { headers: { Range: 'bytes=0-3' } });
        if (response.status !== 206) {
          throw new Error(
            `Expected media range response, got ${response.status}`,
          );
        }
        const body = await response.text();
        if (body !== 'asse') {
          throw new Error(`Unexpected media range body: ${body}`);
        }
      }
      onProgress?.({ progress: 1 });
    },
  ),
  renderStill: vi.fn(async ({ output }: { output?: string | null }) => {
    if (output) await fs.writeFile(output, 'still-frame');
    return { buffer: null, contentType: 'image/png' };
  }),
  selectComposition: vi.fn(async () => ({
    id: 'NeumaVideoRender',
    width: 1280,
    height: 720,
    fps: 24,
    durationInFrames: 72,
    defaultProps: {},
    props: {},
  })),
}));

let workDir: string;

describe('remotion renderer service', () => {
  beforeEach(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-renderer-'));
    vi.stubEnv('NEUMA_VIDEO_WORKDIR', workDir);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('bundles the Remotion entry and renders with EDL-derived input props', async () => {
    const project = projectFixture();
    await createAssetFiles(project);
    const progress: number[] = [];
    const outputPath = path.join(workDir, 'videos/project-1/out.mp4');
    await fs.mkdir(path.dirname(outputPath), { recursive: true });

    const input = await renderProjectWithRemotion({
      project,
      outputPath,
      aspectRatio: '16:9',
      mode: 'speed',
      includeCaptions: false,
      root: workDir,
      onProgress: (value) => progress.push(value),
    });

    expect(input.captions).toEqual([]);
    expect(bundle).toHaveBeenCalledWith(
      expect.objectContaining({
        entryPoint: expect.stringMatching(/remotion-render-entry\.(ts|js)$/),
        enableCaching: true,
      }),
    );
    expect(input.visualClips[0]?.src).toMatch(/^file:\/\//);
    expect(selectComposition).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'NeumaVideoRender',
        inputProps: expect.objectContaining({
          projectId: 'project-1',
          visualClips: [
            expect.objectContaining({
              src: expect.stringMatching(
                /^http:\/\/127\.0\.0\.1:\d+\/[a-f0-9]{16}\/video\.mp4$/,
              ),
              sourceStartFrame: 24,
            }),
          ],
        }),
        serveUrl: 'serve-url',
      }),
    );
    expect(renderMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        codec: 'h264',
        crf: 23,
        inputProps: expect.objectContaining({ projectId: 'project-1' }),
        outputLocation: outputPath,
        serveUrl: 'serve-url',
        x264Preset: 'veryfast',
      }),
    );
    expect(progress).toEqual([8, 100]);
  });

  it('uses a content-addressed Remotion bundle dir and prunes older bundle caches', async () => {
    const project = projectFixture();
    await createAssetFiles(project);
    const bundleRoot = path.join(
      workDir,
      '.cache',
      'videos',
      project.id,
      'remotion-bundle',
    );
    const staleFingerprints = [
      '1111111111111111',
      '2222222222222222',
      '3333333333333333',
    ];
    await Promise.all(
      staleFingerprints.map(async (fingerprint, index) => {
        const dir = path.join(bundleRoot, fingerprint);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(path.join(dir, 'marker'), fingerprint);
        const timestamp = new Date(Date.UTC(2026, 0, index + 1));
        await fs.utimes(dir, timestamp, timestamp);
      }),
    );

    const outputPath = path.join(workDir, 'videos/project-1/out.mp4');
    await fs.mkdir(path.dirname(outputPath), { recursive: true });

    await renderProjectWithRemotion({
      project,
      outputPath,
      aspectRatio: '16:9',
      mode: 'speed',
      includeCaptions: false,
      root: workDir,
    });

    const bundleCall = vi.mocked(bundle).mock.calls.at(-1)?.[0];
    if (!bundleCall || typeof bundleCall.outDir !== 'string') {
      throw new Error('Expected Remotion bundle outDir');
    }
    const fingerprint = path.relative(bundleRoot, bundleCall.outDir);

    expect(fingerprint).toMatch(/^[a-f0-9]{16}$/);
    expect(await directoryExists(path.join(bundleRoot, fingerprint))).toBe(
      true,
    );
    expect(
      await directoryExists(path.join(bundleRoot, '1111111111111111')),
    ).toBe(false);
    expect(
      await directoryExists(path.join(bundleRoot, '2222222222222222')),
    ).toBe(true);
    expect(
      await directoryExists(path.join(bundleRoot, '3333333333333333')),
    ).toBe(true);
  });

  it('renders composited timeline stills and reuses frame cache', async () => {
    const project = projectFixture();
    await createAssetFiles(project);

    const first = await renderTimelineFramesWithRemotion({
      project,
      startMs: 0,
      endMs: 3000,
      frameCount: 2,
      aspectRatio: '16:9',
      maxEdgePx: 640,
      root: workDir,
    });
    const second = await renderTimelineFramesWithRemotion({
      project,
      startMs: 0,
      endMs: 3000,
      frameCount: 2,
      aspectRatio: '16:9',
      maxEdgePx: 640,
      root: workDir,
    });

    expect(first).toMatchObject({
      schema: 'neuma.video.timeline-frames.v1',
      projectId: 'project-1',
      maxEdgePx: 640,
      frames: [
        expect.objectContaining({
          imageBase64: Buffer.from('still-frame').toString('base64'),
          w: 640,
          h: 360,
          cacheHit: false,
        }),
        expect.objectContaining({
          imageBase64: Buffer.from('still-frame').toString('base64'),
          w: 640,
          h: 360,
          cacheHit: false,
        }),
      ],
    });
    expect(second.frames).toEqual(
      first.frames.map((frame) => ({ ...frame, cacheHit: true })),
    );
    expect(bundle).toHaveBeenCalledTimes(1);
    expect(renderStill).toHaveBeenCalledTimes(2);
    expect(selectComposition).toHaveBeenCalledWith(
      expect.objectContaining({
        inputProps: expect.objectContaining({
          compositionWidth: 640,
          compositionHeight: 360,
        }),
      }),
    );
  });
});

async function createAssetFiles(project: VideoProject): Promise<void> {
  await Promise.all(
    project.assets.map(async (asset) => {
      const filePath = path.join(workDir, asset.path);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, `${asset.id}\n`);
    }),
  );
}

async function directoryExists(dir: string): Promise<boolean> {
  const stats = await fs.stat(dir).catch(() => null);
  return Boolean(stats?.isDirectory());
}

function projectFixture(): VideoProject {
  return {
    id: 'project-1',
    name: 'Remotion render',
    template: 'explainer',
    prompt: '',
    assets: [asset('asset-video', 'video', 'assets/video.mp4', 6000)],
    storyboard: {
      status: 'approved',
      intent: 'Render',
      totalDurationMs: 3000,
      costEstimateUsd: { low: 0, high: 0 },
      scenes: [
        {
          id: 'scene-1',
          durationMs: 3000,
          intent: 'Opening',
          assetPlan: { kind: 'existing', assetId: 'asset-video' },
        },
      ],
    },
    timeline: {
      schema: 'neuma.video.timeline.v1',
      durationMs: 3000,
      fps: 24,
      tracks: [
        {
          id: 'track-video-main',
          kind: 'video',
          name: 'Video 1',
          muted: false,
          locked: false,
          hidden: false,
          order: 0,
          clips: [
            {
              id: 'clip-video-main',
              kind: 'video',
              sourceRef: { kind: 'asset', assetId: 'asset-video' },
              sceneId: 'scene-1',
              startMs: 0,
              durationMs: 3000,
              trimStartMs: 1000,
              trimEndMs: 4000,
              sourceDurationMs: 6000,
            },
          ],
        },
      ],
    },
    render: { status: 'idle', updatedAt: '2026-05-20T00:00:00.000Z' },
    budget: { capUsd: 5, spentUsd: 0 },
    outputs: [],
    createdAt: '2026-05-20T00:00:00.000Z',
    updatedAt: '2026-05-20T00:00:00.000Z',
  };
}

function asset(
  id: string,
  kind: MediaItem['kind'],
  filePath: string,
  durationMs: number,
): MediaItem {
  return {
    id,
    kind,
    source: 'user',
    path: `videos/project-1/${filePath}`,
    metadata: { durationMs },
  };
}
