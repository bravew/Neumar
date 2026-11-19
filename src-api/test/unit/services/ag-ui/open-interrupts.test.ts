import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getPendingQuestions, listPlanInterrupts, listOpenClaudePermissions } =
  vi.hoisted(() => ({
    getPendingQuestions: vi.fn(),
    listPlanInterrupts: vi.fn(),
    listOpenClaudePermissions: vi.fn(),
  }));

vi.mock('@/core/agent/questions', () => ({
  agentQuestionService: { getPendingQuestions },
  serializeAgentQuestion: (row: Record<string, unknown>) => ({
    id: row.id,
    sessionId: 'session-1',
    taskId: row.task_id,
    toolUseId: null,
    questions: [{ question: `Question ${String(row.id)}` }],
    status: 'pending',
    answer: null,
    askedAt: '2026-01-01T00:00:00Z',
    answeredAt: null,
    expiresAt: row.expires_at,
  }),
}));
vi.mock('@/shared/services/ag-ui/plan-decisions', () => ({
  listPlanInterrupts,
}));
vi.mock('@/extensions/agent/claude/index', () => ({
  listOpenClaudePermissions,
}));

const { listOpenInterrupts } =
  await import('@/shared/services/ag-ui/open-interrupts');
const { requestHostToolPermission, ToolPermissionRegistry } =
  await import('@/core/agent/tool-permission-registry');

const NOW = Date.parse('2026-01-01T00:30:00Z');

/** Ends every host prompt a test opened, so none outlives the test. */
let hostRuns = new AbortController();

describe('listOpenInterrupts', () => {
  beforeEach(() => {
    hostRuns = new AbortController();
    getPendingQuestions.mockReset().mockReturnValue([]);
    listPlanInterrupts.mockReset().mockReturnValue([]);
    listOpenClaudePermissions.mockReset().mockReturnValue([]);
  });

  afterEach(() => {
    hostRuns.abort();
  });

  it('is empty when nothing is waiting', async () => {
    await expect(listOpenInterrupts('task-1', NOW)).resolves.toEqual([]);
    expect(getPendingQuestions).toHaveBeenCalledWith({ taskId: 'task-1' });
  });

  it('combines plan, question, and both adapters permissions for one task', async () => {
    listPlanInterrupts.mockReturnValue([
      { id: 'plan:p1', reason: 'plan_approval' },
    ]);
    getPendingQuestions.mockReturnValue([
      { id: 'q1', task_id: 'task-1', expires_at: '2026-01-01T01:00:00Z' },
    ]);
    listOpenClaudePermissions.mockReturnValue([
      {
        taskId: 'task-1',
        sessionId: 'session-1',
        prompt: { id: 'claude-req', tool: 'Bash', description: 'Execute Bash' },
        expiresAt: NOW + 1000,
      },
    ]);
    void requestHostToolPermission({
      taskId: 'task-1',
      sessionId: 'session-1',
      toolName: 'Write',
      input: { file: 'a.txt' },
      registry: new ToolPermissionRegistry(),
      signal: hostRuns.signal,
    });

    const interrupts = await listOpenInterrupts('task-1', NOW);

    expect(interrupts.map((interrupt) => interrupt.reason)).toEqual([
      'plan_approval',
      'agent_question',
      'tool_permission',
      'tool_permission',
    ]);
    expect(interrupts[1]?.id).toBe('question:q1');
    expect(interrupts[2]?.id).toBe('permission:claude-req');
    expect(interrupts[3]?.id).toMatch(/^permission:/);
    expect(listOpenClaudePermissions).toHaveBeenCalledWith('task-1');
  });

  it('drops a question whose expiry has passed', async () => {
    getPendingQuestions.mockReturnValue([
      { id: 'stale', task_id: 'task-1', expires_at: '2026-01-01T00:00:00Z' },
      { id: 'live', task_id: 'task-1', expires_at: null },
    ]);

    const interrupts = await listOpenInterrupts('task-1', NOW);

    expect(interrupts.map((interrupt) => interrupt.id)).toEqual([
      'question:live',
    ]);
  });
});
