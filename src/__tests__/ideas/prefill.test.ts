import { afterEach, describe, expect, it } from 'vitest';

import {
  IDEAS_PREFILL_EVENT,
  requestComposerPrefill,
  takeComposerPrefill,
} from '@/shared/ideas/prefill';

describe('composer prefill hand-off', () => {
  afterEach(() => {
    takeComposerPrefill();
  });

  it('waits for the next composer when nothing is mounted', () => {
    expect(requestComposerPrefill('Draft an email')).toBe(false);
    expect(takeComposerPrefill()).toBe('Draft an email');
    expect(takeComposerPrefill()).toBeNull();
  });

  it('reports a claim by a mounted composer', () => {
    let received: string | null = null;
    const claim = () => {
      received = takeComposerPrefill();
    };
    window.addEventListener(IDEAS_PREFILL_EVENT, claim);
    try {
      expect(requestComposerPrefill('Build a feature')).toBe(true);
    } finally {
      window.removeEventListener(IDEAS_PREFILL_EVENT, claim);
    }
    expect(received).toBe('Build a feature');
    expect(takeComposerPrefill()).toBeNull();
  });
});
