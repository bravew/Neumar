import { beforeEach, describe, expect, it, vi } from 'vitest';

import { jsonReq } from '../../helpers/request-factory';

/**
 * A run that reaches a tool-permission prompt ends with an interrupt outcome,
 * and the answer continues the same agent in a new run. Everything between the
 * route and the agent is real: emitter, detached pipeline, event bus, the
 * permission registry, and the hold. Only the agent itself, the database and the
 * persister are replaced.
 */

interface AgentCall {
  taskId: string;
  signal: AbortSignal;
}

const agent = vi.hoisted(() => ({
  script: null as null | ((call: AgentCall) => AsyncGenerator<unknown>),
}));

vi.mock('@/shared/services/agent', () => ({
  createSession: vi.fn(() => ({
    id: `session-${crypto.randomUUID()}`,
    abortController: new AbortController(),
  })),
  runAgent: vi.fn(
    (
      _prompt: string,
      options: {
        taskId: string;
        session: { abortController: AbortController };
      },
    ) =>
      agent.script!({
        taskId: options.taskId,
        signal: options.session.abortController.signal,
      }),
  ),
  runPlanningPhase: vi.fn(),
  runExecutionPhase: vi.fn(),
  resolveAgentProvider: vi.fn().mockReturnValue('claude'),
}));

vi.mock('@/shared/services/branch-sdk-session', () => ({
  resolveBranchContextPlan: vi.fn().mockReturnValue({ path: 'main' }),
  withBranchSdkSessionRecording: vi.fn((stream: AsyncGenerator) => stream),
}));

vi.mock('@/shared/services/ag-ui/journal', () => ({
  journalAGUIEvent: vi.fn(),
  replayAGUIEvents: vi.fn().mockReturnValue([]),
}));

// The Claude adapter owns its own pending prompts; these runs use the shared
// host-permission registry, which is the other half of the answer path.
vi.mock('@/extensions/agent/claude/index', () => ({
  resolvePermission: vi.fn().mockReturnValue(false),
}));

vi.mock('@/shared/services/ag-ui/open-interrupts', () => ({
  listOpenInterrupts: vi.fn(),
}));

vi.mock('@/shared/services/ag-ui/persistence', () => ({
  AGUIEventPersister: class MockAGUIEventPersister {
    runStartedAtMs = Date.now();
    scanOutputArtifacts = vi.fn();
    handleEvent = vi.fn();
  },
}));

vi.mock('@/shared/db/operations', () => ({
  AgentRunConflictError: class AgentRunConflictError extends Error {},
  createFileSnapshot: vi.fn(),
  decideOrchestrationRun: vi.fn(),
  getAgentRun: vi.fn(),
  getFilesByTaskId: vi.fn().mockReturnValue([]),
  getMessagesByTaskId: vi.fn().mockReturnValue([]),
  getOrchestrationRun: vi.fn(),
  getOrchestrationRunsByTaskId: vi.fn().mockReturnValue([]),
  getSetting: vi.fn(),
  getTask: vi.fn().mockImplementation((id: string) => ({
    id,
    work_dir: null,
  })),
  reserveAgentRun: vi.fn().mockImplementation((input) => ({
    disposition: 'created',
    run: { id: input.runId },
  })),
  finishAgentRun: vi.fn(),
  updateOrchestrationRunPayload: vi.fn(),
  updateOrchestrationRunStatus: vi.fn(),
  updateTask: vi.fn(),
}));

vi.mock('@/shared/db/index', () => ({
  getDatabase: vi.fn().mockReturnValue({
    prepare: vi.fn().mockReturnValue({
      run: vi.fn(),
      get: vi.fn(),
      all: vi.fn().mockReturnValue([]),
    }),
  }),
}));

vi.mock('@/core/agent/base', () => ({
  isConversationalPrompt: vi.fn().mockReturnValue(false),
  isSingleActionPrompt: vi.fn().mockReturnValue(false),
}));

