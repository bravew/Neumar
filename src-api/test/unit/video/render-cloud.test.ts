import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FalRenderProvider } from '@/shared/services/render/adapters/fal';
import {
  attachUploadedRenderAssets,
  createAssetManifestItem,
  listRenderProviderConfigs,
  renderWithCloudProvider,
  upsertRenderProviderConfig,
} from '@/shared/services/render/router';
import type {
  RenderAssetManifestItem,
  RenderGraph,
  RenderRequest,
} from '@/shared/services/render/types';

const dbMocks = vi.hoisted(() => {
  const settings = new Map<string, string>();
  return {
    settings,
    getSetting: vi.fn((key: string) => settings.get(key) ?? null),
    setSetting: vi.fn((key: string, value: string) => {
      settings.set(key, value);
    }),
  };
});

vi.mock('@/shared/db/operations', () => ({
  getSetting: dbMocks.getSetting,
  setSetting: dbMocks.setSetting,
}));

vi.mock('@/shared/services/usage-logger', () => ({
  logUsage: vi.fn(() => 'usage-1'),
}));

let workDir: string;

describe('cloud render router', () => {
  beforeEach(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-render-cloud-'));
    dbMocks.settings.clear();
    vi.stubEnv('NEUMA_VIDEO_CLOUD_RENDER_POLL_INTERVAL_MS', '0');
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('stores render provider config without exposing API keys', () => {
    const provider = upsertRenderProviderConfig({
      id: 'fal-mock',
      provider: 'fal',
      label: 'fal mock',
      enabled: true,
      baseUrl: 'mock://fal',
      endpointId: 'neumar/video-ffmpeg-renderer',
      apiKey: 'secret-key',
    });

    expect(provider.hasApiKey).toBe(true);
    expect('apiKey' in provider).toBe(false);
    expect(listRenderProviderConfigs()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'fal-mock', hasApiKey: true }),
      ]),
    );
  });

  it('uploads a typed render graph to a cloud provider and downloads output', async () => {
    upsertRenderProviderConfig({
      id: 'fal-mock',
      provider: 'fal',
      label: 'fal mock',
      enabled: true,
      baseUrl: 'mock://fal',
      endpointId: 'neumar/video-ffmpeg-renderer',
      apiKey: 'secret-key',
    });
    const inputPath = path.join(workDir, 'scene.mp4');
    const outputPath = path.join(workDir, 'out.mp4');
    await fs.writeFile(inputPath, Buffer.from('scene bytes'));
    const asset = await createAssetManifestItem({
      localAbsPath: inputPath,
      name: 'scene-1.mp4',
      role: 'scene',
      projectId: 'project-1',
      sourcePath: inputPath,
    });
    const graph: RenderGraph = {
      schema: 'neuma.video.render-graph.v1',
      scenes: [
        {
          id: 'scene-1',
          assetName: 'scene-1.mp4',
          durationSec: 3,
          kind: 'video',
          transitionToNext: 'cut',
        },
      ],
      aspectRatio: '16:9',
      mode: 'speed',
      totalDurationSec: 3,
      renderer: {
        image: 'ghcr.io/bravew/neumar-video-renderer',
        version: '2026-05-19',
      },
    };

    const statuses: string[] = [];
    const result = await renderWithCloudProvider({
      providerId: 'fal-mock',
      outputPath,
      request: {
        kind: 'ffmpeg',
        projectId: 'project-1',
        graph,
        assets: [asset],
        outputName: 'out.mp4',
      },
      onStatus: async (status) => {
        statuses.push(status.status);
      },
    });

    expect(result.status).toBe('succeeded');
    expect(await fs.readFile(outputPath, 'utf8')).toBe('mock fal cloud render');
    expect(statuses).toContain('queued');
    expect(statuses).toContain('running');
  });

  it('accepts Remotion cloud render requests and records render-second usage', async () => {
    upsertRenderProviderConfig({
      id: 'fal-mock',
      provider: 'fal',
      label: 'fal mock',
      enabled: true,
      baseUrl: 'mock://fal',
      endpointId: 'neuma/video-remotion-renderer',
      apiKey: 'secret-key',
      defaultCostCentsPerRenderSec: 2,
    });
    const inputPath = path.join(workDir, 'scene.mp4');
    const outputPath = path.join(workDir, 'out.mp4');
    await fs.writeFile(inputPath, Buffer.from('scene bytes'));
    const asset = await createAssetManifestItem({
      localAbsPath: inputPath,
      name: 'scene-1.mp4',
      role: 'scene',
      projectId: 'project-1',
      sourcePath: inputPath,
    });
    const graph = renderGraphFixture();

    const result = await renderWithCloudProvider({
      providerId: 'fal-mock',
      outputPath,
      request: {
        kind: 'remotion',
        projectId: 'project-1',
        graph,
        assets: [asset],
        outputName: 'out.mp4',
        bundle: {
          compositionId: 'NeumaVideoRender',
          bundleUrl: 'https://renderer.example/remotion/bundle',
          inputProps: {
            schema: 'neuma.video.remotion-input.v1',
            projectId: 'project-1',
            aspectRatio: '16:9',
            compositionWidth: 1280,
            compositionHeight: 720,
            durationInFrames: 90,
            fps: 30,
            visualClips: [
              {
                id: 'scene-1',
                sourcePath: inputPath,
                src: `file://${inputPath}`,
              },
            ],
            audioClips: [],
            captions: [],
          },
        },
      },
    });

    expect(result.status).toBe('succeeded');
    expect(result.unitType).toBe('render-second');
    expect(result.unitCount).toBe(3);
    expect(result.totalCostUsd).toBe(0.06);
    expect(await fs.readFile(outputPath, 'utf8')).toBe('mock fal cloud render');
  });

  it('rewrites Remotion file URLs to uploaded remote URLs before queueing', () => {
    const sourcePath = path.join(workDir, 'scene.mp4');
    const audioPath = path.join(workDir, 'narration.wav');
    const request: RenderRequest = {
      kind: 'remotion',
      projectId: 'project-1',
      graph: renderGraphFixture(),
      assets: [],
      outputName: 'out.mp4',
      bundle: {
        compositionId: 'NeumaVideoRender',
        inputProps: {
          visualClips: [
            {
              id: 'scene-1',
              sourcePath,
              src: `file://${sourcePath}`,
            },
          ],
          audioClips: [
            {
              id: 'narration-1',
              sourcePath: audioPath,
              src: `file://${audioPath}`,
            },
          ],
        },
      },
    };

    const updated = attachUploadedRenderAssets(request, [
      uploadedAsset('scene-1.mp4', sourcePath, 'https://cdn.example/scene.mp4'),
      uploadedAsset(
        'narration.wav',
        audioPath,
        'https://cdn.example/narration.wav',
      ),
    ]);

    expect(updated.kind).toBe('remotion');
    if (updated.kind !== 'remotion') throw new Error('expected remotion');
    expect(updated.bundle.inputProps.visualClips).toEqual([
      expect.objectContaining({ src: 'https://cdn.example/scene.mp4' }),
    ]);
    expect(updated.bundle.inputProps.audioClips).toEqual([
      expect.objectContaining({ src: 'https://cdn.example/narration.wav' }),
    ]);
  });

  it('passes abort signals to fal.ai queue requests', async () => {
    const inputPath = path.join(workDir, 'scene.mp4');
    await fs.writeFile(inputPath, Buffer.from('scene bytes'));
    const asset = await createAssetManifestItem({
      localAbsPath: inputPath,
      name: 'scene-1.mp4',
      role: 'scene',
      projectId: 'project-1',
      sourcePath: inputPath,
    });
    const graph: RenderGraph = {
      schema: 'neuma.video.render-graph.v1',
      scenes: [
        {
          id: 'scene-1',
          assetName: 'scene-1.mp4',
          durationSec: 3,
          kind: 'video',
          transitionToNext: 'cut',
        },
      ],
      aspectRatio: '16:9',
      mode: 'speed',
      totalDurationSec: 3,
      renderer: {
        image: 'ghcr.io/bravew/neumar-video-renderer',
        version: '2026-05-19',
      },
    };
    const request: RenderRequest = {
      kind: 'ffmpeg',
      projectId: 'project-1',
      graph,
      assets: [asset],
      outputName: 'out.mp4',
    };
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      if (url === 'https://uploads.example/assets') {
        return jsonResponse({
          url: 'https://assets.example/scene-1.mp4',
          sha256: asset.sha256,
        });
      }
      if (url === 'https://queue.fal.run/neumar/video-ffmpeg-renderer') {
        return jsonResponse({ request_id: 'req-1', status: 'IN_QUEUE' });
      }
      if (
        url ===
        'https://queue.fal.run/neumar/video-ffmpeg-renderer/requests/req-1/status'
      ) {
        return jsonResponse({ status: 'COMPLETED' });
      }
      if (
        url ===
        'https://queue.fal.run/neumar/video-ffmpeg-renderer/requests/req-1'
      ) {
        return jsonResponse({
          video: {
            url: 'https://results.example/out.mp4',
            sha256: 'remote-output-hash',
          },
        });
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new FalRenderProvider({
      id: 'fal',
      provider: 'fal',
      label: 'fal.ai',
      enabled: true,
      baseUrl: 'https://queue.fal.run',
      endpointId: 'neumar/video-ffmpeg-renderer',
      apiKey: 'secret-key',
      settings: { assetUploadUrl: 'https://uploads.example/assets' },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const signal = new AbortController().signal;

    await provider.uploadAsset(inputPath, asset, signal);
    const created = await provider.createRenderTask(request, signal);
    const status = await provider.getRenderTaskStatus(created.taskId, signal);

    expect(status).toEqual(
      expect.objectContaining({
        taskId: 'req-1',
        status: 'succeeded',
        resultUrl: 'https://results.example/out.mp4',
      }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('queues Remotion requests through fal.ai with duration estimates', async () => {
    const graph = renderGraphFixture();
    const request: RenderRequest = {
      kind: 'remotion',
      projectId: 'project-1',
      graph,
      assets: [],
      outputName: 'out.mp4',
      bundle: {
        compositionId: 'NeumaVideoRender',
        bundleUrl: 'https://renderer.example/remotion/bundle',
        inputProps: { schema: 'neuma.video.remotion-input.v1' },
      },
    };
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.input).toMatchObject({
        kind: 'remotion',
        projectId: 'project-1',
        bundle: {
          compositionId: 'NeumaVideoRender',
          bundleUrl: 'https://renderer.example/remotion/bundle',
        },
      });
      return jsonResponse({ request_id: 'req-remotion', status: 'IN_QUEUE' });
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new FalRenderProvider({
      id: 'fal',
      provider: 'fal',
      label: 'fal.ai',
      enabled: true,
      baseUrl: 'https://queue.fal.run',
      endpointId: 'neuma/video-remotion-renderer',
      apiKey: 'secret-key',
      defaultCostCentsPerRenderSec: 2,
      settings: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const created = await provider.createRenderTask(request);

    expect(created).toEqual(
      expect.objectContaining({
        taskId: 'req-remotion',
        estimatedCostUsd: 0.06,
        estimatedTimeSec: 3,
      }),
    );
  });
});

function renderGraphFixture(): RenderGraph {
  return {
    schema: 'neuma.video.render-graph.v1',
    scenes: [
      {
        id: 'scene-1',
        assetName: 'scene-1.mp4',
        durationSec: 3,
        kind: 'video',
        transitionToNext: 'cut',
      },
    ],
    aspectRatio: '16:9',
    mode: 'speed',
    totalDurationSec: 3,
    renderer: {
      image: 'ghcr.io/bravew/neumar-video-renderer',
      version: '2026-05-19',
    },
  };
}

function uploadedAsset(
  name: string,
  sourcePath: string,
  remoteUrl: string,
): RenderAssetManifestItem {
  return {
    name,
    localAbsPath: sourcePath,
    byteCount: 1,
    sha256: 'sha256',
    remoteUrl,
    provenance: {
      role: 'scene',
      projectId: 'project-1',
      sourcePath,
    },
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
  });
}
