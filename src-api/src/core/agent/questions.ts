import {
  answerAgentQuestion,
  createAgentQuestion,
  getAgentQuestion,
  getPendingAgentQuestions,
} from '@/shared/db/operations';
import type {
  AgentQuestionRow,
  CreateAgentQuestionInput,
} from '@/shared/db/types';

export interface PendingAgentQuestionInput {
  sessionId: string;
  taskId?: string | null;
  toolUseId?: string | null;
  questions: unknown[];
  timeoutMs?: number;
}

export interface SerializedAgentQuestion {
  id: string;
  sessionId: string;
  taskId: string | null;
  toolUseId: string | null;
  questions: unknown[];
  status: AgentQuestionRow['status'];
  answer: unknown;
  askedAt: string;
  answeredAt: string | null;
  expiresAt: string | null;
}

export interface AgentQuestionStore {
  create(input: CreateAgentQuestionInput): AgentQuestionRow;
  get(id: string): AgentQuestionRow | null;
  getPending(filter: {
    sessionId?: string;
    taskId?: string;
  }): AgentQuestionRow[];
  answer(id: string, answer: unknown): AgentQuestionRow | null;
}

interface Waiter {
  resolve: (value: { answer: unknown; row: AgentQuestionRow }) => void;
  reject: (error: Error) => void;
  timer?: NodeJS.Timeout;
}

const defaultStore: AgentQuestionStore = {
  create: createAgentQuestion,
  get: getAgentQuestion,
  getPending: getPendingAgentQuestions,
  answer: answerAgentQuestion,
};

function addTimeout(now: () => Date, timeoutMs?: number): string | null {
  if (!timeoutMs || timeoutMs <= 0) return null;
  return new Date(now().getTime() + timeoutMs).toISOString();
}

function parseJson(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

export function serializeAgentQuestion(
  row: AgentQuestionRow,
): SerializedAgentQuestion {
  return {
    id: row.id,
    sessionId: row.session_id,
    taskId: row.task_id,
    toolUseId: row.tool_use_id,
    questions: Array.isArray(parseJson(row.questions_json))
      ? (parseJson(row.questions_json) as unknown[])
      : [],
    status: row.status,
    answer: parseJson(row.answer_json),
    askedAt: row.asked_at,
    answeredAt: row.answered_at,
    expiresAt: row.expires_at,
  };
}

export class AgentQuestionService {
  private readonly waiters = new Map<string, Waiter>();

  constructor(
    private readonly store: AgentQuestionStore = defaultStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  createPendingQuestion(input: PendingAgentQuestionInput): AgentQuestionRow {
    return this.store.create({
      session_id: input.sessionId,
      task_id: input.taskId ?? null,
      tool_use_id: input.toolUseId ?? null,
      questions: input.questions,
      expires_at: addTimeout(this.now, input.timeoutMs),
    });
  }

  getPendingQuestions(filter: {
    sessionId?: string;
    taskId?: string;
  }): AgentQuestionRow[] {
    return this.store.getPending(filter);
  }

  getQuestion(id: string): AgentQuestionRow | null {
    return this.store.get(id);
  }

  answerQuestion(questionId: string, answer: unknown): AgentQuestionRow | null {
    const row = this.store.answer(questionId, answer);
    if (!row || row.status !== 'answered') return row;

    const waiter = this.waiters.get(questionId);
    if (waiter) {
      this.waiters.delete(questionId);
      if (waiter.timer) clearTimeout(waiter.timer);
      waiter.resolve({ answer, row });
    }
    return row;
  }

  waitForAnswer(
    questionId: string,
    timeoutMs?: number,
  ): Promise<{ answer: unknown; row: AgentQuestionRow }> {
    const existing = this.store.get(questionId);
    if (existing?.status === 'answered') {
      return Promise.resolve({
        answer: parseJson(existing.answer_json),
        row: existing,
      });
    }

    return new Promise((resolve, reject) => {
      const waiter: Waiter = { resolve, reject };
      if (timeoutMs && timeoutMs > 0) {
        waiter.timer = setTimeout(() => {
          this.waiters.delete(questionId);
          reject(new Error(`Agent question timed out: ${questionId}`));
        }, timeoutMs);
      }
      this.waiters.set(questionId, waiter);
    });
  }
}

export const agentQuestionService = new AgentQuestionService();
