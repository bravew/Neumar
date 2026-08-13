/**
 * AvailablePluginDetailDialog — the plugin detail modal. Two modes:
 *   • Available (not installed): catalog-sourced detail + an Install action.
 *   • Installed: local-record detail (author, example query, context bundles,
 *     capability permissions, source table), a "More" overflow menu, and a
 *     Use / Use-without-prompt split action.
 * Mirrors Open Design's split between the pre-install and installed views.
 */

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { AvailablePluginEntry } from '@/shared/hooks/useMarketplaceSources';
import type { InstalledPlugin } from '@/shared/hooks/usePlugins';
import { useLanguage } from '@/shared/providers/language-provider';

import { AvailableDetailBody } from './AvailableDetailBody';
import { TrustBadge } from './DetailPrimitives';
import { InstalledDetailBody } from './InstalledDetailBody';
import { PluginMoreMenu } from './PluginMoreMenu';
import { PluginUseButton } from './PluginUseButton';

export function AvailablePluginDetailDialog({
  entry,
  installedPlugin,
  open,
  pending,
  onOpenChange,
  onInstall,
  onUse,
  onUseWithoutPrompt,
}: {
  entry: AvailablePluginEntry | null;
  /** Set when the entry is already installed — switches to installed mode. */
  installedPlugin?: InstalledPlugin;
  open: boolean;
  pending?: boolean;
  onOpenChange: (open: boolean) => void;
  onInstall: () => void;
  onUse: () => void;
  onUseWithoutPrompt: () => void;
}) {
  const { t } = useLanguage();
  const installed = !!installedPlugin;
  const meta = entry?.entry;
  const title =
    installedPlugin?.manifest?.displayName ||
    meta?.displayName ||
    installedPlugin?.name ||
    meta?.name;
  const version = installedPlugin?.version ?? meta?.version;
  const canSeed = !!installedPlugin?.manifest?.metadata?.neuma?.exampleQuery;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-lg flex-col">
        <DialogHeader>
          <div className="flex items-start justify-between gap-2">
            <DialogTitle className="flex items-center gap-2">
              <span className="truncate">{title}</span>
              {entry ? <TrustBadge trust={entry.sourceTrust} /> : null}
            </DialogTitle>
            {installedPlugin ? (
              <PluginMoreMenu plugin={installedPlugin} entry={entry} />
            ) : null}
          </div>
          <DialogDescription className="font-mono text-xs">
            {installedPlugin?.name ?? meta?.name}
            {version ? ` · v${version}` : ''}
            {entry ? ` · ${entry.sourceName}` : null}
          </DialogDescription>
        </DialogHeader>

        <div className="-mr-2 flex-1 space-y-5 overflow-y-auto pr-2 text-sm">
          {installedPlugin ? (
            <InstalledDetailBody plugin={installedPlugin} entry={entry} />
          ) : entry ? (
            <AvailableDetailBody entry={entry} />
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t.common.cancel}
          </Button>
          {installed ? (
            <PluginUseButton
              size="default"
              canSeed={canSeed}
              onUse={onUse}
              onUseWithoutPrompt={onUseWithoutPrompt}
            />
          ) : (
            <Button onClick={onInstall} disabled={pending || !entry}>
              {t.plugins.actions.install}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
