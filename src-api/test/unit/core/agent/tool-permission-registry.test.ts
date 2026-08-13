import { describe, expect, it } from 'vitest';

import { ToolPermissionRegistry } from '@/core/agent/tool-permission-registry';

describe('ToolPermissionRegistry', () => {
  describe('default classifications', () => {
    const registry = new ToolPermissionRegistry();

    it('allows Read tools', () => {
      expect(registry.evaluate('Read', {})).toBe('allow');
    });

    it('allows Glob tools', () => {
      expect(registry.evaluate('Glob', {})).toBe('allow');
    });

    it('allows Grep tools', () => {
      expect(registry.evaluate('Grep', {})).toBe('allow');
    });

    it('asks for Bash (execute classification)', () => {
      expect(registry.evaluate('Bash', { command: 'ls' })).toBe('ask');
    });

    it('asks for Task (execute classification)', () => {
      expect(registry.evaluate('Task', {})).toBe('ask');
    });

    it('allows Edit (write classification)', () => {
      expect(registry.evaluate('Edit', {})).toBe('allow');
    });

    it('allows WebFetch (network classification)', () => {
      expect(registry.evaluate('WebFetch', {})).toBe('allow');
    });
  });

  describe('MCP tool classification', () => {
    const registry = new ToolPermissionRegistry();

    it('classifies mcp__ tools as network', () => {
      expect(registry.classifyTool('mcp__github__create_issue')).toBe(
        'network',
      );
    });

    it('allows mcp__ tools by default (network → allow)', () => {
      expect(registry.evaluate('mcp__slack__send_message', {})).toBe('allow');
    });
  });

  describe('deny rules', () => {
    it('deny rules override everything', () => {
      const registry = new ToolPermissionRegistry({
        alwaysAllow: ['Read'],
        alwaysDeny: ['Read'],
        alwaysAsk: [],
      });
      expect(registry.evaluate('Read', {})).toBe('deny');
    });

    it('deny rules with pattern matching', () => {
      const registry = new ToolPermissionRegistry({
        alwaysAllow: [],
        alwaysDeny: ['Bash(rm)'],
        alwaysAsk: [],
      });
      expect(registry.evaluate('Bash', { command: 'rm -rf /' })).toBe('deny');
      expect(registry.evaluate('Bash', { command: 'ls -la' })).toBe('ask'); // Bash is execute → ask
    });
  });

  describe('ask rules', () => {
    it('ask rules checked before classification', () => {
      const registry = new ToolPermissionRegistry({
        alwaysAllow: [],
        alwaysDeny: [],
        alwaysAsk: ['Write'],
      });
      // Write is normally 'allow' (write classification), but ask rule overrides
      expect(registry.evaluate('Write', {})).toBe('ask');
    });
  });

  describe('allow rules', () => {
    it('allow rules override execute classification', () => {
      const registry = new ToolPermissionRegistry({
        alwaysAllow: ['Bash'],
        alwaysDeny: [],
        alwaysAsk: [],
      });
      // Bash is 'execute' → normally 'ask', but allow rule takes precedence
      expect(registry.evaluate('Bash', {})).toBe('allow');
    });
  });

  describe('evaluation order: deny → ask → allow → classification', () => {
    it('follows correct precedence', () => {
      const registry = new ToolPermissionRegistry({
        alwaysAllow: ['Bash'],
        alwaysDeny: ['Bash(dangerous)'],
        alwaysAsk: [],
      });

      // Deny rule matches → deny (deny always wins)
      expect(registry.evaluate('Bash', 'dangerous command')).toBe('deny');

      // No deny match, allow rule matches → allow (allow before classification)
      expect(registry.evaluate('Bash', 'safe command')).toBe('allow');
    });
  });

  describe('addAllowRule', () => {
    it('adds a rule to alwaysAllow', () => {
      const registry = new ToolPermissionRegistry();
      registry.addAllowRule('Bash');
      const rules = registry.getRules();
      expect(rules.alwaysAllow).toContain('Bash');
    });

    it('does not duplicate rules', () => {
      const registry = new ToolPermissionRegistry();
      registry.addAllowRule('Bash');
      registry.addAllowRule('Bash');
      const rules = registry.getRules();
      expect(rules.alwaysAllow.filter((r) => r === 'Bash')).toHaveLength(1);
    });
  });

  describe('custom classification', () => {
    it('overrides built-in classification', () => {
      const registry = new ToolPermissionRegistry();
      registry.setClassification('Read', 'destructive');
      // destructive → ask
      expect(registry.evaluate('Read', {})).toBe('ask');
    });
  });
});
