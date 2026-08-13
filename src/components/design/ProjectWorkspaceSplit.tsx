import type { ModelOption } from '@/components/shared/ChatInput.types';
import type { PromptLibrarySample } from '@/shared/design/prompt-library-types';
import type { AgentQuestion } from '@/shared/hooks/agent-types';
import type { DesignChatTurn } from '@/shared/hooks/useDesignChat';
import type {
  DesignJuryRun,
  DesignProject,
  DesignTaskRecord,
} from '@/shared/types/design-mode';

import { FileWorkspace } from './FileWorkspace';
import { ProjectChatSidebar } from './ProjectChatSidebar';
import type { QueuedDesignSend } from './queued-design-sends';

export type ProjectChatSidebarTab = 'chat' | 'questions';

export function ProjectWorkspaceSplit({
  activeTaskId,
  chatPanelWidth,
  juryError,
  juryRun,
  message,
  project,
  sendError,
  sending,
  tasks,
  activeTab,
  queuedSends,
  questions,
  questionsStreaming,
  chatLoopActive,
  chatTurns,
  chatModelId,
  chatModelOptions,
  reloadSignal,
  onChatModelChange,
  onProjectChange,
  onBriefSubmit,
  onCancelActiveTask,
  onEditQueuedSend,
  onMessageChange,
  onRemoveQueuedSend,
  onSampleSelected,
  onSend,
  onSendQueuedNow,
  onProjectFileOpen,
  onAnswerQuestion,
  onActiveTabChange,
  onWidthChange,
}: {
  activeTaskId: string | null;
  chatPanelWidth: number;
  juryError: string | null;
  juryRun: DesignJuryRun | null;
  message: string;
  project: DesignProject;
  sendError: string | null;
  sending: boolean;
  tasks: DesignTaskRecord[];
  activeTab: ProjectChatSidebarTab;
  queuedSends: QueuedDesignSend[];
  questions: AgentQuestion[];
  questionsStreaming: boolean;
  chatLoopActive: boolean;
  chatTurns: DesignChatTurn[];
  chatModelId?: string;
  chatModelOptions: ModelOption[];
  reloadSignal: number;
  onChatModelChange: (modelId: string) => void;
  onProjectChange: (project: DesignProject) => void;
  onBriefSubmit: (brief: Record<string, unknown>) => Promise<void>;
  onCancelActiveTask: () => void;
  onEditQueuedSend: (id: string) => void;
  onMessageChange: (message: string) => void;
  onRemoveQueuedSend: (id: string) => void;
  onSampleSelected: (sample: PromptLibrarySample) => void;
  onSend: () => void;
  onSendQueuedNow: (id: string) => void;
  onProjectFileOpen: (path: string) => void;
  onAnswerQuestion: (text: string) => void;
  onActiveTabChange: (tab: ProjectChatSidebarTab) => void;
  onWidthChange: (width: number) => void;
}) {
  return (
    <div className="design-split flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <ProjectChatSidebar
        activeTaskId={activeTaskId}
        chatPanelWidth={chatPanelWidth}
        juryError={juryError}
        juryRun={juryRun}
        message={message}
        project={project}
        sendError={sendError}
        sending={sending}
        tasks={tasks}
        activeTab={activeTab}
        queuedSends={queuedSends}
        questions={questions}
        questionsStreaming={questionsStreaming}
        chatLoopActive={chatLoopActive}
        chatTurns={chatTurns}
        chatModelId={chatModelId}
        chatModelOptions={chatModelOptions}
        onChatModelChange={onChatModelChange}
        onProjectChange={onProjectChange}
        onBriefSubmit={onBriefSubmit}
        onCancelActiveTask={onCancelActiveTask}
        onEditQueuedSend={onEditQueuedSend}
        onMessageChange={onMessageChange}
        onRemoveQueuedSend={onRemoveQueuedSend}
        onSampleSelected={onSampleSelected}
        onSend={onSend}
        onSendQueuedNow={onSendQueuedNow}
        onProjectFileOpen={onProjectFileOpen}
        onAnswerQuestion={onAnswerQuestion}
        onActiveTabChange={onActiveTabChange}
        onWidthChange={onWidthChange}
      />
      <FileWorkspace
        projectId={project.id}
        project={project}
        surface={project.surface}
        outputs={project.outputs}
        onProjectChange={onProjectChange}
        onSendToChat={onAnswerQuestion}
        reloadSignal={reloadSignal}
      />
    </div>
  );
}
