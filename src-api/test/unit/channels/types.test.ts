import { describe, expect, it } from 'vitest';

import { DiscordPlugin } from '@/shared/channels/discord';
import { LarkPlugin } from '@/shared/channels/lark';
import { SlackPlugin } from '@/shared/channels/slack';
import { TelegramPlugin } from '@/shared/channels/telegram';
import type { ChannelCapabilities } from '@/shared/channels/types';

const REQUIRED_BOOLEAN_KEYS = [
  'supportsEditMessage',
  'supportsThreads',
  'supportsButtons',
  'supportsSelects',
  'supportsModals',
  'supportsDatePicker',
  'supportsReactions',
  'supportsTyping',
  'supportsUnfurlControl',
  'supportsFileUpload',
] as const;

const REQUIRED_NUMBER_KEYS = [
  'maxMessageLength',
  'maxAttachmentBytes',
  'maxAttachmentsPerMessage',
] as const;

function expectCapabilitiesShape(capabilities: ChannelCapabilities): void {
  for (const key of REQUIRED_BOOLEAN_KEYS) {
    expect(typeof capabilities[key], key).toBe('boolean');
  }
  for (const key of REQUIRED_NUMBER_KEYS) {
    expect(Number.isFinite(capabilities[key]), key).toBe(true);
    expect(capabilities[key], key).toBeGreaterThan(0);
  }
  expect(['none', 'basic', 'full']).toContain(capabilities.supportsMarkdown);
  expect(['official', 'bridge', 'experimental']).toContain(
    capabilities.runtimeClass,
  );
}

describe('channel capabilities', () => {
  it('declares the full capability matrix for every active plugin', () => {
    const plugins = [
      new SlackPlugin(),
      new DiscordPlugin(),
      new TelegramPlugin(),
      new LarkPlugin(),
    ];

    for (const plugin of plugins) {
      expectCapabilitiesShape(plugin.capabilities);
    }
  });

  it('keeps pre-parity providers honest until their phases land', () => {
    expect(new DiscordPlugin().capabilities.supportsButtons).toBe(true);
    expect(new TelegramPlugin().capabilities.supportsButtons).toBe(true);
    expect(new LarkPlugin().capabilities.supportsReactions).toBe(true);
  });
});
