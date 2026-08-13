import { describe, expect, it } from 'vitest';

import {
  createPaletteBridgeScript,
  PALETTE_PRESETS,
} from '@/components/artifacts/live/palette-bridge';

describe('palette bridge', () => {
  it('ships deterministic preset payloads', () => {
    expect(PALETTE_PRESETS.map((preset) => preset.id)).toEqual([
      'original',
      'coral',
      'electric',
      'acidForest',
      'risograph',
      'monoNoir',
    ]);
    expect(
      PALETTE_PRESETS.find((preset) => preset.id === 'monoNoir'),
    ).toMatchObject({
      request: { type: 'palette/apply', desaturate: true },
    });
  });

  it('contains the stylesheet walker, mutation observer, and reset path', () => {
    const script = createPaletteBridgeScript();

    expect(script).toContain('document.styleSheets');
    expect(script).toContain('MutationObserver');
    expect(script).toContain('palette/reset');
    expect(script).toContain('__NEUMA_PALETTE_NONCE__');
  });
});
