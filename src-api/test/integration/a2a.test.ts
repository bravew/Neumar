import { describe, expect, it } from 'vitest';

import { A2ATaskState } from '@/extensions/agent/a2a/types';

describe('A2A Protocol Integration', () => {
  describe('A2A types', () => {
    it('has all 8 TASK_STATE prefixed constants', () => {
      expect(A2ATaskState.SUBMITTED).toBe('TASK_STATE_SUBMITTED');
      expect(A2ATaskState.WORKING).toBe('TASK_STATE_WORKING');
      expect(A2ATaskState.INPUT_REQUIRED).toBe('TASK_STATE_INPUT_REQUIRED');
      expect(A2ATaskState.AUTH_REQUIRED).toBe('TASK_STATE_AUTH_REQUIRED');
      expect(A2ATaskState.COMPLETED).toBe('TASK_STATE_COMPLETED');
      expect(A2ATaskState.FAILED).toBe('TASK_STATE_FAILED');
      expect(A2ATaskState.CANCELED).toBe('TASK_STATE_CANCELED');
      expect(A2ATaskState.REJECTED).toBe('TASK_STATE_REJECTED');
    });
  });

  describe('A2AClient', () => {
    it('rejects private IPs (SSRF)', async () => {
      const { A2AClient } = await import('@/extensions/agent/a2a/client');
      expect(() => new A2AClient('http://10.0.0.1/agent')).toThrow(
        /validation failed/i,
      );

      expect(() => new A2AClient('http://192.168.1.1/agent')).toThrow(
        /validation failed/i,
      );

      expect(() => new A2AClient('http://172.16.0.1/agent')).toThrow(
        /validation failed/i,
      );
    });

    it('allows localhost for local agents', async () => {
      const { A2AClient } = await import('@/extensions/agent/a2a/client');
      // Should not throw — localhost is allowed
      const client = new A2AClient('http://localhost:9999/agent');
      expect(client).toBeTruthy();
    });
  });

  describe('A2A plugin', () => {
    it('has correct transport and capabilities', async () => {
      const { a2aPlugin } = await import('@/extensions/agent/a2a');
      const meta = a2aPlugin.metadata;
      expect(meta.type).toBe('a2a');
      expect(meta.transport).toBe('a2a');
      expect(meta.supportsMcp).toBe('none');
      expect(meta.supportsSkills).toBe('none');
      expect(meta.supportsPlanMode).toBe('none');
      expect(meta.requiresApiKey).toBe(false);
      expect(meta.supportsEnvironmentTest).toBe(true);
    });

    it('testEnvironment returns unhealthy without baseUrl', async () => {
      const { a2aPlugin } = await import('@/extensions/agent/a2a');
      const report = await a2aPlugin.testEnvironment!({
        provider: 'a2a',
      });
      expect(report.healthy).toBe(false);
      expect(report.errors).toContain('No A2A agent URL configured');
    });

    it('testEnvironment returns report with unreachable URL', async () => {
      const { a2aPlugin } = await import('@/extensions/agent/a2a');
      const report = await a2aPlugin.testEnvironment!({
        provider: 'a2a',
        baseUrl: 'http://localhost:59999',
      });
      expect(report.healthy).toBe(false);
      expect(report.errors.length).toBeGreaterThan(0);
    });
  });

  describe('Task state mapping', () => {
    it('all 8 states have distinct values', () => {
      const values = Object.values(A2ATaskState);
      const unique = new Set(values);
      expect(unique.size).toBe(8);
    });

    it('all values start with TASK_STATE_', () => {
      for (const value of Object.values(A2ATaskState)) {
        expect(value).toMatch(/^TASK_STATE_/);
      }
    });
  });
});
