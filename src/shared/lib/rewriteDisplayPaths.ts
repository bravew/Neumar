import { toDisplayPath } from '@/shared/lib/toDisplayPath';

const CODE_SEGMENT = /(```[\s\S]*?```|`[^`\n]*`)/g;

/**
 * Display-only rewrite. Paths under the session root become root-relative.
 * Fenced and inline code are left unchanged, and the stored message is not
 * this function's input.
 */
export function rewriteDisplayPaths(
  text: string,
  sessionRoot: string | undefined,
): string {
  if (!text || !sessionRoot) return text;
  return text
    .split(CODE_SEGMENT)
    .map((part, index) =>
      index % 2 === 1 ? part : replaceProsePaths(part, sessionRoot),
    )
    .join('');
}

function replaceProsePaths(text: string, sessionRoot: string): string {
  const roots = [
    ...new Set([
      sessionRoot,
      sessionRoot.replace(/\\/g, '/'),
      sessionRoot.replace(/\//g, '\\'),
    ]),
  ].filter((root) => root.length > 1);

  let result = text;
  for (const root of roots) {
    const escaped = root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`${escaped}(?:[/\\\\][^\\s\`'"<>|*?)]+)?`, 'g');
    result = result.replace(pattern, (match, offset: number, whole: string) => {
      const next = whole[offset + match.length];
      if (next && !/[\s`'".,:;)\]]/.test(next)) return match;
      const trimmed = match.replace(/[.,:;]+$/, '');
      const suffix = match.slice(trimmed.length);
      const display = toDisplayPath(trimmed, sessionRoot);
      return display === trimmed ? match : `${display}${suffix}`;
    });
  }
  return result;
}
