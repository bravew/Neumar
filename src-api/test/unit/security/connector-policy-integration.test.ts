import { describe, expect, it, vi } from 'vitest';

import { resolveConnectorPolicy } from '@/shared/auth/connector-policy';

/**
 * Phase D regression test for the connector-tier gate. These tests pin the
 * security-critical paths so a future refactor can't silently regress the
 * fail-closed posture documented in
 * `dev-doc/plan/2026-04-28-connector-tier-isolation.md`.
 */

vi.mock('@/shared/db/operations', () => ({
  getSetting: vi.fn(() => null),
  saveSetting: vi.fn(),
}));

describe('connector-policy regression — operator on Slack must NOT access Google', () => {
  it('denies Google MCP for operator-tier inbound Slack message', () => {
    const policy = resolveConnectorPolicy({
      platform: 'slack',
      permissionTier: 'operator',
      channelId: 'T0123ABCD',
    });
    expect(policy.allowGoogle).toBe(false);
    expect(policy.allowNotion).toBe(false);
    expect(policy.allowSlackUserToken).toBe(false);
    expect(policy.allowScheduleCreate).toBe(false);
  });

  it('denies for viewer-tier as well', () => {
    const policy = resolveConnectorPolicy({
      platform: 'slack',
      permissionTier: 'viewer',
    });
    expect(policy.allowGoogle).toBe(false);
  });

  it('allows for admin-tier same channel', () => {
    const policy = resolveConnectorPolicy({
      platform: 'slack',
      permissionTier: 'admin',
    });
    expect(policy.allowGoogle).toBe(true);
  });

  it('blocks scheduled non-admin automation runs', () => {
    const policy = resolveConnectorPolicy({
      platform: 'slack',
      permissionTier: 'operator',
      automationOrigin: true,
    });
    expect(policy.allowScheduleCreate).toBe(false);
    expect(policy.allowGoogle).toBe(false);
  });
});
