import { describe, expect, it } from 'vitest';

import {
  AGENT_TYPE_IDS,
  normalizeAgentType,
  stripRuntimeModelPrefix,
} from '@/core/agent/runtime-ids';

describe('runtime-ids', () => {
  it('accepts the canonical local CLI runtime ids', () => {
    for (const id of [
      'claude',
      'codex',
      'cursor-agent',
      'qwen',
      'copilot',
      'kimi',
      'atomcode',
    ]) {
      expect(AGENT_TYPE_IDS).toContain(id);
    }
  });

  it('normalizes the stale cursor-local alias to cursor-agent', () => {
    expect(normalizeAgentType('cursor-local')).toBe('cursor-agent');
    expect(normalizeAgentType('cursor-agent')).toBe('cursor-agent');
    expect(normalizeAgentType('claude')).toBe('claude');
  });

  it('strips only the owning runtime prefix from model ids', () => {
    expect(stripRuntimeModelPrefix('cursor-agent', 'cursor-agent:auto')).toBe(
      'auto',
    );
    expect(stripRuntimeModelPrefix('qwen', 'qwen3-coder-plus')).toBe(
      'qwen3-coder-plus',
    );
    expect(stripRuntimeModelPrefix('copilot', 'codex:gpt-5.5')).toBe(
      'codex:gpt-5.5',
    );
    expect(stripRuntimeModelPrefix('cursor-agent', undefined)).toBeUndefined();
    // A bare "<runtime>:" prefix with no model yields undefined (use default)
    expect(
      stripRuntimeModelPrefix('cursor-agent', 'cursor-agent:'),
    ).toBeUndefined();
  });
});
