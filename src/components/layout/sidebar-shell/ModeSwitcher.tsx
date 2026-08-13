import { useMemo } from 'react';

import { useNavigate } from 'react-router-dom';

import { Check, ChevronDown } from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { formatChord } from '@/shared/hotkeys/format';
import { useShortcut } from '@/shared/hotkeys/useShortcut';
import { cn } from '@/shared/lib/utils';
import type { ModeDefinition } from '@/shared/modes/types';
import { useMode } from '@/shared/modes/useMode';
import { useLanguage } from '@/shared/providers/language-provider';

function ModeShortcut({ mode }: { mode: ModeDefinition }) {
  const navigate = useNavigate();
  const slot = mode.shortcutSlot ?? 1;
  useShortcut({
    id: `mode.switch.${mode.id}`,
    chord: `mod+${slot}`,
    scope: 'global',
    descriptionKey: mode.labelKey,
    group: 'mode',
    handler: () => navigate(mode.rootPath),
  });
  return null;
}

export function ModeSwitcher() {
  const { activeMode, modes, setActiveMode } = useMode();
  const { tt } = useLanguage();
  const switcherModes = useMemo(
    () => modes.filter((mode) => mode.shortcutSlot),
    [modes],
  );
  const ActiveIcon = activeMode.icon;
  const activeLabel = tt(activeMode.labelKey);

  return (
    <div aria-label={tt('modes.switcherLabel')}>
      {switcherModes.map((mode) => (
        <ModeShortcut key={mode.id} mode={mode} />
      ))}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="border-sidebar-border bg-sidebar-accent/60 text-sidebar-foreground hover:bg-sidebar-accent focus-visible:ring-primary/40 flex h-10 w-full min-w-0 items-center gap-2 rounded-lg border px-3 text-left text-sm font-medium transition-colors outline-none focus-visible:ring-2"
            aria-label={`${tt('modes.switcherLabel')}: ${activeLabel}`}
          >
            <ActiveIcon className="text-primary size-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{activeLabel}</span>
            <ChevronDown className="text-muted-foreground size-4 shrink-0" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" sideOffset={6} className="w-56">
          {modes.map((mode) => {
            const Icon = mode.icon;
            const label = tt(mode.labelKey);
            const shortcut = mode.shortcutSlot
              ? formatChord(`mod+${mode.shortcutSlot}`)
              : null;
            const active = activeMode.id === mode.id;
            return (
              <DropdownMenuItem
                key={mode.id}
                onSelect={() => setActiveMode(mode.id)}
                className="gap-2"
              >
                <Icon
                  className={cn(
                    'size-4',
                    active ? 'text-primary' : 'text-muted-foreground',
                  )}
                />
                <span className="min-w-0 flex-1 truncate">{label}</span>
                {shortcut ? (
                  <DropdownMenuShortcut>{shortcut}</DropdownMenuShortcut>
                ) : null}
                {active ? <Check className="text-primary size-4" /> : null}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
