/**
 * Folds agent stream signals (AG-UI CUSTOM `neuma.stream_signal`) into the
 * state the task thread renders: notice rows, the rate-limit / retry
 * countdown, and the live session state. Pure so it can be unit-tested.
 */
import type { ResourceLink, StreamSignal } from '@/shared/hooks/agent-types';

export const STREAM_SIGNAL_EVENT_NAME = 'neuma.stream_signal';

/** Newest notices kept on screen. */
const MAX_NOTICES = 5;

export type StreamNotice =
  | {
      id: string;
      kind: 'message';
      level: 'notice' | 'suggestion' | 'warning';
      content: string;
    }
  | { id: string; kind: 'rate_limit_warning'; utilization?: number }
  | { id: string; kind: 'plugin_errors'; count: number }
  | { id: string; kind: 'conversation_reset' };

/** `retryAfterMs` is measured when the signal arrived; `until` is absolute. */
export type StreamRetry =
  | { kind: 'rate_limit'; until: number; retryAfterMs: number }
  | {
      kind: 'api_retry';
      until: number;
      retryAfterMs: number;
      attempt: number;
      maxRetries: number;
    };

export interface StreamSignalState {
  notices: StreamNotice[];
  retry: StreamRetry | null;
  sessionState: 'idle' | 'running' | 'requires_action' | null;
}

export const EMPTY_STREAM_SIGNAL_STATE: StreamSignalState = {
  notices: [],
  retry: null,
  sessionState: null,
};

const KINDS = new Set([
  'notice',
  'rate_limit',
  'api_retry',
  'plugin_errors',
  'conversation_reset',
  'session_state',
  'resource_links',
]);

/** Shallow guard for signals arriving over SSE. */
export function isStreamSignal(value: unknown): value is StreamSignal {
  if (typeof value !== 'object' || value === null) return false;
  const kind = (value as { kind?: unknown }).kind;
  return typeof kind === 'string' && KINDS.has(kind);
}

function pushNotice(
  state: StreamSignalState,
  notice: StreamNotice,
): StreamSignalState {
  return {
    ...state,
    notices: [...state.notices, notice].slice(-MAX_NOTICES),
  };
}

export function applyStreamSignal(
  state: StreamSignalState,
  signal: StreamSignal,
  now: number,
  id: string,
): StreamSignalState {
  switch (signal.kind) {
    case 'notice':
      // 'info' is transcript-only per the SDK contract.
      if (signal.level === 'info') return state;
      return pushNotice(state, {
        id,
        kind: 'message',
        level: signal.level,
        content: signal.content,
      });
    case 'rate_limit':
      if (signal.status === 'rejected') {
        // Without a reset time there is nothing to count down to.
        if (!signal.resetsAt || signal.resetsAt <= now) return state;
        return {
          ...state,
          retry: {
            kind: 'rate_limit',
            until: signal.resetsAt,
            retryAfterMs: signal.resetsAt - now,
          },
        };
      }
      if (signal.status === 'allowed_warning') {
        return pushNotice(state, {
          id,
          kind: 'rate_limit_warning',
          utilization: signal.utilization,
        });
      }
      return state;
    case 'api_retry':
      return {
        ...state,
        retry: {
          kind: 'api_retry',
          until: now + Math.max(0, signal.retryDelayMs),
          retryAfterMs: Math.max(0, signal.retryDelayMs),
          attempt: signal.attempt,
          maxRetries: signal.maxRetries,
        },
      };
    case 'plugin_errors':
      if (signal.errors.length === 0) return state;
      return pushNotice(state, {
        id,
        kind: 'plugin_errors',
        count: signal.errors.length,
      });
    case 'conversation_reset':
      return pushNotice(
        { ...state, notices: [], retry: null },
        { id, kind: 'conversation_reset' },
      );
    case 'session_state':
      return {
        ...state,
        sessionState: signal.state,
        // An idle session is no longer retrying; a rate-limit reset time
        // stays relevant after the run ends.
        retry:
          signal.state === 'idle' && state.retry?.kind === 'api_retry'
            ? null
            : state.retry,
      };
    case 'resource_links':
      return state;
  }
}

export function dismissStreamNotice(
  state: StreamSignalState,
  id: string,
): StreamSignalState {
  return { ...state, notices: state.notices.filter((n) => n.id !== id) };
}

/**
 * Library `files` row for a returned resource link, or null when the URI is
 * not a local file or web URL the artifact viewer can open.
 */
export function resourceLinkToFile(
  link: ResourceLink,
): { name: string; path: string } | null {
  let url: URL;
  try {
    url = new URL(link.uri);
  } catch {
    return null;
  }
  const name = link.title?.trim() || link.name;
  if (url.protocol === 'file:') {
    const path = decodeURIComponent(url.pathname);
    // file:///C:/x → C:/x on Windows.
    return { name, path: /^\/[A-Za-z]:\//.test(path) ? path.slice(1) : path };
  }
  if (url.protocol === 'https:' || url.protocol === 'http:') {
    return { name, path: url.href };
  }
  return null;
}
