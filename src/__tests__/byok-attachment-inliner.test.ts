import { describe, expect, it } from 'vitest';

import { appendInlineAttachmentContext } from '@/shared/lib/byok-attachment-inliner';

describe('appendInlineAttachmentContext', () => {
  it('inlines small text data-url file attachments', async () => {
    const prompt = await appendInlineAttachmentContext('Summarize this', [
      {
        id: 'att_1',
        type: 'file',
        name: 'notes.md',
        mimeType: 'text/markdown',
        data: `data:text/markdown;base64,${btoa('# Notes\\nShip the design mode polish.')}`,
      },
    ]);

    expect(prompt).toContain('ATTACHED TEXT CONTEXT');
    expect(prompt).toContain('### notes.md');
    expect(prompt).toContain('Ship the design mode polish.');
    expect(prompt).toContain('Summarize this');
  });

  it('skips binary file attachments', async () => {
    const prompt = await appendInlineAttachmentContext('Use the file path', [
      {
        id: 'att_2',
        type: 'file',
        name: 'clip.mov',
        mimeType: 'video/quicktime',
        data: 'data:video/quicktime;base64,AAAA',
      },
    ]);

    expect(prompt).toBe('Use the file path');
  });
});
