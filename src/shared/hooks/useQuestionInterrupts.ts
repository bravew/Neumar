/**
 * useQuestionInterrupts — agent questions the backend still holds open, and
 * the answer that resumes the run.
 *
 * The turn that asked a question has ended, so nothing waits on the stored
 * record. The answer is the user's next turn, the same as the legacy chat: it
 * is added to the thread as the final user message and sent with a `resume`
 * entry for `question:<id>`. The server checks that the entry and the message
 * carry the same text, then records the answer and runs the turn.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { Interrupt, ResumeEntry } from '@ag-ui/core';

import { API_BASE_URL } from '@/config';
import { normalizeAgentQuestions } from '@/shared/questions/question-policy';
import { randomUUID } from '@/shared/utils/uuid';

import type { AgentQuestion } from './agent-types';

const QUESTION_INTERRUPT_REASON = 'agent_question';

/** An open question, with the interrupt id that answers it. */
export interface OpenQuestion {
  interruptId: string;
  questions: AgentQuestion[];
}

/** The part of the AG-UI agent this hook needs to continue with an answer. */
export interface QuestionAgent {
  messages: unknown[];
  addMessage(message: { id: string; role: 'user'; content: string }): void;
  setMessages(messages: unknown[]): void;
  runAgent: (opts: {
    forwardedProps?: Record<string, unknown>;
    resume?: ResumeEntry[];
  }) => Promise<unknown> | void;
}

function questionFromInterrupt(interrupt: Interrupt): OpenQuestion[] {
  if (interrupt.reason !== QUESTION_INTERRUPT_REASON) return [];
  const decision = (
    interrupt.metadata as
      | { decision?: { kind?: string; questions?: unknown } }
      | undefined
  )?.decision;
  if (decision?.kind !== 'question') return [];
  const questions = normalizeAgentQuestions({ questions: decision.questions });
  return questions.length > 0 ? [{ interruptId: interrupt.id, questions }] : [];
}

async function fetchOpenQuestions(
  taskId: string,
  signal: AbortSignal,
): Promise<OpenQuestion[]> {
  const res = await fetch(`${API_BASE_URL}/ag-ui/interrupts/${taskId}`, {
    signal,
  });
  if (!res.ok) throw new Error(`Open interrupts request failed: ${res.status}`);
  const data = (await res.json()) as { interrupts?: Interrupt[] };
  return (data.interrupts ?? []).flatMap(questionFromInterrupt);
}

/** The answer text the legacy chat sends: one `question → answer` line each. */
export function formatQuestionAnswer(answers: Record<string, string>): string {
  return Object.entries(answers)
    .map(([question, answer]) => `${question} → ${answer}`)
    .join('\n');
}

export function useQuestionInterrupts(
  taskId: string | undefined,
  isRunning: boolean,
  agent: QuestionAgent,
) {
  const [owned, setOwned] = useState<{
    taskId: string | undefined;
    open: OpenQuestion[];
  }>({ taskId, open: [] });
  const open = owned.taskId === taskId ? owned.open : [];
  const agentRef = useRef(agent);
  useEffect(() => {
    agentRef.current = agent;
  });
  const taskIdRef = useRef(taskId);
  useEffect(() => {
    taskIdRef.current = taskId;
  });
  // One answer at a time: a second would start while the first still streams.
  const answeringRef = useRef(false);
  const [answering, setAnswering] = useState(false);

  const refresh = useCallback(
    async (signal: AbortSignal) => {
      if (!taskId) return;
      const next = await fetchOpenQuestions(taskId, signal);
      if (!signal.aborted) setOwned({ taskId, open: next });
    },
    [taskId],
  );

  // An idle task has no live run to answer in place, so whatever the backend
  // holds open was left by a turn that already ended. This covers a run
  // ending, a reload, and switching to a task that is waiting.
  useEffect(() => {
    if (isRunning || !taskId) return;
    const ac = new AbortController();
    fetchOpenQuestions(taskId, ac.signal)
      .then((next) => {
        if (!ac.signal.aborted) setOwned({ taskId, open: next });
      })
      .catch(() => {
        // A failed read does not mean nothing is waiting: keep what is shown.
      });
    return () => ac.abort();
  }, [isRunning, taskId]);

  const resume = useCallback(
    async (
      interruptId: string,
      entry: Omit<ResumeEntry, 'interruptId'>,
      answerText?: string,
    ) => {
      const a = agentRef.current;
      if (answeringRef.current || !taskId) return;
      answeringRef.current = true;
      setAnswering(true);
      const before = [...a.messages];
      if (answerText !== undefined) {
        a.addMessage({ id: randomUUID(), role: 'user', content: answerText });
      }
      // The card closes now: the request stays open for the whole continuation.
      setOwned((prev) => ({
        taskId,
        open: (prev.taskId === taskId ? prev.open : []).filter(
          (q) => q.interruptId !== interruptId,
        ),
      }));
      try {
        await a.runAgent({
          resume: [{ interruptId, ...entry }],
          forwardedProps: { taskId },
        });
      } catch {
        // Lost a race (answered elsewhere, expired, or cancelled). Take the
        // unsent answer back out of the thread, then let the backend's record
        // say whether the question is still open.
        if (answerText !== undefined) a.setMessages(before);
        if (taskIdRef.current === taskId) {
          await refresh(new AbortController().signal).catch(() => undefined);
        }
      } finally {
        answeringRef.current = false;
        setAnswering(false);
      }
    },
    [taskId, refresh],
  );

  const answer = useCallback(
    (interruptId: string, answers: Record<string, string>) => {
      const text = formatQuestionAnswer(answers).trim();
      if (!text) return Promise.resolve();
      return resume(
        interruptId,
        { status: 'resolved', payload: { answer: text } },
        text,
      );
    },
    [resume],
  );

  const dismiss = useCallback(
    (interruptId: string) => resume(interruptId, { status: 'cancelled' }),
    [resume],
  );

  return { openQuestions: open, answering, answer, dismiss };
}
