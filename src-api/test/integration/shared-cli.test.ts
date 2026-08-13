import { Readable } from 'stream';

import { describe, expect, it } from 'vitest';

import {
  assertBinaryExists,
  mergeEnv,
  normalizeToAgentMessage,
  parseJsonlStream,
  redactForLog,
  resolveBinaryPath,
  validateCwd,
  withTimeout,
} from '@/extensions/agent/shared/cli';

describe('Shared CLI Utilities', () => {
  describe('resolveBinaryPath', () => {
    it('finds a known binary (node)', () => {
      const result = resolveBinaryPath('node');
      expect(result).not.toBeNull();
      expect(result).toContain('node');
    });

    it('returns null for nonexistent binary', () => {
      const result = resolveBinaryPath('this-binary-does-not-exist-12345');
      expect(result).toBeNull();
    });
  });

  describe('assertBinaryExists', () => {
    it('returns path for existing binary', () => {
      const path = assertBinaryExists('node');
      expect(path).toContain('node');
    });

    it('throws with helpful message for missing binary', () => {
      expect(() => assertBinaryExists('nonexistent-binary-xyz')).toThrow(
        /not found/i,
      );
    });
  });

  describe('validateCwd', () => {
    it('accepts valid absolute directory', () => {
      const result = validateCwd('/tmp');
      expect(result).toBe('/tmp');
    });

    it('rejects relative paths', () => {
      expect(() => validateCwd('./relative')).toThrow(/absolute path/i);
    });

    it('rejects nonexistent directories', () => {
      expect(() => validateCwd('/nonexistent-dir-xyz-99999')).toThrow(
        /does not exist/i,
      );
    });
  });

  describe('mergeEnv', () => {
    it('merges base with overrides', () => {
      const base = { A: '1', B: '2' };
      const overrides = { B: '3', C: '4' };
      const result = mergeEnv(base, overrides);
      expect(result).toEqual({ A: '1', B: '3', C: '4' });
    });
  });

  describe('redactForLog', () => {
    it('redacts API key patterns', () => {
      const env = {
        OPENAI_API_KEY: 'sk-secret',
        PATH: '/usr/bin',
        DB_PASSWORD: 'pass123',
      };
      const redacted = redactForLog(env);
      expect(redacted.OPENAI_API_KEY).toBe('***REDACTED***');
      expect(redacted.DB_PASSWORD).toBe('***REDACTED***');
      expect(redacted.PATH).toBe('/usr/bin');
    });
  });

  describe('parseJsonlStream', () => {
    it('parses valid JSONL', async () => {
      const data = '{"type":"text","content":"hello"}\n{"type":"done"}\n';
      const stream = Readable.from([data]);
      const results: Record<string, unknown>[] = [];
      for await (const obj of parseJsonlStream(stream)) {
        results.push(obj);
      }
      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({
        type: 'text',
        content: 'hello',
      });
      expect(results[1]).toEqual({ type: 'done' });
    });

    it('handles malformed lines gracefully', async () => {
      const data = '{"valid":true}\nnot-json\n{"also":"valid"}\n';
      const stream = Readable.from([data]);
      const results: Record<string, unknown>[] = [];
      for await (const obj of parseJsonlStream(stream)) {
        results.push(obj);
      }
      expect(results).toHaveLength(2);
    });
  });

  describe('normalizeToAgentMessage', () => {
    it('maps known event types to AgentMessage', () => {
      const text = normalizeToAgentMessage(
        { type: 'message', content: 'hi' },
        'test',
      );
      expect(text.type).toBe('text');
      expect(text.content).toBe('hi');
      expect(text.output).toBeUndefined();

      const result = normalizeToAgentMessage(
        { type: 'result', content: 'done' },
        'test',
      );
      expect(result.type).toBe('result');

      const err = normalizeToAgentMessage(
        { type: 'error', message: 'fail' },
        'test',
      );
      expect(err.type).toBe('error');
      expect(err.content).toBe('fail');
    });

    it('maps init to session', () => {
      const msg = normalizeToAgentMessage(
        { type: 'init', sessionId: 'abc' },
        'test',
      );
      expect(msg.type).toBe('session');
      expect(msg.sessionId).toBe('abc');
    });
  });

  describe('withTimeout', () => {
    it('resolves before timeout', async () => {
      const result = await withTimeout(Promise.resolve(42), 1000, 'test');
      expect(result).toBe(42);
    });

    it('rejects after timeout', async () => {
      const slow = new Promise((resolve) => setTimeout(resolve, 5000));
      await expect(withTimeout(slow, 50, 'test-timeout')).rejects.toThrow(
        /Timeout after 50ms/,
      );
    });
  });
});
