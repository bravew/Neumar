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
  /** The sub-agent invocation that asked, when a child owns the question. */
  subagentRunId?: string;
  /** The `AskUserQuestion` tool call that asked, when the transcript has one. */
  toolUseId?: string;
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

/** Thread-owned inputs the continuation needs but the hook does not own. */
export interface QuestionInterruptContext {
  /**
   * Seeds the agent from thread history when it has no messages, so the
   * answer does not replace a reloaded conversation with one message.
   */
  seedAgent?: () => void;
  /** Extra forwarded props (model, work dirs), read at submit time. */
  forwardedProps?: () => Record<string, unknown>;
}

function questionFromInterrupt(interrupt: Interrupt): OpenQuestion[] {
  if (interrupt.reason !== QUESTION_INTERRUPT_REASON) return [];
  const decision = (
    interrupt.metadata as
      | {
          decision?: {
            kind?: string;
            questions?: unknown;
            subagentRunId?: unknown;
            toolUseId?: unknown;
          };
        }
      | undefined
  )?.decision;
  if (decision?.kind !== 'question') return [];
  const questions = normalizeAgentQuestions({ questions: decision.questions });
  return questions.length > 0
    ? [
        {
          interruptId: interrupt.id,
          questions,
          ...(typeof decision.subagentRunId === 'string'
            ? { subagentRunId: decision.subagentRunId }
            : {}),
          ...(typeof decision.toolUseId === 'string'
            ? { toolUseId: decision.toolUseId }
            : {}),
        },
      ]
    : [];
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

/**
 * Drops answers that are empty once trimmed and trims the rest. The server
 * trims each value before deriving the transcript text it compares, so the
 * record and the message must be built from the same trimmed values.
 */
export function normalizeQuestionAnswers(
  answers: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(answers)
      .map(([question, answer]) => [question, answer.trim()] as const)
      .filter(([, answer]) => answer.length > 0),
  );
}

/**
 * Whether the open questions are known. `pending` while an idle task's
 * questions are being read; `failed` when the last read failed, so `open` may
 * be missing a question. No task or a live run is `loaded` with none open:
 * a live run answers its own turns.
 */
export type QuestionLookup = 'pending' | 'loaded' | 'failed';

export function useQuestionInterrupts(
  taskId: string | undefined,
  isRunning: boolean,
  agent: QuestionAgent,
  context: QuestionInterruptContext = {},
) {
  const [owned, setOwned] = useState<{
    taskId: string | undefined;
    open: OpenQuestion[];
    lookup: QuestionLookup;
  }>({ taskId, open: [], lookup: 'pending' });
  // A run can ask a new question, so what was read before it is stale once it
  // ends. Adjusted during render so no idle render reports the old read.
  if (isRunning && owned.lookup !== 'pending') {
    setOwned((prev) => ({ ...prev, lookup: 'pending' }));
  }
  // A run that started after these loaded answers its own turns; the cards
  // come back if the question is still open when it ends.
  const open = isRunning || owned.taskId !== taskId ? [] : owned.open;
  const lookup: QuestionLookup =
    !taskId || isRunning
      ? 'loaded'
      : owned.taskId !== taskId
        ? 'pending'
        : owned.lookup;
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  });

  const agentRef = useRef(agent);
  useEffect(() => {
    agentRef.current = agent;
  });
  const contextRef = useRef(context);
  useEffect(() => {
    contextRef.current = context;
  });
  const taskIdRef = useRef(taskId);
  useEffect(() => {
    taskIdRef.current = taskId;
  });
  const isRunningRef = useRef(isRunning);
  useEffect(() => {
    isRunningRef.current = isRunning;
  });
  // One answer at a time: a second would start while the first still streams.
  const answeringRef = useRef(false);
  const [answering, setAnswering] = useState(false);

  // An idle task has no live run to answer in place, so whatever the backend
  // holds open was left by a turn that already ended. This covers a run
  // ending, a reload, and switching to a task that is waiting.
  useEffect(() => {
    if (isRunning || !taskId) return;
    const ac = new AbortController();
    fetchOpenQuestions(taskId, ac.signal)
      .then((next) => {
        if (!ac.signal.aborted) {
          setOwned({ taskId, open: next, lookup: 'loaded' });
        }
      })
      .catch(() => {
        // A failed read does not mean nothing is waiting: keep what is shown,
        // and say the list may be incomplete.
        if (ac.signal.aborted) return;
        setOwned((prev) => ({
          taskId,
          open: prev.taskId === taskId ? prev.open : [],
          lookup: 'failed',
        }));
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
      if (answeringRef.current || isRunningRef.current || !taskId) return;
      const removed = openRef.current.find(
        (question) => question.interruptId === interruptId,
      );
      answeringRef.current = true;
      setAnswering(true);
      const before = [...a.messages];
      if (answerText !== undefined) {
        // Seed first: the answer must extend the reloaded conversation, not
        // replace it with one message.
        contextRef.current.seedAgent?.();
        a.addMessage({ id: randomUUID(), role: 'user', content: answerText });
      }
      // The card closes now: the request stays open for the whole continuation.
      setOwned((prev) => ({
        taskId,
        open: (prev.taskId === taskId ? prev.open : []).filter(
          (question) => question.interruptId !== interruptId,
        ),
        lookup: prev.taskId === taskId ? prev.lookup : 'pending',
      }));
      try {
        await a.runAgent({
          resume: [{ interruptId, ...entry }],
          forwardedProps: {
            taskId,
            ...contextRef.current.forwardedProps?.(),
          },
        });
      } catch {
        if (taskIdRef.current !== taskId) return;
        // The record decides what happened. Still open means the resume was
        // refused before the run started; absent means it was accepted (or
        // settled elsewhere), and the answer and its output stand.
        let next: OpenQuestion[] | null = null;
        try {
          next = await fetchOpenQuestions(taskId, new AbortController().signal);
        } catch {
          next = null;
        }
        if (taskIdRef.current !== taskId) return;
        if (next) {
          setOwned({ taskId, open: next, lookup: 'loaded' });
          if (
            answerText !== undefined &&
            next.some((question) => question.interruptId === interruptId)
          ) {
            a.setMessages(before);
          }
          return;
        }
        // The read was inconclusive, so the answer may or may not have been
        // recorded. Keep it and put the card back so it can be retried.
        setOwned((prev) => {
          const current = prev.taskId === taskId ? prev.open : [];
          if (
            !removed ||
            current.some(
              (question) => question.interruptId === removed.interruptId,
            )
          ) {
            return { taskId, open: current, lookup: 'failed' };
          }
          return { taskId, open: [...current, removed], lookup: 'failed' };
        });
      } finally {
        answeringRef.current = false;
        setAnswering(false);
      }
    },
    [taskId],
  );

  const answer = useCallback(
    (interruptId: string, answers: Record<string, string>) => {
      // The record and the message come from the same trimmed values, or the
      // server's comparison of the two fails.
      const normalized = normalizeQuestionAnswers(answers);
      const text = formatQuestionAnswer(normalized);
      if (!text) return Promise.resolve();
      return resume(
        interruptId,
        { status: 'resolved', payload: { answers: normalized } },
        text,
      );
    },
    [resume],
  );

  const dismiss = useCallback(
    (interruptId: string) => resume(interruptId, { status: 'cancelled' }),
    [resume],
  );

  return { openQuestions: open, lookup, answering, answer, dismiss };
}
