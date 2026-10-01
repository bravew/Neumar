import { describe, expect, it } from 'vitest';

import {
  getPageContext,
  setPageContext,
} from '@/components/chat-dock/usePageContext';

describe('usePageContext', () => {
  it('stores a page payload and clears it', () => {
    setPageContext({
      label: 'Library',
      payload: 'Looking at: Library › report.pdf',
    });
    expect(getPageContext()?.payload).toBe('Looking at: Library › report.pdf');
    setPageContext(null);
    expect(getPageContext()).toBeNull();
  });
});
