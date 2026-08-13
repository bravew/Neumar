import crypto from 'node:crypto';

const claimedTelegramTokenHashes = new Set<string>();

export function claimTelegramToken(token: string): boolean {
  const tokenHash = hashTelegramToken(token);
  if (claimedTelegramTokenHashes.has(tokenHash)) return false;
  claimedTelegramTokenHashes.add(tokenHash);
  return true;
}

export function releaseTelegramToken(token: string): void {
  claimedTelegramTokenHashes.delete(hashTelegramToken(token));
}

export function resetTelegramTokenClaimsForTest(): void {
  claimedTelegramTokenHashes.clear();
}

function hashTelegramToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
