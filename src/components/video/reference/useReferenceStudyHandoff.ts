import { useEffect, useRef } from 'react';

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
  // A turn costs money and clutters the conversation, so each request is sent
  // exactly once. Clearing the store is not enough on its own: StrictMode
  // re-runs this effect with the same captured request, which posted the
  // handoff twice.
  const sentNonce = useRef<number | null>(null);

  useEffect(() => {
    setAgentStreaming(streaming);
  }, [setAgentStreaming, streaming]);

  useEffect(() => {
    if (!handoff || streaming) return;
    if (sentNonce.current === handoff.nonce) return;
    sentNonce.current = handoff.nonce;
    const prompt = handoff.discussResults
      ? t.video.reference.discussPrompt.replace('{label}', handoff.label)
      : handoff.blocked
        ? t.video.reference.unblockPrompt
            .replace('{label}', handoff.label)
            .replace('{step}', handoff.blocked.stepId)
            .replace('{reason}', handoff.blocked.reason)
        : t.video.reference.handoffPrompt
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
    t.video.reference.unblockPrompt,
    t.video.reference.discussPrompt,
  ]);
}
