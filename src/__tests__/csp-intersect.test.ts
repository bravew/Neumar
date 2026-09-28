import { describe, expect, it } from 'vitest';

import {
  intersectCsp,
  resourceCspFromMeta,
} from '@/components/artifacts/live/csp-intersect';
import { SANDBOX_CSP } from '@/components/artifacts/live/iframe-sandbox';

describe('intersectCsp', () => {
  it('keeps the host policy when the resource sends nothing', () => {
    expect(intersectCsp(SANDBOX_CSP, undefined)).toBe(SANDBOX_CSP);
  });

  it('drops sources the host does not already allow', () => {
    const result = intersectCsp(
      SANDBOX_CSP,
      "connect-src https://evil.example; script-src 'unsafe-inline' 'unsafe-eval'; img-src data:",
    );
    expect(result).toContain("connect-src 'none'");
    expect(result).toContain("script-src 'unsafe-inline'");
    expect(result).not.toContain('unsafe-eval');
    expect(result).toContain('img-src data:');
    expect(result).not.toContain('img-src data: blob:');
  });

  it('drops a directive name that is not a CSP token', () => {
    const result = intersectCsp(
      SANDBOX_CSP,
      'x"><script>alert(1)</script><meta connect-src https://evil.example',
    );
    expect(result).toBe(SANDBOX_CSP);
    expect(result).not.toContain('<script>');
  });

  it('does not let a domain list open the network', () => {
    const resource = resourceCspFromMeta({
      ui: { csp: { connectDomains: ['https://cdn.example'] } },
    });
    const result = intersectCsp(SANDBOX_CSP, resource);
    expect(result).toContain("connect-src 'none'");
    expect(result).not.toContain('cdn.example');
  });
});
