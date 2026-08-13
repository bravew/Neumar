import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getAssetRegistry } from '@/shared/assets';
import { closeDatabase } from '@/shared/db';
import { setSetting } from '@/shared/db/operations';
import { mediaTools } from '@/shared/mcp/media-server';
import {
  createVideoTask,
  embedProvenance,
  generateImage,
  getVideoTaskStatus,
} from '@/shared/services/media-generation';

vi.mock('@/shared/services/media-generation', () => ({
  createVideoTask: vi.fn(),
  embedProvenance: vi.fn(),
  generateImage: vi.fn(),
  getVideoTaskStatus: vi.fn(),
  listCapabilities: vi.fn(() => []),
}));

const imageTool = mediaTools.find(
  (tool) => tool.name === 'media_generate_image',
);
const generateVideoTool = mediaTools.find(
  (tool) => tool.name === 'media_generate_video',
);
const checkVideoTool = mediaTools.find(
  (tool) => tool.name === 'media_check_video',
);

describe('media MCP generated asset cataloging', () => {
  let homeDir: string;
  let workDir: string;

  beforeEach(async () => {
    closeDatabase();
    homeDir = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), 'media-assets-home-')),
    );
    workDir = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), 'media-assets-work-')),
    );
    vi.stubEnv('HOME', homeDir);
    setSetting('workDir', workDir);
    setSetting('assets.catalog_enabled', 'true');
    vi.mocked(createVideoTask).mockReset();
    vi.mocked(embedProvenance).mockReset();
    vi.mocked(generateImage).mockReset();
    vi.mocked(getVideoTaskStatus).mockReset();
  });

  afterEach(async () => {
    closeDatabase();
    vi.unstubAllEnvs();
    await fs.rm(homeDir, { recursive: true, force: true });
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('catalogs generated image and video outputs with ai_gen provenance', async () => {
    expect(imageTool).toBeDefined();
    expect(generateVideoTool).toBeDefined();
    expect(checkVideoTool).toBeDefined();

    vi.mocked(generateImage).mockResolvedValueOnce({
      success: true,
      provider: 'OpenAI',
      model: 'gpt-image-1',
      seed: 12345,
      images: [
        {
          url: `data:image/png;base64,${Buffer.from('generated image bytes').toString('base64')}`,
          revisedPrompt: 'A refined catalog image prompt',
          size: '1024x1024',
        },
      ],
      provenance: {
        requestedProvider: 'BytePlus',
        requestedModel: 'seedream-5.0',
        fallbackReason: 'requested provider unavailable',
      },
    });

    const imageResult = await imageTool!.handler(
      {
        prompt: 'A catalog image prompt',
        provider: 'BytePlus',
        seed: 12345,
      },
      {},
    );
    expect(imageResult.isError).not.toBe(true);

    vi.mocked(createVideoTask).mockResolvedValueOnce({
      success: true,
      provider: 'BytePlus',
      model: 'seedance-2.0',
      taskId: 'video-task-1',
      seed: 67890,
      provenance: {
        requestedProvider: 'OpenAI',
        requestedModel: 'sora',
        fallbackReason: 'requested model not configured',
      },
    });

    const videoStartResult = await generateVideoTool!.handler(
      {
        prompt: 'A catalog video prompt with smooth camera motion',
        provider: 'OpenAI',
        seed: 67890,
        duration: 5,
        resolution: '720p',
      },
      {},
    );
    expect(videoStartResult.isError).not.toBe(true);

    const videoPath = path.join(workDir, 'output', 'generated-video.mp4');
    await fs.mkdir(path.dirname(videoPath), { recursive: true });
    await fs.writeFile(videoPath, 'generated video bytes');
    vi.mocked(getVideoTaskStatus).mockResolvedValueOnce({
      success: true,
      provider: 'BytePlus',
      taskId: 'video-task-1',
      status: 'succeeded',
      localPath: videoPath,
      model: 'seedance-2.0',
      seed: 67890,
      duration: 5,
      resolution: '720p',
      provenance: {
        requestedProvider: 'OpenAI',
        requestedModel: 'sora',
        fallbackReason: 'requested model not configured',
      },
    });

    const videoStatusResult = await checkVideoTool!.handler(
      { task_id: 'video-task-1' },
      {},
    );
    expect(videoStatusResult.isError).not.toBe(true);

    const assets = getAssetRegistry().list({
      sources: ['ai_gen'],
      limit: 10,
    }).items;

    const image = assets.find((asset) => asset.kind === 'image');
    const video = assets.find((asset) => asset.kind === 'video');
    expect(image).toMatchObject({
      source: 'ai_gen',
      description: 'A catalog image prompt',
      caption: 'A refined catalog image prompt',
      tags: ['ai-generated', 'image'],
    });
    expect(image?.provenance).toMatchObject({
      provider: 'OpenAI',
      model: 'gpt-image-1',
      requestedProvider: 'BytePlus',
      requestedModel: 'seedream-5.0',
      fallbackReason: 'requested provider unavailable',
      seed: 12345,
    });
    expect(video).toMatchObject({
      source: 'ai_gen',
      description: 'A catalog video prompt with smooth camera motion',
      tags: ['ai-generated', 'video'],
    });
    expect(video?.provenance).toMatchObject({
      provider: 'BytePlus',
      model: 'seedance-2.0',
      requestedProvider: 'OpenAI',
      requestedModel: 'sora',
      fallbackReason: 'requested model not configured',
      seed: 67890,
    });
    expect(embedProvenance).toHaveBeenCalledTimes(2);
  });
});
