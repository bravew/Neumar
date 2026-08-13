/**
 * AvailablePluginCard — a marketplace catalog entry with its source trust
 * badge and pre-install capability summary (shown before install).
 */

import { Package } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { type AvailablePluginEntry } from '@/shared/hooks/useMarketplaceSources';
import { useLanguage } from '@/shared/providers/language-provider';

import { TrustBadge } from './DetailPrimitives';
import { PluginUseButton } from './PluginUseButton';

export function AvailablePluginCard({
  entry,
  pending,
  installed = false,
  canSeed = false,
  onInstall,
  onUse,
  onUseWithoutPrompt,
  onSelect,
}: {
  entry: AvailablePluginEntry;
  pending: boolean;
  /** True when this catalog entry is already installed — offer "Use" not "Install". */
  installed?: boolean;
  /** True when the installed plugin has an example query to seed. */
  canSeed?: boolean;
  onInstall: () => void;
  onUse: () => void;
  onUseWithoutPrompt: () => void;
  onSelect: () => void;
}) {
  const { t } = useLanguage();
  const meta = entry.entry;
  const title = meta.displayName || meta.name;
  const capabilities = meta.metadata?.neuma?.capabilitiesSummary ?? [];

  return (
    <div className="border-border bg-card hover:border-foreground/20 flex h-full flex-col gap-3 rounded-lg border p-4 transition-colors">
      <div className="flex items-start gap-3">
        <div className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-md">
          <Package className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onSelect}
              className="hover:text-foreground/80 truncate text-left text-sm font-medium"
              title={title}
            >
              {title}
            </button>
            <TrustBadge trust={entry.sourceTrust} />
          </div>
          <div className="text-muted-foreground mt-0.5 flex items-center gap-2 text-xs">
            {meta.version ? (
              <span className="font-mono">v{meta.version}</span>
            ) : null}
            <span aria-hidden>·</span>
            <span className="truncate">{entry.sourceName}</span>
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={onSelect}
        className="text-muted-foreground line-clamp-2 text-left text-xs"
      >
        {meta.description}
      </button>

      {capabilities.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {capabilities.slice(0, 4).map((capability) => (
            <span
              key={capability}
              className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 font-mono text-[10px]"
            >
              {capability}
            </span>
          ))}
        </div>
      ) : null}

      <div className="mt-auto flex items-center gap-2 pt-1">
        {installed ? (
          <PluginUseButton
            canSeed={canSeed}
            onUse={onUse}
            onUseWithoutPrompt={onUseWithoutPrompt}
          />
        ) : (
          <Button size="sm" onClick={onInstall} disabled={pending}>
            {t.plugins.actions.install}
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onSelect}>
          {t.plugins.actions.details}
        </Button>
      </div>
    </div>
  );
}
