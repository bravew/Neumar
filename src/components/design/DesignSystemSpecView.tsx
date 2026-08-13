import type { ReactNode } from 'react';
import { useMemo } from 'react';

import { cn } from '@/shared/lib/utils';

/**
 * DESIGN.md panel of the preview modal (Open Design parity). Renders the spec
 * as a lightly syntax-coloured monospace *source* view — headings, blockquotes,
 * inline code, bold/italic, and hex colors (with a swatch) are highlighted via
 * CSS classes only (no `innerHTML` for untrusted text), matching Open Design's
 * `DesignSpecView`. We deliberately show source rather than rendered prose so
 * the panel reads like the authored DESIGN.md sitting beside the showcase.
 */
export function DesignSystemSpecView({
  body,
  testId,
}: {
  body: string;
  testId?: string;
}) {
  const lines = useMemo(() => (body ? body.split(/\r?\n/) : []), [body]);

  return (
    <div className="h-full overflow-auto" data-testid={testId}>
      <pre className="text-foreground/90 px-4 py-3 font-mono text-xs leading-5 break-words whitespace-pre-wrap">
        <code>
          {lines.map((line, idx) => (
            <span key={idx} className={cn('block', lineClass(line))}>
              {renderInline(line)}
              {'\n'}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}

/** Per-line styling keyed on the markdown construct that opens the line. */
function lineClass(line: string): string {
  if (/^#{1,6}\s+/.test(line)) {
    const hashes = /^(#+)\s/.exec(line)?.[1]?.length ?? 1;
    return hashes <= 1
      ? 'font-semibold text-sky-600 dark:text-sky-400'
      : 'font-semibold text-teal-600 dark:text-teal-400';
  }
  if (/^>\s/.test(line)) return 'text-muted-foreground italic';
  if (/^\s*```/.test(line)) return 'text-muted-foreground';
  return '';
}

// Bold / italic / inline-code / hex-color tokens. Module-scoped so it isn't
// recompiled per render.
const TOKEN_RE = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|#[0-9a-fA-F]{3,8}\b)/g;

function renderInline(line: string): ReactNode {
  if (!line) return null;
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const match of line.matchAll(TOKEN_RE)) {
    const start = match.index ?? 0;
    if (start > last) out.push(line.slice(last, start));
    const token = match[0];
    if (token.startsWith('**')) {
      out.push(
        <span key={key++} className="text-foreground font-semibold">
          {token.slice(2, -2)}
        </span>,
      );
    } else if (token.startsWith('*')) {
      out.push(
        <span key={key++} className="italic">
          {token.slice(1, -1)}
        </span>,
      );
    } else if (token.startsWith('`')) {
      out.push(
        <span key={key++} className="bg-muted rounded px-1 py-0.5">
          {token.slice(1, -1)}
        </span>,
      );
    } else {
      // Hex color — show a swatch next to the literal value.
      out.push(
        <span
          key={key++}
          className="inline-flex items-center gap-1 text-teal-600 dark:text-teal-400"
        >
          <span
            className="border-border inline-block size-2.5 rounded-[3px] border align-middle"
            style={{ backgroundColor: token }}
            aria-hidden
          />
          {token}
        </span>,
      );
    }
    last = start + token.length;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}
