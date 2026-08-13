import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

import type { InteractiveBlock } from '../_shared/interactive';
import type { Option } from '../_shared/interactive';
import type { ChannelButton } from '../types';

export interface DiscordInteractiveDefinition {
  customId: string;
  kind: 'button' | 'select' | 'modal-trigger' | 'modal-submit';
  label: string;
  value?: string;
  modal?: ModalBuilder;
}

export interface DiscordInteractiveRenderResult {
  // discord.js builder generics are intentionally erased here because send()
  // accepts JSONEncodable action rows across component kinds.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  components: ActionRowBuilder<any>[];
  definitions: DiscordInteractiveDefinition[];
}

const MAX_BUTTONS_PER_ROW = 5;
const MAX_SELECT_OPTIONS = 25;
const MAX_ROWS = 5;

export function renderDiscordInteractive(params: {
  blocks: InteractiveBlock[];
  buttons?: ChannelButton[];
  formId: string;
}): DiscordInteractiveRenderResult {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const components: ActionRowBuilder<any>[] = [];
  const definitions: DiscordInteractiveDefinition[] = [];
  let statefulCount = 0;

  const pushRow = (
    row: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>,
  ) => {
    if (components.length < MAX_ROWS) components.push(row);
  };

  params.blocks.forEach((block, blockIdx) => {
    if (block.kind === 'buttons') {
      for (let i = 0; i < block.items.length; i += MAX_BUTTONS_PER_ROW) {
        const row = new ActionRowBuilder<ButtonBuilder>();
        block.items
          .slice(i, i + MAX_BUTTONS_PER_ROW)
          .forEach((item, offset) => {
            const index = i + offset;
            const button = new ButtonBuilder().setLabel(
              item.label.slice(0, 80),
            );
            if (item.url) {
              button.setStyle(ButtonStyle.Link).setURL(item.url);
            } else {
              const customId = `neuma:button:${blockIdx}_${index}:${params.formId}`;
              button
                .setCustomId(customId)
                .setStyle(toDiscordButtonStyle(item.style))
                .setDisabled(false);
              definitions.push({
                customId,
                kind: 'button',
                label: item.label,
                value: item.value,
              });
            }
            row.addComponents(button);
          });
        pushRow(row);
      }
      return;
    }

    if (
      block.kind === 'select' ||
      block.kind === 'multiselect' ||
      block.kind === 'checkboxes' ||
      block.kind === 'radio'
    ) {
      const options: Option[] = block.options;
      if (options.length === 0) return;
      const customId = `neuma:select:${blockIdx}:${params.formId}`;
      const select = new StringSelectMenuBuilder()
        .setCustomId(customId)
        .setPlaceholder(
          'placeholder' in block ? block.placeholder.slice(0, 100) : 'Choose',
        )
        .setMinValues(block.kind === 'radio' || block.kind === 'select' ? 1 : 0)
        .setMaxValues(
          block.kind === 'select' || block.kind === 'radio'
            ? 1
            : Math.min(options.length, MAX_SELECT_OPTIONS),
        )
        .addOptions(
          options
            .slice(0, MAX_SELECT_OPTIONS)
            .map((option) =>
              new StringSelectMenuOptionBuilder()
                .setLabel(option.label.slice(0, 100))
                .setValue(option.value.slice(0, 100)),
            ),
        );
      const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        select,
      );
      definitions.push({
        customId,
        kind: 'select',
        label: getBlockLabel(block),
      });
      statefulCount++;
      pushRow(row);
      return;
    }

    if (
      block.kind === 'datepicker' ||
      block.kind === 'timepicker' ||
      block.kind === 'datetimepicker' ||
      block.kind === 'text-input'
    ) {
      const customId = `neuma:modal:${blockIdx}:${params.formId}`;
      const fieldId = `neuma:field:${blockIdx}`;
      const modal = new ModalBuilder()
        .setCustomId(`neuma:modal-submit:${blockIdx}:${params.formId}`)
        .setTitle(getBlockLabel(block).slice(0, 45));
      const input = new TextInputBuilder()
        .setCustomId(fieldId)
        .setLabel(getBlockLabel(block).slice(0, 45))
        .setStyle(
          block.kind === 'text-input' && block.multiline
            ? TextInputStyle.Paragraph
            : TextInputStyle.Short,
        )
        .setRequired(block.kind !== 'text-input' || block.required !== false);
      if (block.kind === 'text-input') {
        if (block.placeholder) input.setPlaceholder(block.placeholder);
        if (block.min !== undefined) input.setMinLength(block.min);
        if (block.max !== undefined) input.setMaxLength(block.max);
      } else if (block.default !== undefined) {
        input.setValue(String(block.default));
      }
      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(input),
      );

      const button = new ButtonBuilder()
        .setCustomId(customId)
        .setLabel(getBlockLabel(block).slice(0, 80))
        .setStyle(ButtonStyle.Secondary);
      pushRow(new ActionRowBuilder<ButtonBuilder>().addComponents(button));
      definitions.push({
        customId,
        kind: 'modal-trigger',
        label: getBlockLabel(block),
        modal,
      });
      statefulCount++;
    }
  });

  if (params.buttons?.length) {
    for (let i = 0; i < params.buttons.length; i += MAX_BUTTONS_PER_ROW) {
      const row = new ActionRowBuilder<ButtonBuilder>();
      params.buttons
        .slice(i, i + MAX_BUTTONS_PER_ROW)
        .forEach((item, offset) => {
          const index = i + offset;
          const customId = `neuma:button:response_${index}:${params.formId}`;
          row.addComponents(
            new ButtonBuilder()
              .setCustomId(customId)
              .setLabel(item.text.slice(0, 80))
              .setStyle(ButtonStyle.Secondary),
          );
          definitions.push({
            customId,
            kind: 'button',
            label: item.text,
            value: item.data,
          });
        });
      pushRow(row);
    }
  }

  if (statefulCount >= 2 && components.length < MAX_ROWS) {
    const customId = `neuma:form:submit:${params.formId}`;
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(customId)
        .setLabel('Submit')
        .setStyle(ButtonStyle.Primary),
    );
    definitions.push({
      customId,
      kind: 'button',
      label: 'Submit',
      value: 'submit',
    });
    components.push(row);
  }

  return { components, definitions };
}

function toDiscordButtonStyle(style?: string): ButtonStyle {
  if (style === 'primary') return ButtonStyle.Primary;
  if (style === 'danger') return ButtonStyle.Danger;
  return ButtonStyle.Secondary;
}

function getBlockLabel(block: InteractiveBlock): string {
  if ('placeholder' in block && block.placeholder) return block.placeholder;
  if ('label' in block) return block.label;
  return block.kind;
}
