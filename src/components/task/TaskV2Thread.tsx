import React, { useCallback, useEffect, useMemo, useRef } from 'react';

import { useAgent } from '@copilotkit/react-core/v2';
import { ChevronDown } from 'lucide-react';
import { Virtuoso } from 'react-virtuoso';

import type { Artifact } from '@/components/artifacts/types';
import { ChatInput } from '@/components/shared/ChatInput';
import {
  enqueueEditedCommand,
  flushEditedCommand,
} from '@/components/task/edited-command-queue';
import {
  groupMessages,
  renderGroupedItem,
  type GroupedItem,
  type GroupedItemRenderContext,
} from '@/components/task/GroupedMessageList';
import { appendOutputArtifactsItem } from '@/components/task/outputArtifactItems';
import { RunErrorBubble } from '@/components/task/RunErrorBubble';
import { RunTreeView } from '@/components/task/RunTreeView';
import { StreamSignalBanner } from '@/components/task/StreamSignalBanner';
import { SubAgentPanel } from '@/components/task/SubAgentPanel';
import { TaskThreadActions } from '@/components/task/task-thread-actions';
import {
  buildAgentPrompt,
  checkEmptyRun,
  deriveAttachmentDirs,
  notifyAttachmentFailures,
  resolveAttachmentsForSubmit,
} from '@/components/task/taskV2-submit-helpers';
import type { AGUIMessage } from '@/components/task/TaskV2MessageBubble';
import {
  appendPermissionItems,
  injectBranchNav,
} from '@/components/task/thread-items';
import { createMessage } from '@/shared/db';
import type { MessageAttachment } from '@/shared/hooks/useAgent';
import { useAgentActions } from '@/shared/hooks/useAgentActions';
import { useAgentSync } from '@/shared/hooks/useAgentSync';
import { useAutoScroll } from '@/shared/hooks/useAutoScroll';
import { useBranchActions } from '@/shared/hooks/useBranchActions';
import { usePermissionRequests } from '@/shared/hooks/usePermissionRequests';
import { usePlanInterrupt } from '@/shared/hooks/usePlanInterrupt';
import { usePostRunEffects } from '@/shared/hooks/usePostRunEffects';
import { useRunError } from '@/shared/hooks/useRunError';
import { useSubAgents } from '@/shared/hooks/useSubAgents';
import { useThreadSync } from '@/shared/hooks/useThreadSync';
import { useV2FileExtraction } from '@/shared/hooks/useV2FileExtraction';
import { toAgentSeedMessages } from '@/shared/lib/message-tree';
import { useLanguage } from '@/shared/providers/language-provider';
import { useBranchStore } from '@/shared/stores/branch-store';
import {
  useThreadHydration,
  useThreadStore,
} from '@/shared/stores/thread-store';
import { randomUUID } from '@/shared/utils/uuid';

const EMPTY_MESSAGES: unknown[] = []; // Stable selector fallback.

// ── Main thread component ─────────────────────────────────────────────────────

/**
 * Full thread view for the AG-UI V2 route (/task-v2/:id).
 * Uses CopilotKit's useAgent hook for message state and run control.
 * Renders the shared ChatInput (reply variant) wired to agent.runAgent().
 */
