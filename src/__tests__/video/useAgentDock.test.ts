import { createElement, StrictMode, type ReactNode } from 'react';

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  normalizeAgentActionPayload,
  useAgentDock,
} from '@/components/video/useAgentDock';
import { LanguageProvider } from '@/shared/providers/language-provider';

let restoreLocalStorage: (() => void) | null = null;

beforeEach(() => {
  vi.unstubAllGlobals();
  restoreLocalStorage = installLocalStorageMock();
});

afterEach(() => {
  restoreLocalStorage?.();
  restoreLocalStorage = null;
});

describe('normalizeAgentActionPayload', () => {
  it('accepts timeline op approval cards from the agent stream', () => {
    const action = normalizeAgentActionPayload({
      id: 'action-1',
      type: 'action',
      name: 'applyTimelineOp',
      summary: 'Move the hook later.',
      args: {
        op: {
          kind: 'clip.move',
          clipId: 'clip-1',
          from: { trackId: 'track-video', startMs: 0 },
          to: { trackId: 'track-video', startMs: 500 },
        },
      },
      requiresApproval: true,
      status: 'pending',
    });

    expect(action).toMatchObject({
      name: 'applyTimelineOp',
      status: 'pending',
      args: {
        op: {
          kind: 'clip.move',
          clipId: 'clip-1',
        },
      },
    });
  });

  it('accepts timeline op batch approval cards from the agent stream', () => {
    const action = normalizeAgentActionPayload({
      id: 'action-1',
      type: 'action',
      name: 'applyTimelineOps',
      summary: 'Cut selected transcript text.',
      args: {
        ops: [
          {
            kind: 'clip.removeTimeRange',
            trackId: 'track-video',
            startMs: 1000,
            endMs: 1600,
            magnetic: true,
          },
        ],
      },
      requiresApproval: true,
      status: 'pending',
    });

    expect(action).toMatchObject({
      name: 'applyTimelineOps',
      status: 'pending',
      args: {
        ops: [
          {
            kind: 'clip.removeTimeRange',
            trackId: 'track-video',
          },
        ],
      },
    });
  });

  it('rejects unsupported action names', () => {
    expect(
      normalizeAgentActionPayload({
        id: 'action-1',
        type: 'action',
        name: 'unsupportedAction',
        summary: 'Nope',
        args: {},
        status: 'pending',
      }),
    ).toBeNull();
  });

  it('promotes AG-UI video tool results into action cards', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const stream = [
          sseFrame('agui', {
            type: 'TOOL_CALL_START',
            toolCallId: 'call-1',
            toolCallName: 'video_apply_timeline_op',
          }),
          sseFrame('agui', {
            type: 'TOOL_CALL_ARGS',
            toolCallId: 'call-1',
            delta: JSON.stringify({
              op: {
                kind: 'clip.move',
                clipId: 'clip-1',
                to: { trackId: 'track-video', startMs: 500 },
              },
              summary: 'Move the clip later.',
            }),
          }),
          sseFrame('agui', {
            type: 'TOOL_CALL_RESULT',
            toolCallId: 'call-1',
            content: JSON.stringify({ summary: 'Moved the clip later.' }),
          }),
          sseFrame('agui', { type: 'RUN_FINISHED' }),
        ].join('');

        return new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      }),
    );

    const { result } = renderHook(() => useAgentDock({ projectId: 'p1' }), {
      wrapper: strictModeWrapper,
    });

    await act(async () => {
      await result.current.sendMessage('Move clip', { aspectRatio: '16:9' });
    });

    await waitFor(() => {
      expect(result.current.streaming).toBe(false);
      expect(
        result.current.messages.find(
          (message) =>
            message.kind === 'action' &&
            message.action.name === 'applyTimelineOp',
        ),
      ).toMatchObject({
        kind: 'action',
        action: {
          name: 'applyTimelineOp',
          summary: 'Moved the clip later.',
          args: {
            op: {
              kind: 'clip.move',
              clipId: 'clip-1',
              to: { trackId: 'track-video', startMs: 500 },
            },
            summary: 'Move the clip later.',
          },
        },
      });
    });
  });
});

describe('plugin flow context carryover', () => {
  it('carries the plugin gate onto the approval turn, then clears it', async () => {
    const bodies: Array<{ context?: Record<string, unknown> }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const target = String(url);
        // Only the agent-turn POST carries a message + context; ignore the
        // on-mount history GET so it doesn't pollute the recorded bodies.
        if (target.endsWith('/agent') && init?.method === 'POST') {
          bodies.push(JSON.parse(String(init.body ?? '{}')));
          return new Response(sseFrame('agui', { type: 'RUN_FINISHED' }), {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          });
        }
        return new Response(JSON.stringify({ messages: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }),
    );

    const { result } = renderHook(() => useAgentDock({ projectId: 'p1' }), {
      wrapper: strictModeWrapper,
    });

    // Turn 1: the "Use plugin" run carries the plugin context.
    await act(async () => {
      await result.current.sendMessage('@plugin:talking-head-auto-cut', {
        aspectRatio: '16:9',
        pluginId: 'talking-head-auto-cut',
        approvedPluginCapabilities: ['video:edit'],
        lastReviewedPluginDigest: 'digest-1',
      });
    });
    // Turn 2: the plain approval message inherits the plugin gate.
    await act(async () => {
      await result.current.sendMessage('Approve the cut plan', {
        aspectRatio: '16:9',
      });
    });
    // Turn 3: an unrelated edit is no longer gated to the plugin toolset.
    await act(async () => {
      await result.current.sendMessage('Now make it 9:16', {
        aspectRatio: '9:16',
      });
    });

    await waitFor(() => expect(bodies).toHaveLength(3));
    expect(bodies[0]?.context?.pluginId).toBe('talking-head-auto-cut');
    expect(bodies[1]?.context?.pluginId).toBe('talking-head-auto-cut');
    expect(bodies[1]?.context?.approvedPluginCapabilities).toEqual([
      'video:edit',
    ]);
    expect(bodies[2]?.context?.pluginId).toBeUndefined();
  });
});

function strictModeWrapper({ children }: { children: ReactNode }) {
  return createElement(
    StrictMode,
    null,
    createElement(LanguageProvider, null, children),
  );
}

function sseFrame(event: string, payload: Record<string, unknown>): string {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

function installLocalStorageMock(): () => void {
  const storage = createStorageMock();
  const globalDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    'localStorage',
  );
  const windowDescriptor = Object.getOwnPropertyDescriptor(
    window,
    'localStorage',
  );
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  });
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: storage,
  });
  return () => {
    restoreStorageDescriptor(globalThis, globalDescriptor);
    restoreStorageDescriptor(window, windowDescriptor);
  };
}

function restoreStorageDescriptor(
  target: typeof globalThis | Window,
  descriptor: PropertyDescriptor | undefined,
) {
  if (descriptor) {
    Object.defineProperty(target, 'localStorage', descriptor);
    return;
  }
  delete (target as { localStorage?: Storage }).localStorage;
}

function createStorageMock(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: vi.fn(() => values.clear()),
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    key: vi.fn((index: number) => Array.from(values.keys())[index] ?? null),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
  };
}
