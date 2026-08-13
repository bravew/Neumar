import { describe, expect, it, vi } from 'vitest';

import {
  LEG_STALL_TIMEOUT_MS,
  assertJobTransition,
  assertLegTransition,
  canTransitionJob,
  canTransitionLeg,
  isLegStalled,
  jobStates,
  legStates,
} from '@/shared/services/publish/state-machine';

describe('publish state machine', () => {
  it('defines and enforces every job transition', () => {
    for (const current of jobStates) {
      for (const next of jobStates) {
        if (canTransitionJob(current, next)) {
          expect(() => assertJobTransition(current, next)).not.toThrow();
        } else {
          expect(() => assertJobTransition(current, next)).toThrow(
            /Illegal publish job transition/,
          );
        }
      }
    }

    expect(canTransitionJob('drafted', 'canceled')).toBe(true);
    expect(canTransitionJob('succeeded', 'canceled')).toBe(false);
  });

  it('defines and enforces every leg transition', () => {
    for (const current of legStates) {
      for (const next of legStates) {
        if (canTransitionLeg(current, next)) {
          expect(() => assertLegTransition(current, next)).not.toThrow();
        } else {
          expect(() => assertLegTransition(current, next)).toThrow(
            /Illegal publish leg transition/,
          );
        }
      }
    }

    expect(canTransitionLeg('queued', 'canceled')).toBe(true);
    expect(canTransitionLeg('published', 'uploading')).toBe(false);
  });

  it('detects uploading legs that stopped making chunk progress', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-05-06T12:11:00.000Z'));

      expect(
        isLegStalled({
          state: 'uploading',
          chunk_offset_bytes: 1024,
          last_progress_at: '2026-05-06T12:00:00.000Z',
          updated_at: '2026-05-06T12:00:00.000Z',
        }),
      ).toBe(true);

      expect(
        isLegStalled({
          state: 'uploading',
          chunk_offset_bytes: 1024,
          last_progress_at: new Date(
            Date.now() - LEG_STALL_TIMEOUT_MS + 1_000,
          ).toISOString(),
          updated_at: '2026-05-06T12:00:00.000Z',
        }),
      ).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
