import { useEffect, useMemo, useRef } from 'react';

import type { AgentQuestion } from '@/shared/hooks/agent-types';
import type { DesignChatTurn } from '@/shared/hooks/useDesignChat';

/**
 * Surface normalized AG-UI `AskUserQuestion` data for the Questions tab and
 * auto-open the tab when a fresh question set first appears.
 */
export function useDesignChatQuestions({
  chatLoopActive,
  chatTurns,
  onQuestionsAppear,
  enabled = true,
}: {
  chatLoopActive: boolean;
  chatTurns: DesignChatTurn[];
  onQuestionsAppear: () => void;
  enabled?: boolean;
}): { questions: AgentQuestion[]; questionsStreaming: boolean } {
  const latestAssistant = useMemo(() => {
    for (let i = chatTurns.length - 1; i >= 0; i--) {
      if (chatTurns[i].role === 'assistant') return chatTurns[i];
    }
    return null;
  }, [chatTurns]);
  const questions = chatLoopActive ? (latestAssistant?.questions ?? []) : [];
  const questionsStreaming = chatLoopActive
    ? (latestAssistant?.questionsStreaming ?? false)
    : false;

  const hadQuestionsRef = useRef(false);
  useEffect(() => {
    if (!enabled) {
      hadQuestionsRef.current = questions.length > 0;
      return;
    }
    const has = questions.length > 0;
    if (has && !hadQuestionsRef.current) onQuestionsAppear();
    hadQuestionsRef.current = has;
    // onQuestionsAppear is a stable setter; depend only on the count/enabled.
  }, [enabled, questions.length]); // eslint-disable-line react-hooks/exhaustive-deps

  return { questions, questionsStreaming };
}
