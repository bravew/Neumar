import { useEffect, useRef } from 'react';

import { useAuiState } from '@assistant-ui/react';

import type { TaskPlan } from '@/shared/hooks/agent-types';
import { randomUUID } from '@/shared/utils/uuid';

/**
 * Subscribes to CUSTOM AG-UI events forwarded via the assistant-ui thread.
 * Must be rendered inside an AssistantRuntimeProvider subtree.
 *
 * Detects plan and interrupt messages placed in thread message metadata by
 * AgentExternalRuntimeProvider and dispatches them to the provided handlers.
 */
export function useNeumaAGUIEvents(handlers: {
  onPlan?: (plan: TaskPlan) => void;
  onInterrupt?: (reason: string) => void;
}) {
  // useAuiState is the v0.12+ API (re-exported from @assistant-ui/react).
  // Equivalent to the deprecated useThread((s) => s.messages) but forward-compatible.
  const messages = useAuiState((s) => s.thread.messages);
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  // Track the last dispatched message id to prevent re-dispatching on
  // React StrictMode double-mount (effect runs twice with the same messages array).
  const lastDispatchedIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    const last = messages[messages.length - 1];
    if (!last) return;
    // Guard: skip if we already dispatched for this exact message instance
    if (last.id === lastDispatchedIdRef.current) return;
    const custom = last.metadata?.custom as Record<string, unknown> | undefined;
    if (!custom) return;
    if (custom._type === 'plan' && handlersRef.current.onPlan) {
      lastDispatchedIdRef.current = last.id;
      handlersRef.current.onPlan({
        id: randomUUID(),
        goal: custom.goal as string,
        steps: custom.steps as TaskPlan['steps'],
        createdAt: new Date(),
      });
    }
    if (custom._type === 'interrupt' && handlersRef.current.onInterrupt) {
      lastDispatchedIdRef.current = last.id;
      handlersRef.current.onInterrupt(custom.reason as string);
    }
  }, [messages]);
}
