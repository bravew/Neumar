import { useEffect, useMemo, useRef, useState } from 'react';

import { useCopilotKit } from '@copilotkit/react-core/v2';

import type { AGUIMessage } from '@/components/task/TaskV2MessageBubble.types';
import { TaskV2Thread } from '@/components/task/TaskV2Thread';
import { getMessagesByTaskId, getTask } from '@/shared/db';
import { parseAdditionalWorkDirs } from '@/shared/db/types';
import { buildModelOverride } from '@/shared/hooks/agent-utils';
import { useTaskModelSelector } from '@/shared/hooks/useTaskModelSelector';
import { dbMessagesToAGUI } from '@/shared/lib/message-tree';
import {
  clearPendingFirstPrompt,
  readPendingFirstPrompt,
} from '@/shared/lib/pending-initial-prompt';
import { AgUiProvider } from '@/shared/providers/agui-provider';

/**
 * Module-level so a StrictMode or keyed remount cannot send a new chat's
 * first prompt twice (the same guard InitialMessageSender uses).
 */
const sentFirstPromptTaskIds = new Set<string>();

/** Test-only: clears the first-send guard between test cases. */
export function resetDockFirstSendForTests(): void {
  sentFirstPromptTaskIds.clear();
}

interface DockThreadProps {
  taskId: string;
  promptPrefix?: { text: string; onUsed: () => void };
}

/** The task page's thread, mounted in the dock with its own agent runtime. */
export function DockThread(props: DockThreadProps) {
  // A chat this dock just created has no history to fetch, and it still owes
  // its first prompt. Both facts come from the pending registry rather than a
  // prop, so a dock that unmounted before the lazy thread connected does not
  // lose the handoff.
  const owesFirstPrompt = readPendingFirstPrompt(props.taskId) !== null;
  return (
    <AgUiProvider
      key={props.taskId}
      threadId={props.taskId}
      isNewTask={owesFirstPrompt}
    >
      <DockThreadBody {...props} />
    </AgUiProvider>
  );
}

function DockThreadBody({ taskId, promptPrefix }: DockThreadProps) {
  const { copilotkit } = useCopilotKit();
  const [historyMessages, setHistoryMessages] = useState<AGUIMessage[]>([]);
  const [workDir, setWorkDir] = useState<string>();
  const [additionalWorkDirs, setAdditionalWorkDirs] = useState<string[]>();
  const [modelId, setModelId] = useTaskModelSelector(taskId);
  const modelConfig = useMemo(
    () =>
      modelId
        ? (buildModelOverride(modelId) as Record<string, unknown>)
        : undefined,
    [modelId],
  );
  const submitRef = useRef<((text: string) => void) | null>(null);

  useEffect(() => {
    let stale = false;
    void Promise.all([
      getMessagesByTaskId(taskId).catch(() => []),
      getTask(taskId).catch(() => null),
    ]).then(([messages, task]) => {
      if (stale) return;
      setHistoryMessages(dbMessagesToAGUI(messages));
      setWorkDir(task?.work_dir ?? undefined);
      setAdditionalWorkDirs(
        parseAdditionalWorkDirs(task?.additional_work_dirs),
      );
    });
    return () => {
      stale = true;
    };
  }, [taskId]);

  // Same gate as InitialMessageSender: the agent from useAgent() is only the
  // real one once the runtime reports `connected`. The prompt is read from the
  // pending registry at send time, so a dock reopened after a close still
  // delivers it. Claiming it here is what makes delivery exactly once: the
  // dock, a remount, and the full task view all consult the same registry.
  const connected = copilotkit.runtimeConnectionStatus === 'connected';
  useEffect(() => {
    if (!connected || !submitRef.current) return;
    if (sentFirstPromptTaskIds.has(taskId)) return;
    const prompt = readPendingFirstPrompt(taskId);
    if (prompt === null) return;
    sentFirstPromptTaskIds.add(taskId);
    clearPendingFirstPrompt(taskId);
    submitRef.current(prompt);
  }, [connected, taskId]);

  return (
    <TaskV2Thread
      taskId={taskId}
      historyMessages={historyMessages}
      modelConfig={modelConfig}
      onSubmitRef={submitRef}
      selectedModel={modelId}
      onModelChange={setModelId}
      workDir={workDir}
      additionalWorkDirs={additionalWorkDirs}
      promptPrefix={promptPrefix}
    />
  );
}
