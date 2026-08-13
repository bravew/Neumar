import { useMemo } from 'react';

import { Streamdown } from 'streamdown';

import { preprocessMermaidInMarkdown } from '@/shared/lib/mermaid-contrast';
import { useStreamdownPlugins } from '@/shared/lib/streamdown-plugins';
import { cn } from '@/shared/lib/utils';

interface MarkdownArtifactProps {
  source: string;
  className?: string;
}

export function MarkdownArtifact({ source, className }: MarkdownArtifactProps) {
  // Theme-aware mermaid + plugin tuple — re-renders fenced ```mermaid
  // blocks with new fills/strokes when the app theme flips.
  const plugins = useStreamdownPlugins();
  // Inject `color:` per `style X fill:#XXX` line so user-supplied fills
  // get readable text via Mermaid's canonical `style ... fill:X,color:Y`
  // recipe. Pure transformation; idempotent.
  const processed = useMemo(
    () => preprocessMermaidInMarkdown(source),
    [source],
  );
  return (
    <div
      className={cn(
        'prose prose-sm dark:prose-invert max-w-none overflow-auto px-4 py-3',
        // Tighter contrast in dark mode — default `prose-invert` leaves
        // body text and rule lines too faint against `bg-background`.
        'dark:prose-headings:text-foreground dark:prose-p:text-foreground dark:prose-li:text-foreground',
        'dark:prose-strong:text-foreground dark:prose-hr:border-border',
        'dark:prose-th:border-border dark:prose-td:border-border',
        '[&_table]:w-full [&_table]:border-collapse [&_table]:text-sm',
        '[&_thead]:bg-muted [&_thead]:sticky [&_thead]:top-0',
        '[&_th]:border-border [&_th]:border [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-medium',
        '[&_td]:border-border [&_td]:border [&_td]:px-3 [&_td]:py-2',
        '[&_tbody_tr:nth-child(even)]:bg-muted/30',
        // Mermaid edge stroke — Mermaid has no config key for stroke
        // width; CSS is canonical (per docs/Issue #1955).
        '[&_svg.flowchart_.flowchart-link]:!stroke-[1.75px]',
        '[&_svg.flowchart_.edgePath_path]:!stroke-[1.75px]',
        // Prose's `p { color: var(--tw-prose-body) }` overrides the
        // per-node `color:` we inject into mermaid spans, because
        // mermaid wraps node labels in <p>. Force <p>/<span> inside
        // .nodeLabel to inherit from the span (which carries our
        // YIQ-contrast color).
        '[&_svg.flowchart_.nodeLabel_p]:!text-inherit',
        '[&_svg.flowchart_.nodeLabel_span]:!text-inherit',
        '[&_svg.flowchart_.edgeLabel_p]:!text-inherit',
        '[&_svg.flowchart_.edgeLabel_span]:!text-inherit',
        className,
      )}
    >
      <Streamdown plugins={plugins}>{processed}</Streamdown>
    </div>
  );
}
