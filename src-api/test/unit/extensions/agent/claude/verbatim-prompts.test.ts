import { describe, expect, it } from 'vitest';

import {
  selectClaudePathForVerbatim,
  supportsVerbatimPrompts,
  VERBATIM_PROMPTS_MIN_VERSION,
} from '@/extensions/agent/claude/verbatim-prompts';

describe('verbatim prompt CLI gate', () => {
  it('requires Claude Code 2.1.248 or later', () => {
    expect(supportsVerbatimPrompts('2.1.247')).toBe(false);
    expect(supportsVerbatimPrompts(VERBATIM_PROMPTS_MIN_VERSION)).toBe(true);
    expect(supportsVerbatimPrompts('2.2.0')).toBe(true);
    expect(supportsVerbatimPrompts('1.9.9')).toBe(false);
    expect(supportsVerbatimPrompts(undefined)).toBe(false);
    expect(supportsVerbatimPrompts('2.1')).toBe(false);
  });

  it('keeps the preferred CLI when verbatim prompts are not required', () => {
    const result = selectClaudePathForVerbatim({
      preferredPath: '/usr/local/bin/claude',
      preferredVersion: '2.1.100',
      verbatimRequired: false,
    });
    expect(result).toEqual({
      ok: true,
      choice: {
        path: '/usr/local/bin/claude',
        version: '2.1.100',
        usedSidecarFallback: false,
      },
    });
  });

  it('falls back to a new enough bundled CLI', () => {
    const result = selectClaudePathForVerbatim({
      preferredPath: '/usr/local/bin/claude',
      preferredVersion: '2.1.100',
      sidecarPath: '/app/claude',
      sidecarVersion: '2.1.248',
      verbatimRequired: true,
    });
    expect(result).toEqual({
      ok: true,
      choice: {
        path: '/app/claude',
        version: '2.1.248',
        usedSidecarFallback: true,
      },
    });
  });

  it('refuses the run when every CLI is too old or unreadable', () => {
    const result = selectClaudePathForVerbatim({
      preferredPath: '/usr/local/bin/claude',
      preferredVersion: undefined,
      sidecarPath: '/app/claude',
      sidecarVersion: '2.1.200',
      verbatimRequired: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('refused');
      expect(result.message).toContain(VERBATIM_PROMPTS_MIN_VERSION);
    }
  });
});
