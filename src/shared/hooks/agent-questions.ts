import type { AgentQuestion } from './agent-types';
import { AGENT_SERVER_URL, fetchWithRetry } from './agent-utils';

interface CreateBackendQuestionInput {
  sessionId: string;
  taskId: string;
  toolUseId: string;
  questions: AgentQuestion[];
}

interface BackendQuestionResponse {
  question?: {
    id?: string;
  };
}

export async function createBackendAgentQuestion(
  input: CreateBackendQuestionInput,
): Promise<string | null> {
  const response = await fetchWithRetry(`${AGENT_SERVER_URL}/agent/questions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: input.sessionId,
      taskId: input.taskId,
      toolUseId: input.toolUseId,
      questions: input.questions,
    }),
  });

  if (!response.ok) return null;
  const body = (await response.json()) as BackendQuestionResponse;
  return body.question?.id ?? null;
}

export async function answerBackendAgentQuestion(
  questionId: string,
  answer: Record<string, string>,
): Promise<void> {
  await fetchWithRetry(
    `${AGENT_SERVER_URL}/agent/questions/${encodeURIComponent(questionId)}/answer`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answer }),
    },
  );
}
