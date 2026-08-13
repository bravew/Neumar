import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { HotkeyRegistry } from '@/shared/hotkeys/HotkeyRegistry';
import type { ShortcutDefinition } from '@/shared/hotkeys/types';
import { useShortcut } from '@/shared/hotkeys/useShortcut';
import { useLanguage } from '@/shared/providers/language-provider';

import { ShortcutGroup } from './ShortcutGroup';

function groupShortcuts(shortcuts: ShortcutDefinition[]) {
  const groups = new Map<string, ShortcutDefinition[]>();
  for (const shortcut of shortcuts) {
    const entries = groups.get(shortcut.group) ?? [];
    entries.push(shortcut);
    groups.set(shortcut.group, entries);
  }
  return Array.from(groups.entries());
}

export function ShortcutOverlay() {
  const [open, setOpen] = useState(false);
  const [shortcuts, setShortcuts] = useState(() => HotkeyRegistry.list());
  const { t } = useLanguage();

  useShortcut({
    id: 'overlay.shortcuts',
    chord: 'mod+/',
    scope: 'global',
    descriptionKey: 'shortcuts.overlayShortcuts.description',
    group: 'navigation',
    handler: () => setOpen(true),
  });

  useEffect(() => {
    return HotkeyRegistry.subscribe(() => setShortcuts(HotkeyRegistry.list()));
  }, []);

  const groups = groupShortcuts(shortcuts);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[80vh] overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t.shortcuts.title}</DialogTitle>
        </DialogHeader>
        <div className="scrollbar-hide space-y-5 overflow-y-auto pr-1">
          {groups.map(([group, groupShortcuts]) => (
            <ShortcutGroup
              key={group}
              group={group}
              shortcuts={groupShortcuts}
            />
          ))}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setOpen(false);
              window.dispatchEvent(
                new CustomEvent('open-settings', { detail: 'keyboard' }),
              );
            }}
          >
            {t.shortcuts.openKeyboardSettings}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
