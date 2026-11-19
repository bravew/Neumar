import { useCallback, useEffect, useRef } from 'react';

import { ChevronDown } from 'lucide-react';
import { Virtuoso } from 'react-virtuoso';

import type { Artifact } from '@/components/artifacts/types';
import {
  type GroupedItem,
  type GroupedItemRenderContext,
  renderGroupedItem,
} from '@/components/task/GroupedMessageList';
import type { AGUIMessage } from '@/components/task/TaskV2MessageBubble';
import { VIRTUOSO_COMPONENTS } from '@/components/task/virtuosoComponents';
import type { MessageAttachment } from '@/shared/hooks/useAgent';
import { useAutoScroll } from '@/shared/hooks/useAutoScroll';

/** Virtualized transcript, extracted to keep TaskV2Thread under its ceiling. */
export function VirtuosoMessageList({
  groupedItems,
  messages,
  isRunning,
  thinkingLabel,
  attachmentMap,
  allArtifacts,
  onSendMessage,
  onApprovePlan,
  onRejectPlan,
  onCancelTool,
  onEditMessage,
  onRegenerate,
  onForkFromHere,
  onBranchNavigate,
  scrollToBottomLabel,
}: {
  groupedItems: GroupedItem[];
  messages: AGUIMessage[];
  isRunning: boolean;
  thinkingLabel: string;
  attachmentMap: Map<string, MessageAttachment[]>;
  allArtifacts?: Artifact[];
  onSendMessage: (text: string) => void;
  onApprovePlan: () => void;
  onRejectPlan: () => void;
  onCancelTool?: (toolUseId: string) => void;
  onEditMessage?: (messageId: string, newContent: string) => void;
  onRegenerate?: (messageId: string) => void;
  onForkFromHere?: (messageId: string) => void;
  onBranchNavigate?: (
    forkPointId: string | number,
    direction: 'prev' | 'next',
  ) => void;
  scrollToBottomLabel: string;
}) {
  const {
    virtuosoRef,
    handleScrollerRef,
    handleScroll,
    handleAtBottomStateChange,
    handleFollowOutput,
    showScrollButton,
    scrollToBottom,
  } = useAutoScroll({ isRunning });

  // Force scroll to bottom when user sends a message
  const prevMessageCountRef = useRef(messages.length);
  useEffect(() => {
    const prev = prevMessageCountRef.current;
    prevMessageCountRef.current = messages.length;
    if (messages.length > prev) {
      const lastMsg = messages[messages.length - 1];
      if (lastMsg?.role === 'user') {
        scrollToBottom('auto');
      }
    }
  }, [messages, scrollToBottom]);

  // Passed through Virtuoso's `context`, so `itemContent` stays stable while
  // items still render with the latest values.
  const renderContext: GroupedItemRenderContext = {
    thinkingLabel,
    attachmentMap,
    messages,
    allArtifacts,
    isRunning,
    onSendMessage,
    onApprovePlan,
    onRejectPlan,
    onCancelTool,
    onEditMessage,
    onRegenerate,
    onForkFromHere,
    onBranchNavigate,
  };
  const itemContent = useCallback(
    (_index: number, item: GroupedItem, context: GroupedItemRenderContext) =>
      renderGroupedItem(item, context),
    [],
  );

  return (
    <div className="relative min-w-0 flex-1">
      <Virtuoso
        ref={virtuosoRef}
        data={groupedItems}
        computeItemKey={(_index, item) => item.key}
        defaultItemHeight={80}
        increaseViewportBy={1200}
        atBottomThreshold={100}
        followOutput={handleFollowOutput}
        atBottomStateChange={handleAtBottomStateChange}
        scrollerRef={handleScrollerRef}
        onScroll={handleScroll}
        context={renderContext}
        itemContent={itemContent}
        className="h-full overflow-x-hidden pt-6 pb-16"
        initialTopMostItemIndex={
          groupedItems.length > 0 ? groupedItems.length - 1 : 0
        }
        components={VIRTUOSO_COMPONENTS}
      />

      {showScrollButton && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center">
          <button
            onClick={() => scrollToBottom()}
            className="bg-background/80 border-border text-muted-foreground hover:text-foreground pointer-events-auto rounded-full border p-2 shadow-md backdrop-blur-sm transition-colors"
            title={scrollToBottomLabel}
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
