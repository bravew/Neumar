/**
 * Collapsible wrapper for the tier-based connector access policy.
 *
 * Separated from the Composio catalog so policy lives at the same
 * hierarchical level as the other top-level Connectors cards (your
 * accounts, cloud storage, catalog, policy) instead of being buried
 * inside the catalog disclosure.
 */
import { useState, type ReactNode } from 'react';

import { ChevronDown, ShieldCheck } from 'lucide-react';

import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

interface AccessPolicySectionProps {
  children: ReactNode;
}

export function AccessPolicySection({ children }: AccessPolicySectionProps) {
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
          <ShieldCheck className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-foreground text-base font-medium">
            {t.connectors.accessPolicySectionTitle}
          </h3>
          <p className="text-muted-foreground text-sm">
            {t.connectors.accessPolicySectionDescription}
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
