import { describe, expect, it } from 'vitest';

import {
  isDerivableContent,
  shouldCapture,
} from '@/shared/services/memory/capturer';

describe('isDerivableContent', () => {
  // ── Git output ──

  it('rejects git commit log output', () => {
    expect(isDerivableContent('commit a1b2c3d4e5f6 Author: Jane Doe')).toBe(
      true,
    );
  });

  it('rejects merge branch messages', () => {
    expect(isDerivableContent('Merge branch "feature/x" into main')).toBe(true);
    expect(isDerivableContent('Merge pull request #42 from org/branch')).toBe(
      true,
    );
  });

  it('rejects git author lines', () => {
    expect(isDerivableContent('Author: Jane Doe <jane@example.com>')).toBe(
      true,
    );
  });

  // ── Stack traces ──

  it('rejects JavaScript stack traces', () => {
    expect(
      isDerivableContent(
        'Error: Something failed\n    at Module.run (src/index.ts:42:10)',
      ),
    ).toBe(true);
  });

  it('rejects Python stack traces', () => {
    expect(
      isDerivableContent('  File "/app/main.py", line 42, in <module>'),
    ).toBe(true);
  });

  // ── Code blocks ──

  it('rejects messages with substantial code blocks', () => {
    const code = '```\n' + 'const x = 1;\n'.repeat(10) + '```';
    expect(isDerivableContent(code)).toBe(true);
  });

  it('allows messages with small code blocks', () => {
    expect(isDerivableContent('Use `npm install` to install')).toBe(false);
  });

  // ── File path heavy ──

  it('rejects messages dominated by file paths', () => {
    const paths =
      '/src/components/App.tsx /src/utils/helpers.ts /src/hooks/useAuth.ts /src/config/theme.ts';
    expect(isDerivableContent(paths)).toBe(true);
  });

  it('allows messages with a few file paths', () => {
    expect(
      isDerivableContent('I moved /src/utils/helpers.ts to a new location'),
    ).toBe(false);
  });

  // ── Normal content ──

  it('allows personal preferences', () => {
    expect(isDerivableContent('I prefer dark mode for all editors')).toBe(
      false,
    );
  });

  it('allows decisions', () => {
    expect(
      isDerivableContent('We decided to use PostgreSQL instead of MySQL'),
    ).toBe(false);
  });
});

describe('shouldCapture integration', () => {
  it('rejects git log even when trigger matches', () => {
    const gitLog = 'commit abcdef1234567\nI merged the feature branch';
    expect(shouldCapture(gitLog)).toBeNull();
  });

  it('allows a genuine preference with a trigger', () => {
    expect(shouldCapture('I prefer TypeScript over JavaScript')).toBe(
      'I prefer TypeScript over JavaScript',
    );
  });

  // ── Question rejection ──

  it('rejects questions ending with ?', () => {
    expect(
      shouldCapture('which mode do I prefer when using Vim keybindings?'),
    ).toBeNull();
  });

  it('rejects questions starting with question words', () => {
    expect(shouldCapture('what do I like about TypeScript?')).toBeNull();
    expect(shouldCapture('how do I always format code?')).toBeNull();
    expect(shouldCapture('do I prefer dark mode?')).toBeNull();
  });

  it('allows declarative statements that contain question words mid-sentence', () => {
    // "I prefer what works" — "what" is not at the start, not a question
    expect(shouldCapture('I always use whatever works best')).toBe(
      'I always use whatever works best',
    );
  });

  it('rejects Chinese questions', () => {
    // "什么..." doesn't match triggers, so it would be rejected anyway
    // But "我喜欢什么？" has trigger "我喜欢" + question mark
    expect(shouldCapture('我喜欢什么？')).toBeNull();
  });
});
