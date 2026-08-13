/**
 * PluginMoreMenu — overflow menu of secondary actions on the installed plugin
 * detail: copy the plugin id / install source, open the source repo or
 * homepage. Mirrors Open Design's "More" menu.
 */

import { MoreHorizontal } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { AvailablePluginEntry } from '@/shared/hooks/useMarketplaceSources';
import type { InstalledPlugin } from '@/shared/hooks/usePlugins';
import { useLanguage } from '@/shared/providers/language-provider';

import { githubWebUrl, safeUrl, sourceRef } from './detail-helpers';

export function PluginMoreMenu({
  plugin,
  entry,
}: {
  plugin: InstalledPlugin;
  entry: AvailablePluginEntry | null;
}) {
  const { t } = useLanguage();

  const copy = (value: string) => () => {
    void navigator.clipboard?.writeText(value);
  };
  const open = (url: string) => () => {
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const installRef = plugin.sourceRef || (entry ? sourceRef(entry) : '');
  const github = entry ? githubWebUrl(entry) : null;
  const homepage = safeUrl(plugin.manifest?.homepage ?? entry?.entry.homepage);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={t.plugins.details.more}
          className="gap-1.5"
        >
          <MoreHorizontal className="size-4" />
          {t.plugins.details.more}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={copy(plugin.id)}>
          {t.plugins.details.moreCopyId}
        </DropdownMenuItem>
        {installRef ? (
          <DropdownMenuItem onSelect={copy(installRef)}>
            {t.plugins.details.moreCopyInstall}
          </DropdownMenuItem>
        ) : null}
        {github || homepage ? <DropdownMenuSeparator /> : null}
        {github ? (
          <DropdownMenuItem onSelect={open(github)}>
            {t.plugins.details.moreOpenSource}
          </DropdownMenuItem>
        ) : null}
        {homepage ? (
          <DropdownMenuItem onSelect={open(homepage)}>
            {t.plugins.details.moreOpenHomepage}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
