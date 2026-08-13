import { describe, expect, it } from 'vitest';

import {
  getConnectorDenialMessage,
  resolveConnectorPolicy,
} from '@/shared/auth/connector-policy';

describe('resolveConnectorPolicy — fail-closed defaults', () => {
  it('denies all globally-scoped connectors when no input is provided', () => {
    const p = resolveConnectorPolicy(undefined);
    expect(p.allowGoogle).toBe(false);
    expect(p.allowNotion).toBe(false);
    expect(p.allowSlackUserToken).toBe(false);
    expect(p.allowScheduleCreate).toBe(false);
  });

  it('denies for an unknown platform', () => {
    const p = resolveConnectorPolicy({
      platform: 'parler',
      permissionTier: 'admin',
    });
    expect(p.allowGoogle).toBe(false);
  });

  it('denies for missing tier on a known channel platform', () => {
    const p = resolveConnectorPolicy({ platform: 'slack' });
    expect(p.allowGoogle).toBe(false);
    expect(p.allowSlackUserToken).toBe(false);
    expect(p.allowScheduleCreate).toBe(false);
  });
});

describe('resolveConnectorPolicy — §4 matrix', () => {
  it('desktop platform allows all connectors', () => {
    const p = resolveConnectorPolicy({ platform: 'desktop' });
    expect(p.allowGoogle).toBe(true);
    expect(p.allowNotion).toBe(true);
    expect(p.allowSlackUserToken).toBe(true);
    expect(p.allowScheduleCreate).toBe(true);
  });

  it('admin tier on slack allows all connectors', () => {
    const p = resolveConnectorPolicy({
      platform: 'slack',
      permissionTier: 'admin',
    });
    expect(p.allowGoogle).toBe(true);
    expect(p.allowNotion).toBe(true);
    expect(p.allowSlackUserToken).toBe(true);
    expect(p.allowScheduleCreate).toBe(true);
  });

  it('operator tier on slack denies all globally-scoped connectors', () => {
    const p = resolveConnectorPolicy({
      platform: 'slack',
      permissionTier: 'operator',
    });
    expect(p.allowGoogle).toBe(false);
    expect(p.allowNotion).toBe(false);
    expect(p.allowSlackUserToken).toBe(false);
    expect(p.allowScheduleCreate).toBe(false);
  });

  it('viewer tier on slack denies all globally-scoped connectors', () => {
    const p = resolveConnectorPolicy({
      platform: 'slack',
      permissionTier: 'viewer',
    });
    expect(p.allowGoogle).toBe(false);
  });

  it('denies for discord operator', () => {
    const p = resolveConnectorPolicy({
      platform: 'discord',
      permissionTier: 'operator',
    });
    expect(p.allowGoogle).toBe(false);
  });

  it('admin-tier automation run is allowed', () => {
    const p = resolveConnectorPolicy({
      platform: 'slack',
      permissionTier: 'admin',
      automationOrigin: true,
    });
    expect(p.allowGoogle).toBe(true);
  });

  it('non-admin automation does NOT escalate to admin', () => {
    const p = resolveConnectorPolicy({
      platform: 'slack',
      permissionTier: 'operator',
      automationOrigin: true,
    });
    expect(p.allowGoogle).toBe(false);
    expect(p.allowScheduleCreate).toBe(false);
  });
});

describe('getConnectorDenialMessage', () => {
  it('returns localised English copy by default', () => {
    const m = getConnectorDenialMessage('google');
    expect(m).toContain('Google Workspace');
    expect(m).toMatch(/Settings/);
  });

  it('returns Chinese copy for zh locale', () => {
    const m = getConnectorDenialMessage('google', 'zh');
    expect(m).toContain('Google Workspace');
    expect(m).toContain('设置');
  });

  it('falls back to generic when connector is unknown', () => {
    const m = getConnectorDenialMessage(
      'made-up-connector' as unknown as 'google',
      'en',
    );
    expect(m).toMatch(/connector/i);
  });

  it('falls back to English for unknown locale', () => {
    const m = getConnectorDenialMessage('google', 'xx');
    expect(m).toContain('Google Workspace');
  });
});
