/**
 * Collapsible wrapper that groups all Composio-managed pieces:
 *  - API key card
 *  - Connector catalog grid
 *  - Per-tool access controls
 *
 * Matches the visual contract of `CloudStorageConnectionsSection` (chevron
 * header + count badge + nested body) so the Connectors tab reads as a
 * sequence of unified disclosure cards.
 */
import { useState, type ReactNode } from 'react';

import { ChevronDown, Boxes } from 'lucide-react';

import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

interface ComposioSectionProps {
  count?: number;
  children: ReactNode;
}

export function ComposioSection({ count, children }: ComposioSectionProps) {
  const { t } = useLanguage();
  const [expanded, setExpanded] = useState(false);

  return (
    <section className="border-border bg-card overflow-hidden rounded-xl border shadow-sm">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="hover:bg-muted/50 flex w-full items-center gap-3 px-4 py-3 text-left transition-colors"
      >
        <div className="bg-muted flex size-9 shrink-0 items-center justify-center rounded-lg">
          <Boxes className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-foreground text-base font-medium">
              {t.connectors.composioSectionTitle}
            </h3>
            {typeof count === 'number' && (
              <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-[10px] font-medium tabular-nums">
                {count}
              </span>
            )}
          </div>
          <p className="text-muted-foreground text-sm">
            {t.connectors.composioSectionDescription}
          </p>
        </div>
        <ChevronDown
          className={cn(
            'text-muted-foreground size-4 shrink-0 transition-transform duration-200',
            expanded && 'rotate-180',
          )}
        />
      </button>

      {expanded && (
        <div className="border-border space-y-4 border-t px-4 py-4">
          {children}
        </div>
      )}
    </section>
  );
}
