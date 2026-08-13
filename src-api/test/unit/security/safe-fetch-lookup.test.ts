import { describe, expect, it } from 'vitest';

import { createPinnedLookup } from '@/shared/network-policy/fetch';

function runPinnedLookup(
  pinIp: string,
  options: object,
): Promise<string | Array<{ address: string; family: number }>> {
  const lookup = createPinnedLookup(pinIp);
  return new Promise((resolve, reject) => {
    lookup('image.example.test', options, (err, address) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(address);
    });
  });
}

describe('safeFetch DNS pinning lookup', () => {
  it('returns pinned addresses in the all=true callback shape', async () => {
    await expect(runPinnedLookup('127.0.0.1', { all: true })).resolves.toEqual([
      { address: '127.0.0.1', family: 4 },
    ]);
  });

  it('keeps the single-address callback shape for normal lookups', async () => {
    await expect(runPinnedLookup('203.0.113.8', {})).resolves.toBe(
      '203.0.113.8',
    );
  });
});
