import { useRef, useState, type ReactNode } from 'react';

import { useLocation } from 'react-router-dom';

import { FileText, Send, Square } from 'lucide-react';

import type { ModelOption } from '@/components/shared/ChatInput.types';
import { Button } from '@/components/ui/button';
import type { PromptLibrarySample } from '@/shared/design/prompt-library-types';
import type { AgentQuestion } from '@/shared/hooks/agent-types';
import type { DesignChatTurn } from '@/shared/hooks/useDesignChat';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import type {
  DesignJuryRun,
  DesignProject,
  DesignTaskRecord,
} from '@/shared/types/design-mode';

import { ChatPanelResizeHandle } from './ChatPanelResizeHandle';
import { DesignChatTranscript } from './DesignChatTranscript';
import { DesignComposerControls } from './DesignComposerControls';
import { DesignNextStepCard } from './DesignNextStepCard';
import { DesignProjectActivity } from './DesignProjectActivity';
import { DesignQuestionsPane } from './DesignQuestionsPane';
import { DesignStarters } from './DesignStarters';
import type { QueuedDesignSend } from './queued-design-sends';
import { QueuedSendStrip } from './QueuedSendStrip';
import { useDesignChatQuestions } from './use-design-chat-questions';

export type { QueuedDesignSend };
type ProjectChatSidebarTab = 'chat' | 'questions';

/** Artifact file types the chat can edit (shown as a composer context chip). */
const ARTIFACT_EXTENSION_RE = /\.(html|md|svg)$/i;

