import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ClaudePluginHealthView } from '@/components/settings/components/ClaudePluginHealth';
import { RateLimitIndicator } from '@/components/task/RateLimitIndicator';
import { StreamSignalView } from '@/components/task/StreamSignalBanner';
import type { StreamSignal } from '@/shared/hooks/agent-types';
import {
  applyStreamSignal,
  dismissStreamNotice,
  EMPTY_STREAM_SIGNAL_STATE,
  isStreamSignal,
  resourceLinkToFile,
  type StreamSignalState,
} from '@/shared/lib/stream-signals';

vi.mock('@/shared/providers/language-provider', async () => {
  const t = {
    common: (await import('@/config/locale/messages/en/common')).default,
    plugins: (await import('@/config/locale/messages/en/plugins')).default,
    task: (await import('@/config/locale/messages/en/task')).default,
  };
  const get = (key: string) =>
    key
      .split('.')
      .reduce<unknown>(
        (o, k) => (o as Record<string, unknown> | undefined)?.[k],
        t,
      ) as string;
  return {
    useLanguage: () => ({
      t,
      tt: (key: string, params?: Record<string, string | number>) =>
        Object.entries(params ?? {}).reduce(
          (s, [k, v]) => s.replace(`{${k}}`, String(v)),
          get(key),
        ),
    }),
  };
});

const NOW = 1_000_000;

function fold(signals: StreamSignal[]): StreamSignalState {
  return signals.reduce(
    (state, s, i) => applyStreamSignal(state, s, NOW, `n${i}`),
    EMPTY_STREAM_SIGNAL_STATE,
  );
}

describe('applyStreamSignal', () => {
  it('turns notices, warnings, plugin errors and resets into notice rows', () => {
    const state = fold([
      { kind: 'notice', level: 'info', content: 'transcript only' },
      { kind: 'notice', level: 'warning', content: 'Hook blocked prompt' },
      { kind: 'rate_limit', status: 'allowed_warning', utilization: 0.82 },
      {
        kind: 'plugin_errors',
        errors: [{ plugin: 'a@m', type: 'generic-error', message: 'x' }],
      },
    ]);
    expect(state.notices.map((n) => n.kind)).toEqual([
      'message',
      'rate_limit_warning',
      'plugin_errors',
    ]);

    const reset = applyStreamSignal(
      state,
      { kind: 'conversation_reset', newConversationId: 'c2' },
      NOW,
      'r',
    );
    expect(reset.notices).toEqual([{ id: 'r', kind: 'conversation_reset' }]);
    expect(dismissStreamNotice(reset, 'r').notices).toEqual([]);
  });

  it('counts down to resetsAt for a rejected rate limit', () => {
    const state = fold([
      { kind: 'rate_limit', status: 'rejected', resetsAt: NOW + 30_000 },
    ]);
    expect(state.retry).toEqual({
      kind: 'rate_limit',
      until: NOW + 30_000,
      retryAfterMs: 30_000,
    });
    // No reset time → nothing to count down to.
    expect(fold([{ kind: 'rate_limit', status: 'rejected' }]).retry).toBeNull();
  });

  it('counts down to the next api_retry attempt and clears it when idle', () => {
    const retrying = fold([
      {
        kind: 'api_retry',
        attempt: 2,
        maxRetries: 10,
        retryDelayMs: 4000,
        errorStatus: 529,
        error: 'overloaded',
      },
    ]);
    expect(retrying.retry).toMatchObject({
      kind: 'api_retry',
      retryAfterMs: 4000,
      attempt: 2,
      maxRetries: 10,
    });
    const idle = applyStreamSignal(
      retrying,
      { kind: 'session_state', state: 'idle' },
      NOW,
      'x',
    );
    expect(idle.retry).toBeNull();
    expect(idle.sessionState).toBe('idle');
  });

  it('validates signals from the wire', () => {
    expect(isStreamSignal({ kind: 'notice' })).toBe(true);
    expect(isStreamSignal({ kind: 'bogus' })).toBe(false);
    expect(isStreamSignal(null)).toBe(false);
  });

  it('maps resource links to library file rows', () => {
    expect(
      resourceLinkToFile({ uri: 'file:///tmp/a%20b.pdf', name: 'a b.pdf' }),
    ).toEqual({ name: 'a b.pdf', path: '/tmp/a b.pdf' });
    expect(
      resourceLinkToFile({ uri: 'file:///C:/out/x.png', name: 'x.png' }),
    ).toEqual({ name: 'x.png', path: 'C:/out/x.png' });
    expect(
      resourceLinkToFile({
        uri: 'https://example.com/r.csv',
        name: 'r.csv',
        title: 'Report',
      }),
    ).toEqual({ name: 'Report', path: 'https://example.com/r.csv' });
    expect(
      resourceLinkToFile({ uri: 'mcp://server/thing', name: 't' }),
    ).toBeNull();
  });
});

