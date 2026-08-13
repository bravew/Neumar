import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  clearCreativeDebugCounters,
  CREATIVE_DEBUG_COUNTER_STORAGE_KEY,
  readCreativeDebugCounters,
  recordCreativeDebugCounter,
  recordCreativeDebugCounterOnce,
} from '@/shared/creative-workflow/debug-counters';

import { installLocalStorageMock } from './helpers/local-storage';

describe('creative debug counters', () => {
  beforeEach(() => installLocalStorageMock());
  afterEach(() => clearCreativeDebugCounters());

  it('stores only event counts and last timestamps locally', () => {
    const now = new Date('2026-06-21T12:00:00.000Z');

    recordCreativeDebugCounter('entry.intent.selected', now);
    recordCreativeDebugCounter('entry.intent.selected', now);
    recordCreativeDebugCounter(
      'generation.submitted',
      new Date('2026-06-21T12:01:00.000Z'),
    );

    expect(readCreativeDebugCounters()).toEqual({
      version: 1,
      updatedAt: '2026-06-21T12:01:00.000Z',
      events: {
        'entry.intent.selected': {
          count: 2,
          lastAt: '2026-06-21T12:00:00.000Z',
        },
        'generation.submitted': {
          count: 1,
          lastAt: '2026-06-21T12:01:00.000Z',
        },
      },
    });
    expect(
      window.localStorage.getItem(CREATIVE_DEBUG_COUNTER_STORAGE_KEY),
    ).not.toContain('prompt');
  });

  it('ignores unknown stored events', () => {
    window.localStorage.setItem(
      CREATIVE_DEBUG_COUNTER_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        updatedAt: '2026-06-21T12:00:00.000Z',
        events: {
          'entry.intent.selected': {
            count: 1,
            lastAt: '2026-06-21T12:00:00.000Z',
          },
          'prompt.payload': {
            count: 99,
            lastAt: '2026-06-21T12:00:00.000Z',
            prompt: 'private prompt',
          },
        },
      }),
    );

    expect(readCreativeDebugCounters()).toEqual({
      version: 1,
      updatedAt: '2026-06-21T12:00:00.000Z',
      events: {
        'entry.intent.selected': {
          count: 1,
          lastAt: '2026-06-21T12:00:00.000Z',
        },
      },
    });
  });

  it('ignores malformed array snapshots', () => {
    window.localStorage.setItem(
      CREATIVE_DEBUG_COUNTER_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        updatedAt: '2026-06-21T12:00:00.000Z',
        events: [
          {
            count: 1,
            lastAt: '2026-06-21T12:00:00.000Z',
          },
        ],
      }),
    );

    expect(readCreativeDebugCounters()).toEqual({
      version: 1,
      updatedAt: null,
      events: {},
    });
  });

  it('deduplicates immediate replayed events by key', () => {
    const first = new Date('2026-06-21T12:00:00.000Z');
    const replay = new Date('2026-06-21T12:00:00.500Z');
    const later = new Date('2026-06-21T12:00:02.000Z');

    expect(
      recordCreativeDebugCounterOnce('flow.viewer.opened', 'flow', first),
    ).toBe(true);
    expect(
      recordCreativeDebugCounterOnce('flow.viewer.opened', 'flow', replay),
    ).toBe(false);
    expect(
      recordCreativeDebugCounterOnce('flow.viewer.opened', 'flow', later),
    ).toBe(true);

    expect(
      readCreativeDebugCounters().events['flow.viewer.opened']?.count,
    ).toBe(2);
  });
});
