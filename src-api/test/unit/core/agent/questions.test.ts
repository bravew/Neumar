import { describe, expect, it } from 'vitest';

import {
  AgentQuestionService,
  serializeAgentQuestion,
  type AgentQuestionStore,
} from '@/core/agent/questions';

import type {
  AgentQuestionRow,
  CreateAgentQuestionInput,
} from '@/shared/db/types';

function createStore(): AgentQuestionStore {
  const rows = new Map<string, AgentQuestionRow>();
  return {
    create(input: CreateAgentQuestionInput) {
      const row: AgentQuestionRow = {
        id: input.id ?? 'question-1',
        session_id: input.session_id,
        task_id: input.task_id ?? null,
        tool_use_id: input.tool_use_id ?? null,
        questions_json: JSON.stringify(input.questions),
        status: 'pending',
        answer_json: null,
        asked_at: '2026-05-17T00:00:00.000Z',
        answered_at: null,
        expires_at: input.expires_at ?? null,
        created_at: '2026-05-17T00:00:00.000Z',
        updated_at: '2026-05-17T00:00:00.000Z',
      };
      rows.set(row.id, row);
      return row;
    },
    get(id: string) {
      return rows.get(id) ?? null;
    },
    getPending(filter) {
      return Array.from(rows.values()).filter(
        (row) =>
          row.status === 'pending' &&
          (!filter.sessionId || row.session_id === filter.sessionId) &&
          (!filter.taskId || row.task_id === filter.taskId),
      );
    },
    answer(id: string, answer: unknown) {
      const row = rows.get(id);
      if (!row) return null;
      const answered = {
        ...row,
        status: 'answered' as const,
        answer_json: JSON.stringify(answer),
        answered_at: '2026-05-17T00:00:01.000Z',
      };
      rows.set(id, answered);
      return answered;
    },
  };
}

describe('AgentQuestionService', () => {
  it('persists pending questions with an optional expiry', () => {
    const service = new AgentQuestionService(
      createStore(),
      () => new Date('2026-05-17T00:00:00.000Z'),
    );

    const row = service.createPendingQuestion({
      sessionId: 'session-1',
      taskId: 'task-1',
      toolUseId: 'tool-1',
      questions: [{ question: 'Ship it?' }],
      timeoutMs: 1000,
    });

    expect(row.expires_at).toBe('2026-05-17T00:00:01.000Z');
    expect(serializeAgentQuestion(row)).toMatchObject({
      id: 'question-1',
      sessionId: 'session-1',
      taskId: 'task-1',
      questions: [{ question: 'Ship it?' }],
      status: 'pending',
    });
  });

  it('resolves waiters when an answer arrives', async () => {
    const service = new AgentQuestionService(createStore());
    const row = service.createPendingQuestion({
      sessionId: 'session-1',
      questions: [{ question: 'Pick one' }],
    });

    const waiter = service.waitForAnswer(row.id, 1000);
    service.answerQuestion(row.id, { 'Pick one': 'A' });

    await expect(waiter).resolves.toMatchObject({
      answer: { 'Pick one': 'A' },
      row: { status: 'answered' },
    });
  });
});
