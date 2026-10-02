import { describe, expect, it } from 'vitest';

import { approvalsListStatus } from '@/app/pages/Approvals';

describe('approvalsListStatus', () => {
  it('keeps pending cards visible when history failed', () => {
    expect(approvalsListStatus('pending', true, 'error')).toBe('ready');
  });

  it('keeps the pending tab loading until the live snapshot arrives', () => {
    expect(approvalsListStatus('pending', false, 'error')).toBe('loading');
    expect(approvalsListStatus('pending', false, 'ready')).toBe('loading');
  });

  it('uses the history fetch status only on the history tab', () => {
    expect(approvalsListStatus('history', true, 'loading')).toBe('loading');
    expect(approvalsListStatus('history', true, 'error')).toBe('error');
    expect(approvalsListStatus('history', false, 'ready')).toBe('ready');
  });
});
