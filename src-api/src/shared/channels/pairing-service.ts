import {
  approveChannelUser,
  createPairingCode,
  markPairingCodeUsed,
  verifyPairingCode,
} from '@/shared/db/operations';
import type { ChannelPlatform, ChannelUser } from '@/shared/db/types';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('PairingService');

export function generatePairingCode(
  configId: string,
  platform: ChannelPlatform,
  platformUserId: string,
): string {
  const record = createPairingCode(configId, platform, platformUserId);
  logger.info(
    `Generated pairing code for ${platform}:${platformUserId} (config ${configId.slice(0, 8)})`,
  );
  return record.code;
}

export function verifyAndPair(
  code: string,
  displayName?: string,
): { success: boolean; user?: ChannelUser } {
  const record = verifyPairingCode(code);
  if (!record) {
    logger.warn(`Invalid or expired pairing code: ${code}`);
    return { success: false };
  }
  markPairingCodeUsed(code);
  const user = approveChannelUser(
    record.config_id ?? '',
    record.platform,
    record.platform_user_id,
    displayName,
  );
  logger.info(`Paired user ${record.platform_user_id} on ${record.platform}`);
  return { success: true, user };
}

/**
 * Verify a pairing code sent by a bot user. The code may have been generated
 * by the bot (with the user's platform_user_id stored) or by the desktop app
 * (with the platform_user_id pre-filled for the expected user).
 *
 * Falls back to using the supplied platform/userId if the code's stored
 * platform_user_id is empty or 'pending'.
 */
export function verifyAndPairFromBot(
  code: string,
  configId: string,
  platform: string,
  platformUserId: string,
  displayName: string,
): { success: boolean; user?: ChannelUser } {
  const record = verifyPairingCode(code);
  if (!record) {
    logger.warn(`Invalid or expired pairing code: ${code}`);
    return { success: false };
  }

  // Determine actual user to approve
  const userId =
    record.platform_user_id && record.platform_user_id !== 'pending'
      ? record.platform_user_id
      : platformUserId;
  const actualConfigId = record.config_id ?? configId;
  const actualPlatform = (record.platform ?? platform) as ChannelPlatform;

  markPairingCodeUsed(code);
  const user = approveChannelUser(
    actualConfigId,
    actualPlatform,
    userId,
    displayName || undefined,
  );
  logger.info(
    `Paired user ${userId} on ${actualPlatform} (config ${actualConfigId.slice(0, 8)}) via bot command`,
  );
  return { success: true, user };
}

export class PairingService {
  verifyAndPair(
    code: string,
    configId: string,
    platform: string,
    platformUserId: string,
    displayName: string,
  ): { success: boolean; user?: ChannelUser } {
    return verifyAndPairFromBot(
      code,
      configId,
      platform,
      platformUserId,
      displayName,
    );
  }
}

let _pairingService: PairingService | null = null;

export function getPairingService(): PairingService {
  return (_pairingService ??= new PairingService());
}
