export type TimelineKeyboardAction =
  | 'add-marker'
  | 'clear-output-range'
  | 'set-output-in'
  | 'set-output-out'
  | 'copy'
  | 'cut'
  | 'delete-selection'
  | 'paste'
  | 'redo'
  | 'ripple-delete'
  | 'select-all'
  | 'select-tool'
  | 'razor-tool'
  | 'split-at-playhead'
  | 'step-back-10frames'
  | 'step-back-frame'
  | 'step-forward-10frames'
  | 'step-forward-frame'
  | 'toggle-snap'
  | 'undo';

export function resolveTimelineKeyboardAction(
  event: Pick<
    KeyboardEvent,
    'altKey' | 'ctrlKey' | 'key' | 'metaKey' | 'shiftKey'
  >,
): TimelineKeyboardAction | null {
  if (event.altKey) return null;
  const key = normalizeKey(event.key);
  const mod = event.metaKey || event.ctrlKey;

  if (mod) {
    if (!event.shiftKey && key === 'a') return 'select-all';
    if (!event.shiftKey && key === 'c') return 'copy';
    if (!event.shiftKey && key === 'x') return 'cut';
    if (!event.shiftKey && key === 'v') return 'paste';
    if (!event.shiftKey && (key === 'b' || key === 'k')) {
      return 'split-at-playhead';
    }
    if (!event.shiftKey && key === 'z') return 'undo';
    if ((event.shiftKey && key === 'z') || (!event.shiftKey && key === 'y')) {
      return 'redo';
    }
    return null;
  }

  if (key === 'delete' || key === 'backspace') {
    return event.shiftKey ? 'ripple-delete' : 'delete-selection';
  }
  if (!event.shiftKey && key === 'v') return 'select-tool';
  if (!event.shiftKey && (key === 'b' || key === 'c')) return 'razor-tool';
  if (!event.shiftKey && key === 'm') return 'add-marker';
  // I/O follow the convention every NLE uses for in and out points; Shift+X
  // clears the range, matching Premiere's "clear in and out".
  if (!event.shiftKey && key === 'i') return 'set-output-in';
  if (!event.shiftKey && key === 'o') return 'set-output-out';
  if (event.shiftKey && key === 'x') return 'clear-output-range';
  if (!event.shiftKey && (key === 's' || key === 'n')) return 'toggle-snap';
  if (key === 'arrowleft' || key === ',') {
    return event.shiftKey ? 'step-back-10frames' : 'step-back-frame';
  }
  if (key === 'arrowright' || key === '.') {
    return event.shiftKey ? 'step-forward-10frames' : 'step-forward-frame';
  }
  return null;
}

function normalizeKey(key: string): string {
  return key.toLowerCase();
}
