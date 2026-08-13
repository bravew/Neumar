import { useEffect, useMemo, useState } from 'react';

import { Search } from 'lucide-react';

import { HotkeyRegistry } from '@/shared/hotkeys/HotkeyRegistry';
import type { ShortcutDefinition } from '@/shared/hotkeys/types';
import { useLanguage } from '@/shared/providers/language-provider';

import { KeyChip } from './KeyChip';

export function ShortcutSettings() {
  const { t, tt } = useLanguage();
  const [query, setQuery] = useState('');
  const [shortcuts, setShortcuts] = useState<ShortcutDefinition[]>(() =>
    HotkeyRegistry.list(),
  );

  useEffect(() => {
    return HotkeyRegistry.subscribe(() => setShortcuts(HotkeyRegistry.list()));
  }, []);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return shortcuts;
    return shortcuts.filter((shortcut) =>
      `${tt(shortcut.descriptionKey)} ${shortcut.chord} ${shortcut.group}`
        .toLowerCase()
        .includes(normalized),
    );
  }, [query, shortcuts, tt]);

  return (
    <div className="space-y-5">
      <p className="text-muted-foreground text-sm">
        {t.shortcuts.settingsDescription}
      </p>
      <label className="border-input bg-background flex h-10 items-center gap-2 rounded-lg border px-3 text-sm">
        <Search className="text-muted-foreground size-4" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t.shortcuts.searchPlaceholder}
          className="min-w-0 flex-1 bg-transparent outline-none"
        />
      </label>
      <div className="divide-border overflow-hidden rounded-lg border">
        {filtered.map((shortcut) => (
          <div
            key={shortcut.id}
            className="flex items-center justify-between gap-4 px-3 py-3"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">
                {tt(shortcut.descriptionKey)}
              </p>
              <p className="text-muted-foreground text-xs">
                {tt(`shortcuts.groups.${shortcut.group}`)}
              </p>
            </div>
            <KeyChip chord={shortcut.chord} />
          </div>
        ))}
      </div>
    </div>
  );
}
