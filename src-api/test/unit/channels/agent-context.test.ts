/**
 * buildAgentChannelContext — regression for the missing-tier propagation bug.
 *
 * The active channels runtime (channel-manager) used to build the agent
 * run's channelContext without `permissionTier`/`identityId`, so the
 * ConnectorPolicy fail-closed path denied every gated connector (schedule,
 * Google, Slack user token) for ALL channel callers regardless of their
 * actual tier. The context is now built by this helper, whose contract
 * requires the resolved ChannelUser.
 */
import { describe, expect, it } from 'vitest';

import { buildAgentChannelContext } from '@/shared/channels/agent-context';
import type { ChannelUser } from '@/shared/db/types';

const channelUser: ChannelUser = {
  id: 'identity-1',
  platform: 'slack',
  config_id: 'cfg-1',
  platform_user_id: 'U09QX07DFDE',
  display_name: 'Yong Wang',
  approved_at: '2026-04-28 00:28:01',
  permission_tier: 'operator',
  token_budget: 0,
  tokens_used_today: 0,
  tokens_period_start: null,
};

describe('buildAgentChannelContext', () => {
  it('propagates the caller permission tier and identity id', () => {
    const ctx = buildAgentChannelContext({
      platform: 'slack',
      conversationId: 'C0AT2S0QFS9:1776289753.127889',
      configId: 'cfg-1',
      qualifiedUserId: 'TPWPNU0NT:U09QX07DFDE',
      channelUser,
      botToken: 'xoxb-test',
      actionToken: 'tok-1',
    });

    expect(ctx.permissionTier).toBe('operator');
    expect(ctx.identityId).toBe('identity-1');
    expect(ctx.platform).toBe('slack');
    expect(ctx.conversationId).toBe('C0AT2S0QFS9:1776289753.127889');
    expect(ctx.userId).toBe('TPWPNU0NT:U09QX07DFDE');
    expect(ctx.displayName).toBe('Yong Wang');
    expect(ctx.botToken).toBe('xoxb-test');
    expect(ctx.actionToken).toBe('tok-1');
  });

  it('keeps optional fields undefined when absent (non-Slack platforms)', () => {
    const ctx = buildAgentChannelContext({
      platform: 'telegram',
      conversationId: '6470837883',
      channelUser: { ...channelUser, platform: 'telegram', display_name: null },
    });

    expect(ctx.permissionTier).toBe('operator');
    expect(ctx.identityId).toBe('identity-1');
    expect(ctx.botToken).toBeUndefined();
    expect(ctx.actionToken).toBeUndefined();
    expect(ctx.displayName).toBeUndefined();
  });
});
