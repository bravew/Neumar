import * as Tabs from '@radix-ui/react-tabs';

import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

type SidebarPanel = 'activity' | 'files';

const PANELS = ['activity', 'files'] as const;

export function SidebarPanelTabs({
  panel,
  onSelect,
}: {
  panel: SidebarPanel;
  onSelect: (panel: SidebarPanel) => void;
}) {
  const { t } = useLanguage();

  return (
    <Tabs.Root
      value={panel}
      onValueChange={(value) => onSelect(value as SidebarPanel)}
      className="shrink-0"
    >
      <Tabs.List
        aria-label={t.task.panelActivity}
        className="border-border/50 flex shrink-0 gap-1 border-b px-3 py-2"
      >
        {PANELS.map((name) => (
          <Tabs.Trigger
            key={name}
            value={name}
            className={cn(
              'text-muted-foreground hover:text-foreground rounded-md px-2.5 py-1 text-sm',
              'data-[state=active]:bg-accent data-[state=active]:text-foreground data-[state=active]:font-medium',
            )}
          >
            {name === 'activity' ? t.task.panelActivity : t.task.panelFiles}
          </Tabs.Trigger>
        ))}
      </Tabs.List>
    </Tabs.Root>
  );
}
