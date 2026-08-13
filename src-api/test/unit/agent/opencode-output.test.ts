import { describe, expect, it } from 'vitest';

import {
  extractOpenCodeErrorText,
  parseOpenCodeOutputLine,
  shouldFailEmptyOpenCodeRun,
} from '@/extensions/agent/opencode-local/output';

describe('OpenCode output parsing', () => {
  it('surfaces JSON error frames as error messages', () => {
    expect(
      parseOpenCodeOutputLine(
        JSON.stringify({ type: 'error', message: 'provider failed' }),
      ),
    ).toMatchObject({
      type: 'error',
      message: 'provider failed',
      content: 'provider failed',
    });
  });

  it('surfaces usage-limit and provider-failure text as errors', () => {
    expect(
      parseOpenCodeOutputLine(
        'Usage limit reached. Please try again after the reset window.',
      ),
    ).toMatchObject({
      type: 'error',
      message: 'Usage limit reached. Please try again after the reset window.',
    });
    expect(
      parseOpenCodeOutputLine(
        JSON.stringify({
          type: 'message',
          content: 'Provider unavailable: upstream returned 502',
        }),
      ),
    ).toMatchObject({
      type: 'error',
      message: 'Provider unavailable: upstream returned 502',
    });
  });

  it('keeps plain output as text', () => {
    expect(parseOpenCodeOutputLine('hello world')).toEqual({
      type: 'text',
      content: 'hello world',
    });
  });

  it('extracts framed errors from stderr text', () => {
    const stderr = [
      'debug line',
      JSON.stringify({ event: 'error', error: { message: 'auth failed' } }),
    ].join('\n');

    expect(extractOpenCodeErrorText(stderr)).toBe('auth failed');
    expect(
      extractOpenCodeErrorText(
        'debug line\nProvider error: request failed with status 429',
      ),
    ).toBe('Provider error: request failed with status 429');
  });

  it('treats zero-exit empty runs as failed', () => {
    expect(shouldFailEmptyOpenCodeRun(0, false, false)).toBe(true);
    expect(shouldFailEmptyOpenCodeRun(0, true, false)).toBe(false);
    expect(shouldFailEmptyOpenCodeRun(1, false, false)).toBe(false);
  });
});
