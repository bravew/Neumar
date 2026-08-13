export interface Option {
  label: string;
  value: string;
}

export type ButtonStyle = 'primary' | 'danger' | 'link';

export type InteractiveBlock =
  | {
      kind: 'buttons';
      items: Array<{
        label: string;
        value: string;
        style?: ButtonStyle;
        url?: string;
      }>;
    }
  | { kind: 'select'; placeholder: string; options: Option[] }
  | { kind: 'multiselect'; placeholder: string; options: Option[] }
  | { kind: 'checkboxes'; options: Option[]; defaults?: string[] }
  | { kind: 'radio'; options: Option[]; default?: string }
  | { kind: 'datepicker'; label: string; default?: string }
  | { kind: 'timepicker'; label: string; default?: string }
  | { kind: 'datetimepicker'; label: string; default?: number }
  | { kind: 'overflow'; items: Option[] }
  | {
      kind: 'text-input';
      label: string;
      placeholder?: string;
      multiline?: boolean;
      min?: number;
      max?: number;
      required?: boolean;
    };

export interface ParsedInteractive {
  cleanText: string;
  blocks: InteractiveBlock[];
}

const SUPPORTED_TYPES =
  'buttons|select|multiselect|checkboxes|radio|datepicker|timepicker|datetimepicker|overflow';

const INTERACTIVE_BLOCK_RE = new RegExp(
  `^\`{3,}(${SUPPORTED_TYPES})\\s*\\n([\\s\\S]*?)^\`{3,}\\s*$`,
  'gm',
);

const MAX_BUTTONS = 25;
const MAX_OPTIONS = 10;
const MAX_SELECT_OPTIONS = 100;
const MAX_OVERFLOW_OPTIONS = 5;

type BlockType =
  | 'buttons'
  | 'select'
  | 'multiselect'
  | 'checkboxes'
  | 'radio'
  | 'datepicker'
  | 'timepicker'
  | 'datetimepicker'
  | 'overflow';

const BUILDERS: Record<BlockType, (body: string) => InteractiveBlock | null> = {
  buttons: parseButtons,
  select: (body) => parseSelectVariant(body, 'select'),
  multiselect: (body) => parseSelectVariant(body, 'multiselect'),
  checkboxes: parseCheckboxes,
  radio: parseRadio,
  datepicker: parseDatepicker,
  timepicker: parseTimepicker,
  datetimepicker: parseDatetimepicker,
  overflow: parseOverflow,
};

export function parseInteractiveMarkdown(text: string): ParsedInteractive {
  const blocks: InteractiveBlock[] = [];

  INTERACTIVE_BLOCK_RE.lastIndex = 0;
  const cleaned = text.replace(
    INTERACTIVE_BLOCK_RE,
    (_match: string, type: string, body: string) => {
      const trimmed = body.trim();
      if (!trimmed) return '';

      const block = BUILDERS[type as BlockType]?.(trimmed) ?? null;
      if (block) blocks.push(block);
      return '';
    },
  );

  return {
    cleanText: cleaned.replace(/\n{3,}/g, '\n\n').trim(),
    blocks,
  };
}

function parseButtons(body: string): InteractiveBlock | null {
  const lines = nonEmpty(body);
  if (lines.length === 0) return null;

  return {
    kind: 'buttons',
    items: lines.slice(0, MAX_BUTTONS).map((line) => {
      const parts = splitPipe(line);
      const label = parts[0] || 'Option';
      const value = parts[1] || slugify(label);
      let style: ButtonStyle | undefined;
      let url: string | undefined;

      for (let p = 2; p < parts.length; p++) {
        const flag = parts[p]!;
        const lower = flag.toLowerCase();
        if (lower === 'primary' || lower === 'danger') {
          style = lower;
        } else if (lower.startsWith('url:')) {
          url = flag.slice(4).trim();
          style = 'link';
        }
      }

      return {
        label,
        value,
        ...(style ? { style } : {}),
        ...(url ? { url } : {}),
      };
    }),
  };
}