vi.mock('@/shared/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('@/shared/utils/url-validator', () => ({
  safeFetch: vi.fn(),
  validateBaseUrl: vi.fn().mockReturnValue({ valid: true }),
  validateBaseUrlForFetch: vi.fn().mockResolvedValue({ valid: true }),
}));

interface WireEvent {
  type: string;
  runId?: string;
  delta?: string;
  messageId?: string;
  patch?: Array<{ op: string; path: string; value: unknown }>;
  outcome?: {
    type: string;
    interrupts?: Array<{ id: string; reason: string }>;
  };
}

async function readEvents(res: Response): Promise<WireEvent[]> {
  const text = await res.text();
  return text
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice('data: '.length)) as WireEvent);
}

const deltas = (events: WireEvent[]): string[] =>
  events
    .filter((event) => event.type === 'TEXT_MESSAGE_CONTENT')
    .map((event) => event.delta ?? '');

const finished = (events: WireEvent[]): WireEvent | undefined =>
  events.find((event) => event.type === 'RUN_FINISHED');

/** The agent text, a Bash permission prompt, then the agent text the answer allows. */
function permissionScript(seen: { approved: boolean | null }) {
  return async function* (call: AgentCall) {
    const { ToolPermissionRegistry, requestHostToolPermission } =
      await import('@/core/agent/tool-permission-registry');
    yield { type: 'text', content: 'before' };
    seen.approved = await requestHostToolPermission({
      taskId: call.taskId,
      sessionId: 'session-1',
      toolName: 'Bash',
      input: { command: 'ls' },
      registry: new ToolPermissionRegistry(),
      signal: call.signal,
    });
    yield { type: 'text', content: `after:${seen.approved}` };
  };
}

function runRequest(taskId: string, runId: string) {
  return jsonReq('/run', {
    threadId: taskId,
    runId,
    // An assistant turn in the history skips planning and runs the agent directly.
    messages: [
      { id: `${runId}-u1`, role: 'user', content: 'First' },
      { id: `${runId}-a1`, role: 'assistant', content: 'Answer' },
      { id: `${runId}-u2`, role: 'user', content: 'Run ls' },
    ],
    forwardedProps: { taskId },
  });
}

function resumeRequest(
  taskId: string,
  runId: string,
  entries: Array<Record<string, unknown>>,
) {
  return jsonReq('/run', {
    threadId: taskId,
    runId,
    messages: [{ id: `${runId}-u`, role: 'user', content: 'Run ls' }],
    forwardedProps: { taskId },
    resume: entries,
  });
}

