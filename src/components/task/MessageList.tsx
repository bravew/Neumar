import { useMemo } from 'react';

import type { AgentMessage } from '@/shared/hooks/useAgent';
import { useLanguage } from '@/shared/providers/language-provider';
import { parseStructuredEnvelope } from '@/shared/utils/structured-envelope';

import { MessageItem } from './MessageItem';
import { TaskGroupComponent } from './TaskGroupComponent';

type ToolWithResult = {
  message: AgentMessage;
  globalIndex: number;
  result?: AgentMessage;
};

type TaskMessageGroup = {
  type: 'task';
  title: string;
  description: string;
  tools: ToolWithResult[];
  isCompleted: boolean;
};

type OtherMessageGroup = {
  type: 'other';
  message: AgentMessage;
};

type MessageGroup = TaskMessageGroup | OtherMessageGroup;

/** Max characters for a task group title preview. */
const TASK_TITLE_PREVIEW_LENGTH = 300;

export function MessageList({
  messages,
  isRunning,
  searchQuery,
  phase,
  autoExecutePlan,
  onApprovePlan,
  onRejectPlan,
  onRetry,
  onResume,
}: {
  messages: AgentMessage[];
  isRunning: boolean;
  searchQuery?: string;
  phase?: string;
  autoExecutePlan?: boolean;
  onApprovePlan?: () => void;
  onRejectPlan?: () => void;
  onRetry?: () => void;
  onResume?: () => void;
}) {
  const { t } = useLanguage();

  // Keep all messages — text messages are already accumulated server-side
  // (flush-on-boundary) and by the SSE handler (consecutive delta merge).
  // Filter out text whose content is a duplicate raw plan envelope only when
  // the stream also contains an explicit plan message. Otherwise MessageItem
  // can render the text envelope as PlanApproval.
  // Memoized to avoid JSON.parse on every render.
  const mergedMessages: AgentMessage[] = useMemo(() => {
    const hasExplicitPlan = messages.some((message) => message.type === 'plan');
    return messages.filter((msg) => {
      // Thinking/planning indicators are only used by RunningIndicator, not rendered as messages
      if (msg.type === 'thinking' || msg.type === 'planning_status')
        return false;
      if (msg.type !== 'text' || !msg.content) return true;
      const envelope = parseStructuredEnvelope(msg.content);
      if (envelope?.type !== 'plan') return true;
      return !hasExplicitPlan;
    });
  }, [messages]);

  // Memoize the entire grouping computation — this is O(n) with a backward-walk
  // cost map, and runs on every streaming message without memoization.
  const { groups, textGroupCostMap } = useMemo(() => {
    if (mergedMessages.length === 0) {
      return {
        groups: [] as MessageGroup[],
        textGroupCostMap: new Map<
          number,
          {
            cost?: number;
            usage?: {
              input_tokens?: number;
              output_tokens?: number;
              cache_read_input_tokens?: number;
              cache_creation_input_tokens?: number;
            };
          }
        >(),
      };
    }

    // Build a map from tool_use ID → tool_result for ID-based matching.
    // Falls back to index-based matching for messages without IDs (legacy).
    const toolResultById = new Map<string, AgentMessage>();
    const toolResultByIndex: AgentMessage[] = [];
    mergedMessages.forEach((msg) => {
      if (msg.type === 'tool_result') {
        if (msg.toolUseId) {
          toolResultById.set(msg.toolUseId, msg);
        }
        toolResultByIndex.push(msg);
      }
    });

    let toolResultFallbackIdx = 0;
    const getToolResult = (toolUseId?: string): AgentMessage | undefined => {
      if (toolUseId && toolResultById.has(toolUseId)) {
        return toolResultById.get(toolUseId);
      }
      // Fallback: index-based for messages without IDs
      return toolResultByIndex[toolResultFallbackIdx++];
    };

    // Filter out duplicate plan messages - only keep the last one
    const lastPlanIdx = mergedMessages.reduce(
      (lastIdx, msg, idx) => (msg.type === 'plan' ? idx : lastIdx),
      -1,
    );
    const filteredMessages =
      lastPlanIdx >= 0
        ? mergedMessages.filter(
            (msg, idx) => msg.type !== 'plan' || idx === lastPlanIdx,
          )
        : mergedMessages;

    // Find the last result message index in filteredMessages
    let lastResultIndex = -1;
    filteredMessages.forEach((msg, index) => {
      if (msg.type === 'result') {
        lastResultIndex = index;
      }
    });

    // Process messages into groups
    const groups: MessageGroup[] = [];
    let toolGlobalIndex = 0;

    // Use a ref object to track current group (avoids TypeScript narrowing issues)
    const state = { currentGroup: null as TaskMessageGroup | null };

    const pushCurrentGroup = (completed: boolean) => {
      if (
        state.currentGroup &&
        (state.currentGroup.tools.length > 0 || state.currentGroup.description)
      ) {
        state.currentGroup.isCompleted = completed;
        groups.push(state.currentGroup);
        state.currentGroup = null;
      }
    };

    const ensureCurrentGroup = () => {
      if (!state.currentGroup) {
        state.currentGroup = {
          type: 'task',
          title: t.task.executingTask,
          description: '',
          tools: [],
          isCompleted: false,
        };
      }
      return state.currentGroup;
    };

    let lastTextContent = '';
    // Track pending text message that might be standalone (no following tools)
    let pendingTextMessage: AgentMessage | null = null;

    filteredMessages.forEach((message, msgIndex) => {
      if (message.type === 'text' && message.content) {
        // Skip duplicate consecutive text messages
        if (message.content === lastTextContent) {
          return;
        }

        // Skip text messages that contain raw plan JSON
        // These are displayed by the PlanApproval component instead
        const trimmedContent = message.content.trim();
        if (
          trimmedContent.startsWith('{') &&
          trimmedContent.includes('"type"') &&
          trimmedContent.includes('"plan"')
        ) {
          return;
        }

        lastTextContent = message.content;

        // If there's a pending text message that had no tools, render it as standalone
        if (pendingTextMessage) {
          groups.push({ type: 'other', message: pendingTextMessage });
        }

        // Push any current tool group
        pushCurrentGroup(true);

        // Store this text as pending - we'll decide how to render it based on what follows
        pendingTextMessage = message;
        state.currentGroup = null;
      } else if (message.type === 'tool_use' && message.name) {
        // Text followed by tool_use - create a task group with the text as description
        if (pendingTextMessage) {
          const title =
            (pendingTextMessage.content || '').slice(
              0,
              TASK_TITLE_PREVIEW_LENGTH,
            ) +
            ((pendingTextMessage.content || '').length >
            TASK_TITLE_PREVIEW_LENGTH
              ? '...'
              : '');
          state.currentGroup = {
            type: 'task',
            title,
            description: pendingTextMessage.content || '',
            tools: [],
            isCompleted: false,
          };
          pendingTextMessage = null;
        }
        const group = ensureCurrentGroup();
        // Find associated tool_result by ID (falls back to index for legacy)
        const result = getToolResult(message.id);
        group.tools.push({ message, globalIndex: toolGlobalIndex++, result });
      } else if (message.type === 'tool_result') {
        // Skip tool_result messages as they're associated with tool_use
      } else if (message.type === 'user') {
        // Flush any pending text as standalone
        if (pendingTextMessage) {
          groups.push({ type: 'other', message: pendingTextMessage });
          pendingTextMessage = null;
        }
        pushCurrentGroup(true);
        groups.push({ type: 'other', message });
      } else if (message.type === 'result') {
        // Only show the last result message
        if (msgIndex === lastResultIndex) {
          // Flush any pending text as standalone
          if (pendingTextMessage) {
            groups.push({ type: 'other', message: pendingTextMessage });
            pendingTextMessage = null;
          }
          pushCurrentGroup(true);
          groups.push({ type: 'other', message });
        }
      } else if (message.type === 'error') {
        // Flush any pending text as standalone
        if (pendingTextMessage) {
          groups.push({ type: 'other', message: pendingTextMessage });
          pendingTextMessage = null;
        }
        pushCurrentGroup(true);
        groups.push({ type: 'other', message });
      } else if (message.type === 'plan') {
        // Plan message - render inline (duplicates already filtered out)
        if (pendingTextMessage) {
          groups.push({ type: 'other', message: pendingTextMessage });
          pendingTextMessage = null;
        }
        pushCurrentGroup(true);
        groups.push({ type: 'other', message });
      }
    });

    // Push any remaining pending text as standalone message
    if (pendingTextMessage) {
      groups.push({ type: 'other', message: pendingTextMessage });
    }

    // Push any remaining tool group
    pushCurrentGroup(!isRunning);

    // Build a map: for each text group index, attach cost/usage from the next result group
    const textGroupCostMap = new Map<
      number,
      {
        cost?: number;
        usage?: {
          input_tokens?: number;
          output_tokens?: number;
          cache_read_input_tokens?: number;
          cache_creation_input_tokens?: number;
        };
      }
    >();
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];
      if (
        group.type === 'other' &&
        group.message.type === 'result' &&
        (group.message.cost != null || group.message.usage)
      ) {
        // Walk backwards to find the last text message before this result
        for (let j = i - 1; j >= 0; j--) {
          const prev = groups[j];
          if (prev.type === 'other' && prev.message.type === 'text') {
            textGroupCostMap.set(j, {
              cost: group.message.cost,
              usage: group.message.usage,
            });
            break;
          }
          // Stop searching if we hit a user message (different conversation turn)
          if (prev.type === 'other' && prev.message.type === 'user') break;
        }
      }
    }

    return { groups, textGroupCostMap };
  }, [mergedMessages, isRunning, t]);

  if (groups.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      {groups.map((group, index) => {
        // Generate stable keys from group content instead of array index
        const groupKey =
          group.type === 'task'
            ? `task-${group.tools[0]?.globalIndex ?? index}`
            : `msg-${group.message.type}-${index}`;
        if (group.type === 'task') {
          return (
            <div key={groupKey}>
              <TaskGroupComponent
                title={group.title}
                description={group.description}
                tools={group.tools}
                isCompleted={group.isCompleted}
                isRunning={isRunning}
                searchQuery={searchQuery}
              />
            </div>
          );
        }
        const costData = textGroupCostMap.get(index);
        const canShowActions = group.message.type === 'text' && !isRunning;
        return (
          <div key={groupKey}>
            <MessageItem
              message={group.message}
              phase={phase}
              autoExecutePlan={autoExecutePlan}
              onApprovePlan={onApprovePlan}
              onRejectPlan={onRejectPlan}
              onRetry={canShowActions ? onRetry : undefined}
              onResume={canShowActions ? onResume : undefined}
              cost={costData?.cost}
              usage={costData?.usage}
            />
          </div>
        );
      })}
    </div>
  );
}
