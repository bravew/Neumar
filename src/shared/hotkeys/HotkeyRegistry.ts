import { normalizeChord } from './chord';
import type { ShortcutDefinition, ShortcutScope } from './types';

type ShortcutListener = () => void;

const shortcuts = new Map<string, ShortcutDefinition>();
const listeners = new Set<ShortcutListener>();
let version = 0;

function emitChange() {
  version += 1;
  for (const listener of listeners) listener();
}

function conflictKey(definition: ShortcutDefinition): string {
  return `${definition.scope}:${normalizeChord(definition.chord)}`;
}

export const HotkeyRegistry = {
  register(definition: ShortcutDefinition): () => void {
    const nextConflictKey = conflictKey(definition);
    const conflict = Array.from(shortcuts.values()).find(
      (existing) =>
        existing.id !== definition.id &&
        conflictKey(existing) === nextConflictKey,
    );

    if (conflict) {
      const message = `[HotkeyRegistry] Shortcut conflict: ${definition.id} and ${conflict.id} both use ${definition.chord} in ${definition.scope}`;
      if (
        import.meta.env.MODE === 'test' &&
        import.meta.env.NEUMA_HOTKEY_STRICT === '1'
      ) {
        throw new Error(message);
      }
      if (import.meta.env.DEV) console.warn(message);
    }

    shortcuts.set(definition.id, {
      ...definition,
      chord: normalizeChord(definition.chord),
      ignoreInEditable: definition.ignoreInEditable ?? true,
    });
    emitChange();
    return () => HotkeyRegistry.unregister(definition.id);
  },

  unregister(id: string): void {
    shortcuts.delete(id);
    emitChange();
  },

  clear(): void {
    shortcuts.clear();
    emitChange();
  },

  list(): ShortcutDefinition[] {
    return Array.from(shortcuts.values());
  },

  version(): number {
    return version;
  },

  subscribe(listener: ShortcutListener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  matchesScope(definition: ShortcutDefinition, activeModeId: string): boolean {
    const activeModeScope: ShortcutScope = `mode:${activeModeId}`;
    return (
      definition.scope === 'global' ||
      definition.scope === 'composer' ||
      definition.scope === 'overlay' ||
      definition.scope === activeModeScope
    );
  },
};

export function normalizeKeyChord(chord: string): string {
  return normalizeChord(chord);
}
