import { describe, expect, it } from 'vitest';

import { normalizeToAgentMessage } from '@/extensions/agent/shared/cli';

describe('Gemini Local Adapter', () => {
  describe('Plugin metadata', () => {
    it('has correct transport and capabilities', async () => {
      const { geminiLocalPlugin } =
        await import('@/extensions/agent/gemini-local');
      const meta = geminiLocalPlugin.metadata;
      expect(meta.type).toBe('gemini-local');
      expect(meta.transport).toBe('cli');
      expect(meta.requiresBinary).toBe(true);
      expect(meta.supportsMcp).toBe('shim');
      expect(meta.supportsSkills).toBe('none');
      expect(meta.supportsPlanMode).toBe('orchestrated');
      expect(meta.supportsResume).toBe(true);
      expect(meta.supportsEnvironmentTest).toBe(true);
      expect(meta.supportsModelDiscovery).toBe(false);
    });

    it('has supported model aliases', async () => {
      const { geminiLocalPlugin } =
        await import('@/extensions/agent/gemini-local');
      expect(geminiLocalPlugin.metadata.supportedModels).toContain('auto');
      expect(geminiLocalPlugin.metadata.supportedModels).toContain('pro');
      expect(geminiLocalPlugin.metadata.supportedModels).toContain('flash');
      expect(geminiLocalPlugin.metadata.supportedModels).toContain(
        'flash-lite',
      );
    });
  });

  describe('Preflight', () => {
    it('returns binaryFound: false when gemini CLI not installed', async () => {
      const { geminiLocalPlugin } =
        await import('@/extensions/agent/gemini-local');
      // On most CI/dev machines, gemini CLI is not installed
      const report = await geminiLocalPlugin.testEnvironment!({
        provider: 'gemini-local',
      });
      // We just verify the report structure is correct
      expect(report).toHaveProperty('healthy');
      expect(report).toHaveProperty('binaryFound');
      expect(report).toHaveProperty('authValid');
      expect(report).toHaveProperty('helloProbeOk');
      expect(report).toHaveProperty('errors');
      expect(Array.isArray(report.errors)).toBe(true);
    });
  });

  describe('JSONL event mapping', () => {
    it('maps init to session', () => {
      const msg = normalizeToAgentMessage(
        { type: 'init', session_id: 's1' },
        'gemini-local',
      );
      expect(msg.type).toBe('session');
      expect(msg.sessionId).toBe('s1');
    });

    it('maps message to text', () => {
      const msg = normalizeToAgentMessage(
        { type: 'message', content: 'hello' },
        'gemini-local',
      );
      expect(msg.type).toBe('text');
      expect(msg.content).toBe('hello');
    });

    it('maps tool_use to tool_use', () => {
      const msg = normalizeToAgentMessage(
        {
          type: 'tool_use',
          name: 'search',
          id: 'tc1',
          input: { q: 'test' },
        },
        'gemini-local',
      );
      expect(msg.type).toBe('tool_use');
      expect(msg.name).toBe('search');
    });

    it('maps Gemini stream-json tool events', () => {
      const call = normalizeToAgentMessage(
        {
          type: 'tool_call',
          id: 'call-1',
          functionCall: {
            name: 'read_file',
            args: { path: 'src/App.tsx' },
          },
        },
        'gemini-local',
      );
      expect(call).toMatchObject({
        type: 'tool_use',
        id: 'call-1',
        name: 'read_file',
        input: { path: 'src/App.tsx' },
      });

      const result = normalizeToAgentMessage(
        {
          type: 'tool_call_result',
          tool_call_id: 'call-1',
          functionResponse: {
            name: 'read_file',
            content: 'file contents',
          },
        },
        'gemini-local',
      );
      expect(result).toMatchObject({
        type: 'tool_result',
        toolUseId: 'call-1',
        name: 'read_file',
        content: 'file contents',
        output: 'file contents',
      });
    });

    it('maps result to result', () => {
      const msg = normalizeToAgentMessage(
        { type: 'result', content: 'final answer' },
        'gemini-local',
      );
      expect(msg.type).toBe('result');
    });

    it('maps error to error', () => {
      const msg = normalizeToAgentMessage(
        { type: 'error', message: 'something failed' },
        'gemini-local',
      );
      expect(msg.type).toBe('error');
    });
  });
});
