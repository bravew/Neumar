/**
 * ActivePluginChip — a dismissable chip shown when a surface was opened via the
 * marketplace "Use" action (`?plugin=<id>`). It confirms which plugin is
 * pre-attached for the next run and lets the user detach it (clearing the
 * query params). The plugin itself is already enabled, so its skills reach the
 * agent regardless; this is the visible affordance.
 */

import { Puzzle, X } from 'lucide-react';

import { useActivePlugin } from '@/shared/hooks/useActivePlugin';
import { useLanguage } from '@/shared/providers/language-provider';

export function ActivePluginChip({ className }: { className?: string }) {
  const { t } = useLanguage();
  const { active, dismiss } = useActivePlugin();

  if (!active) return null;

  return (
    <div
      className={
        'border-border bg-muted/40 text-foreground inline-flex items-center gap-1.5 rounded-md border py-1 pr-1.5 pl-2 text-xs font-medium ' +
        (className ?? '')
      }
    >
      <Puzzle className="text-muted-foreground size-3.5 shrink-0" />
      <span className="truncate">
        {t.plugins.activePlugin.label.replace('{name}', active.name)}
      </span>
      <button
        type="button"
        onClick={dismiss}
        aria-label={t.plugins.activePlugin.dismiss}
        title={t.plugins.activePlugin.dismiss}
        className="text-muted-foreground hover:bg-accent hover:text-foreground flex size-4 items-center justify-center rounded-sm transition-colors"
      >
        <X className="size-3" />
      </button>
    </div>
  );
}
