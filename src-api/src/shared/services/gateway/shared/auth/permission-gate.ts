/**
 * Permission Gate
 *
 * Tier-based command authorization.
 */

import type { PermissionTier } from '../../channels/types';
import { TIER_PERMISSIONS } from '../../channels/types';

export function hasPermission(tier: PermissionTier, command: string): boolean {
  const allowed = TIER_PERMISSIONS[tier];
  if (!allowed) return false;
  if (allowed.includes('*')) return true;
  return allowed.includes(command);
}

export function getPermissionDeniedMessage(
  command: string,
  tier: PermissionTier,
): string {
  return `Permission denied: '${command}' requires higher access than '${tier}'.`;
}
