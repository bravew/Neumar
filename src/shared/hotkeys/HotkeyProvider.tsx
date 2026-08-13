import { useEffect, type ReactNode } from 'react';

import { useMode } from '@/shared/modes/useMode';

import { matchesChord } from './chord';
import { HotkeyRegistry } from './HotkeyRegistry';

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return (
    tagName === 'input' ||
    tagName === 'textarea' ||
    tagName === 'select' ||
    target.isContentEditable
  );
}

export function HotkeyProvider({ children }: { children: ReactNode }) {
  const { activeMode } = useMode();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const editable = isEditableTarget(event.target);
      const match = HotkeyRegistry.list().find(
        (definition) =>
          HotkeyRegistry.matchesScope(definition, activeMode.id) &&
          matchesChord(event, definition.chord) &&
          !(definition.ignoreInEditable && editable),
      );

      if (!match) return;
      event.preventDefault();
      event.stopPropagation();
      match.handler(event);
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [activeMode.id]);

  return <>{children}</>;
}
