import { describe, expect, it } from 'vitest';

import { capabilityProfileFor } from '@/shared/channels/_shared/presentation/capability-profile';
import { renderPresentationForChannel } from '@/shared/channels/_shared/presentation/render';
import type { ChannelCapabilities } from '@/shared/channels/types';

const baseCapabilities: ChannelCapabilities = {
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
  maxMessageLength: 4000,
  maxAttachmentBytes: 10_000,
  maxAttachmentsPerMessage: 10,
  supportsMarkdown: 'full',
  runtimeClass: 'official',
};

describe('channel presentation rendering', () => {
  it('maps channel capabilities into a presentation profile', () => {
    expect(capabilityProfileFor('slack', baseCapabilities)).toMatchObject({
      platform: 'slack',
      supportsButtons: true,
      supportsForms: true,
      supportsDatePicker: true,
      supportsFileAttachment: true,
    });
  });

  it('keeps supported interactive blocks native', () => {
    const rendered = renderPresentationForChannel({
      platform: 'slack',
      capabilities: baseCapabilities,
      response: {
        text: 'Pick\n\n```buttons\nShip|ship|primary\nCancel|cancel\n```',
      },
    });

    expect(rendered.text).toBe('Pick');
    expect(rendered.blocks).toHaveLength(1);
    expect(rendered.degradedBlocks).toHaveLength(0);
  });

  it('degrades unsupported controls into plain text', () => {
    const rendered = renderPresentationForChannel({
      platform: 'discord',
      capabilities: {
        ...baseCapabilities,
        supportsSelects: false,
        supportsModals: false,
        supportsDatePicker: false,
      },
      response: {
        text: 'Pick a date\n\n```datepicker\nDue date|2026-05-18\n```',
        buttons: [{ text: 'Later', data: 'later' }],
      },
    });

    expect(rendered.blocks).toHaveLength(0);
    expect(rendered.buttons).toEqual([{ text: 'Later', data: 'later' }]);
    expect(rendered.text).toContain('Due date');
    expect(rendered.text).not.toContain('```datepicker');
    expect(rendered.degradedReason).toBe('channel_capability');
  });
});
