import { describe, expect, it } from 'vitest';

import { wrapHtmlSrcdoc } from '@/components/artifacts/live/iframe-sandbox';

describe('IframeSandbox focus guard', () => {
  it('injects the focus suppression bootstrap before user HTML executes', () => {
    const srcdoc = wrapHtmlSrcdoc(
      '<script>window.focus();document.body.focus();</script>',
      'nonce_focus',
    );

    const guardIndex = srcdoc.indexOf('window.focus=function(){}');
    const userFocusIndex = srcdoc.indexOf('window.focus();');
    expect(guardIndex).toBeGreaterThan(-1);
    expect(userFocusIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeLessThan(userFocusIndex);
  });
});
