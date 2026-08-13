import { PROVENANCE_COMMENT_RE } from './provenance';

const BULLET_PATTERN = /^(\s*)[•●◦]\s+(.+)$/;
const MARKDOWN_LINK_RE = /\[([^\]]+)\]\(([^)\s]+)\)/g;
const BARE_URL_RE = /(^|[\s>(])((?:https?:\/\/|www\.)[^\s<]+)/gi;
const LINK_PLACEHOLDER_RE = /@@NEUMA_LINK_(\d+)@@/g;
const TRAILING_PUNCTUATION_RE = /[.,;:!?]$/;
const CLOSER_TO_OPENER: Record<string, string> = {
  ')': '(',
  ']': '[',
  '}': '{',
};

/**
 * Normalise Unicode bullet characters (•, ●, ◦) into standard markdown
 * list syntax so Streamdown renders them correctly. Also strips per-asset
 * provenance comments — they're parsed separately for badge rendering.
 *
 * Soft line breaks (single `\n` in prose) are converted to `<br>` by the
 * `remark-breaks` plugin passed via `remarkPlugins` to Streamdown, which
 * leaves fenced code, lists, and tables untouched — do not duplicate that
 * behaviour here.
 */
export function preprocessMarkdown(text: string): string {
  const stripped = text.replace(PROVENANCE_COMMENT_RE, '');
  let inFence = false;
  return stripped
    .split('\n')
    .map((line) => {
      if (/^\s*```/.test(line)) {
        inFence = !inFence;
        return line;
      }
      if (inFence) return line;
      const bulletMatch = line.match(BULLET_PATTERN);
      if (bulletMatch) {
        const indent = bulletMatch[1];
        const lineContent = bulletMatch[2];
        return trimUrlPunctuation(`${indent}- ${lineContent}`);
      }
      return trimUrlPunctuation(line);
    })
    .join('\n');
}

export function trimUrlPunctuation(line: string): string {
  const markdownLinks: string[] = [];
  const withPlaceholders = line.replace(
    MARKDOWN_LINK_RE,
    (match, label: string, target: string) => {
      if (!isUrlLike(target)) return match;
      const trimmed = splitTrailingUrlPunctuation(target);
      const replacement = `[${label}](${urlTarget(trimmed.url)})${trimmed.trailing}`;
      const index = markdownLinks.push(replacement) - 1;
      return `@@NEUMA_LINK_${index}@@`;
    },
  );

  const linked = withPlaceholders.replace(
    BARE_URL_RE,
    (match, prefix: string, rawUrl: string) => {
      const trimmed = splitTrailingUrlPunctuation(rawUrl);
      if (!trimmed.url) return match;
      return `${prefix}[${trimmed.url}](${urlTarget(trimmed.url)})${trimmed.trailing}`;
    },
  );

  return linked.replace(LINK_PLACEHOLDER_RE, (_match, index: string) => {
    return markdownLinks[Number(index)] ?? '';
  });
}

function splitTrailingUrlPunctuation(value: string): {
  url: string;
  trailing: string;
} {
  let url = value;
  let trailing = '';
  while (url) {
    const last = url.at(-1) ?? '';
    if (TRAILING_PUNCTUATION_RE.test(last) || isUnbalancedCloser(url, last)) {
      trailing = `${last}${trailing}`;
      url = url.slice(0, -1);
      continue;
    }
    break;
  }
  return { url, trailing };
}

function isUnbalancedCloser(value: string, closer: string): boolean {
  const opener = CLOSER_TO_OPENER[closer];
  if (!opener) return false;
  return countChar(value, closer) > countChar(value, opener);
}

function countChar(value: string, char: string): number {
  return [...value].filter((item) => item === char).length;
}

function isUrlLike(value: string): boolean {
  return /^(https?:\/\/|www\.)/i.test(value);
}

function urlTarget(value: string): string {
  return /^www\./i.test(value) ? `https://${value}` : value;
}
