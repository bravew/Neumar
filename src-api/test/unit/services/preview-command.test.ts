import { describe, expect, it } from 'vitest';

import { resolvePreviewCommand } from '@/shared/services/preview';

describe('resolvePreviewCommand', () => {
  it('uses cmd shims for npm tools on Windows without requiring shell execution', () => {
    expect(resolvePreviewCommand('npm', 'win32')).toBe('npm.cmd');
    expect(resolvePreviewCommand('npx', 'win32')).toBe('npx.cmd');
  });

  it('keeps direct executable names on POSIX platforms', () => {
    expect(resolvePreviewCommand('npm', 'darwin')).toBe('npm');
    expect(resolvePreviewCommand('npx', 'linux')).toBe('npx');
    expect(resolvePreviewCommand('node', 'win32')).toBe('node');
  });
});
