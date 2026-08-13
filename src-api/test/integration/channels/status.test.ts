import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

const slackCapabilities = {
  supportsEditMessage: true,
  supportsThreads: true,
  supportsButtons: true,
  supportsSelects: true,
  supportsModals: true,
  supportsDatePicker: true,
  supportsReactions: true,
  supportsTyping: true,
  supportsUnfurlControl: true,
  supportsFileUpload: true,
  maxMessageLength: 3000,
  maxAttachmentBytes: 50 * 1024 * 1024,
  maxAttachmentsPerMessage: 10,
  supportsMarkdown: 'full',
  runtimeClass: 'official',
} as const;

vi.mock('@/shared/channels/channel-manager', () => ({
  getChannelManager: () => ({
    getStatus: () => ({
      'cfg-slack': {
        platform: 'slack',
        name: 'Workspace bot',
        state: 'running',
        capabilities: slackCapabilities,
        runtimeClass: 'official',
      },
    }),
  }),
}));

describe('GET /channels/status', () => {
  it('returns capability metadata for status consumers', async () => {
    const { channelRoutes } = await import('@/app/api/channels');
    const app = new Hono();
    app.route('/channels', channelRoutes);

    const response = await app.request('/channels/status');
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      status: Record<string, { capabilities?: unknown; runtimeClass?: string }>;
    };
    expect(body.status['cfg-slack']?.capabilities).toEqual(slackCapabilities);
    expect(body.status['cfg-slack']?.runtimeClass).toBe('official');
  });
});
