import { describe, expect, it } from 'vitest';

describe('HTTP Agent Adapter', () => {
  describe('Plugin metadata', () => {
    it('has correct transport and capabilities', async () => {
      const { httpAgentPlugin } = await import('@/extensions/agent/http-agent');
      const meta = httpAgentPlugin.metadata;
      expect(meta.type).toBe('http-agent');
      expect(meta.transport).toBe('http');
      expect(meta.requiresApiKey).toBe(true);
      expect(meta.supportsMcp).toBe('none');
      expect(meta.supportsSkills).toBe('none');
      expect(meta.supportsPlanMode).toBe('none');
      expect(meta.supportsEnvironmentTest).toBe(true);
    });
  });

  describe('SSRF validation', () => {
    it('blocks private IPs', async () => {
      const { httpAgentPlugin } = await import('@/extensions/agent/http-agent');
      const report = await httpAgentPlugin.testEnvironment!({
        provider: 'http-agent',
        baseUrl: 'http://10.0.0.1/api',
      });
      expect(report.healthy).toBe(false);
      expect(report.errors.some((e) => /validation failed/i.test(e))).toBe(
        true,
      );
    });

    it('blocks 172.16.x.x range', async () => {
      const { httpAgentPlugin } = await import('@/extensions/agent/http-agent');
      const report = await httpAgentPlugin.testEnvironment!({
        provider: 'http-agent',
        baseUrl: 'http://172.16.0.1/api',
      });
      expect(report.healthy).toBe(false);
    });

    it('blocks 192.168.x.x range', async () => {
      const { httpAgentPlugin } = await import('@/extensions/agent/http-agent');
      const report = await httpAgentPlugin.testEnvironment!({
        provider: 'http-agent',
        baseUrl: 'http://192.168.1.1/api',
      });
      expect(report.healthy).toBe(false);
    });

    it('allows localhost for local development', async () => {
      const { httpAgentPlugin } = await import('@/extensions/agent/http-agent');
      // This will fail on reachability (no server) but not on SSRF
      const report = await httpAgentPlugin.testEnvironment!({
        provider: 'http-agent',
        baseUrl: 'http://localhost:9999/api',
      });
      // Should not have URL validation failure — only reachability failure
      expect(report.errors.every((e) => !/validation failed/i.test(e))).toBe(
        true,
      );
    });
  });

  describe('Error normalization', () => {
    it('handles missing baseUrl', async () => {
      const { httpAgentPlugin } = await import('@/extensions/agent/http-agent');
      const report = await httpAgentPlugin.testEnvironment!({
        provider: 'http-agent',
      });
      expect(report.healthy).toBe(false);
      expect(report.errors).toContain('No endpoint URL configured');
    });
  });

  describe('testEnvironment', () => {
    it('returns AdapterEnvironmentReport structure', async () => {
      const { httpAgentPlugin } = await import('@/extensions/agent/http-agent');
      const report = await httpAgentPlugin.testEnvironment!({
        provider: 'http-agent',
        baseUrl: 'https://api.example.com',
      });
      expect(report).toHaveProperty('healthy');
      expect(report).toHaveProperty('binaryFound');
      expect(report).toHaveProperty('authValid');
      expect(report).toHaveProperty('helloProbeOk');
      expect(report).toHaveProperty('errors');
      expect(Array.isArray(report.errors)).toBe(true);
    });
  });
});
