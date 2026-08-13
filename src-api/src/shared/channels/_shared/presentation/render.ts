import type {
  ChannelButton,
  ChannelCapabilities,
  NormalizedResponse,
} from '../../types';
import {
  parseInteractiveMarkdown,
  type InteractiveBlock,
} from '../interactive';
import { capabilityProfileFor } from './capability-profile';
import type {
  CapabilityProfile,
  Presentation,
  RenderedPresentation,
} from './types';

export interface RenderPresentationInput {
  platform: string;
  capabilities: ChannelCapabilities;
  response: NormalizedResponse;
}

export function presentationFromResponse(
  response: NormalizedResponse,
): Presentation {
  const parsed = parseInteractiveMarkdown(response.text);
  return {
    kind: 'message',
    text: parsed.blocks.length > 0 ? parsed.cleanText : response.text,
    blocks: parsed.blocks,
    buttons: response.buttons ?? [],
    attachments: response.attachments,
  };
}

export function renderPresentationForChannel(
  input: RenderPresentationInput,
): RenderedPresentation {
  const profile = capabilityProfileFor(input.platform, input.capabilities);
  const presentation = presentationFromResponse(input.response);
  const supportedBlocks: InteractiveBlock[] = [];
  const degradedBlocks: InteractiveBlock[] = [];

  for (const block of presentation.blocks) {
    if (isSupported(block, profile)) {
      supportedBlocks.push(limitBlock(block, profile));
    } else {
      degradedBlocks.push(block);
    }
  }

  const buttons = profile.supportsButtons
    ? presentation.buttons.slice(0, profile.maxButtons)
    : [];
  const degradedButtons = profile.supportsButtons ? [] : presentation.buttons;
  const degradedText = [
    ...degradedBlocks.flatMap(describeBlock),
    ...degradedButtons.map(describeButton),
  ];
  const text = [presentation.text, degradedText.join('\n')]
    .filter(Boolean)
    .join('\n\n')
    .trim();

  return {
    ...presentation,
    text,
    blocks: supportedBlocks,
    buttons,
    profile,
    degradedBlocks,
    degradedReason:
      degradedBlocks.length > 0 || degradedButtons.length > 0
        ? 'channel_capability'
        : undefined,
  };
}

function isSupported(
  block: InteractiveBlock,
  profile: CapabilityProfile,
): boolean {
  switch (block.kind) {
    case 'buttons':
      return profile.supportsButtons;
    case 'select':
    case 'multiselect':
    case 'checkboxes':
    case 'radio':
    case 'overflow':
      return profile.supportsSelects || profile.supportsForms;
    case 'datepicker':
    case 'timepicker':
    case 'datetimepicker':
      return profile.supportsDatePicker;
    case 'text-input':
      return profile.supportsForms;
  }
}

function limitBlock(
  block: InteractiveBlock,
  profile: CapabilityProfile,
): InteractiveBlock {
  switch (block.kind) {
    case 'buttons':
      return {
        ...block,
        items: block.items.slice(0, profile.maxButtons),
      };
    case 'select':
    case 'multiselect':
      return {
        ...block,
        options: block.options.slice(0, profile.maxOptions),
      };
    case 'checkboxes':
      return {
        ...block,
        options: block.options.slice(0, profile.maxOptions),
      };
    case 'radio':
      return {
        ...block,
        options: block.options.slice(0, profile.maxOptions),
      };
    case 'overflow':
      return {
        ...block,
        items: block.items.slice(0, profile.maxOptions),
      };
    default:
      return block;
  }
}

function describeBlock(block: InteractiveBlock): string[] {
  switch (block.kind) {
    case 'buttons':
      return block.items.map((item) =>
        describeButton({
          text: item.label,
          data: item.value,
        }),
      );
    case 'select':
    case 'multiselect':
      return [
        `${block.placeholder}: ${block.options.map((option) => option.label).join(', ')}`,
      ];
    case 'checkboxes':
    case 'radio':
      return [block.options.map((option) => `- ${option.label}`).join('\n')];
    case 'datepicker':
    case 'timepicker':
    case 'datetimepicker':
      return [block.label];
    case 'overflow':
      return [block.items.map((option) => `- ${option.label}`).join('\n')];
    case 'text-input':
      return [block.label];
  }
}

function describeButton(button: ChannelButton): string {
  return `- ${button.text}`;
}
