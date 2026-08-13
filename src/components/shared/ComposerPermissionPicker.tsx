import { useCallback, useState } from 'react';

import { ShieldCheck } from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  getSettings,
  saveSettings,
  useSettingsValue,
  type Settings,
} from '@/shared/db/settings';
import { useShortcut } from '@/shared/hotkeys/useShortcut';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

type PermissionId = 'ask' | 'autoAcceptEdits' | 'plan' | 'auto' | 'bypass';

const PERMISSION_MODES: Array<{
  id: PermissionId;
  planMode?: Settings['planMode'];
  supported: boolean;
}> = [
  { id: 'ask', planMode: 'off', supported: true },
  { id: 'autoAcceptEdits', supported: false },
  { id: 'plan', planMode: 'on', supported: true },
  { id: 'auto', planMode: 'auto', supported: true },
  { id: 'bypass', supported: false },
];

function activePermissionId(planMode: Settings['planMode']): PermissionId {
  if (planMode === 'off') return 'ask';
  if (planMode === 'auto') return 'auto';
  return 'plan';
}

export function ComposerPermissionPicker({
  disabled,
  isRunning,
}: {
  disabled: boolean;
  isRunning: boolean;
}) {
  const { tt } = useLanguage();
  const settings = useSettingsValue();
  const [open, setOpen] = useState(false);
  const activeId = activePermissionId(settings.planMode ?? 'on');
  const activeLabel = tt(`composer.permissionMode.${activeId}`);

  useShortcut({
    id: 'composer.permissionMode.open',
    chord: 'mod+shift+m',
    scope: 'global',
    descriptionKey: 'shortcuts.permissionMode.description',
    group: 'composer',
    ignoreInEditable: false,
    handler: () => {
      if (!disabled && !isRunning) setOpen(true);
    },
  });

  const selectMode = useCallback((planMode: Settings['planMode']) => {
    saveSettings({ ...getSettings(), planMode });
  }, []);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled || isRunning}
          aria-label={tt('composer.permissionMode.label')}
          className={cn(
            'border-border/60 text-muted-foreground hover:bg-accent hover:text-foreground flex h-8 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50',
            activeId === 'auto' && 'border-amber-400/50 bg-amber-400/10',
          )}
        >
          <ShieldCheck className="size-3.5" />
          <span>{activeLabel}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {PERMISSION_MODES.map((mode) => (
          <DropdownMenuItem
            key={mode.id}
            disabled={!mode.supported}
            onSelect={() => {
              if (mode.planMode) selectMode(mode.planMode);
            }}
            className="cursor-pointer justify-between"
          >
            <span>{tt(`composer.permissionMode.${mode.id}`)}</span>
            {!mode.supported && (
              <span className="text-muted-foreground text-xs">
                {tt('composer.permissionMode.readOnly')}
              </span>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