describe('StreamSignalView', () => {
  it('renders nothing without signals', () => {
    const { container } = render(
      <StreamSignalView
        state={EMPTY_STREAM_SIGNAL_STATE}
        onDismissNotice={() => {}}
        onRetryDone={() => {}}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders notice rows and dismisses them', () => {
    const onDismiss = vi.fn();
    const state = fold([
      { kind: 'notice', level: 'warning', content: 'Hook blocked prompt' },
      { kind: 'rate_limit', status: 'allowed_warning', utilization: 0.82 },
      {
        kind: 'plugin_errors',
        errors: [{ plugin: 'a@m', type: 'generic-error', message: 'x' }],
      },
      { kind: 'session_state', state: 'requires_action' },
    ]);
    render(
      <StreamSignalView
        state={state}
        onDismissNotice={onDismiss}
        onRetryDone={() => {}}
      />,
    );
    expect(screen.getByText('Hook blocked prompt')).toBeInTheDocument();
    expect(
      screen.getByText('Approaching usage limit (82% used)'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        '1 Claude plugin(s) failed to load — see Settings → Plugins',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Waiting for your input')).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'Dismiss' })[0]);
    expect(onDismiss).toHaveBeenCalledWith('n0');
  });
});

describe('RateLimitIndicator', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shows the api_retry attempt and counts down, then dismisses', () => {
    const onDismiss = vi.fn();
    render(
      <RateLimitIndicator
        retry={{
          kind: 'api_retry',
          until: NOW + 2000,
          retryAfterMs: 2000,
          attempt: 2,
          maxRetries: 10,
        }}
        onDismiss={onDismiss}
      />,
    );
    expect(
      screen.getByText('Request failed — retry 2 of 10 in 2s'),
    ).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1000));
    expect(
      screen.getByText('Request failed — retry 2 of 10 in 1s'),
    ).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1000));
    expect(onDismiss).toHaveBeenCalled();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows seconds for a short rate-limit wait and a clock time for a long one', () => {
    const { rerender } = render(
      <RateLimitIndicator
        key="short"
        retry={{
          kind: 'rate_limit',
          until: NOW + 30_000,
          retryAfterMs: 30_000,
        }}
      />,
    );
    expect(
      screen.getByText('Rate limited — retrying in 30s'),
    ).toBeInTheDocument();

    rerender(
      <RateLimitIndicator
        key="long"
        retry={{
          kind: 'rate_limit',
          until: NOW + 3_600_000,
          retryAfterMs: 3_600_000,
        }}
      />,
    );
    expect(screen.getByRole('status').textContent).toMatch(
      /^Rate limited — resets at /,
    );
  });
});

describe('ClaudePluginHealthView', () => {
  it('hides before any session reported plugin state', () => {
    const { container } = render(
      <ClaudePluginHealthView health={{ checkedAt: null, errors: [] }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('lists plugin load errors', () => {
    render(
      <ClaudePluginHealthView
        health={{
          checkedAt: 1,
          errors: [
            {
              plugin: 'lint-tools@acme',
              type: 'dependency-unsatisfied',
              message: 'requires base-tools@acme',
            },
          ],
        }}
      />,
    );
    expect(
      screen.getByText('1 plugin(s) failed to load at the last session start'),
    ).toBeInTheDocument();
    expect(screen.getByText('lint-tools@acme')).toBeInTheDocument();
  });

  it('reports a healthy load', () => {
    render(<ClaudePluginHealthView health={{ checkedAt: 1, errors: [] }} />);
    expect(
      screen.getByText(
        'All Claude Code plugins loaded at the last session start.',
      ),
    ).toBeInTheDocument();
  });
});
