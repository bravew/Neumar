import { afterEach, describe, expect, it } from 'vitest';

import { wrapHtmlSrcdoc } from '@/components/artifacts/live/iframe-sandbox';
import { createPaletteBridgeScript } from '@/components/artifacts/live/palette-bridge';

describe('wrapHtmlSrcdoc', () => {
  afterEach(() => {
    document.head.innerHTML = '';
    document.documentElement.removeAttribute('style');
  });

  it('keeps output byte-equivalent when palette options are absent', () => {
    expect(wrapHtmlSrcdoc('<main>Hi</main>', 'nonce', 'off')).toBe(
      wrapHtmlSrcdoc('<main>Hi</main>', 'nonce', 'off', {}),
    );
  });

  it('prepends the palette bridge to the document head', () => {
    const srcdoc = wrapHtmlSrcdoc('<main>Hi</main>', 'nonce-123', 'off', {
      paletteBridge: createPaletteBridgeScript(),
    });

    expect(srcdoc.indexOf('<script>(function(){')).toBeLessThan(
      srcdoc.indexOf('<style>html,body'),
    );
    expect(srcdoc).toContain('var N="nonce-123"');
  });

  it('shifts and restores root CSS custom properties', () => {
    document.head.innerHTML = `
      <style>
        :root {
          --brand-accent: #ff3366;
          --space-md: 8px;
        }
        @media (prefers-color-scheme: dark) {
          :root { --brand-accent: #cc3344; }
        }
      </style>
    `;
    const script = createPaletteBridgeScript().replaceAll(
      '__NEUMA_PALETTE_NONCE__',
      'palette-test',
    );
    window.eval(script);

    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          nonce: 'palette-test',
          type: 'palette/apply',
          hue: 218,
          sat: 115,
          lightnessDelta: 0,
          desaturate: false,
        },
      }),
    );

    const sheet = document.styleSheets[0] as CSSStyleSheet;
    const rootRule = sheet.cssRules[0] as CSSStyleRule;
    const mediaRule = sheet.cssRules[1] as CSSMediaRule;
    const darkRootRule = mediaRule.cssRules[0] as CSSStyleRule;
    expect(rootRule.style.getPropertyValue('--brand-accent')).not.toBe(
      '#ff3366',
    );
    expect(darkRootRule.style.getPropertyValue('--brand-accent')).not.toBe(
      '#cc3344',
    );
    expect(rootRule.style.getPropertyValue('--space-md')).toBe('8px');

    window.dispatchEvent(
      new MessageEvent('message', {
        data: { nonce: 'palette-test', type: 'palette/reset' },
      }),
    );

    expect(rootRule.style.getPropertyValue('--brand-accent')).toBe('#ff3366');
    expect(darkRootRule.style.getPropertyValue('--brand-accent')).toBe(
      '#cc3344',
    );
    expect(rootRule.style.getPropertyValue('--space-md')).toBe('8px');
  });
});
