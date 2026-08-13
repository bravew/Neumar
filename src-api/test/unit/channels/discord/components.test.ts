import { describe, expect, it } from 'vitest';

import { renderDiscordInteractive } from '@/shared/channels/discord/components';

describe('renderDiscordInteractive', () => {
  it('renders buttons and selects with stable Neuma custom ids', () => {
    const rendered = renderDiscordInteractive({
      formId: 'form1',
      blocks: [
        {
          kind: 'buttons',
          items: [
            { label: 'Approve', value: 'approve', style: 'primary' },
            {
              label: 'Docs',
              value: 'docs',
              style: 'link',
              url: 'https://e.test',
            },
          ],
        },
        {
          kind: 'select',
          placeholder: 'Priority',
          options: [
            { label: 'High', value: 'high' },
            { label: 'Low', value: 'low' },
          ],
        },
      ],
    });

    expect(rendered.definitions).toEqual([
      {
        customId: 'neuma:button:0_0:form1',
        kind: 'button',
        label: 'Approve',
        value: 'approve',
      },
      { customId: 'neuma:select:1:form1', kind: 'select', label: 'Priority' },
    ]);
    expect(rendered.components).toHaveLength(2);
    expect(rendered.components[0]!.toJSON()).toMatchObject({
      type: 1,
      components: [
        { type: 2, custom_id: 'neuma:button:0_0:form1' },
        { type: 2, style: 5, url: 'https://e.test' },
      ],
    });
  });

  it('adds a submit button when multiple stateful controls are rendered', () => {
    const rendered = renderDiscordInteractive({
      formId: 'form2',
      blocks: [
        {
          kind: 'select',
          placeholder: 'Priority',
          options: [{ label: 'High', value: 'high' }],
        },
        { kind: 'datepicker', label: 'Due date', default: '2026-04-15' },
      ],
    });

    expect(
      rendered.definitions.map((definition) => definition.customId),
    ).toContain('neuma:form:submit:form2');
  });
});
