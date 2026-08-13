import { useEffect, useRef } from 'react';

import { HotkeyRegistry } from './HotkeyRegistry';
import type { ShortcutDefinition } from './types';

export function useShortcut(definition: ShortcutDefinition) {
  const { id, chord, scope, descriptionKey, group, ignoreInEditable, handler } =
    definition;
  const handlerRef = useRef(definition.handler);
  handlerRef.current = handler;

  useEffect(() => {
    return HotkeyRegistry.register({
      id,
      chord,
      scope,
      descriptionKey,
      group,
      ignoreInEditable,
      handler: (event) => handlerRef.current(event),
    });
  }, [chord, descriptionKey, group, id, ignoreInEditable, scope]);
}
