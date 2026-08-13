import fs from 'node:fs/promises';
import path from 'node:path';

import { getChannelManager } from '@/shared/channels/channel-manager';
import { validatePath } from '@/shared/services/ffmpeg';

import { getProject, getVideoWorkspaceRoot } from './store';
import type {
  AspectRatio,
  VideoExportDestination,
  VideoExportPreset,
  VideoProject,
  VideoShareResult,
} from './types';

type ChannelShareDestination = Extract<
  VideoExportDestination,
  'slack' | 'discord' | 'telegram' | 'lark'
>;

interface SharePlugin {
  platform: string;
  state: string;
  capabilities: { supportsFileUpload: boolean };
  sendMessage(
    conversationId: string,
    response: { text: string; unfurl?: boolean },
  ): Promise<{ messageId: string | null }>;
  sendFiles?: (conversationId: string, filePaths: string[]) => Promise<void>;
}

interface ShareChannelManager {
  getPlugin(configId: string): SharePlugin | undefined;
}

export interface VideoShareInput {
  destination: VideoExportDestination;
  aspectRatio?: AspectRatio;
  channelConfigId?: string;
  conversationId?: string;
  message?: string;
}

interface VideoShareDeps {
  getProject?: typeof getProject;
  getVideoWorkspaceRoot?: typeof getVideoWorkspaceRoot;
  getChannelManager?: () => ShareChannelManager;
  stat?: typeof fs.stat;
}

export const VIDEO_EXPORT_PRESETS: Record<
  VideoExportDestination,
  VideoExportPreset
> = {
  'download-mp4': {
    id: 'download-mp4',
    aspect: '16:9',
    videoCodec: 'h264-main',
    audioCodec: 'aac-lc',
    videoBitrateKbps: 12_000,
    audioBitrateKbps: 192,
    container: 'mp4',
    faststart: true,
  },
  youtube: {
    id: 'youtube',
    aspect: '16:9',
    videoCodec: 'h264-main',
    audioCodec: 'aac-lc',
    videoBitrateKbps: 12_000,
    audioBitrateKbps: 192,
    container: 'mp4',
    faststart: true,
  },
  tiktok: {
    id: 'tiktok',
    aspect: '9:16',
    videoCodec: 'h264-high',
    audioCodec: 'aac-lc',
    videoBitrateKbps: 9_000,
    audioBitrateKbps: 192,
    container: 'mp4',
    faststart: true,
    maxDurationMs: 30 * 60 * 1000,
  },
  slack: {
    id: 'slack',
    aspect: '16:9',
    videoCodec: 'h264-baseline',
    audioCodec: 'aac-lc',
    videoBitrateKbps: 8_000,
    audioBitrateKbps: 128,
    container: 'mp4',
    faststart: true,
  },
  discord: {
    id: 'discord',
    aspect: '16:9',
    videoCodec: 'h264-main',
    audioCodec: 'aac-lc',
    videoBitrateKbps: 8_000,
    audioBitrateKbps: 128,
    container: 'mp4',
    faststart: true,
  },
  telegram: {
    id: 'telegram',
    aspect: '16:9',
    videoCodec: 'h264-main',
    audioCodec: 'aac-lc',
    videoBitrateKbps: 6_000,
    audioBitrateKbps: 128,
    container: 'mp4',
    faststart: true,
  },
  lark: {
    id: 'lark',
    aspect: '16:9',
    videoCodec: 'h264-main',
    audioCodec: 'aac-lc',
    videoBitrateKbps: 8_000,
    audioBitrateKbps: 128,
    container: 'mp4',
    faststart: true,
  },
};

export async function shareVideoProject(
  projectId: string,
  input: VideoShareInput,
  deps: VideoShareDeps = {},
): Promise<VideoShareResult> {
  const loadProject = deps.getProject ?? getProject;
  const getRoot = deps.getVideoWorkspaceRoot ?? getVideoWorkspaceRoot;
  const statFile = deps.stat ?? fs.stat;
  const project = await loadProject(projectId);
  const root = getRoot();
  const output = resolveShareOutput(project, input.aspectRatio);
  const outputPath = validatePath(output.path, root, 'read');
  const stats = await statFile(outputPath);
  if (!stats.isFile()) throw new Error('share output is not a file');

  const base: VideoShareResult = {
    destination: input.destination,
    status: input.destination === 'download-mp4' ? 'ready' : 'sent',
    aspectRatio: output.aspectRatio,
    outputPath: path.relative(root, outputPath),
    fileName: path.basename(outputPath),
    fileSize: stats.size,
    mime: mimeForPath(outputPath),
  };

  if (input.destination === 'download-mp4') return base;
  if (!isChannelDestination(input.destination)) {
    throw new Error(`${input.destination} share is not available yet`);
  }

  const channelConfigId = input.channelConfigId?.trim();
  const conversationId = input.conversationId?.trim();
  if (!channelConfigId) throw new Error('channelConfigId is required');
  if (!conversationId) throw new Error('conversationId is required');

  const manager = (deps.getChannelManager ?? getChannelManager)();
  const plugin = manager.getPlugin(channelConfigId);
  if (!plugin) throw new Error('channel plugin not found');
  if (plugin.platform !== input.destination) {
    throw new Error('channel platform does not match share destination');
  }
  if (plugin.state !== 'running')
    throw new Error('channel plugin is not running');
  if (!plugin.capabilities.supportsFileUpload || !plugin.sendFiles) {
    throw new Error('channel does not support file upload');
  }

  const sent = await plugin.sendMessage(conversationId, {
    text: shareMessage(project, output.aspectRatio, input.message),
    unfurl: false,
  });
  await plugin.sendFiles(
    fileConversationId(input.destination, conversationId, sent.messageId),
    [outputPath],
  );

  return {
    ...base,
    channel: {
      configId: channelConfigId,
      platform: input.destination,
      conversationId,
      messageId: sent.messageId,
    },
  };
}

function resolveShareOutput(
  project: VideoProject,
  aspectRatio?: AspectRatio,
): NonNullable<VideoProject['outputs']>[number] {
  if (aspectRatio) {
    const output = project.outputs?.find(
      (candidate) => candidate.aspectRatio === aspectRatio,
    );
    if (!output) throw new Error(`render output not found for ${aspectRatio}`);
    return output;
  }
  const output = project.outputs?.[0];
  if (!output) throw new Error('render output not found');
  return output;
}

function isChannelDestination(
  destination: VideoExportDestination,
): destination is ChannelShareDestination {
  return (
    destination === 'slack' ||
    destination === 'discord' ||
    destination === 'telegram' ||
    destination === 'lark'
  );
}

function shareMessage(
  project: VideoProject,
  aspectRatio: AspectRatio,
  message?: string,
): string {
  const trimmed = message?.trim();
  if (trimmed) return trimmed;
  return `${project.name} (${aspectRatio})`;
}

function fileConversationId(
  destination: ChannelShareDestination,
  conversationId: string,
  messageId: string | null,
): string {
  if (destination !== 'slack' || !messageId || conversationId.includes(':')) {
    return conversationId;
  }
  return `${conversationId}:${messageId}`;
}

function mimeForPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.mov') return 'video/quicktime';
  return 'video/mp4';
}
