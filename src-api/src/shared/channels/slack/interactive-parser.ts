/**
 * Slack Interactive Block Parser
 *
 * Parses agent markdown for fenced code blocks that declare interactive
 * elements and converts them to Block Kit ActionsBlocks.
 */

import type {
  ActionsBlock,
  Button,
  Checkboxes,
  Datepicker,
  DateTimepicker,
  KnownBlock,
  MultiStaticSelect,
  Option as SlackOption,
  Overflow,
  PlainTextOption,
  RadioButtons,
  StaticSelect,
  Timepicker,
} from '@slack/types';

import { validateBaseUrl } from '@/shared/utils/url-validator';

import {
  parseInteractiveMarkdown,
  type InteractiveBlock,
  type Option,
} from '../_shared/interactive';

// ── Public interface ─────────────────────────────────────────────────────

export interface ParsedInteractive {
  /** Agent text with interactive code blocks removed. */
  cleanText: string;
  /** Block Kit actions blocks parsed from the interactive markers. */
  actions: KnownBlock[];
}

/**
 * Multi-input forms batch selections via an auto-appended Submit button.
 * The action handler decides to defer or fire by looking at the action_id
 * prefix — more robust than inspecting `body.message.blocks`, which Slack
 * can reshape (e.g. `markdown` expansion) between post and interaction.
 */
export const FORM_ACTION_PREFIX = 'neuma:form:';
export const FORM_SUBMIT_ACTION_ID = 'neuma:form:submit:send';
const FORM_SUBMIT_BLOCK_ID = 'neuma:form:submit';
const SUBMIT_AUTOAPPEND_MIN = 2;

// ── Constants ────────────────────────────────────────────────────────────

const MAX_LABEL = 75;

// ── Main parser ──────────────────────────────────────────────────────────

/**
 * Parse interactive element markers from agent text.
 *
 * Extracts fenced code blocks tagged with a supported type and converts
 * them to Block Kit ActionsBlocks. Returns cleaned text with those blocks
 * removed and collapsed whitespace.
 */
export function parseInteractiveBlocks(text: string): ParsedInteractive {
  const parsed = parseInteractiveMarkdown(text);
  const actions = buildInteractiveActionsBlocks(parsed.blocks);

  return {
    cleanText: parsed.cleanText,
    actions,
  };
}

export function buildInteractiveActionsBlocks(
  blocks: InteractiveBlock[],
): ActionsBlock[] {
  const actions = blocks
    .map((block, idx) => buildActionsBlock(block, idx))
    .filter((block): block is ActionsBlock => Boolean(block));

  // Auto-append Submit when multiple stateful inputs are present so the
  // user fills them together. Pure button groups are skipped — they're
  // one-tap CTAs that don't benefit from batching. Buttons inside a form
  // keep their plain IDs so one-tap side actions (e.g. Cancel) still fire.
  const statefulCount = rewriteFormIfMultiInput(actions);
  if (statefulCount >= SUBMIT_AUTOAPPEND_MIN) {
    actions.push(buildSubmitBlock(actions.length));
  }

  return actions;
}

function buildActionsBlock(
  block: InteractiveBlock,
  idx: number,
): ActionsBlock | null {
  switch (block.kind) {
    case 'buttons':
      return buildButtonsBlock(block, idx);
    case 'select':
      return buildSelectBlock(block, idx);
    case 'multiselect':
      return buildMultiSelectBlock(block, idx);
    case 'checkboxes':
      return buildCheckboxesBlock(block, idx);
    case 'radio':
      return buildRadioBlock(block, idx);
    case 'datepicker':
      return buildDatepickerBlock(block, idx);
    case 'timepicker':
      return buildTimepickerBlock(block, idx);
    case 'datetimepicker':
      return buildDateTimepickerBlock(block, idx);
    case 'overflow':
      return buildOverflowBlock(block, idx);
    case 'text-input':
      return null;
  }
}

/**
 * Walk the actions blocks once: count non-button elements, and if that
 * count meets the form threshold, rewrite their action_ids onto the
 * `neuma:form:` namespace so the action handler can recognise in-form
 * clicks from the action_id alone.
 */
function rewriteFormIfMultiInput(blocks: KnownBlock[]): number {
  let count = 0;
  const candidates: {
    block: Extract<KnownBlock, { type: 'actions' }>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    elements: any[];
  }[] = [];
  for (const block of blocks) {
    if (block.type !== 'actions') continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const statefulEls: any[] = [];
    for (const el of block.elements) {
      // Buttons are one-tap CTAs; overflow "⋯" menus also fire on pick
      // and don't appear in `state.values`, so they can't be part of a
      // batched Submit.
      if (el.type !== 'button' && el.type !== 'overflow') {
        statefulEls.push(el);
      }
    }
    count += statefulEls.length;
    if (statefulEls.length > 0)
      candidates.push({ block, elements: statefulEls });
  }
  if (count < SUBMIT_AUTOAPPEND_MIN) return count;

  for (const { block, elements } of candidates) {
    for (const el of elements) {
      if (typeof el.action_id === 'string') {
        el.action_id = toFormActionId(el.action_id);
      }
    }
    if (typeof block.block_id === 'string') {
      block.block_id = toFormActionId(block.block_id);
    }
  }
  return count;
}

function toFormActionId(id: string): string {
  if (id.startsWith(FORM_ACTION_PREFIX)) return id;
  if (id.startsWith('neuma:'))
    return FORM_ACTION_PREFIX + id.slice('neuma:'.length);
  return FORM_ACTION_PREFIX + id;
}

