import type { RequestPermissionRequest } from '@zed-industries/agent-client-protocol';
import { describe, expect, it, vi } from 'vitest';

import { ToolPermissionRegistry } from '@/core/agent/tool-permission-registry';

import {
  AcpToolCallTracker,
  assertAcpProtocolVersion,
  mapAcpSessionUpdate,
  normalizeAcpUsage,
  resolveAcpPermissionRequest,
  shouldLoadAcpSession,
} from '@/extensions/agent/shared/acp';

function permissionRequest(
  title: string,
  kind?: RequestPermissionRequest['toolCall']['kind'],
): RequestPermissionRequest {
  return {
    sessionId: 'session-1',
    toolCall: {
      toolCallId: 'tool-1',
      title,
      kind,
      rawInput: { command: 'rm file' },
    },
    options: [
      { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
      { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
    ],
  };
}

describe('ACP protocol boundary', () => {
  it('maps text, thoughts, tool calls, results, and plans to AgentMessage', () => {
    expect(
      mapAcpSessionUpdate({
        sessionId: 's',
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'hello' },
        },
      }),
    ).toEqual([{ type: 'text', content: 'hello' }]);
    expect(
      mapAcpSessionUpdate({
        sessionId: 's',
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'tool-1',
          title: 'Write',
          rawInput: { path: 'a.txt' },
        },
      }),
    ).toEqual([
      {
        type: 'tool_use',
        id: 'tool-1',
        name: 'Write',
        input: { path: 'a.txt' },
      },
    ]);
    expect(
      mapAcpSessionUpdate({
        sessionId: 's',
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'tool-1',
          status: 'failed',
          rawOutput: { error: 'denied' },
        },
      }),
    ).toEqual([
      {
        type: 'tool_result',
        toolUseId: 'tool-1',
        output: '{"error":"denied"}',
        isError: true,
      },
    ]);
  });

  it('routes ACP permission denials through Neuma policy', async () => {
    const registry = new ToolPermissionRegistry({
      alwaysAllow: [],
      alwaysAsk: [],
      alwaysDeny: ['Write'],
    });
    await expect(
      resolveAcpPermissionRequest(registry, permissionRequest('Write')),
    ).resolves.toEqual({
      outcome: { outcome: 'selected', optionId: 'reject' },
    });
  });

  it('uses host mediation for ask decisions', async () => {
    const mediator = vi.fn(async () => 'allow');
    await expect(
      resolveAcpPermissionRequest(
        new ToolPermissionRegistry({
          alwaysAllow: [],
          alwaysAsk: ['Bash'],
          alwaysDeny: [],
        }),
        permissionRequest('Bash'),
        mediator,
      ),
    ).resolves.toEqual({ outcome: { outcome: 'selected', optionId: 'allow' } });
    expect(mediator).toHaveBeenCalledOnce();
  });

  it('maps ACP tool kinds into Neuma permission classifications', async () => {
    const mediator = vi.fn(async () => 'allow');
    await resolveAcpPermissionRequest(
      new ToolPermissionRegistry(),
      permissionRequest('Run arbitrary command', 'execute'),
      mediator,
    );
    expect(mediator).toHaveBeenCalledOnce();
  });

  it('loads sessions only when the capability was negotiated', () => {
    expect(shouldLoadAcpSession({ loadSession: true }, 'session-1')).toBe(true);
    expect(shouldLoadAcpSession({}, 'session-1')).toBe(false);
    expect(shouldLoadAcpSession({ loadSession: true }, undefined)).toBe(false);
  });

  it('rejects incompatible protocol versions', () => {
    expect(() => assertAcpProtocolVersion(999)).toThrow(
      /Unsupported ACP protocol version/,
    );
  });

  it('normalizes camelCase and snake_case usage', () => {
    expect(
      normalizeAcpUsage({
        inputTokens: 10,
        output_tokens: 4,
        cachedReadTokens: 3,
      }),
    ).toEqual({
      input_tokens: 10,
      output_tokens: 4,
      cache_read_input_tokens: 3,
      cache_creation_input_tokens: undefined,
    });
  });

  it('emits one terminal tool result and flushes incomplete calls', () => {
    const tracker = new AcpToolCallTracker();
    const started = {
      sessionId: 's',
      update: {
        sessionUpdate: 'tool_call' as const,
        toolCallId: 'tool-1',
        title: 'Write',
      },
    };
    expect(tracker.map(started)).toHaveLength(1);
    expect(tracker.map(started)).toEqual([]);
    expect(tracker.flush('cancelled')).toEqual([
      {
        type: 'tool_result',
        toolUseId: 'tool-1',
        output: 'cancelled',
        isError: true,
      },
    ]);
    expect(tracker.flush('cancelled')).toEqual([]);
  });
});
