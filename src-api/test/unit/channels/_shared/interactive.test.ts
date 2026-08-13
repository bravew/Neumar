import { describe, expect, it } from 'vitest';

import { parseInteractiveMarkdown } from '@/shared/channels/_shared/interactive';

describe('parseInteractiveMarkdown', () => {
  it('parses Slack-compatible fenced interactive blocks into logical blocks', () => {
    const parsed = parseInteractiveMarkdown(`
Choose:

\`\`\`buttons
Approve | approve | primary
Reject | reject | danger
Open docs | docs | url:https://example.com/docs
\`\`\`

\`\`\`select
Pick one
Alpha | a
Beta | b
\`\`\`

\`\`\`checkboxes
One | one | checked
Two | two
\`\`\`

\`\`\`datepicker
Due date | 2026-04-15
\`\`\`
`);

    expect(parsed.cleanText).toBe('Choose:');
    expect(parsed.blocks).toEqual([
      {
        kind: 'buttons',
        items: [
          { label: 'Approve', value: 'approve', style: 'primary' },
          { label: 'Reject', value: 'reject', style: 'danger' },
          {
            label: 'Open docs',
            value: 'docs',
            style: 'link',
            url: 'https://example.com/docs',
          },
        ],
      },
      {
        kind: 'select',
        placeholder: 'Pick one',
        options: [
          { label: 'Alpha', value: 'a' },
          { label: 'Beta', value: 'b' },
        ],
      },
      {
        kind: 'checkboxes',
        options: [
          { label: 'One', value: 'one' },
          { label: 'Two', value: 'two' },
        ],
        defaults: ['one'],
      },
      { kind: 'datepicker', label: 'Due date', default: '2026-04-15' },
    ]);
  });

  it('leaves unsupported fenced blocks in the clean text', () => {
    const input = 'Before\n```mermaid\ngraph LR\n```\nAfter';
    const parsed = parseInteractiveMarkdown(input);

    expect(parsed.cleanText).toBe(input);
    expect(parsed.blocks).toEqual([]);
  });
});
