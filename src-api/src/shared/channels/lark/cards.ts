import type { InteractiveBlock, Option } from '../_shared/interactive';
import type { ChannelButton } from '../types';

export interface LarkCardActionValue {
  kind: 'button' | 'select' | 'submit' | 'input';
  formId: string;
  customId: string;
  value?: string;
  label?: string;
}

export interface LarkCardDefinition {
  customId: string;
  kind: LarkCardActionValue['kind'];
  label: string;
  value?: string;
}

export interface LarkCardRenderResult {
  card: Record<string, unknown>;
  definitions: LarkCardDefinition[];
}

const MAX_BUTTONS_PER_ROW = 5;
const MAX_SELECT_OPTIONS = 100;

export function renderLarkCard(params: {
  text: string;
  blocks: InteractiveBlock[];
  buttons?: ChannelButton[];
  formId: string;
}): LarkCardRenderResult {
  const elements: unknown[] = [
    {
      tag: 'div',
      text: { tag: 'lark_md', content: params.text || 'Choose an option:' },
    },
  ];
  const definitions: LarkCardDefinition[] = [];
  let statefulCount = 0;

  params.blocks.forEach((block, blockIdx) => {
    if (block.kind === 'buttons') {
      for (let i = 0; i < block.items.length; i += MAX_BUTTONS_PER_ROW) {
        elements.push({
          tag: 'action',
          actions: block.items
            .slice(i, i + MAX_BUTTONS_PER_ROW)
            .map((item, offset) => {
              const index = i + offset;
              const customId = `neuma:button:${blockIdx}_${index}:${params.formId}`;
              if (!item.url) {
                definitions.push({
                  customId,
                  kind: 'button',
                  label: item.label,
                  value: item.value,
                });
              }
              return {
                tag: 'button',
                text: { tag: 'plain_text', content: item.label.slice(0, 80) },
                type: toLarkButtonType(item.style),
                ...(item.url ? { url: item.url } : {}),
                ...(!item.url
                  ? {
                      value: actionValue({
                        kind: 'button',
                        formId: params.formId,
                        customId,
                        value: item.value,
                        label: item.label,
                      }),
                    }
                  : {}),
              };
            }),
        });
      }
      return;
    }

    if (
      block.kind === 'select' ||
      block.kind === 'multiselect' ||
      block.kind === 'checkboxes' ||
      block.kind === 'radio' ||
      block.kind === 'overflow'
    ) {
      const options: Option[] =
        block.kind === 'overflow' ? block.items : block.options;
      if (options.length === 0) return;
      const customId = `neuma:select:${blockIdx}:${params.formId}`;
      const label = getBlockLabel(block);
      definitions.push({ customId, kind: 'select', label });
      statefulCount++;
      elements.push({
        tag: 'action',
        actions: [
          {
            tag: block.kind === 'overflow' ? 'overflow' : 'select_static',
            placeholder: { tag: 'plain_text', content: label.slice(0, 80) },
            option: options.slice(0, MAX_SELECT_OPTIONS).map((option) => ({
              text: { tag: 'plain_text', content: option.label.slice(0, 80) },
              value: option.value.slice(0, 100),
            })),
            value: actionValue({
              kind: 'select',
              formId: params.formId,
              customId,
              label,
            }),
          },
        ],
      });
      return;
    }

    if (
      block.kind === 'datepicker' ||
      block.kind === 'timepicker' ||
      block.kind === 'datetimepicker'
    ) {
      const customId = `neuma:${block.kind}:${blockIdx}:${params.formId}`;
      const label = getBlockLabel(block);
      definitions.push({ customId, kind: 'select', label });
      statefulCount++;
      elements.push({
        tag: 'action',
        actions: [
          {
            tag: toLarkPickerTag(block.kind),
            placeholder: { tag: 'plain_text', content: label.slice(0, 80) },
            ...pickerDefault(block),
            value: actionValue({
              kind: 'select',
              formId: params.formId,
              customId,
              label,
            }),
          },
        ],
      });
    }
  });

  if (params.buttons?.length) {
    for (let i = 0; i < params.buttons.length; i += MAX_BUTTONS_PER_ROW) {
      elements.push({
        tag: 'action',
        actions: params.buttons
          .slice(i, i + MAX_BUTTONS_PER_ROW)
          .map((item, offset) => {
            const index = i + offset;
            const customId = `neuma:button:response_${index}:${params.formId}`;
            definitions.push({
              customId,
              kind: 'button',
              label: item.text,
              value: item.data,
            });
            return {
              tag: 'button',
              text: { tag: 'plain_text', content: item.text.slice(0, 80) },
              type: 'default',
              value: actionValue({
                kind: 'button',
                formId: params.formId,
                customId,
                value: item.data,
                label: item.text,
              }),
            };
          }),
      });
    }
  }

  if (statefulCount >= 2) {
    const customId = `neuma:form:submit:${params.formId}`;
    definitions.push({
      customId,
      kind: 'submit',
      label: 'Submit',
      value: 'submit',
    });
    elements.push({
      tag: 'action',
      actions: [
        {
          tag: 'button',
          text: { tag: 'plain_text', content: 'Submit' },
          type: 'primary',
          value: actionValue({
            kind: 'submit',
            formId: params.formId,
            customId,
            value: 'submit',
            label: 'Submit',
          }),
        },
      ],
    });
  }

  return {
    card: {
      schema: '2.0',
      config: { wide_screen_mode: true, update_multi: true },
      header: {
        template: 'blue',
        title: { tag: 'plain_text', content: 'Neuma' },
      },
      body: { elements },
    },
    definitions,
  };
}

export function buildCardMessage(text: string, buttons?: ChannelButton[]) {
  return renderLarkCard({
    text,
    blocks: [],
    buttons,
    formId: 'legacy',
  }).card;
}

function actionValue(value: LarkCardActionValue): Record<string, unknown> {
  return { ...value };
}

function toLarkButtonType(style?: string): 'default' | 'primary' | 'danger' {
  if (style === 'primary') return 'primary';
  if (style === 'danger') return 'danger';
  return 'default';
}

function getBlockLabel(block: InteractiveBlock): string {
  if ('placeholder' in block && block.placeholder) return block.placeholder;
  if ('label' in block) return block.label;
  return block.kind;
}

function toLarkPickerTag(
  kind: 'datepicker' | 'timepicker' | 'datetimepicker',
): 'date_picker' | 'picker_time' | 'picker_datetime' {
  if (kind === 'timepicker') return 'picker_time';
  if (kind === 'datetimepicker') return 'picker_datetime';
  return 'date_picker';
}

function pickerDefault(
  block:
    | Extract<InteractiveBlock, { kind: 'datepicker' }>
    | Extract<InteractiveBlock, { kind: 'timepicker' }>
    | Extract<InteractiveBlock, { kind: 'datetimepicker' }>,
): Record<string, unknown> {
  if (block.default === undefined) return {};
  if (block.kind === 'datepicker') return { initial_date: block.default };
  if (block.kind === 'timepicker') return { initial_time: block.default };
  return { initial_datetime: String(block.default) };
}
