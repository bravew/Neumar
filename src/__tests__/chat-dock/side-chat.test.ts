import { describe, expect, it } from 'vitest';

import {
  isSideChatPrompt,
  sideChatDraft,
} from '@/components/chat-dock/side-chat';

describe('sideChatDraft', () => {
  it.each(['library', 'artifact', 'automation'] as const)(
    'titles a %s side chat after the item and attaches it',
    (kind) => {
      const draft = sideChatDraft({ kind, name: 'report.pdf' });
      expect(draft.title).toBe('report.pdf');
      expect(draft.payload).toBe(`Looking at: ${kind} › report.pdf`);
      expect(isSideChatPrompt(draft.payload)).toBe(true);
    },
  );
});