describe('AG-UI run paused at a tool permission', () => {
  beforeEach(() => {
    agent.script = null;
  });

  it('ends the run with a permission interrupt, then continues the same agent on approval', async () => {
    const { aguiRoutes } = await import('@/app/api/ag-ui');
    const { hasPermissionHold } =
      await import('@/shared/services/ag-ui/permission-hold');
    const seen = { approved: null as boolean | null };
    agent.script = permissionScript(seen);

    const first = await readEvents(
      await aguiRoutes.request(runRequest('task-approve', 'run-1')),
    );

    expect(deltas(first)).toEqual(['before']);
    const interrupt = finished(first)?.outcome;
    expect(interrupt?.type).toBe('interrupt');
    expect(interrupt?.interrupts).toHaveLength(1);
    expect(interrupt?.interrupts?.[0]).toMatchObject({
      reason: 'tool_permission',
    });
    expect(interrupt?.interrupts?.[0]?.id).toMatch(/^permission:/);
    expect(seen.approved).toBeNull();
    expect(hasPermissionHold('task-approve')).toBe(true);

    const second = await readEvents(
      await aguiRoutes.request(
        resumeRequest('task-approve', 'run-2', [
          {
            interruptId: interrupt!.interrupts![0]!.id,
            status: 'resolved',
            payload: { approved: true },
          },
        ]),
      ),
    );

    expect(seen.approved).toBe(true);
    expect(second[0]?.type).toBe('RUN_STARTED');
    expect(second[0]?.runId).not.toBe(first[0]?.runId);
    expect(deltas(second)).toEqual(['after:true']);
    expect(finished(second)?.outcome).toBeUndefined();
    expect(hasPermissionHold('task-approve')).toBe(false);
  });

  it('settles the plan widget a permission-paused run left open', async () => {
    const { aguiRoutes } = await import('@/app/api/ag-ui');
    const seen = { approved: null as boolean | null };
    agent.script = async function* (call: AgentCall) {
      const { ToolPermissionRegistry, requestHostToolPermission } =
        await import('@/core/agent/tool-permission-registry');
      yield {
        type: 'plan_activity',
        plan: {
          id: 'plan-1',
          goal: 'Ship it',
          steps: [],
          createdAt: new Date(),
        },
      };
      seen.approved = await requestHostToolPermission({
        taskId: call.taskId,
        sessionId: 'session-1',
        toolName: 'Bash',
        input: { command: 'ls' },
        registry: new ToolPermissionRegistry(),
        signal: call.signal,
      });
      yield { type: 'text', content: `after:${seen.approved}` };
    };

    const first = await readEvents(
      await aguiRoutes.request(runRequest('task-plan', 'run-1')),
    );
    const id = finished(first)!.outcome!.interrupts![0]!.id;
    expect(
      first.filter((event) => event.type === 'ACTIVITY_SNAPSHOT'),
    ).toHaveLength(1);
    // The decision is the next run's starting point, so this run leaves the
    // widget running.
    expect(
      first.filter((event) => event.type === 'ACTIVITY_DELTA'),
    ).toHaveLength(0);

    const second = await readEvents(
      await aguiRoutes.request(
        resumeRequest('task-plan', 'run-2', [
          { interruptId: id, status: 'resolved', payload: { approved: true } },
        ]),
      ),
    );

    // The continuation runs on a new emitter, which settles the same widget.
    expect(second.filter((event) => event.type === 'ACTIVITY_DELTA')).toEqual([
      expect.objectContaining({
        messageId: 'plan-plan-1',
        patch: [{ op: 'replace', path: '/phase', value: 'done' }],
      }),
    ]);
  });

  it('delivers a denial to the agent when the user cancels the interrupt', async () => {
    const { aguiRoutes } = await import('@/app/api/ag-ui');
    const seen = { approved: null as boolean | null };
    agent.script = permissionScript(seen);

    const first = await readEvents(
      await aguiRoutes.request(runRequest('task-cancel', 'run-1')),
    );
    const id = finished(first)!.outcome!.interrupts![0]!.id;

    const second = await readEvents(
      await aguiRoutes.request(
        resumeRequest('task-cancel', 'run-2', [
          { interruptId: id, status: 'cancelled' },
        ]),
      ),
    );

    expect(seen.approved).toBe(false);
    expect(deltas(second)).toEqual(['after:false']);
  });

  it('refuses a resume for another task and leaves the prompt open', async () => {
    const { aguiRoutes } = await import('@/app/api/ag-ui');
    const { hasPermissionHold, releasePermissionHold } =
      await import('@/shared/services/ag-ui/permission-hold');
    const seen = { approved: null as boolean | null };
    agent.script = permissionScript(seen);
    const first = await readEvents(
      await aguiRoutes.request(runRequest('task-owner', 'run-1')),
    );
    const id = finished(first)!.outcome!.interrupts![0]!.id;

    const res = await aguiRoutes.request(
      resumeRequest('task-other', 'run-2', [
        { interruptId: id, status: 'resolved', payload: { approved: true } },
      ]),
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'wrong_thread' });
    expect(seen.approved).toBeNull();
    expect(hasPermissionHold('task-owner')).toBe(true);
    releasePermissionHold('task-owner');
  });

  it('rejects an invalid answer without settling the prompt', async () => {
    const { aguiRoutes } = await import('@/app/api/ag-ui');
    const { hasPermissionHold, releasePermissionHold } =
      await import('@/shared/services/ag-ui/permission-hold');
    const seen = { approved: null as boolean | null };
    agent.script = permissionScript(seen);
    const first = await readEvents(
      await aguiRoutes.request(runRequest('task-invalid', 'run-1')),
    );
    const id = finished(first)!.outcome!.interrupts![0]!.id;

    const res = await aguiRoutes.request(
      resumeRequest('task-invalid', 'run-2', [
        { interruptId: id, status: 'resolved', payload: { approved: 'yes' } },
      ]),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'invalid_response' });
    expect(seen.approved).toBeNull();
    expect(hasPermissionHold('task-invalid')).toBe(true);
    releasePermissionHold('task-invalid');
  });

  it('does not continue a run the user stopped while it was waiting', async () => {
    const { aguiRoutes } = await import('@/app/api/ag-ui');
    const { hasPermissionHold } =
      await import('@/shared/services/ag-ui/permission-hold');
    const seen = { approved: null as boolean | null };
    agent.script = permissionScript(seen);
    const first = await readEvents(
      await aguiRoutes.request(runRequest('task-stop', 'run-1')),
    );
    const id = finished(first)!.outcome!.interrupts![0]!.id;

    const stop = await aguiRoutes.request(
      jsonReq('/stop/task-stop', {}, 'POST'),
    );
    expect(stop.status).toBe(200);
    await vi.waitFor(() => expect(seen.approved).toBe(false));

    expect(hasPermissionHold('task-stop')).toBe(false);
    const late = await aguiRoutes.request(
      resumeRequest('task-stop', 'run-2', [
        { interruptId: id, status: 'resolved', payload: { approved: true } },
      ]),
    );
    expect(late.status).toBe(409);
    expect(await late.json()).toMatchObject({
      code: 'continuation_unavailable',
    });
  });

  it('keeps the run open until every prompt is answered, reporting the rest', async () => {
    const { aguiRoutes } = await import('@/app/api/ag-ui');
    const seen = { approved: [] as boolean[] };
    agent.script = async function* (call: AgentCall) {
      const { ToolPermissionRegistry, requestHostToolPermission } =
        await import('@/core/agent/tool-permission-registry');
      yield { type: 'text', content: 'before' };
      const ask = (command: string) =>
        requestHostToolPermission({
          taskId: call.taskId,
          sessionId: 'session-1',
          toolName: 'Bash',
          input: { command },
          registry: new ToolPermissionRegistry(),
          signal: call.signal,
        }).then((approved) => seen.approved.push(approved));
      await Promise.all([ask('one'), ask('two')]);
      yield { type: 'text', content: `after:${seen.approved.join(',')}` };
    };

    const first = await readEvents(
      await aguiRoutes.request(runRequest('task-two', 'run-1')),
    );
    const [a, b] = finished(first)!.outcome!.interrupts!.map((i) => i.id);
    expect(a).toBeDefined();
    expect(b).toBeDefined();

    const partial = await readEvents(
      await aguiRoutes.request(
        resumeRequest('task-two', 'run-2', [
          { interruptId: a!, status: 'resolved', payload: { approved: true } },
        ]),
      ),
    );
    expect(deltas(partial)).toEqual([]);
    expect(finished(partial)?.outcome?.interrupts?.map((i) => i.id)).toEqual([
      b,
    ]);

    const last = await readEvents(
      await aguiRoutes.request(
        resumeRequest('task-two', 'run-3', [
          { interruptId: b!, status: 'resolved', payload: { approved: false } },
        ]),
      ),
    );
    expect(last[0]?.type).toBe('RUN_STARTED');
    expect(last[0]?.runId).not.toBe(first[0]?.runId);
    expect(deltas(last)).toEqual(['after:true,false']);
  });
});
