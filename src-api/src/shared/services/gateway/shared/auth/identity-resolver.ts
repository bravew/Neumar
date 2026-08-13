/**
 * Identity Resolver
 *
 * Maps channel-specific user IDs to gateway identities.
 * Creates auto-identities for unknown senders.
 */

import { createLogger } from '@/shared/utils/logger';

import type {
  GatewayIdentity,
  InboundMessage,
  PermissionTier,
} from '../../channels/types';
import * as db from '../db/operations';

const logger = createLogger('IdentityResolver');

export function resolveIdentity(
  message: InboundMessage,
  defaultTier: PermissionTier,
): GatewayIdentity | null {
  // Look up existing identity by channel + user ID
  const existing = db.getIdentityByChannelUser(
    message.channelId,
    message.senderId,
  );
  if (existing) return existing;

  // Auto-create identity for unknown senders with default tier
  const id = crypto.randomUUID();
  const linkId = crypto.randomUUID();

  const identity = db.createIdentity(id, message.senderName, defaultTier, 0);
  db.linkIdentityChannel(
    linkId,
    id,
    message.channelId,
    message.senderId,
    message.senderName,
  );

  logger.info(
    `Auto-created identity ${id} for ${message.channelId}:${message.senderId} (${message.senderName})`,
  );
  return identity;
}
