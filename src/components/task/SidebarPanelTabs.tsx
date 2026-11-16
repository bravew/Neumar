import { useLanguage } from '@/shared/providers/language-provider';

type SidebarPanel = 'activity' | 'files';

export function SidebarPanelTabs({
  panel,
  onSelect,
}: {
  panel: SidebarPanel;
  onSelect: (panel: SidebarPanel) => void;
}) {
  const { t } = useLanguage();

  return (
    <div
      role="tablist"
      aria-label={t.task.panelActivity}
      className="border-border/50 flex shrink-0 gap-1 border-b px-3 py-2"
    >
      {(['activity', 'files'] as const).map((name) => (
        <button
          key={name}
          type="button"
          role="tab"
          aria-selected={panel === name}
          className={
            panel === name
              ? 'bg-accent text-foreground rounded-md px-2.5 py-1 text-sm font-medium'
              : 'text-muted-foreground hover:text-foreground rounded-md px-2.5 py-1 text-sm'
          }
          onClick={() => onSelect(name)}
        >
          {name === 'activity' ? t.task.panelActivity : t.task.panelFiles}
        </button>
      ))}
    </div>
  );
}
