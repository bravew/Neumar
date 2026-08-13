import type { ShortcutDefinition } from '@/shared/hotkeys/types';
import { useLanguage } from '@/shared/providers/language-provider';

import { KeyChip } from './KeyChip';

interface ShortcutGroupProps {
  group: string;
  shortcuts: ShortcutDefinition[];
}

export function ShortcutGroup({ group, shortcuts }: ShortcutGroupProps) {
  const { tt } = useLanguage();

  return (
    <section className="space-y-2">
      <h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
        {tt(`shortcuts.groups.${group}`)}
      </h3>
      <div className="divide-border overflow-hidden rounded-lg border">
        {shortcuts.map((shortcut) => (
          <div
            key={shortcut.id}
            className="flex items-center justify-between gap-4 px-3 py-2.5"
          >
            <span className="text-sm">{tt(shortcut.descriptionKey)}</span>
            <KeyChip chord={shortcut.chord} />
          </div>
        ))}
      </div>
    </section>
  );
}
