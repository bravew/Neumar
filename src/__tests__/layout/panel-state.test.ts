import { describe, expect, it } from 'vitest';

import {
  cyclePanel,
  defaultPanelRecord,
  toggleFocus,
  type PanelRecord,
} from '@/shared/layout/panelState';

describe('panelState', () => {
  it('defaults to the rail plus the panel on a wide screen', () => {
    expect(defaultPanelRecord(1280)).toEqual({ state: 'A', restore: 'A' });
  });

  it('defaults to the rail only below 1100px', () => {
    expect(defaultPanelRecord(1099)).toEqual({ state: 'B', restore: 'B' });
  });

  it('cycles A to B to C and back to A', () => {
    const start: PanelRecord = { state: 'A', restore: 'A' };
    const rail = cyclePanel(start);
    expect(rail.state).toBe('B');
    const focus = cyclePanel(rail);
    expect(focus).toEqual({ state: 'C', restore: 'B' });
    expect(cyclePanel(focus).state).toBe('A');
  });

  it('hides with ⌘. and restores the previous state', () => {
    const wide: PanelRecord = { state: 'A', restore: 'A' };
    expect(toggleFocus(wide)).toEqual({ state: 'C', restore: 'A' });
    expect(toggleFocus({ state: 'C', restore: 'B' })).toEqual({
      state: 'B',
      restore: 'B',
    });
  });
});