export function ProjectChatSidebar({
  activeTaskId,
  chatPanelWidth,
  juryError,
  juryRun,
  message,
  project,
  activeTab,
  queuedSends,
  questions: controlledQuestions,
  questionsStreaming: controlledQuestionsStreaming,
  sendError,
  sending,
  tasks,
  chatLoopActive = false,
  chatTurns = [],
  chatModelId,
  chatModelOptions = [],
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
  activeTab?: ProjectChatSidebarTab;
  queuedSends: QueuedDesignSend[];
  questions?: AgentQuestion[];
  questionsStreaming?: boolean;
  sendError: string | null;
  sending: boolean;
  tasks: DesignTaskRecord[];
  chatLoopActive?: boolean;
  chatTurns?: DesignChatTurn[];
  chatModelId?: string;
  chatModelOptions?: ModelOption[];
  onChatModelChange?: (modelId: string) => void;
  onProjectChange?: (project: DesignProject) => void;
  onBriefSubmit: (brief: Record<string, unknown>) => Promise<void>;
  onCancelActiveTask: () => void;
  onEditQueuedSend: (id: string) => void;
  onMessageChange: (message: string) => void;
  onRemoveQueuedSend: (id: string) => void;
  onSampleSelected: (sample: PromptLibrarySample) => void;
  onSend: () => void;
  onSendQueuedNow: (id: string) => void;
  onProjectFileOpen?: (path: string) => void;
  onAnswerQuestion: (text: string) => void;
  onActiveTabChange?: (tab: ProjectChatSidebarTab) => void;
  onWidthChange: (width: number) => void;
}) {
  const { t } = useLanguage();
  const isComposingRef = useRef(false);
  const [fallbackActiveTab, setFallbackActiveTab] =
    useState<ProjectChatSidebarTab>('chat');
  const currentActiveTab = activeTab ?? fallbackActiveTab;
  const setActiveTab = onActiveTabChange ?? setFallbackActiveTab;
  // Artifact the chat edits — shown as a composer context chip (Open Design).
  const openFile = new URLSearchParams(useLocation().search).get('file');
  const activeArtifactFile =
    openFile && ARTIFACT_EXTENSION_RE.test(openFile) ? openFile : null;
  const questionsControlled =
    controlledQuestions !== undefined &&
    controlledQuestionsStreaming !== undefined;
  const derivedQuestionState = useDesignChatQuestions({
    chatLoopActive,
    chatTurns,
    onQuestionsAppear: () => setActiveTab('questions'),
    enabled: !questionsControlled,
  });
  const questions = controlledQuestions ?? derivedQuestionState.questions;
  const questionsStreaming =
    controlledQuestionsStreaming ?? derivedQuestionState.questionsStreaming;

  return (
    <aside
      className="border-border relative flex min-w-0 shrink-0 flex-col border-r"
      style={{ width: chatPanelWidth }}
    >
      <div
        role="tablist"
        aria-label={`${t.design.chat} / ${t.design.questionsTab}`}
        className="border-border flex shrink-0 gap-1 border-b p-2"
      >
        <TabButton
          active={currentActiveTab === 'chat'}
          onClick={() => setActiveTab('chat')}
        >
          {t.design.chat}
        </TabButton>
        <TabButton
          active={currentActiveTab === 'questions'}
          onClick={() => setActiveTab('questions')}
        >
          {t.design.questionsTab}
          {questions.length > 0 && (
            <span className="bg-primary text-primary-foreground ml-1.5 rounded-full px-1.5 text-[10px] leading-4">
              {questions.length}
            </span>
          )}
        </TabButton>
      </div>
      {currentActiveTab === 'chat' && chatLoopActive ? (
        <div className="min-h-0 flex-1 overflow-auto p-3">
          <DesignChatTranscript
            turns={chatTurns}
            errorFallback={t.design.chatErrorFallback}
            askCardLabel={t.design.askCard}
            askCardAnsweredLabel={t.design.askCardAnswered}
            onOpenQuestions={() => setActiveTab('questions')}
            emptyState={
              <DesignStarters
                surface={project.surface}
                title={t.design.startersTitle}
                onSelect={onMessageChange}
              />
            }
          />
          {chatLoopActive && (
            <DesignNextStepCard
              surface={project.surface}
              turns={chatTurns}
              hasOpenQuestions={questions.length > 0}
              sending={sending}
              artifactFile={activeArtifactFile}
              onPick={onMessageChange}
            />
          )}
        </div>
      ) : currentActiveTab === 'chat' ? (
        <DesignProjectActivity
          projectId={project.id}
          brief={project.brief}
          tasks={tasks}
          sendError={sendError}
          juryRun={juryRun}
          juryError={juryError}
          emptyHint={t.design.emptyChatHint}
          scrollStorageKey={`neuma-design-chat-scroll:${project.id}`}
          promptLibrarySurface={project.surface === 'video' ? 'video' : 'image'}
          surface={project.surface}
          startersTitle={t.design.startersTitle}
          onStarterSelect={onMessageChange}
          onBriefSubmit={onBriefSubmit}
          onProjectFileOpen={onProjectFileOpen}
          onSampleSelected={onSampleSelected}
        />
      ) : (
        <DesignQuestionsPane
          questions={questions}
          streaming={questionsStreaming}
          onAnswer={(text) => {
            onAnswerQuestion(text);
            setActiveTab('chat');
          }}
        />
      )}
      <div className="border-border space-y-2 border-t p-3">
        <QueuedSendStrip
          queuedSends={queuedSends}
          labels={t.design}
          onSendQueuedNow={onSendQueuedNow}
          onEditQueuedSend={onEditQueuedSend}
          onRemoveQueuedSend={onRemoveQueuedSend}
        />
        <textarea
          value={message}
          onChange={(event) => onMessageChange(event.target.value)}
          onCompositionStart={() => {
            isComposingRef.current = true;
          }}
          onCompositionEnd={() => {
            setTimeout(() => {
              isComposingRef.current = false;
            }, 10);
          }}
          onKeyDown={(event) => {
            if (
              event.key === 'Enter' &&
              !event.shiftKey &&
              !isComposingRef.current
            ) {
              event.preventDefault();
              onSend();
            }
          }}
          placeholder={t.design.composerPlaceholder}
          className="border-input bg-background min-h-24 w-full resize-none rounded-md border p-3 text-sm break-words outline-none"
        />
        {chatLoopActive && activeArtifactFile && (
          <div className="border-border text-muted-foreground inline-flex w-fit max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-xs">
            <FileText className="size-3 shrink-0" />
            <span className="truncate">
              {t.design.composerCurrentFile.replace(
                '{file}',
                activeArtifactFile.split('/').pop() ?? activeArtifactFile,
              )}
            </span>
          </div>
        )}
        <div className="flex items-center justify-between gap-2">
          {chatLoopActive && chatModelId && onChatModelChange ? (
            <DesignComposerControls
              modelId={chatModelId}
              modelOptions={chatModelOptions}
              onModelChange={onChatModelChange}
              project={project}
              onProjectChange={onProjectChange}
            />
          ) : (
            <span className="text-muted-foreground text-xs">
              {t.design.composerHint}
            </span>
          )}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t.design.cancelTask}
              disabled={!activeTaskId}
              onClick={onCancelActiveTask}
            >
              <Square className="size-4" />
            </Button>
            <Button
              type="button"
              size="icon-sm"
              aria-label={t.design.send}
              disabled={sending}
              onClick={onSend}
            >
              <Send className="size-4" />
            </Button>
          </div>
        </div>
      </div>
      <ChatPanelResizeHandle
        width={chatPanelWidth}
        label={t.design.resizeChatPanel}
        onWidthChange={onWidthChange}
      />
    </aside>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'inline-flex items-center rounded-md px-3 py-1 text-sm transition-colors',
        active
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:bg-muted',
      )}
    >
      {children}
    </button>
  );
}
