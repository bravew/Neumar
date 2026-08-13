import { describe, expect, it } from 'vitest';

import {
  CloudStorageError,
  errorCodeFromStatus,
  normalizeErrorCode,
} from '@/shared/integrations/cloud-storage/errors';

describe('cloud storage errors', () => {
  it('serializes neutral errors for Hono responses', () => {
    const error = new CloudStorageError('rate_limited', 'Slow down', {
      retryAfterMs: 1000,
    });

    expect(error.toJSON()).toEqual({
      error: 'rate_limited',
      message: 'Slow down',
      status: 429,
      retryAfterMs: 1000,
      details: undefined,
    });
  });

  it('normalizes unknown upstream codes safely', () => {
    expect(normalizeErrorCode('missing_scope')).toBe('missing_scope');
    expect(normalizeErrorCode('not-real')).toBe('transient_upstream');
    expect(errorCodeFromStatus(404)).toBe('not_found');
    expect(errorCodeFromStatus(503)).toBe('transient_upstream');
  });
});
