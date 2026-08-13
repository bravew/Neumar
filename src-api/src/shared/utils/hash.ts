import { createHash } from 'crypto';

/**
 * Short hex digest of an arbitrary string. Useful for deriving stable cache
 * keys / filenames from URLs or payloads where the full 64-char hex is
 * overkill. 16 hex chars = 64 bits of entropy.
 */
export function shortSha256(input: string, length = 16): string {
  return createHash('sha256').update(input).digest('hex').slice(0, length);
}

/**
 * Hex SHA-1 of a string. Used where collision resistance matters more than
 * cryptographic strength (e.g. RAG chunk ids derived from path + line).
 */
export function sha1(input: string): string {
  return createHash('sha1').update(input).digest('hex');
}
