import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/shared/services/ffmpeg', async () => {
  const path = await import('node:path');
  return {
    probeFile: vi.fn(),
    runFFmpeg: vi.fn(),
    validateInputFile: vi.fn((filePath: string, root: string) =>
      path.isAbsolute(filePath) ? filePath : path.join(root, filePath),
    ),
    validatePath: vi.fn((filePath: string, root: string) =>
      path.isAbsolute(filePath) ? filePath : path.join(root, filePath),
    ),
  };
});

import { probeFile, runFFmpeg } from '@/shared/services/ffmpeg';
import {
  buildVideoProxyArgs,
  generateVideoProxyForAsset,
  proxyPathForAsset,
  shouldGenerateVideoProxy,
  VIDEO_PROXY_SIZE_THRESHOLD_BYTES,
} from '@/shared/video/proxy';
import {
  getProject,
  getVideoProjectDir,
  writeProject,
} from '@/shared/video/store';
import type { MediaItem, VideoProject } from '@/shared/video/types';

const mockedRunFFmpeg = vi.mocked(runFFmpeg);
const mockedProbeFile = vi.mocked(probeFile);

let workDir: string;

describe('video proxy generation', () => {
  beforeEach(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-proxy-'));
    vi.stubEnv('NEUMA_VIDEO_WORKDIR', workDir);
    mockedRunFFmpeg.mockResolvedValue({ exitCode: 0, stderr: '' });
    mockedProbeFile.mockResolvedValue({
      filePath: '',
      duration: 10,
      size: 1_000_000,
      bitRate: 1_800_000,
      formatName: 'mov,mp4',
      streams: [
        {
          index: 0,
          codecType: 'video',
          codecName: 'h264',
          width: 1280,
          height: 720,
        },
      ],
      videoStreamCount: 1,
      audioStreamCount: 0,
      subtitleStreamCount: 0,
      raw: {},
    });
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('detects videos that cross the proxy threshold', () => {
    expect(
      shouldGenerateVideoProxy(
        mediaAsset({ fileSize: VIDEO_PROXY_SIZE_THRESHOLD_BYTES + 1 }),
      ),
    ).toBe(true);
    expect(
      shouldGenerateVideoProxy(mediaAsset({ width: 3840, height: 2160 })),
    ).toBe(true);
    expect(
      shouldGenerateVideoProxy(mediaAsset({ width: 1920, height: 1080 })),
    ).toBe(false);
    expect(shouldGenerateVideoProxy(mediaAsset({ fileSize: 1024 }))).toBe(
      false,
    );
    expect(
      shouldGenerateVideoProxy({
        ...mediaAsset({ fileSize: VIDEO_PROXY_SIZE_THRESHOLD_BYTES + 1 }),
        kind: 'audio',
      }),
    ).toBe(false);
  });

  it('writes proxies into the project derivatives dir, with stable args', () => {
    // Never beside the master: it may be an external file we only read.
    expect(
      proxyPathForAsset('p1', mediaAsset({ path: '/Volumes/Card/source.mov' })),
    ).toMatch(/[/\\]p1[/\\]derivatives[/\\]asset-video[/\\]proxy\.mp4$/);
    expect(buildVideoProxyArgs('/in.mov', '/out.proxy.mp4')).toEqual([
      '-i',
      '/in.mov',
      '-map',
      '0:v:0',
      '-vf',
      'scale=-2:720',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '30',
      '-pix_fmt',
      'yuv420p',
      '-an',
      '-movflags',
      '+faststart',
      '/out.proxy.mp4',
    ]);
  });

  it('writes proxy metadata back to the latest project document', async () => {
    const asset = mediaAsset({
      fileSize: VIDEO_PROXY_SIZE_THRESHOLD_BYTES + 1,
      path: 'videos/project-1/assets/source.mov',
    });
    await fs.mkdir(path.dirname(path.join(workDir, asset.path)), {
      recursive: true,
    });
    await fs.writeFile(path.join(workDir, asset.path), 'source');
    await writeProject(projectFixture(asset));

    const result = await generateVideoProxyForAsset('project-1', asset.id);

    expect(result.generated).toBe(true);
    const proxyRelativePath =
      'videos/project-1/derivatives/asset-video/proxy.mp4';
    expect(mockedRunFFmpeg).toHaveBeenCalledWith(
      expect.arrayContaining([
        path.join(workDir, asset.path),
        path.join(workDir, proxyRelativePath),
      ]),
      { inputDuration: 10 },
    );
    const updated = await getProject('project-1');
    expect(updated.assets[0]?.proxy).toMatchObject({
      path: proxyRelativePath,
      widthPx: 1280,
      heightPx: 720,
      bitrateBps: 1_800_000,
    });
  });

  it('skips small videos unless forced', async () => {
    const asset = mediaAsset({
      fileSize: 1024,
      path: 'videos/project-1/assets/small.mp4',
    });
    await fs.mkdir(getVideoProjectDir('project-1'), { recursive: true });
    await writeProject(projectFixture(asset));

    const result = await generateVideoProxyForAsset('project-1', asset.id);

    expect(result).toMatchObject({
      generated: false,
      skippedReason: 'below-threshold',
    });
    expect(mockedRunFFmpeg).not.toHaveBeenCalled();
  });
});

function mediaAsset(
  metadata: Partial<MediaItem['metadata']> & { path?: string } = {},
): MediaItem {
  const { path: assetPath, ...mediaMetadata } = metadata;
  return {
    id: 'asset-video',
    kind: 'video',
    source: 'user',
    path: assetPath ?? 'videos/project-1/assets/source.mp4',
    metadata: {
      durationMs: 10_000,
      width: 640,
      height: 360,
      fileSize: 1024,
      ...mediaMetadata,
    },
  };
}

function projectFixture(asset: MediaItem): VideoProject {
  const now = '2026-05-25T00:00:00.000Z';
  return {
    id: 'project-1',
    name: 'Proxy project',
    template: 'custom',
    prompt: '',
    assets: [asset],
    sources: [],
    linkedSources: [],
    sourceAnalyses: [],
    cutPlans: [],
    scenes: [],
    render: { status: 'idle', updatedAt: now },
    budget: { capUsd: 5, spentUsd: 0 },
    outputs: [],
    createdAt: now,
    updatedAt: now,
  };
}
