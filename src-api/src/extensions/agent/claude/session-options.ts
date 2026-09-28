import type { Options } from '@anthropic-ai/claude-agent-sdk';

import type { AgentOptions } from '@/core/agent/types';

/**
 * SDK session options for a run. A conversation-branch session (issue #74)
 * takes precedence: `fork` resumes the parent with `forkSession` so the copy
 * is written under the run's own `sessionId`; `resume` continues the branch's
 * session, where the SDK rejects an explicit `sessionId`.
 */
export function claudeSessionOptions(
  options:
    | Pick<AgentOptions, 'sessionId' | 'resumeSessionId' | 'branchSession'>
    | undefined,
): Pick<Options, 'sessionId' | 'resume' | 'forkSession'> {
  const branch = options?.branchSession;
  if (branch?.kind === 'fork') {
    return {
      resume: branch.parentSessionId,
      forkSession: true,
      ...(options?.sessionId ? { sessionId: options.sessionId } : {}),
    };
  }
  if (branch?.kind === 'resume') return { resume: branch.sessionId };
  return {
    // SDK session persistence — pass session ID for resume capability
    ...(options?.sessionId ? { sessionId: options.sessionId } : {}),
    // Resume a previous SDK session
    ...(options?.resumeSessionId ? { resume: options.resumeSessionId } : {}),
  };
}
