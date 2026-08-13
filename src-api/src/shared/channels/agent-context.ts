/**
 * Builds the `channelContext` attached to channel-routed agent runs.
 *
 * Single construction site so security-relevant fields can't be silently
 * dropped again: `permissionTier` and `identityId` feed the ConnectorPolicy
 * (`src-api/src/shared/auth/connector-policy.ts`), which fails closed when
 * the tier is missing — omitting them denies every gated connector
 * (schedule, Google, shared Slack user token) for ALL channel callers.
 */
import type { ChannelPermissionTier, ChannelUser } from '@/shared/db/types';

export interface AgentChannelContext {
  platform: string;
  conversationId: string;
  configId?: string;
  userId?: string;
  displayName?: string;
  botToken?: string;
  actionToken?: string;
  permissionTier: ChannelPermissionTier;
  identityId: string;
}

export function buildAgentChannelContext(args: {
  platform: string;
  conversationId: string;
  configId?: string;
  qualifiedUserId?: string;
  channelUser: ChannelUser;
  botToken?: string;
  actionToken?: string;
}): AgentChannelContext {
  return {
    platform: args.platform,
    conversationId: args.conversationId,
    configId: args.configId,
    userId: args.qualifiedUserId,
    displayName: args.channelUser.display_name ?? undefined,
    botToken: args.botToken,
    actionToken: args.actionToken,
    permissionTier: args.channelUser.permission_tier,
    identityId: args.channelUser.id,
  };
}
