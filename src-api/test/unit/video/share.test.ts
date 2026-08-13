import { describe, expect, it, vi } from 'vitest';

import {
  shareVideoProject,
  VIDEO_EXPORT_PRESETS,
  type VideoShareInput,
} from '@/shared/video/share';
import type { VideoProject } from '@/shared/video/types';

describe('video share workflow', () => {
  it('returns a ready result for direct MP4 download', async () => {
    const result = await shareVideoProject(
      'project-1',
      { destination: 'download-mp4', aspectRatio: '9:16' },
      deps({}),
    );

    expect(result).toMatchObject({
      destination: 'download-mp4',
      status: 'ready',
      aspectRatio: '9:16',
      outputPath: 'renders/portrait.mp4',
      fileName: 'portrait.mp4',
      fileSize: 42_000,
      mime: 'video/mp4',
    });
  });

  it('sends channel shares through the running channel plugin', async () => {
    const sendMessage = vi.fn(async () => ({ messageId: '1700000000.1' }));
    const sendFiles = vi.fn(async () => undefined);

    const result = await shareVideoProject(
      'project-1',
      {
        destination: 'slack',
        aspectRatio: '16:9',
        channelConfigId: 'slack-config',
        conversationId: 'C123',
        message: 'Launch cut',
      },
      deps({
        plugin: {
          platform: 'slack',
          state: 'running',
          capabilities: { supportsFileUpload: true },
          sendMessage,
          sendFiles,
        },
      }),
    );

    expect(sendMessage).toHaveBeenCalledWith('C123', {
      text: 'Launch cut',
      unfurl: false,
    });
    expect(sendFiles).toHaveBeenCalledWith('C123:1700000000.1', [
      '/work/renders/wide.mp4',
    ]);
    expect(result.channel).toEqual({
      configId: 'slack-config',
      platform: 'slack',
      conversationId: 'C123',
      messageId: '1700000000.1',
    });
  });

  it('rejects channel platform mismatches', async () => {
    await expect(
      shareVideoProject(
        'project-1',
        channelInput({
          destination: 'discord',
          channelConfigId: 'slack-config',
        }),
        deps({
          plugin: {
            platform: 'slack',
            state: 'running',
            capabilities: { supportsFileUpload: true },
            sendMessage: vi.fn(),
            sendFiles: vi.fn(),
          },
        }),
      ),
    ).rejects.toThrow('channel platform does not match');
  });

  it('rejects missing requested aspect ratios instead of falling back', async () => {
    await expect(
      shareVideoProject(
        'project-1',
        { destination: 'download-mp4', aspectRatio: '1:1' },
        deps({}),
      ),
    ).rejects.toThrow('render output not found for 1:1');
  });

  it('keeps destination presets explicit for first-share targets', () => {
    expect(VIDEO_EXPORT_PRESETS.youtube.videoCodec).toBe('h264-main');
    expect(VIDEO_EXPORT_PRESETS.tiktok.aspect).toBe('9:16');
    expect(VIDEO_EXPORT_PRESETS.slack.videoCodec).toBe('h264-baseline');
  });
});

function deps(input: { plugin?: unknown }) {
  return {
    getProject: async () => projectFixture(),
    getVideoWorkspaceRoot: () => '/work',
    getChannelManager: () => ({
      getPlugin: () => input.plugin as never,
    }),
    stat: (async () => ({
      size: 42_000,
      isFile: () => true,
    })) as never,
  };
}

function channelInput(input: Partial<VideoShareInput> = {}): VideoShareInput {
  return {
    destination: 'slack',
    aspectRatio: '16:9',
    channelConfigId: 'slack-config',
    conversationId: 'C123',
    ...input,
  };
}

function projectFixture(): VideoProject {
  const now = new Date().toISOString();
  return {
    id: 'project-1',
    name: 'Launch video',
    template: 'slideshow',
    prompt: '',
    assets: [],
    outputs: [
      {
        aspectRatio: '16:9',
        path: 'renders/wide.mp4',
        durationSec: 12,
        fileSize: 42_000,
        codec: 'h264',
      },
      {
        aspectRatio: '9:16',
        path: 'renders/portrait.mp4',
        durationSec: 12,
        fileSize: 42_000,
        codec: 'h264',
      },
    ],
    createdAt: now,
    updatedAt: now,
  };
}
