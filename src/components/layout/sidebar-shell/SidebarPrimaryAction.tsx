import { useNavigate } from 'react-router-dom';

import { useMode } from '@/shared/modes/useMode';
import { useLanguage } from '@/shared/providers/language-provider';

export function SidebarPrimaryAction() {
  const navigate = useNavigate();
  const { activeMode } = useMode();
  const { tt, t } = useLanguage();

  return (
    <button
      type="button"
      onClick={() =>
        activeMode.sidebar.primaryAction.onSelect({
          navigate,
          openSettings: () =>
            window.dispatchEvent(new CustomEvent('open-settings')),
          t,
        })
      }
      className="bg-primary text-primary-foreground hover:bg-primary/90 flex h-9 w-full cursor-pointer items-center justify-center rounded-lg px-3 text-sm font-medium transition-colors"
    >
      {tt(activeMode.sidebar.primaryAction.labelKey)}
    </button>
  );
}
