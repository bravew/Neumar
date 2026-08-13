/**
 * Token Budget
 *
 * Per-identity daily token budget enforcement.
 */

import { createLogger } from '@/shared/utils/logger';

import type { GatewayIdentity } from '../../channels/types';
import * as db from '../db/operations';

const logger = createLogger('TokenBudget');

export interface BudgetStatus {
  allowed: boolean;
  remaining: number;
  percentUsed: number;
  warnOnly: boolean;
}

export function checkBudget(
  identity: GatewayIdentity,
  enforcementMode: 'enforce' | 'warn-only',
): BudgetStatus {
  // 0 = unlimited
  if (identity.token_budget === 0) {
    return {
      allowed: true,
      remaining: Infinity,
      percentUsed: 0,
      warnOnly: false,
    };
  }

  const remaining = identity.token_budget - identity.tokens_used_today;
  const percentUsed = identity.tokens_used_today / identity.token_budget;
  const warnOnly = enforcementMode === 'warn-only';

  if (remaining <= 0) {
    if (warnOnly) {
      logger.warn(`Identity ${identity.id} over token budget (warn-only mode)`);
      return { allowed: true, remaining: 0, percentUsed, warnOnly: true };
    }
    return { allowed: false, remaining: 0, percentUsed, warnOnly: false };
  }

  return { allowed: true, remaining, percentUsed, warnOnly };
}

export function trackTokenUsage(identityId: string, tokensUsed: number): void {
  db.updateTokenUsage(identityId, tokensUsed);
}

export function getBudgetMessage(identity: GatewayIdentity): string {
  if (identity.token_budget === 0) return 'Token budget: unlimited';
  const used = identity.tokens_used_today;
  const total = identity.token_budget;
  const pct = Math.round((used / total) * 100);
  return `Token budget: ${used.toLocaleString()}/${total.toLocaleString()} (${pct}%)`;
}
