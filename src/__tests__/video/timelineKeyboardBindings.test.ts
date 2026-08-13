import { describe, expect, it } from 'vitest';

import { resolveTimelineKeyboardAction } from '@/components/video/timeline/timelineKeyboardBindings';

describe('resolveTimelineKeyboardAction', () => {
  it.each([
    [{ key: 'a', metaKey: true }, 'select-all'],
    [{ key: 'c', metaKey: true }, 'copy'],
    [{ key: 'x', metaKey: true }, 'cut'],
    [{ key: 'v', metaKey: true }, 'paste'],
    [{ key: 'b', metaKey: true }, 'split-at-playhead'],
    [{ key: 'k', metaKey: true }, 'split-at-playhead'],
    [{ key: 'z', metaKey: true }, 'undo'],
    [{ key: 'z', metaKey: true, shiftKey: true }, 'redo'],
    [{ key: 'y', ctrlKey: true }, 'redo'],
    [{ key: 'Backspace' }, 'delete-selection'],
    [{ key: 'Delete', shiftKey: true }, 'ripple-delete'],
    [{ key: 'v' }, 'select-tool'],
    [{ key: 'b' }, 'razor-tool'],
    [{ key: 'c' }, 'razor-tool'],
    [{ key: 'm' }, 'add-marker'],
    [{ key: 's' }, 'toggle-snap'],
    [{ key: 'n' }, 'toggle-snap'],
    [{ key: 'ArrowLeft' }, 'step-back-frame'],
    [{ key: ',', shiftKey: true }, 'step-back-10frames'],
    [{ key: 'ArrowRight' }, 'step-forward-frame'],
    [{ key: '.', shiftKey: true }, 'step-forward-10frames'],
  ] as const)('maps %j to %s', (event, action) => {
    expect(resolveTimelineKeyboardAction(keyboardEvent(event))).toBe(action);
  });

  it('ignores unrelated modifiers and unknown keys', () => {
    expect(
      resolveTimelineKeyboardAction(keyboardEvent({ key: 'a' })),
    ).toBeNull();
    expect(
      resolveTimelineKeyboardAction(keyboardEvent({ key: 'm', altKey: true })),
    ).toBeNull();
    expect(
      resolveTimelineKeyboardAction(keyboardEvent({ key: 'q', metaKey: true })),
    ).toBeNull();
  });
});

function keyboardEvent(
  event: Partial<
    Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'key' | 'metaKey' | 'shiftKey'>
  >,
): Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'key' | 'metaKey' | 'shiftKey'> {
  return {
    altKey: false,
    ctrlKey: false,
    key: '',
    metaKey: false,
    shiftKey: false,
    ...event,
  };
}
