import { describe, expect, it } from 'vitest';

import { selectThreadMessages } from '@/shared/lib/thread-messages';

const saved = [{ id: 'saved', content: 'Saved session response' }];
const previousAgent = [{ id: 'previous', content: 'Previous session' }];

describe('thread messages during session loading', () => {
  it('shows database history while hydration is pending instead of a blank thread', () => {
    expect(selectThreadMessages('pending', previousAgent, [], saved)).toBe(
      saved,
    );
  });

  it('shows the selected task cache while its history reloads', () => {
    expect(selectThreadMessages('pending', previousAgent, saved, [])).toBe(
      saved,
    );
  });

  it('uses active agent messages after hydration finishes', () => {
    expect(selectThreadMessages('hydrated', previousAgent, saved, saved)).toBe(
      previousAgent,
    );
  });

  it('retains database history after a history request fails', () => {
    expect(selectThreadMessages('error', [], [], saved)).toBe(saved);
  });
});
