import * as Tabs from '@radix-ui/react-tabs';

import { InstalledPluginsTab, MarketplaceTab } from '@/components/library';
import { useLanguage } from '@/shared/providers/language-provider';

export function PluginSettings() {
  const { t } = useLanguage();

  return (
    <Tabs.Root defaultValue="installed" className="flex flex-col gap-4">
      <Tabs.List className="border-border flex gap-1 border-b">
        <PluginTabTrigger value="installed" label={t.plugins.tabs.installed} />
        <PluginTabTrigger
          value="marketplace"
          label={t.plugins.tabs.marketplace}
        />
      </Tabs.List>

      <Tabs.Content value="installed" className="outline-none">
        <InstalledPluginsTab />
      </Tabs.Content>
      <Tabs.Content value="marketplace" className="outline-none">
        <MarketplaceTab />
      </Tabs.Content>
    </Tabs.Root>
  );
}

function PluginTabTrigger({ value, label }: { value: string; label: string }) {
  return (
    <Tabs.Trigger
      value={value}
      className="text-muted-foreground hover:text-foreground data-[state=active]:border-foreground data-[state=active]:text-foreground cursor-pointer border-b-2 border-transparent px-3 py-2 text-sm font-medium transition-colors"
    >
      {label}
    </Tabs.Trigger>
  );
}
