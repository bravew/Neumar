import { describe, expect, it } from 'vitest';

import {
  FORM_SUBMIT_ACTION_ID,
  parseInteractiveBlocks,
} from '@/shared/channels/slack/interactive-parser';

describe('Slack interactive parser', () => {
  it('delegates through the shared parser and keeps Slack form batching', () => {
    const parsed = parseInteractiveBlocks(`
Configure this:

\`\`\`select
Priority
High | high
Low | low
\`\`\`

\`\`\`datepicker
Due date | 2026-04-15
\`\`\`
`);

    expect(parsed.cleanText).toBe('Configure this:');
    expect(parsed.actions).toHaveLength(3);
    expect(parsed.actions[0]).toMatchObject({
      type: 'actions',
      block_id: 'neuma:form:actions:0',
      elements: [
        {
          type: 'static_select',
          action_id: 'neuma:form:select:0_0',
        },
      ],
    });
    expect(parsed.actions[1]).toMatchObject({
      type: 'actions',
      block_id: 'neuma:form:actions:1',
      elements: [
        {
          type: 'datepicker',
          action_id: 'neuma:form:datepicker:1_0',
          initial_date: '2026-04-15',
        },
      ],
    });
    expect(parsed.actions[2]).toMatchObject({
      type: 'actions',
      block_id: 'neuma:form:submit:2',
      elements: [{ action_id: FORM_SUBMIT_ACTION_ID }],
    });
  });
});
