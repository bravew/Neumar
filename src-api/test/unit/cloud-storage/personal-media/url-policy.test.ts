import { describe, expect, it } from 'vitest';

import { validatePersonalMediaBaseUrl } from '@/shared/integrations/cloud-storage/personal-media/url-policy';

describe('validatePersonalMediaBaseUrl', () => {
  it('allows external HTTPS URLs', () => {
    expect(validatePersonalMediaBaseUrl('https://photos.example.com')).toEqual({
      valid: true,
      lanReachable: false,
    });
  });

  it('allows LAN URLs only with explicit opt-in', () => {
    expect(validatePersonalMediaBaseUrl('http://192.168.1.10:2283')).toEqual({
      valid: false,
      reason: 'lan_url_requires_explicit_opt_in',
    });
    expect(
      validatePersonalMediaBaseUrl('http://192.168.1.10:2283', {
        allowLan: true,
      }),
    ).toEqual({ valid: true, lanReachable: true });
  });

  it('allows Tailscale MagicDNS hostnames as LAN when opted in', () => {
    expect(
      validatePersonalMediaBaseUrl('https://immich.tailnet.ts.net', {
        allowLan: true,
      }),
    ).toEqual({ valid: true, lanReachable: true });
  });

  it('blocks metadata and credential-bearing URLs', () => {
    expect(
      validatePersonalMediaBaseUrl('http://169.254.169.254/latest', {
        allowLan: true,
      }),
    ).toEqual({ valid: false, reason: 'metadata_host_blocked' });
    expect(
      validatePersonalMediaBaseUrl('https://user:pass@photos.example.com'),
    ).toEqual({ valid: false, reason: 'credentials_not_allowed' });
  });

  it('requires HTTPS for non-LAN URLs', () => {
    expect(validatePersonalMediaBaseUrl('http://photos.example.com')).toEqual({
      valid: false,
      reason: 'https_required',
    });
  });
});
