import { describe, expect, it } from 'vitest';

import { renderTelegramInteractive } from '@/shared/channels/telegram/components';

describe('renderTelegramInteractive', () => {
  it('renders buttons and selects as stable inline keyboard callbacks', () => {
    const rendered = renderTelegramInteractive({
      formId: 'form1',
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
        callbackData: 'neuma:btn:0_0:form1',
        kind: 'button',
        label: 'Approve',
        value: 'approve',
        submitOnClick: true,
      },
      {
        callbackData: 'neuma:sel:1_0:form1',
        kind: 'select',
        label: 'Priority',
        value: 'high',
        displayValue: 'High',
        submitOnClick: true,
      },
      {
        callbackData: 'neuma:sel:1_1:form1',
        kind: 'select',
        label: 'Priority',
        value: 'low',
        displayValue: 'Low',
        submitOnClick: true,
      },
    ]);
    expect(rendered.replyMarkup).toEqual({
      inline_keyboard: [
        [{ text: 'Approve', callback_data: 'neuma:btn:0_0:form1' }],
        [{ text: 'High', callback_data: 'neuma:sel:1_0:form1' }],
        [{ text: 'Low', callback_data: 'neuma:sel:1_1:form1' }],
      ],
    });
  });

  it('adds a submit button when multiple stateful controls are rendered', () => {
    const rendered = renderTelegramInteractive({
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

    expect(rendered.replyMarkup?.inline_keyboard.at(-1)).toEqual([
      { text: 'Submit', callback_data: 'neuma:submit:form2' },
    ]);
    expect(
      rendered.definitions
        .filter((definition) => definition.kind === 'select')
        .every((definition) => definition.submitOnClick === false),
    ).toBe(true);
  });
});