function buildSubmitBlock(idx: number): ActionsBlock {
  const submit: Button = {
    type: 'button',
    action_id: FORM_SUBMIT_ACTION_ID,
    text: plainText('Submit'),
    style: 'primary',
    value: 'submit',
  };
  return {
    type: 'actions',
    block_id: `${FORM_SUBMIT_BLOCK_ID}:${idx}`,
    elements: [submit],
  };
}

// ── Block builders ───────────────────────────────────────────────────────

function buildButtonsBlock(
  block: Extract<InteractiveBlock, { kind: 'buttons' }>,
  idx: number,
): ActionsBlock | null {
  if (block.items.length === 0) return null;

  const elements: Button[] = block.items.map((item, i) => {
    let url: string | undefined;
    if (item.url) {
      const check = validateBaseUrl(item.url);
      if (check.valid) url = item.url;
    }
    const style =
      item.style === 'primary' || item.style === 'danger'
        ? item.style
        : undefined;

    return {
      type: 'button',
      text: plainText(item.label),
      action_id: `neuma:button:${idx}_${i}`,
      value: item.value,
      ...(style ? { style } : {}),
      ...(url ? { url } : {}),
    } as Button;
  });

  return actionsBlock(idx, elements);
}

function buildSelectBlock(
  block: Extract<InteractiveBlock, { kind: 'select' }>,
  idx: number,
): ActionsBlock | null {
  if (block.options.length === 0) return null;
  const element: StaticSelect = {
    type: 'static_select',
    placeholder: plainText(block.placeholder),
    action_id: `neuma:select:${idx}_0`,
    options: block.options.map(toPlainTextOption),
  };
  return actionsBlock(idx, [element]);
}

function buildMultiSelectBlock(
  block: Extract<InteractiveBlock, { kind: 'multiselect' }>,
  idx: number,
): ActionsBlock | null {
  if (block.options.length === 0) return null;
  const element: MultiStaticSelect = {
    type: 'multi_static_select',
    placeholder: plainText(block.placeholder),
    action_id: `neuma:multiselect:${idx}_0`,
    options: block.options.map(toPlainTextOption),
  };
  return actionsBlock(idx, [element]);
}

function buildCheckboxesBlock(
  block: Extract<InteractiveBlock, { kind: 'checkboxes' }>,
  idx: number,
): ActionsBlock | null {
  if (block.options.length === 0) return null;
  const options: SlackOption[] = block.options.map(toSlackOption);
  const defaults = new Set<string>(block.defaults ?? []);
  const initialOptions = options.filter((option) =>
    option.value ? defaults.has(option.value) : false,
  );

  const element: Checkboxes = {
    type: 'checkboxes',
    action_id: `neuma:checkboxes:${idx}_0`,
    options,
    ...(initialOptions.length > 0 ? { initial_options: initialOptions } : {}),
  };
  return actionsBlock(idx, [element]);
}

function buildRadioBlock(
  block: Extract<InteractiveBlock, { kind: 'radio' }>,
  idx: number,
): ActionsBlock | null {
  if (block.options.length === 0) return null;
  const options: SlackOption[] = block.options.map(toSlackOption);
  const initialOption = options.find(
    (option) => option.value === block.default,
  );

  const element: RadioButtons = {
    type: 'radio_buttons',
    action_id: `neuma:radio:${idx}_0`,
    options,
    ...(initialOption ? { initial_option: initialOption } : {}),
  };
  return actionsBlock(idx, [element]);
}

function buildDatepickerBlock(
  block: Extract<InteractiveBlock, { kind: 'datepicker' }>,
  idx: number,
): ActionsBlock {
  const element: Datepicker = {
    type: 'datepicker',
    action_id: `neuma:datepicker:${idx}_0`,
    placeholder: plainText(block.label),
    ...(block.default ? { initial_date: block.default } : {}),
  };
  return actionsBlock(idx, [element]);
}

function buildTimepickerBlock(
  block: Extract<InteractiveBlock, { kind: 'timepicker' }>,
  idx: number,
): ActionsBlock {
  const element: Timepicker = {
    type: 'timepicker',
    action_id: `neuma:timepicker:${idx}_0`,
    placeholder: plainText(block.label),
    ...(block.default ? { initial_time: block.default } : {}),
  };
  return actionsBlock(idx, [element]);
}

function buildDateTimepickerBlock(
  block: Extract<InteractiveBlock, { kind: 'datetimepicker' }>,
  idx: number,
): ActionsBlock {
  const element: DateTimepicker = {
    type: 'datetimepicker',
    action_id: `neuma:datetimepicker:${idx}_0`,
    ...(block.default ? { initial_date_time: block.default } : {}),
  };
  return actionsBlock(idx, [element]);
}

function buildOverflowBlock(
  block: Extract<InteractiveBlock, { kind: 'overflow' }>,
  idx: number,
): ActionsBlock | null {
  if (block.items.length === 0) return null;
  const element: Overflow = {
    type: 'overflow',
    action_id: `neuma:overflow:${idx}_0`,
    options: block.items.map(toPlainTextOption),
  };
  return actionsBlock(idx, [element]);
}

// ── Helpers ──────────────────────────────────────────────────────────────

function actionsBlock(
  idx: number,
  elements: ActionsBlock['elements'],
): ActionsBlock {
  return {
    type: 'actions',
    block_id: `neuma:actions:${idx}`,
    elements,
  };
}

function plainText(text: string): {
  type: 'plain_text';
  text: string;
  emoji: true;
} {
  return {
    type: 'plain_text',
    text:
      text.length > MAX_LABEL ? text.slice(0, MAX_LABEL - 1) + '\u2026' : text,
    emoji: true,
  };
}

function toPlainTextOption(option: Option): PlainTextOption {
  return { text: plainText(option.label), value: option.value };
}

function toSlackOption(option: Option): SlackOption {
  return { text: plainText(option.label), value: option.value };
}
