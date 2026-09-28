import { describe, expect, it } from 'vitest';

import { claudeSessionOptions } from '@/extensions/agent/claude/session-options';

describe('claudeSessionOptions', () => {
  it('keeps the per-run session id and resume passthrough', () => {
    expect(claudeSessionOptions({ sessionId: 'run-session' })).toEqual({
      sessionId: 'run-session',
    });
    expect(
      claudeSessionOptions({
        sessionId: 'run-session',
        resumeSessionId: 'old',
      }),
    ).toEqual({ sessionId: 'run-session', resume: 'old' });
    expect(claudeSessionOptions(undefined)).toEqual({});
  });

  it('forks the parent session into the run session id', () => {
    expect(
      claudeSessionOptions({
        sessionId: 'run-session',
        resumeSessionId: 'ignored',
        branchSession: { kind: 'fork', parentSessionId: 'parent' },
      }),
    ).toEqual({
      resume: 'parent',
      forkSession: true,
      sessionId: 'run-session',
    });
  });

  it('resumes a branch session without an explicit session id', () => {
    expect(
      claudeSessionOptions({
        sessionId: 'run-session',
        branchSession: { kind: 'resume', sessionId: 'branch' },
      }),
    ).toEqual({ resume: 'branch' });
  });
});
