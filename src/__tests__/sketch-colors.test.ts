import { describe, expect, it } from 'vitest';

import { resolveDefaultSketchToolColor } from '@/components/design/sketch-colors';

describe('resolveDefaultSketchToolColor', () => {
  it('uses higher-contrast defaults for dark sketch canvases', () => {
    expect(resolveDefaultSketchToolColor('pen', 'light')).toBe('#1D4ED8');
    expect(resolveDefaultSketchToolColor('pen', 'dark')).toBe('#93C5FD');
    expect(resolveDefaultSketchToolColor('highlight', 'dark')).toBe('#FDE68A');
  });
});
