import { describe, expect, it } from 'vitest';

import {
  NativeProvider,
  createNativeProvider,
} from '@/extensions/sandbox/native';

/**
 * NativeProvider hardening contract (Phase 7 Task 3):
 *  - Default exec uses spawn(..., { shell: false }) — verified indirectly by
 *    rejecting shell metacharacter commands without invoking a shell.
 *  - trustedShell mode is explicit, logged, and never marketplace-eligible.
 */

describe('NativeProvider shell semantics', () => {
  it('rejects shell metacharacters in command without trustedShell', async () => {
    const p = new NativeProvider();
    const result = await p.exec({ command: 'echo hi && ls', args: [] });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/shell metacharacters/i);
  });

  it('runs a simple command without a shell when no metachars are present', async () => {
    const p = new NativeProvider();
    // `node -e ...` without spaces in `command` and operands as args[] is the
    // sanctioned shape; this proves the spawn path actually runs.
    const result = await p.exec({
      command: 'node',
      args: ['-e', 'process.stdout.write("ok")'],
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('ok');
  });

  it('reports enforcement none and not marketplace-eligible by default', () => {
    const c = new NativeProvider().getCapabilities();
    expect(c.enforcement).toBe('none');
    expect(c.isolation).toBe('none');
    expect(c.marketplaceEligible).toBe(false);
    expect(c.reducedIsolationReason).toBeUndefined();
  });

  it('flags reducedIsolationReason when trustedShell is enabled, still not marketplace-eligible', async () => {
    const p = createNativeProvider({
      config: { trustedShell: true, shell: '/bin/sh' },
    });
    // init is called inside the factory; await any deferred work
    await new Promise((r) => setTimeout(r, 0));
    const c = p.getCapabilities();
    expect(c.enforcement).toBe('none');
    expect(c.marketplaceEligible).toBe(false);
    expect(c.reducedIsolationReason).toMatch(/trustedShell/);
  });
});
