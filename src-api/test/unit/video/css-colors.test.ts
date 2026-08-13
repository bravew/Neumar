import { describe, expect, it } from 'vitest';

import { normalizeCssColor } from '@/shared/video/css-colors';

describe('normalizeCssColor', () => {
  it('maps CSS named colors to hex', () => {
    expect(normalizeCssColor('green')).toBe('#008000');
    expect(normalizeCssColor('Green')).toBe('#008000');
    expect(normalizeCssColor('rebeccapurple')).toBe('#663399');
  });

  it('expands #rgb and lowercases #rrggbb', () => {
    expect(normalizeCssColor('#0F0')).toBe('#00ff00');
    expect(normalizeCssColor('#FFD166')).toBe('#ffd166');
  });

  it('converts rgb()/rgba() to hex', () => {
    expect(normalizeCssColor('rgb(0, 128, 0)')).toBe('#008000');
    expect(normalizeCssColor('rgba(255, 209, 102, 0.5)')).toBe('#ffd166');
    expect(normalizeCssColor('rgb(999, 0, 0)')).toBe('#ff0000');
  });

  it('passes unknown strings through unchanged', () => {
    expect(normalizeCssColor('hsl(120, 100%, 25%)')).toBe(
      'hsl(120, 100%, 25%)',
    );
    expect(normalizeCssColor('brand-primary')).toBe('brand-primary');
  });
});
