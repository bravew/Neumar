import { describe, expect, it } from 'vitest';

import { piLocalPlugin } from '@/extensions/agent/pi-local';
import {
  buildPiAbortCommand,
  buildPiExtensionUiResponse,
  buildPiPromptCommand,
  buildPiRpcArgs,
  mapPiRpcEvent,
} from '@/extensions/agent/pi-local/rpc';

describe('Pi local adapter', () => {
  it('declares a local RPC CLI provider', () => {
    expect(piLocalPlugin.metadata).toMatchObject({
      type: 'pi-local',
      transport: 'cli',
      requiresBinary: true,
      supportsStreaming: true,
      supportsMcp: 'native',
      supportsPlanMode: 'orchestrated',
      supportsEnvironmentTest: true,
      supportsModelDiscovery: true,
    });
  });

  it('builds pi rpc args with model, reasoning, and absolute extra dirs', () => {
    expect(
      buildPiRpcArgs({
        model: 'anthropic/claude-sonnet-4-6',
        reasoning: 'high',
        extraAllowedDirs: ['/tmp/skills', 'relative', '/tmp/data'],
      }),
    ).toEqual([
      '--mode',
      'rpc',
      '--model',
      'anthropic/claude-sonnet-4-6',
      '--thinking',
      'high',
      '--append-system-prompt',
      'You may also access these additional workspace directories outside the current working directory:\n- /tmp/skills\n- /tmp/data',
    ]);
    expect(buildPiRpcArgs({ model: 'default', reasoning: 'default' })).toEqual([
      '--mode',
      'rpc',
    ]);
    expect(
      buildPiRpcArgs({
        model: 'default',
        reasoning: 'default',
        extraAllowedDirs: ['relative', './nope'],
      }),
    ).toEqual(['--mode', 'rpc']);
  });

  it('builds prompt and abort JSON-RPC commands', () => {
    expect(JSON.parse(buildPiPromptCommand(7, 'hello'))).toEqual({
      id: 7,
      type: 'prompt',
      message: 'hello',
    });
    expect(
      JSON.parse(
        buildPiPromptCommand(9, 'continue', [], {
          parentSession: 'session-prev',
        }),
      ),
    ).toEqual({
      id: 9,
      type: 'prompt',
      message: 'continue',
      parentSession: 'session-prev',
    });
    expect(JSON.parse(buildPiAbortCommand(8))).toEqual({
      id: 8,
      type: 'abort',
    });
  });

  it('auto-resolves extension UI requests', () => {
    expect(
      JSON.parse(
        buildPiExtensionUiResponse({
          id: 1,
          type: 'extension_ui_request',
          method: 'confirm',
        })!,
      ),
    ).toEqual({
      type: 'extension_ui_response',
      id: 1,
      confirmed: true,
    });
    expect(
      JSON.parse(
        buildPiExtensionUiResponse({
          id: 2,
          type: 'extension_ui_request',
          method: 'select',
          params: { options: [{ label: 'First', value: 'first' }] },
        })!,
      ),
    ).toEqual({
      type: 'extension_ui_response',
      id: 2,
      value: 'First',
    });
    expect(
      buildPiExtensionUiResponse({
        id: 3,
        type: 'extension_ui_request',
        method: 'notify',
      }),
    ).toBeNull();
  });

  it('maps text, thinking, tool, usage, and terminal events', () => {
    const context = { runStartedAt: Date.now(), sentFirstToken: false };
    const text = mapPiRpcEvent(
      {
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: 'hi' },
      },
      context,
    );
    expect(text.messages).toEqual([{ type: 'text', content: 'hi' }]);
    expect(text.sentFirstToken).toBe(true);

    const thinking = mapPiRpcEvent(
      {
        type: 'message_update',
        assistantMessageEvent: { type: 'thinking_delta', delta: 'hmm' },
      },
      { ...context, sentFirstToken: true },
    );
    expect(thinking.messages).toEqual([{ type: 'thinking', content: 'hmm' }]);

    const tool = mapPiRpcEvent(
      {
        type: 'tool_execution_start',
        toolCallId: 't1',
        toolName: 'read',
        args: { path: 'a.ts' },
      },
      context,
    );
    expect(tool.messages[0]).toMatchObject({
      type: 'tool_use',
      id: 't1',
      name: 'read',
      input: { path: 'a.ts' },
    });

    const usage = mapPiRpcEvent(
      {
        type: 'turn_end',
        message: { usage: { input: 4, output: 5, cacheRead: 6 } },
      },
      context,
    );
    expect(usage.messages[0]).toMatchObject({
      type: 'result',
      usage: {
        input_tokens: 4,
        output_tokens: 5,
        cache_read_input_tokens: 6,
      },
    });

    expect(mapPiRpcEvent({ type: 'agent_end' }, context).terminal).toBe(true);
  });

  it('surfaces pi error frames as agent errors', () => {
    expect(
      mapPiRpcEvent(
        {
          type: 'message_update',
          assistantMessageEvent: { type: 'error', reason: 'model failed' },
        },
        { runStartedAt: Date.now(), sentFirstToken: false },
      ).messages[0],
    ).toEqual({ type: 'error', message: 'model failed' });

    expect(
      mapPiRpcEvent(
        { type: 'auto_retry_end', success: false, finalError: 'retry failed' },
        { runStartedAt: Date.now(), sentFirstToken: false },
      ).messages[0],
    ).toEqual({ type: 'error', message: 'retry failed' });

    expect(
      mapPiRpcEvent(
        { type: 'turn_error', error: 'provider quota exceeded' },
        { runStartedAt: Date.now(), sentFirstToken: false },
      ).messages[0],
    ).toEqual({ type: 'error', message: 'provider quota exceeded' });
  });
});
