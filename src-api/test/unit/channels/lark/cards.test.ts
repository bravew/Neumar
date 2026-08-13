import { describe, expect, it } from 'vitest';

import { renderLarkCard } from '@/shared/channels/lark/cards';

describe('renderLarkCard', () => {
  it('renders buttons and selects with routable action values', () => {
    const rendered = renderLarkCard({
      formId: 'form1',
      text: 'Pick one',
      blocks: [
        {
          kind: 'buttons',
          items: [{ label: 'Approve', value: 'approve', style: 'primary' }],
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
    expect(rendered.card).toMatchObject({
      schema: '2.0',
      body: {
        elements: [
          { tag: 'div', text: { tag: 'lark_md', content: 'Pick one' } },
          {
            tag: 'action',
            actions: [
              {
                tag: 'button',
                value: {
                  kind: 'button',
                  formId: 'form1',
                  customId: 'neuma:button:0_0:form1',
                  value: 'approve',
                },
              },
            ],
          },
          {
            tag: 'action',
            actions: [
              {
                tag: 'select_static',
                value: {
                  kind: 'select',
                  formId: 'form1',
                  customId: 'neuma:select:1:form1',
                },
              },
            ],
          },
        ],
      },
    });
  });

  it('adds a submit action for multi-control forms', () => {
    const rendered = renderLarkCard({
      formId: 'form2',
      text: '',
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
