import type { ChannelUser } from '@/shared/db/types';

export class TokenBudget {
  checkBudget(user: ChannelUser): {
    allowed: boolean;
    tokensRemaining: number;
  } {
    if (user.token_budget === 0) {
      return { allowed: true, tokensRemaining: Infinity };
    }
    const remaining = user.token_budget - user.tokens_used_today;
    if (remaining <= 0) {
      return { allowed: false, tokensRemaining: 0 };
    }
    return { allowed: true, tokensRemaining: remaining };
  }
}