export function TaskV2Thread({
  attachmentMapRef: externalMapRef,
  taskId,
  historyMessages,
  modelConfig,
  onSubmitRef,
  selectedModel,
  onModelChange,
  workDir,
  additionalWorkDirs,
  allArtifacts,
  promptPrefix,
}: {
  attachmentMapRef?: React.RefObject<Map<string, MessageAttachment[]>>;
  taskId?: string;
  historyMessages?: AGUIMessage[];
  modelConfig?: Record<string, unknown>;
  /** Mutable ref the parent can use to call handleSubmit (for workspace inline reply). */
  onSubmitRef?: React.MutableRefObject<((text: string) => void) | null>;
  selectedModel?: string;
  onModelChange?: (modelId: string) => void;
  /** Task working directory — passed to backend in forwardedProps */
  workDir?: string;
  /** Additional workspace directories for multi-folder access */
  additionalWorkDirs?: string[];
  allArtifacts?: Artifact[];
  /** Prepended to the next message only, then reported through `onUsed`. */
  promptPrefix?: { text: string; onUsed: () => void };
}) {
  const { agent } = useAgent();
  const { t, tt } = useLanguage();
  useThreadSync(taskId);

  // Declare agentRef early — used by error handlers and watchdog below.
  const agentRef = useRef(agent);
  agentRef.current = agent;

  // Refs for workDir/additionalWorkDirs — read from refs in callbacks with sparse deps
  // to avoid stale closures (CLAUDE.md: useCallback with sparse deps must read from refs)
  const workDirRef = useRef(workDir);
  workDirRef.current = workDir;
  const additionalWorkDirsRef = useRef(additionalWorkDirs);
  additionalWorkDirsRef.current = additionalWorkDirs;

  const taskIdRef = useRef(taskId);
  taskIdRef.current = taskId;

  const historyMessagesRef = useRef(historyMessages);
  historyMessagesRef.current = historyMessages;

  const modelConfigRef = useRef(modelConfig);
  modelConfigRef.current = modelConfig;

  const promptPrefixRef = useRef(promptPrefix);
  promptPrefixRef.current = promptPrefix;

  // ── Extracted hooks ──
  const { runError, setRunError, clearRunError } = useRunError(
    taskId,
    agent,
    t.task.agentRunFailed,
  );

  const {
    pendingPlan,
    setPendingPlan,
    planRejectedRef,
    handleApprovePlan,
    handleRejectPlan,
  } = usePlanInterrupt(
    taskId,
    agent,
    runError,
    workDirRef,
    additionalWorkDirsRef,
    modelConfigRef,
  );

  const { forceRender } = useAgentSync(agent);

  usePostRunEffects(taskId, agent, planRejectedRef, setPendingPlan);

  // Track attachments per message ID (AG-UI messages don't carry attachment data).
  // Uses external ref from parent (shared with InitialMessageSender) if provided.
  const internalMapRef = useRef<Map<string, MessageAttachment[]>>(new Map());
  const resolvedAttachmentMapRef = externalMapRef ?? internalMapRef;

  // Active thread: CopilotKit agent state is authoritative.
  // Inactive thread: Zustand cache (backed by DB) or historyMessages prop.
  const agentMessages = agent.messages as AGUIMessage[];
  const cachedMessages = useThreadStore(
    (s) => s.threads[taskId ?? '']?.messages ?? EMPTY_MESSAGES,
  ) as AGUIMessage[];
  const hydrationState = useThreadHydration(taskId);
  const messages = useMemo(
    () =>
      hydrationState === 'pending'
        ? []
        : agentMessages.length > 0
          ? agentMessages
          : cachedMessages.length > 0
            ? cachedMessages
            : ((historyMessages ?? []) as AGUIMessage[]),
    [agentMessages, cachedMessages, historyMessages, hydrationState],
  );

  // Bridge ChatInput's onSubmit to CopilotKit headless agent.
  // Desktop app — files are on disk, so we just pass paths in the prompt.
  // The agent can read/view them directly via tool use.
  const handleSubmit = useCallback(
    async (
      text: string,
      attachments?: MessageAttachment[],
      mcpServers?: string[],
      pinnedSkills?: string[],
    ) => {
      const a = agentRef.current;
      if ((!text.trim() && !attachments?.length) || a.isRunning) return false;

      // Don't let a prior run's error banner linger onto this new send.
      clearRunError();

      if (import.meta.env.DEV && attachments?.length) {
        console.warn(
          '[TaskV2Thread] attachments:',
          attachments.map((att) => ({
            name: att.name,
            type: att.type,
            path: att.path,
            hasData: !!att.data,
            dataLen: att.data?.length ?? 0,
          })),
        );
      }

      // Persist File-object attachments to disk before the submit so the
      // agent receives `att.path` in the prompt prefix. A file the agent
      // could not see blocks the send; `false` restores the composer draft.
      const staged = await resolveAttachmentsForSubmit(
        attachments,
        taskIdRef.current,
        workDirRef.current,
      );
      if (notifyAttachmentFailures(staged.failures, tt)) return false;
      const resolvedAttachments = staged.attachments;

      const prefix = promptPrefixRef.current;
      const { prompt, imageBlocks } = buildAgentPrompt(
        prefix ? `${prefix.text}\n\n${text}` : text,
        resolvedAttachments,
      );
      prefix?.onUsed();

      const msgId = randomUUID();
      if (resolvedAttachments && resolvedAttachments.length > 0) {
        resolvedAttachmentMapRef.current.set(msgId, resolvedAttachments);
      }

      if (taskIdRef.current) {
        // Persist the augmented prompt (with [ATTACHED FILES …] prefix) so
        // conversation replay after a fresh-mount preserves attachment
        // context for the agent. Display strips the prefix via
        // ATTACHED_FILES_PREFIX_RE.
        createMessage({
          task_id: taskIdRef.current,
          type: 'user',
          content: prompt,
          message_id: msgId,
          ...(resolvedAttachments?.length
            ? { attachments: JSON.stringify(resolvedAttachments) }
            : {}),
        }).catch(() => {});
      }

      // Seed agent with history (prose turns only) so the display doesn't flip
      // from historyMessages to empty agentMessages on the first reply.
      if (a.messages.length === 0 && historyMessagesRef.current?.length) {
        for (const msg of toAgentSeedMessages(historyMessagesRef.current)) {
          a.addMessage(msg);
        }
      }

      a.addMessage({ id: msgId, role: 'user', content: prompt });
      // Widen the agent's sandbox to include each dropped file's parent
      // directory so the Read tool can open them without us having to copy
      // the bytes into the session folder.
      const attachmentDirs = deriveAttachmentDirs(resolvedAttachments);
      const mergedAdditionalDirs = [
        ...(additionalWorkDirsRef.current ?? []),
        ...attachmentDirs.filter(
          (d) => !(additionalWorkDirsRef.current ?? []).includes(d),
        ),
      ];
      try {
        await a.runAgent({
          forwardedProps: {
            taskId: taskIdRef.current,
            ...(workDirRef.current ? { workDir: workDirRef.current } : {}),
            ...(mergedAdditionalDirs.length
              ? { additionalWorkDirs: mergedAdditionalDirs }
              : {}),
            ...(modelConfigRef.current
              ? { modelConfig: modelConfigRef.current }
              : {}),
            ...(imageBlocks.length > 0 ? { images: imageBlocks } : {}),
            ...(mcpServers?.length ? { mcpServers } : {}),
            ...(pinnedSkills?.length ? { pinnedSkills } : {}),
          },
        });

        const tid = taskIdRef.current;
        if (tid) {
          const msgs = a.messages as AGUIMessage[];
          const hasOutput = msgs.some(
            (m) =>
              m.role === 'assistant' &&
              (m.content || (m as AGUIMessage).toolCalls?.length),
          );
          const fallback = t.task.agentRunFailed;
          const errorMsg = await checkEmptyRun(tid, hasOutput, fallback);
          if (errorMsg) setRunError(errorMsg);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setRunError(msg);
      }
    },
    [
      resolvedAttachmentMapRef,
      t.task.agentRunFailed,
      tt,
      setRunError,
      clearRunError,
    ],
  );

  // Expose handleSubmit to parent for workspace inline reply
  useEffect(() => {
    if (onSubmitRef) {
      onSubmitRef.current = (text: string) => {
        void handleSubmit(text);
      };
    }
    return () => {
      if (onSubmitRef) onSubmitRef.current = null;
    };
  }, [handleSubmit, onSubmitRef]);

  const {
    handleStop,
    handleSendMessage,
    handleCancelSubAgent,
    handleCancelTool,
  } = useAgentActions(
    agentRef,
    taskIdRef,
    historyMessagesRef,
    forceRender,
    workDirRef,
    additionalWorkDirsRef,
    modelConfigRef,
    clearRunError,
  );

  // Branch actions — edit message, regenerate, fork, branch navigation
  const {
    handleEditMessage,
    handleRegenerate,
    handleForkFromHere,
    handleBranchNavigate,
  } = useBranchActions(
    agentRef,
    taskIdRef,
    workDirRef,
    additionalWorkDirsRef,
    modelConfigRef,
    clearRunError,
  );

  // When an error is detected, treat the agent as stopped regardless of
  // CopilotKit's internal state (which may be stuck on isRunning=true).
  // Also use Zustand's isRunning as fallback — after a task switch the
  // CopilotKit provider remounts with isRunning=false, but the Zustand
  // store is hydrated from /ag-ui/history which reflects the real state.
  const zustandIsRunning = useThreadStore(
    (s) => s.threads[taskId ?? '']?.isRunning ?? false,
  );
  const effectiveIsRunning = (agent.isRunning || zustandIsRunning) && !runError;

  // Register tool-created files (Bash/Skill/etc.) into the Library so they
  // render inline via LocalOutputArtifactPreviews — see useV2FileExtraction.
  useV2FileExtraction(taskId, messages, workDir, effectiveIsRunning);

  // Permission handling — only subscribes to SSE when agent is running
  const { permissionRequests, respond: handlePermissionRespond } =
    usePermissionRequests(taskId, effectiveIsRunning);

  // Sub-agent supervision — track lifecycle from SSE events
  const subAgents = useSubAgents(taskId, effectiveIsRunning);

  const isCancelledPlan =
    pendingPlan?.steps.every((s) => s.status === 'cancelled') ?? false;
  const isWaitingApproval =
    !!pendingPlan && !effectiveIsRunning && !isCancelledPlan && !runError;

  // Branch metadata — used to inject branch-nav indicators at fork points
  const branchState = useBranchStore((s) => s.taskBranches[taskId ?? '']);

  // Build grouped items for Virtuoso, then inject branch-nav items at fork points
  const groupedItems = useMemo(() => {
    const items = groupMessages(messages, pendingPlan, isWaitingApproval);
    const listed = !branchState?.branchMeta.length
      ? appendOutputArtifactsItem(items, allArtifacts)
      : appendOutputArtifactsItem(
          injectBranchNav(items, branchState),
          allArtifacts,
        );
    return appendPermissionItems(listed, permissionRequests);
  }, [
    messages,
    pendingPlan,
    isWaitingApproval,
    branchState,
    allArtifacts,
    permissionRequests,
  ]);

  const queuedEditRef = useRef<string | null>(null);
  const sendEditedCommand = useCallback(
    (text: string) => {
      const next = enqueueEditedCommand(effectiveIsRunning, text);
      if (next.deliver) {
        handleSendMessage(next.deliver);
        return;
      }
      queuedEditRef.current = next.queued;
    },
    [effectiveIsRunning, handleSendMessage],
  );

  useEffect(() => {
    const delivery = flushEditedCommand(
      effectiveIsRunning,
      queuedEditRef.current,
    );
    if (!delivery.deliver) return;
    queuedEditRef.current = null;
    handleSendMessage(delivery.deliver);
  }, [effectiveIsRunning, handleSendMessage]);

  return (
    <TaskThreadActions
      sessionRoot={workDir}
      respondToPermission={handlePermissionRespond}
      sendMessage={sendEditedCommand}
    >
      <div className="flex h-full min-w-0 flex-col overflow-hidden">
        <VirtuosoMessageList
          groupedItems={groupedItems}
          messages={messages}
          isRunning={effectiveIsRunning}
          thinkingLabel={t.task.thinking}
          attachmentMap={resolvedAttachmentMapRef.current}
          allArtifacts={allArtifacts}
          onSendMessage={handleSendMessage}
          onApprovePlan={handleApprovePlan}
          onRejectPlan={handleRejectPlan}
          onCancelTool={effectiveIsRunning ? handleCancelTool : undefined}
          onEditMessage={handleEditMessage}
          onRegenerate={handleRegenerate}
          onForkFromHere={handleForkFromHere}
          onBranchNavigate={handleBranchNavigate}
          scrollToBottomLabel={t.common.scrollToBottom}
        />

        {/* Permission dialogs, sub-agents, errors — outside virtualized list */}
        {(subAgents.length > 0 || runError) && (
          <div className="mx-auto max-w-4xl px-4">
            {subAgents.length > 0 && (
              <SubAgentPanel
                subAgents={subAgents}
                onCancel={handleCancelSubAgent}
              />
            )}

            {/* Persisted run tree (post-stream) — additive to the live SubAgentPanel above. */}
            {taskId && <RunTreeView taskId={taskId} />}

            {runError && (
              <RunErrorBubble
                errorLabel={t.task.agentError ?? 'Error'}
                message={runError}
                onDismiss={clearRunError}
              />
            )}
          </div>
        )}

        {effectiveIsRunning && (
          <div className="text-muted-foreground mx-auto flex max-w-4xl items-center gap-2 px-4 py-2 text-xs">
            <span className="border-primary inline-block h-3 w-3 animate-spin rounded-full border-2 border-t-transparent" />
            {!pendingPlan ? t.task.planning : t.task.runningEllipsis}
          </div>
        )}

        <div className="mx-auto w-full max-w-3xl px-4 pb-4">
          <StreamSignalBanner key={taskId} agent={agent} taskId={taskId} />
          <ChatInput
            variant="reply"
            isRunning={effectiveIsRunning}
            onSubmit={handleSubmit}
            onStop={handleStop}
            placeholder={t.task.continueConversation}
            autoFocus
            selectedModel={selectedModel}
            onModelChange={onModelChange}
          />
        </div>
      </div>
    </TaskThreadActions>
  );
}

// ── Virtuoso message list (extracted to keep TaskV2Thread under 350 lines) ───

function VirtuosoMessageList({
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

  // Stable render context — read from ref to avoid stale closures in Virtuoso itemContent
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
  const renderContextRef = useRef(renderContext);
  renderContextRef.current = renderContext;

  const itemContent = useCallback(
    (_index: number, item: GroupedItem) =>
      renderGroupedItem(item, renderContextRef.current),
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

// Module-level Virtuoso components — inline objects break memoization
const VIRTUOSO_COMPONENTS = {
  Item: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div {...props} className="mx-auto max-w-4xl px-4">
      {children}
    </div>
  ),
};
