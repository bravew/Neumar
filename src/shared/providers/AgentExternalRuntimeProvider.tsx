import type { ReactNode } from 'react';

import {
  AssistantRuntimeProvider,
  useExternalMessageConverter,
  useExternalStoreRuntime,
  type AppendMessage,
} from '@assistant-ui/react';

import type { AgentMessage } from '@/shared/hooks/agent-types';
import { randomUUID } from '@/shared/utils/uuid';

// ── Message converter ────────────────────────────────────────────────────────

/**
 * Stable ID map for messages that don't carry their own `id` field.
 * WeakMap ensures GC when old message objects are dropped from the array.
 * Without this, every id-less message gets the same fallback string, causing
 * MessageRepository to throw "same id already exists in the parent tree".
 */
const msgIdMap = new WeakMap<AgentMessage, string>();

function stableId(msg: AgentMessage): string {
  if (msg.id) return msg.id;
  let id = msgIdMap.get(msg);
  if (!id) {
    id = randomUUID();
    msgIdMap.set(msg, id);
  }
  return id;
}

/**
 * Converts a frontend AgentMessage into the ThreadMessageLike format used by
 * assistant-ui's external store runtime.
 *
 * Only message types that are visible in the conversation thread are mapped.
 * Infra messages (session, done, error, result, permission_request) return []
 * because they are already handled by the existing MessageList.tsx renderer.
 */
function convertAgentMessage(
  msg: AgentMessage,
  _metadata: useExternalMessageConverter.Metadata,
): useExternalMessageConverter.Message | useExternalMessageConverter.Message[] {
  const id = stableId(msg);

  switch (msg.type) {
    case 'user':
      return {
        role: 'user' as const,
        id,
        content: msg.content ?? '',
      };

    case 'text':
      return {
        role: 'assistant' as const,
        id,
        content: [{ type: 'text' as const, text: msg.content ?? '' }],
      };

    case 'thinking':
      return {
        role: 'assistant' as const,
        id,
        content: [{ type: 'reasoning' as const, text: msg.content ?? '' }],
      };

    case 'tool_use':
      return {
        role: 'assistant' as const,
        id,
        content: [
          {
            type: 'tool-call' as const,
            toolCallId: id,
            toolName: msg.name ?? 'unknown',
            argsText: msg.input != null ? JSON.stringify(msg.input) : '{}',
          },
        ],
      };

    case 'tool_result':
      // Paired with the assistant tool-call part above
      return {
        role: 'tool' as const,
        toolCallId: msg.toolUseId ?? id,
        result: msg.output ?? '',
        isError: msg.isError,
      };

    case 'plan':
      // Carry plan data in metadata.custom so PlanCard can read it
      return {
        role: 'assistant' as const,
        id: `plan-${id}`,
        content: [{ type: 'text' as const, text: '' }],
        metadata: {
          custom: {
            _type: 'plan',
            steps: msg.plan?.steps,
            goal: msg.plan?.goal,
          },
        },
      };

    case 'direct_answer':
      return {
        role: 'assistant' as const,
        id: `direct-${id}`,
        content: [{ type: 'text' as const, text: msg.content ?? '' }],
        metadata: { custom: { _type: 'direct_answer' } },
      };

    // Omit infra/lifecycle messages from the assistant-ui thread model —
    // they are already rendered by the existing MessageList component.
    default:
      return [];
  }
}

// ── Provider ─────────────────────────────────────────────────────────────────

interface Props {
  messages: AgentMessage[];
  isRunning: boolean;
  onNew: (prompt: string) => Promise<void>;
  onCancel: () => Promise<void>;
  children: ReactNode;
}

/**
 * Wraps existing useAgent state with assistant-ui's external store runtime.
 *
 * This makes assistant-ui features (ActionBarPrimitive.Copy, BranchPickerPrimitive,
 * ActionBarPrimitive.Reload) available throughout the subtree without touching
 * any existing components. MessageList.tsx continues to own rendering.
 *
 * Key constraint: fresh adapter object every render — intentional, do NOT memoize.
 * useExternalStoreRuntime calls runtime.setAdapter(store) on each render cycle.
 */
export function AgentExternalRuntimeProvider({
  messages,
  isRunning,
  onNew,
  onCancel,
  children,
}: Props) {
  // Convert AgentMessage[] → ThreadMessage[] for the runtime's internal model
  const converted = useExternalMessageConverter({
    callback: convertAgentMessage,
    messages,
    isRunning,
    joinStrategy: 'concat-content',
  });

  // Fresh adapter object every render — intentional (per assistant-ui contract)
  const runtime = useExternalStoreRuntime({
    messages: converted,
    isRunning,

    onNew: async (appendMsg: AppendMessage) => {
      const text = appendMsg.content.find((p) => p.type === 'text')?.text ?? '';
      if (text) await onNew(text);
    },

    onCancel: async () => {
      await onCancel();
    },

    // Branch state is managed by existing useAgent — no-op for now.
    // Wire to useAgent.clearMessages + reload in Phase 6.
    setMessages: () => {},
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      {children}
    </AssistantRuntimeProvider>
  );
}
