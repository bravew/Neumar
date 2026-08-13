import type { InteractiveBlock } from '../_shared/interactive';
import type { ChannelButton } from '../types';

export interface TelegramInteractiveDefinition {
  callbackData: string;
  kind: 'button' | 'select';
  label: string;
  value: string;
  displayValue?: string;
  submitOnClick: boolean;
}

export interface TelegramInteractiveRenderResult {
  replyMarkup?: {
    inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
  };
  definitions: TelegramInteractiveDefinition[];
}

const MAX_CALLBACK_DATA = 64;

export function renderTelegramInteractive(params: {
  blocks: InteractiveBlock[];
  buttons?: ChannelButton[];
  formId: string;
}): TelegramInteractiveRenderResult {
  const keyboard: Array<Array<{ text: string; callback_data: string }>> = [];
  const definitions: TelegramInteractiveDefinition[] = [];
  let statefulCount = 0;

  params.blocks.forEach((block, blockIdx) => {
    if (block.kind === 'buttons') {
      for (const [index, item] of block.items.entries()) {
        const callbackData = callbackId('btn', blockIdx, index, params.formId);
        keyboard.push([{ text: item.label, callback_data: callbackData }]);
        definitions.push({
          callbackData,
          kind: 'button',
          label: item.label,
          value: item.value,
          submitOnClick: true,
        });
      }
      return;
    }

    if (
      block.kind === 'select' ||
      block.kind === 'multiselect' ||
      block.kind === 'checkboxes' ||
      block.kind === 'radio'
    ) {
      statefulCount++;
      const label = 'placeholder' in block ? block.placeholder : block.kind;
      for (const [index, option] of block.options.entries()) {
        const callbackData = callbackId('sel', blockIdx, index, params.formId);
        keyboard.push([{ text: option.label, callback_data: callbackData }]);
        definitions.push({
          callbackData,
          kind: 'select',
          label,
          value: option.value,
          displayValue: option.label,
          submitOnClick: false,
        });
      }
      return;
    }

    if (
      block.kind === 'datepicker' ||
      block.kind === 'timepicker' ||
      block.kind === 'datetimepicker'
    ) {
      statefulCount++;
      const callbackData = callbackId('sel', blockIdx, 0, params.formId);
      const value =
        block.default !== undefined ? String(block.default) : block.label;
      keyboard.push([{ text: block.label, callback_data: callbackData }]);
      definitions.push({
        callbackData,
        kind: 'select',
        label: block.label,
        value,
        submitOnClick: false,
      });
    }
  });

  if (params.buttons?.length) {
    for (const [index, item] of params.buttons.entries()) {
      const callbackData = callbackId('btn', 99, index, params.formId);
      keyboard.push([{ text: item.text, callback_data: callbackData }]);
      definitions.push({
        callbackData,
        kind: 'button',
        label: item.text,
        value: item.data,
        submitOnClick: true,
      });
    }
  }

  if (statefulCount >= 2) {
    const callbackData = `neuma:submit:${params.formId}`.slice(
      0,
      MAX_CALLBACK_DATA,
    );
    keyboard.push([{ text: 'Submit', callback_data: callbackData }]);
    definitions.push({
      callbackData,
      kind: 'button',
      label: 'Submit',
      value: 'submit',
      submitOnClick: true,
    });
  } else {
    for (const definition of definitions) definition.submitOnClick = true;
  }

  return {
    replyMarkup:
      keyboard.length > 0 ? { inline_keyboard: keyboard } : undefined,
    definitions,
  };
}

function callbackId(
  kind: 'btn' | 'sel',
  blockIdx: number,
  itemIdx: number,
  formId: string,
): string {
  return `neuma:${kind}:${blockIdx}_${itemIdx}:${formId}`.slice(
    0,
    MAX_CALLBACK_DATA,
  );
}
