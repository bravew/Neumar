import { useEffect } from 'react';

import { useLanguage } from '@/shared/providers/language-provider';

import type { AgentDockContext } from '../useAgentDock';
import { useReferenceStudyStore } from './useReferenceStudyStore';

interface UseReferenceStudyHandoffInput {
  streaming: boolean;
  sendMessage: (content: string, context: AgentDockContext) => void;
  buildContext: () => AgentDockContext;
}

/**
 * Bridges the Analyze video panel's handoff request into the chat dock.
 *
 * The panel starts a run and finishes the system steps, but `read` and
 * `extract` are agent-owned. Rather than leaving the run parked with no sign of
 * why, the panel posts a handoff and this hook turns it into a normal chat turn
 * — so the work the user sees on the left is visibly the run they started on
 * the right. Held back while a turn is already streaming so we never interrupt
 * the user mid-conversation.
 */
export function useReferenceStudyHandoff({
  streaming,
  sendMessage,
  buildContext,
}: UseReferenceStudyHandoffInput) {
  const { t } = useLanguage();
  const handoff = useReferenceStudyStore((state) => state.handoff);
  const clearHandoff = useReferenceStudyStore((state) => state.clearHandoff);
  const setAgentStreaming = useReferenceStudyStore(
    (state) => state.setAgentStreaming,
  );

  useEffect(() => {
    setAgentStreaming(streaming);
  }, [setAgentStreaming, streaming]);

  useEffect(() => {
    if (!handoff || streaming) return;
    const prompt = t.video.reference.handoffPrompt
      .replace('{label}', handoff.label)
      .replace(
        '{focus}',
        handoff.focus ?? t.video.reference.handoffDefaultFocus,
      );
    clearHandoff();
    sendMessage(prompt, {
      ...buildContext(),
      referenceId: handoff.referenceId,
    });
  }, [
    buildContext,
    clearHandoff,
    handoff,
    sendMessage,
    streaming,
    t.video.reference.handoffDefaultFocus,
    t.video.reference.handoffPrompt,
  ]);
}
