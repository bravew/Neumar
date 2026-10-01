import { toDisplayPath } from '@/shared/lib/toDisplayPath';

type Fence = { char: '`' | '~'; length: number };

/**
 * Display-only rewrite. Paths under the session root become root-relative.
 * Fenced and inline code, and link or URL destinations, stay unchanged.
 * The stored message is not this function's input.
 */
export function rewriteDisplayPaths(
  text: string,
  sessionRoot: string | undefined,
): string {
  if (!text || !sessionRoot) return text;
  return segmentCode(text)
    .map((segment) =>
      segment.code
        ? segment.text
        : replaceProsePaths(segment.text, sessionRoot),
    )
    .join('\n');
}

function segmentCode(text: string): { code: boolean; text: string }[] {
  const lines = text.split('\n');
  const parts: { code: boolean; text: string }[] = [];
  const prose: string[] = [];
  const flushProse = () => {
    if (prose.length === 0) return;
    parts.push({ code: false, text: prose.join('\n') });
    prose.length = 0;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const open = openingFence(lines[index] ?? '');
    if (!open) {
      prose.push(lines[index] ?? '');
      continue;
    }
    flushProse();
    const block = [lines[index] ?? ''];
    index += 1;
    while (index < lines.length) {
      block.push(lines[index] ?? '');
      if (closingFence(lines[index] ?? '', open)) break;
      index += 1;
    }
    parts.push({ code: true, text: block.join('\n') });
  }
  flushProse();
  return parts;
}

function openingFence(line: string): Fence | null {
  const match = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(line);
  if (!match) return null;
  const marker = match[2] ?? '';
  const info = match[3] ?? '';
  if (marker.startsWith('`') && info.includes('`')) return null;
  const char = marker.startsWith('~') ? '~' : '`';
  return { char, length: marker.length };
}

function closingFence(line: string, open: Fence): boolean {
  const match = /^( {0,3})([`~]{3,})[ \t]*$/.exec(line);
  if (!match) return false;
  const marker = match[2] ?? '';
  return marker[0] === open.char && marker.length >= open.length;
}

function replaceProsePaths(text: string, sessionRoot: string): string {
  return text
    .split(/(`[^`\n]*`)/g)
    .map((part, index) =>
      index % 2 === 1 ? part : replacePlainPaths(part, sessionRoot),
    )
    .join('');
}

const ABSOLUTE_PATH = /(^|[\s([>"'])((?:\/|[A-Za-z]:[\\/])[^\s`'"<>|*?)\]]+)/g;

function replacePlainPaths(text: string, sessionRoot: string): string {
  return text.replace(
    ABSOLUTE_PATH,
    (full, lead: string, path: string, offset: number) => {
      const pathStart = offset + lead.length;
      if (isLinkDestination(text, pathStart)) return full;
      const trimmed = path.replace(/[.,:;]+$/, '');
      const suffix = path.slice(trimmed.length);
      const display = toDisplayPath(trimmed, sessionRoot);
      return display === trimmed ? full : `${lead}${display}${suffix}`;
    },
  );
}

function isLinkDestination(text: string, pathStart: number): boolean {
  const before = text.slice(0, pathStart);
  if (before.endsWith('](')) return true;
  return /[a-z][a-z0-9+.-]*:\/\/\S*$/i.test(before);
}
