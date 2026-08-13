import type { BinderRunContext } from '@/shared/connectors/binder';
import { mintBridgeToken } from '@/shared/mcp/subprocess-bridge/token-store';

export function mintCodexConnectorToolToken(args: {
  context: BinderRunContext;
  connectorId: string;
  toolName?: string;
  connectedAccountId?: string;
  providerUserId?: string;
}): string {
  return mintBridgeToken({
    connector: 'connector',
    connectorScope: {
      connectorId: args.connectorId,
      toolName: args.toolName,
      connectedAccountId: args.connectedAccountId,
      userId: args.providerUserId,
    },
    policyContext: {
      platform: args.context.platform,
      permissionTier: args.context.permissionTier,
      identityId: args.context.identityId ?? args.context.accountId,
      automationOrigin: args.context.automationOrigin,
      channelId: args.context.configId ?? args.context.channelId,
    },
    locale: undefined,
    sessionId: args.context.runId,
  });
}
