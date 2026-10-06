import type { ThreadHydrationState } from '@/shared/stores/thread-store';

/** Keep saved messages visible while the active agent's history loads. */
export function selectThreadMessages<T>(
  hydrationState: ThreadHydrationState,
  agentMessages: T[],
  cachedMessages: T[],
  historyMessages: T[],
): T[] {
  if (hydrationState !== 'pending' && agentMessages.length > 0) {
    return agentMessages;
  }
  return cachedMessages.length > 0 ? cachedMessages : historyMessages;
}
