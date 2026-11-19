import { ChatInput } from '@/components/shared/ChatInput';
import type { TaskPlan } from '@/shared/hooks/agent-types';
import type { MessageAttachment } from '@/shared/hooks/useAgent';
import type { StreamSignalSource } from '@/shared/hooks/useStreamSignals';

import { StreamSignalBanner } from './StreamSignalBanner';

/**
 * The V2 thread's running indicator and reply box, below the transcript.
 * Extracted from `TaskV2Thread` to keep that component within its size limit.
 */
export function TaskV2Composer({
  taskId,
  agent,
  isRunning,
  pendingPlan,
  labels,
  selectedModel,
  onModelChange,
  onSubmit,
  onStop,
}: {
  taskId: string | undefined;
  agent: StreamSignalSource;
  isRunning: boolean;
  pendingPlan: TaskPlan | null;
  labels: {
    planning: string;
    runningEllipsis: string;
    continueConversation: string;
  };
  selectedModel?: string;
  onModelChange?: (modelId: string) => void;
  onSubmit: (
    text: string,
    attachments?: MessageAttachment[],
    mcpServers?: string[],
    pinnedSkills?: string[],
  ) => Promise<void | boolean>;
  onStop: () => void;
}) {
  return (
    <>
      {isRunning && (
        <div className="text-muted-foreground mx-auto flex max-w-4xl items-center gap-2 px-4 py-2 text-xs">
          <span className="border-primary inline-block h-3 w-3 animate-spin rounded-full border-2 border-t-transparent" />
          {!pendingPlan ? labels.planning : labels.runningEllipsis}
        </div>
      )}

      <div className="mx-auto w-full max-w-3xl px-4 pb-4">
        <StreamSignalBanner key={taskId} agent={agent} taskId={taskId} />
        <ChatInput
          variant="reply"
          isRunning={isRunning}
          onSubmit={onSubmit}
          onStop={onStop}
          placeholder={labels.continueConversation}
          autoFocus
          selectedModel={selectedModel}
          onModelChange={onModelChange}
        />
      </div>
    </>
  );
}