function parseSelectVariant(
  body: string,
  kind: 'select' | 'multiselect',
): InteractiveBlock | null {
  const { placeholder, optionLines } = extractPlaceholderAndOptions(body);
  if (optionLines.length === 0) return null;
  return {
    kind,
    placeholder,
    options: optionLines.slice(0, MAX_SELECT_OPTIONS).map(parseOption),
  };
}

function parseCheckboxes(body: string): InteractiveBlock | null {
  const lines = nonEmpty(body);
  if (lines.length === 0) return null;

  const options: Option[] = [];
  const defaults: string[] = [];
  for (const line of lines.slice(0, MAX_OPTIONS)) {
    const [rawLabel, rawValue, rawFlag] = splitPipe(line);
    const label = rawLabel || 'Option';
    const value = rawValue || slugify(label);
    options.push({ label, value });
    if (rawFlag?.toLowerCase() === 'checked') defaults.push(value);
  }

  return {
    kind: 'checkboxes',
    options,
    ...(defaults.length > 0 ? { defaults } : {}),
  };
}

function parseRadio(body: string): InteractiveBlock | null {
  const lines = nonEmpty(body);
  if (lines.length === 0) return null;

  const options: Option[] = [];
  let defaultValue: string | undefined;
  for (const line of lines.slice(0, MAX_OPTIONS)) {
    const [rawLabel, rawValue, rawFlag] = splitPipe(line);
    const label = rawLabel || 'Option';
    const value = rawValue || slugify(label);
    options.push({ label, value });
    if (rawFlag?.toLowerCase() === 'selected') defaultValue = value;
  }

  return {
    kind: 'radio',
    options,
    ...(defaultValue ? { default: defaultValue } : {}),
  };
}

function parseDatepicker(body: string): InteractiveBlock | null {
  const line = nonEmpty(body)[0];
  if (!line) return null;
  const [rawLabel, rawDate] = splitPipe(line);
  const label = rawLabel || 'Select a date';
  const defaultValue =
    rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : undefined;
  return {
    kind: 'datepicker',
    label,
    ...(defaultValue ? { default: defaultValue } : {}),
  };
}

function parseTimepicker(body: string): InteractiveBlock | null {
  const line = nonEmpty(body)[0];
  if (!line) return null;
  const [rawLabel, rawTime] = splitPipe(line);
  const label = rawLabel || 'Select a time';
  const defaultValue =
    rawTime && /^\d{2}:\d{2}$/.test(rawTime) ? rawTime : undefined;
  return {
    kind: 'timepicker',
    label,
    ...(defaultValue ? { default: defaultValue } : {}),
  };
}

function parseDatetimepicker(body: string): InteractiveBlock | null {
  const line = nonEmpty(body)[0];
  if (!line) return null;
  const [rawLabel, rawTs] = splitPipe(line);
  const label = rawLabel || 'Select date and time';
  const parsed = rawTs ? Number.parseInt(rawTs, 10) : undefined;
  return {
    kind: 'datetimepicker',
    label,
    ...(parsed && !Number.isNaN(parsed) ? { default: parsed } : {}),
  };
}

function parseOverflow(body: string): InteractiveBlock | null {
  const lines = nonEmpty(body);
  if (lines.length === 0) return null;
  return {
    kind: 'overflow',
    items: lines.slice(0, MAX_OVERFLOW_OPTIONS).map(parseOption),
  };
}

function parseOption(line: string): Option {
  const [rawLabel, rawValue] = splitPipe(line);
  const label = rawLabel || 'Option';
  const value = rawValue || slugify(label);
  return { label, value };
}

function extractPlaceholderAndOptions(body: string): {
  placeholder: string;
  optionLines: string[];
} {
  const lines = nonEmpty(body);
  if (lines.length === 0)
    return { placeholder: 'Choose an option', optionLines: [] };

  if (lines[0] && !lines[0].includes('|')) {
    return {
      placeholder: lines[0].trim(),
      optionLines: lines.slice(1),
    };
  }
  return { placeholder: 'Choose an option', optionLines: lines };
}

function splitPipe(line: string): string[] {
  return line.split('|').map((s) => s.trim());
}

function nonEmpty(body: string): string[] {
  return body.split('\n').filter((line) => line.trim());
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 75);
}
