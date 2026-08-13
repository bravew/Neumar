import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkEmptyRun } from '@/components/task/taskV2-submit-helpers';

/**
 * Regression coverage for the stale-error bug: `checkEmptyRun` used
 * `messages.find(m => m.isError)` over the *entire* task history, so the
 * very first run's error (e.g. a real one-off auth failure) got resurfaced
 * as the result of every later, unrelated send — including ones that failed
 * for a completely different reason, or succeeded. Reproduced live: a
 * follow-up send that actually failed with "Project root escapes its
 * configured workspace" still showed the original run's stale text in the
 * UI. Scoping the scan to messages after the latest user message (this
 * run only) fixes it.
 */
describe('checkEmptyRun', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not resurface an earlier run error for a later, unrelated send', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        messages: [
          { role: 'user', content: 'hello' },
          {
            role: 'assistant',
            content: 'Your access token could not be refreshed...',
            isError: true,
          },
          { role: 'user', content: 'hi' },
          { role: 'user', content: 'a follow-up with no run output yet' },
        ],
      }),
    });

    const result = await checkEmptyRun('task-1', false, 'fallback');
    expect(result).toBe('fallback');
  });

  it('reports a fresh error that belongs to the current run', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        messages: [
          { role: 'user', content: 'hello' },
          {
            role: 'assistant',
            content: 'Your access token could not be refreshed...',
            isError: true,
          },
          { role: 'user', content: 'hi' },
          {
            role: 'assistant',
            content: 'Project root escapes its configured workspace',
            isError: true,
          },
        ],
      }),
    });

    const result = await checkEmptyRun('task-1', false, 'fallback');
    expect(result).toBe('Project root escapes its configured workspace');
  });

  it('returns null when the current run produced real assistant output', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        messages: [
          { role: 'user', content: 'hello' },
          {
            role: 'assistant',
            content: 'Your access token could not be refreshed...',
            isError: true,
          },
          { role: 'user', content: 'hi' },
          { role: 'assistant', content: 'Hi! How can I help?' },
        ],
      }),
    });

    const result = await checkEmptyRun('task-1', true, 'fallback');
    expect(result).toBeNull();
  });
});
