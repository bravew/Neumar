import { describe, expect, it } from 'vitest';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(
  resolve(process.cwd(), 'src/config/style/global.css'),
  'utf8',
);
const settingsModal = readFileSync(
  resolve(process.cwd(), 'src/components/settings/SettingsModal.tsx'),
  'utf8',
);

describe('motion tokens', () => {
  it('fades the old page out before the new page fades in', () => {
    expect(css).toContain('--motion-fast: 120ms;');
    expect(css).toContain('--motion-base: 160ms;');
    expect(css).toContain('--motion-slow: 220ms;');
    expect(css).toContain(
      'animation: vt-fade-out var(--motion-fast) var(--ease-in) forwards;',
    );
    expect(css).toContain(
      'animation: vt-fade-in var(--motion-base) var(--ease-out) var(--motion-fast)',
    );
  });

  it('keeps reduced motion at 0.01ms', () => {
    expect(css).toContain('animation-duration: 0.01ms !important;');
    expect(css).not.toContain('animation-duration: 0ms');
  });

  it('points the settings modal at the base motion duration', () => {
    expect(settingsModal).toContain('duration: 0.16');
    expect(settingsModal).toContain('ease: [0, 0, 0.2, 1]');
  });
});
