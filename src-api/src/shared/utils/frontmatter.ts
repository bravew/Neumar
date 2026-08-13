export interface MarkdownFrontmatter {
  attributes: Record<string, unknown>;
  body: string;
  frontmatter: string;
}

const FRONTMATTER_PATTERN = /^---\s*\r?\n([\s\S]*?)\r?\n---/;
const TOP_LEVEL_KEY_PATTERN = /^([A-Za-z0-9_-]+):\s*(.*)$/;

export function parseMarkdownFrontmatter(
  content: string,
): MarkdownFrontmatter | null {
  const match = content.match(FRONTMATTER_PATTERN);
  if (!match) return null;
  const frontmatter = match[1] ?? '';
  return {
    attributes: parseFrontmatterBlock(frontmatter),
    body: content.slice(match[0].length).replace(/^\s*\n/, ''),
    frontmatter,
  };
}

export function extractFrontmatter(content: string): string {
  return parseMarkdownFrontmatter(content)?.frontmatter ?? '';
}

export function parseFrontmatterBlock(
  frontmatter: string,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = frontmatter.split('\n');

  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index]!;
    if (!raw.trim() || raw.trimStart().startsWith('#')) continue;

    const match = raw.match(TOP_LEVEL_KEY_PATTERN);
    if (!match) continue;

    const key = match[1]!;
    const rawValue = match[2]?.trim() ?? '';
    if (rawValue === '|' || rawValue === '>') {
      const scalar = collectIndentedLines(lines, index, rawValue);
      result[key] = scalar.value;
      index = scalar.endIndex;
    } else if (rawValue === '') {
      const collected = collectIndentedLines(lines, index, '|');
      result[key] = parseIndentedFrontmatterValue(collected.lines);
      index = collected.endIndex;
    } else {
      result[key] = parseInlineFrontmatterValue(rawValue);
    }
  }

  return result;
}

export function extractIndentedBlock(source: string, key: string): string {
  const lines = source.split('\n');
  const start = lines.findIndex((line) =>
    line.match(new RegExp(`^\\s*${escapeRegExp(key)}:[ \\t]*$`)),
  );
  if (start < 0) return '';
  const indent = lines[start]!.match(/^(\s*)/)?.[1]?.length ?? 0;
  const collected: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]!;
    const currentIndent = line.match(/^(\s*)/)?.[1]?.length ?? 0;
    if (line.trim() && currentIndent <= indent) break;
    collected.push(line.slice(Math.min(currentIndent, indent + 2)));
  }
  return collected.join('\n');
}

export function readFrontmatterScalar(
  source: string,
  key: string,
): string | undefined {
  const match = source.match(
    new RegExp(`^\\s*${escapeRegExp(key)}:[ \\t]*(.+)$`, 'm'),
  );
  if (!match) return undefined;
  const raw = match[1]!.trim();
  if (raw === '|' || raw === '>')
    return readFrontmatterBlockScalar(source, key);
  const value = parseInlineFrontmatterValue(raw);
  return typeof value === 'string' ? value : undefined;
}

export function readFrontmatterBlockScalar(
  source: string,
  key: string,
): string | undefined {
  const lines = source.split('\n');
  const start = lines.findIndex((line) =>
    line.match(new RegExp(`^\\s*${escapeRegExp(key)}:[ \\t]*([>|])[ \\t]*$`)),
  );
  if (start < 0) return readFrontmatterScalar(source, key);
  const marker = lines[start]!.trim().endsWith('>') ? '>' : '|';
  return collectIndentedLines(lines, start, marker).value;
}

export function readFrontmatterStringList(
  source: string,
  key: string,
): string[] {
  const match = source.match(
    new RegExp(`^\\s*${escapeRegExp(key)}:[ \\t]*(.*)$`, 'm'),
  );
  if (!match) return [];

  const raw = match[1]?.trim() ?? '';
  if (raw === '') {
    const lines = source.split('\n');
    const start = lines.findIndex((line) =>
      line.match(new RegExp(`^\\s*${escapeRegExp(key)}:[ \\t]*$`)),
    );
    if (start < 0) return [];
    const value = parseIndentedFrontmatterValue(
      collectIndentedLines(lines, start, '|').lines,
    );
    return Array.isArray(value) ? value.filter(isNonEmptyString) : [];
  }

  const value = parseInlineFrontmatterValue(raw);
  if (Array.isArray(value)) return value.filter(isNonEmptyString);
  return typeof value === 'string' && value ? [value] : [];
}

export function stripFrontmatterQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function collectIndentedLines(
  lines: string[],
  start: number,
  marker: string,
): { value: string; lines: string[]; endIndex: number } {
  const indent = lines[start]!.match(/^(\s*)/)?.[1]?.length ?? 0;
  const out: string[] = [];
  let endIndex = start;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]!;
    const currentIndent = line.match(/^(\s*)/)?.[1]?.length ?? 0;
    if (line.trim() && currentIndent <= indent) break;
    out.push(line.slice(Math.min(currentIndent, indent + 2)));
    endIndex = i;
  }
  return {
    value: out.join(marker === '>' ? ' ' : '\n').trim(),
    lines: out,
    endIndex,
  };
}

function parseInlineFrontmatterValue(value: string): unknown {
  if (!value.startsWith('[') || !value.endsWith(']')) {
    return stripFrontmatterQuotes(value);
  }
  return splitInlineArrayItems(value.slice(1, -1))
    .map((part) => stripFrontmatterQuotes(part))
    .filter(Boolean);
}

function splitInlineArrayItems(value: string): string[] {
  const items: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let escaped = false;

  for (const char of value) {
    if (quote) {
      current += char;
      if (quote === '"' && char === '\\' && !escaped) {
        escaped = true;
        continue;
      }
      if (char === quote && !escaped) quote = null;
      escaped = false;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }

    if (char === ',') {
      items.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  items.push(current);
  return items;
}

function parseIndentedFrontmatterValue(lines: string[]): unknown {
  const list = lines
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '))
    .map((line) => stripFrontmatterQuotes(line.slice(2)))
    .filter(Boolean);
  if (list.length > 0) return list;
  return lines.join('\n').trim();
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
