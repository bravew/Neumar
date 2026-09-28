/**
 * Stop ends background sub-agents and Bash tasks (issue #76 / C6).
 *
 * Decision (2026-09-27, final — see
 * dev-doc/plan/2026-09-27-post-upgrade-sdk-feature-adoption.md, C6): Stop
 * must stop background agents too. `perTaskStopAffordance` stays off — the
 * SDK's documented default already stops background agents and workflows on
 * interrupt, and Neumar's Stop aborts the session's `AbortController`, which
 * is the exact controller passed to the Claude SDK `query()` call for every
 * message in the turn (see the
 * `abortController: options?.abortController || session.abortController`
 * wiring at the SDK call sites in `extensions/agent/claude/index.ts`). That
 * ends the CLI process and, per the SDK, its child tasks with it.
 *
 * The production `POST /stop/:sessionId` route (`app/api/agent.ts`) calls
 * `deleteSession(sessionId)`, which is `SessionManager.delete()` —
 * `session.abortController.abort('Session deleted')` followed by evicting
 * the session from the LRU cache. `stopAgent(sessionId)` is a separate,
 * sibling export in `shared/services/agent.ts` that does the plain
 * `abortController.abort()` half of the same thing, but as of this PR it is
 * not called from any production route or caller (`rg -w stopAgent
 * src-api/src` matches only its own definition) — so a regression test
 * targeting only `stopAgent` would provide zero coverage for the code path
 * Stop actually runs. This test drives `deleteSession`, the function the
 * real route calls, and covers `stopAgent` separately as its own
 * (currently unwired) unit.
 *
 * This test proves Neumar's half of the interrupt contract: `deleteSession`
 * aborts the SAME `AbortController` instance an `IAgent.run()` call
 * receives for the session, and once aborted, a well-behaved agent stream
 * (modeling the SDK's documented "kill the CLI process and its background
 * tasks on interrupt" behavior) stops producing
 * `task_notification`/`task_progress` for tasks that were still running in
 * the background — the stream simply ends, it does not report them
 * completing normally. A real Claude CLI subprocess cannot be exercised in
 * this sandboxed test environment (no network/API credentials), so the fake
 * stream below stands in for it, driven by the real production
 * `createSession`/`deleteSession` functions.
 */
import { describe, expect, it } from 'vitest';

import type { AgentMessage } from '@/core/agent';

import {
  createSession,
  deleteSession,
  stopAgent,
} from '@/shared/services/agent';

/**
 * Stands in for `ClaudeAgent.run()` on a turn that launched a background
 * sub-agent (Agent tool, `run_in_background`) and a background Bash task.
 * Mirrors the SDK's task_started -> task_progress -> task_notification
 * lifecycle mapped onto Neumar's step_started/step_finished/task_progress
 * AgentMessage shapes (see the task_started/task_notification/task_progress
 * handling in `extensions/agent/claude/index.ts`).
 */
async function* fakeBackgroundTaskRun(
  abortController: AbortController,
): AsyncGenerator<AgentMessage> {
  yield {
    type: 'step_started',
    stepName: 'sub-agent: researcher',
    id: 'bg-agent-1',
  };
  yield {
    type: 'step_started',
    stepName: 'bash: sleep 300 &',
    id: 'bg-bash-1',
  };

  // The SDK kills the CLI process (and every background task with it) as
  // soon as the AbortController fires — poll the signal instead of a fixed
  // delay so the test is fast and deterministic either way.
  let ticks = 0;
  while (!abortController.signal.aborted && ticks < 200) {
    await new Promise((resolve) => setTimeout(resolve, 2));
    ticks++;
  }

  if (abortController.signal.aborted) {
    // Process killed — no further task_notification/task_progress for
    // either background task, and no step_finished reporting a normal
    // completion. The stream just ends here.
    return;
  }

  // Only reached if Stop failed to abort within the poll window — a bug in
  // the stop path this test exists to catch.
  yield {
    type: 'system',
    subtype: 'task_progress',
    id: 'bg-agent-1',
    isProgress: true,
  };
  yield {
    type: 'step_finished',
    stepName: 'sub-agent: researcher',
    id: 'bg-agent-1',
  };
  yield {
    type: 'step_finished',
    stepName: 'bash: sleep 300 &',
    id: 'bg-bash-1',
  };
}

describe('Stop (deleteSession, the real POST /stop/:sessionId path) ends background sub-agents and Bash tasks', () => {
  it('aborts the exact AbortController the stream was started with, and no further task events for the backgrounded work reach the stream', async () => {
    const session = createSession('execute');
    expect(session.abortController.signal.aborted).toBe(false);

    const stream = fakeBackgroundTaskRun(session.abortController);
    const collected: AgentMessage[] = [];

    // Drain the two step_started events — "start a turn that launches a
    // background sub-agent and a background Bash task".
    collected.push((await stream.next()).value as AgentMessage);
    collected.push((await stream.next()).value as AgentMessage);
    expect(collected.map((m) => m.id)).toEqual(['bg-agent-1', 'bg-bash-1']);

    // "press Stop" — the exact function POST /stop/:sessionId calls.
    const deleted = deleteSession(session.id);
    expect(deleted).toBe(true);

    // Drain the rest of the stream.
    for await (const msg of stream) {
      collected.push(msg);
    }

    expect(session.abortController.signal.aborted).toBe(true);

    // No task_notification/task_progress, and no step_finished reporting a
    // normal completion, for either backgrounded task after Stop.
    const postStopSignals = collected.filter(
      (m) =>
        m.type === 'step_finished' ||
        (m.type === 'system' && m.subtype === 'task_progress'),
    );
    expect(postStopSignals).toEqual([]);
  });

  it('deleteSession is a no-op (returns false) for an unknown session', () => {
    expect(deleteSession('does-not-exist')).toBe(false);
  });
});

describe('stopAgent (currently unwired to any production route)', () => {
  // Kept as its own coverage since `stopAgent` is still a public export of
  // shared/services/agent.ts, but this does NOT stand in for coverage of
  // the real Stop route — see the file header and the deleteSession-driven
  // suite above for that.
  it('aborts the same AbortController the stream was started with', async () => {
    const session = createSession('execute');
    const stream = fakeBackgroundTaskRun(session.abortController);
    await stream.next();
    await stream.next();

    stopAgent(session.id);

    for await (const _msg of stream) {
      // drain
    }
    expect(session.abortController.signal.aborted).toBe(true);
  });

  it('is a no-op for an unknown session (already cleaned up)', () => {
    expect(() => stopAgent('does-not-exist')).not.toThrow();
  });
});

describe('perTaskStopAffordance stays off (2026-09-27 decision)', () => {
  it('the Claude adapter never sets perTaskStopAffordance', async () => {
    // Decision, final: Stop must stop background agents too, so
    // `perTaskStopAffordance` (which would let a background task survive an
    // interrupt) must not be set anywhere in the Claude adapter. This is a
    // structural guard against re-introducing it.
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const adapterPath = path.resolve(
      import.meta.dirname,
      '../../../src/extensions/agent/claude/index.ts',
    );
    const source = await fs.readFile(adapterPath, 'utf8');
    expect(source).not.toContain('perTaskStopAffordance');
  });
});
