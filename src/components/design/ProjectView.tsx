import { useCallback, useEffect, useRef, useState } from 'react';

import { useSetting } from '@/shared/db/settings';
import type { PromptLibrarySample } from '@/shared/design/prompt-library-types';
import { useDesignChat } from '@/shared/hooks/useDesignChat';
import { useDesignMdState } from '@/shared/hooks/useDesignMdState';
import {
  cancelDesignMediaTask,
  getDesignDebugSnapshot,
  resolveDesignPrompt,
  startDesignMedia,
  updateDesignProject,
} from '@/shared/hooks/useDesignMode';
import type {
  DesignDebugSnapshot,
  DesignProject,
} from '@/shared/types/design-mode';

import { useStoredChatPanelWidth } from './ChatPanelResizeHandle';
import { isDesignChatSurface } from './constants';
import {
  appendCommentAttachments,
  loadQueuedCommentAttachments,
  markCommentsAttached,
} from './project-comment-attachments';
import { ProjectHeader } from './ProjectHeader';
import { ProjectViewPanels } from './ProjectViewPanels';
import { ProjectViewWorkflowHeader } from './ProjectViewWorkflowHeader';
import {
  ProjectWorkspaceSplit,
  type ProjectChatSidebarTab,
} from './ProjectWorkspaceSplit';
import { applyPromptLibrarySample } from './prompt-library-sample';
import {
  createQueuedDesignSend,
  retryQueuedDesignSend,
} from './queued-design-sends';
import { useDesignChatModel } from './use-design-chat-model';
import { useDesignChatQuestions } from './use-design-chat-questions';
import { useDesignMediaTaskMonitor } from './use-design-media-task-monitor';
import { useDesignProjectBudget } from './use-design-project-budget';
import { useDesignProjectJury } from './use-design-project-jury';
import { usePersistentQueuedDesignSends } from './use-persistent-queued-design-sends';
import { useQueuedSendDrain } from './use-queued-send-drain';
import {
  useChatArtifactAutoOpen,
  useChatArtifactReload,
} from './useChatArtifactReload';
import { useDesignProjectFinalizer } from './useDesignProjectFinalizer';
import { useDesignRoutePanel } from './useDesignRoutePanel';
import { useProjectFileNavigation } from './useProjectFileNavigation';

type PromptRunResult = { accepted: boolean; error?: string };

export function DesignProjectView({
  project,
  onBack,
  onProjectChange,
}: {
  project: DesignProject;
  onBack: () => void;
  onProjectChange: (project: DesignProject) => void;
}) {
  const [title, setTitle] = useState(project.title);
  const [message, setMessage] = useState('');
  const [promptDrawer, setPromptDrawer] = useState(false);
  const [resolved, setResolved] = useState({ system: '', user: '' });
  const [debugOpen, setDebugOpen] = useState(false);
  const [debugSnapshot, setDebugSnapshot] =
    useState<DesignDebugSnapshot | null>(null);
  const [debugLoading, setDebugLoading] = useState(false);
  const [debugError, setDebugError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const drainingQueueRef = useRef(false);
  const [chatPanelWidth, setChatPanelWidth] = useStoredChatPanelWidth(
    project.id,
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [chatSidebarTab, setChatSidebarTab] =
    useState<ProjectChatSidebarTab>('chat');
  const openProjectFile = useProjectFileNavigation();
  // Conversational chat loop (Fix-sync Phase 02). Surfaces run artifacts live.
  const designModeSettings = useSetting('designMode');
  const { onProject } = useChatArtifactAutoOpen({ onProjectChange, openProjectFile }); // prettier-ignore
  const chat = useDesignChat(project.id, { onProject });
  // Inline model/agent picker, consolidated onto the task composer's source.
  const {
    modelOptions: chatModelOptions,
    modelId: chatModelId,
    setModelId: setChatModelId,
    sendModel: chatSendModel,
  } = useDesignChatModel();
  // Chat loop on by default; only explicit `false` uses the media path.
  const chatLoopActive =
    designModeSettings?.chatLoop !== false &&
    isDesignChatSurface(project.surface);
  const fileReloadSignal = useChatArtifactReload(chat.sending);
  const designMdState = useDesignMdState(
    project.id,
    Date.parse(project.updatedAt) + project.outputs.length,
  );
  const { budget, refreshBudget } = useDesignProjectBudget(project.id);
  const { juryEnabled, juryError, juryLoading, juryRun, runJury } =
    useDesignProjectJury(project);
  const {
    activeTaskId,
    isMonitoringTask,
    monitorDesignTask,
    sendError,
    setActiveTaskId,
    setSendError,
    setTasks,
    tasks,
    tasksHydrated,
  } = useDesignMediaTaskMonitor({
    projectId: project.id,
    onProjectChange,
    onRefreshBudget: refreshBudget,
  });
  const { questions, questionsStreaming } = useDesignChatQuestions({
    chatLoopActive,
    chatTurns: chat.turns,
    onQuestionsAppear: () => setChatSidebarTab('questions'),
  });
  const { queuedSends, updateQueuedSends } = usePersistentQueuedDesignSends(
    project.id,
  );
  const { finalizing, continueCopied, finalizeDesign, continueInCli } =
    useDesignProjectFinalizer({
      project,
      designMdState,
      onError: setSendError,
      onProjectChange,
    });

  useEffect(() => setTitle(project.title), [project.title]);

  const loadDebugSnapshot = useCallback(async () => {
    setDebugLoading(true);
    setDebugError(null);
    try {
      const data = await getDesignDebugSnapshot(project.id);
      setDebugSnapshot(data.snapshot);
    } catch (err) {
      setDebugError(err instanceof Error ? err.message : String(err));
    } finally {
      setDebugLoading(false);
    }
  }, [project.id]);
  const setRoutePanel = useDesignRoutePanel({
    debugOpen,
    promptAvailable: Boolean(resolved.system || resolved.user),
    setPromptDrawer,
    setDebugOpen,
    setSettingsOpen,
    onRouteDebug: loadDebugSnapshot,
  });

  const saveTitle = async () => {
    if (title.trim() && title !== project.title) {
      const { project: next } = await updateDesignProject(project.id, {
        title: title.trim(),
      });
      onProjectChange(next);
    }
  };

  const runPrompt = useCallback(
    async (basePrompt: string): Promise<PromptRunResult> => {
      if (!basePrompt) return { accepted: false };
      let accepted = false;
      setSending(true);
      setSendError(null);
      const surface =
        project.surface === 'image' ||
        project.surface === 'video' ||
        project.surface === 'audio'
          ? project.surface
          : 'document';
      try {
        const queuedComments = await loadQueuedCommentAttachments(project.id);
        const prompt = appendCommentAttachments(basePrompt, queuedComments);
        const { task } = await startDesignMedia(project.id, {
          surface,
          prompt,
          model: project.media?.model,
          aspect: project.media?.aspect,
          lengthSeconds: project.media?.lengthSeconds,
          durationSeconds: project.media?.durationSeconds,
          audioKind: project.media?.audioKind,
          voice: project.media?.voice,
          languageBoost: project.media?.languageBoost,
        });
        accepted = true;
        setActiveTaskId(task.taskId);
        setSending(false);
        setTasks((prev) => [
          task,
          ...prev.filter((item) => item.taskId !== task.taskId),
        ]);
        if (queuedComments.length > 0) {
          void markCommentsAttached(project.id, queuedComments).catch(() => {});
        }
        void monitorDesignTask(task);
        return { accepted: true };
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        setSendError(error);
        return { accepted, error };
      } finally {
        setSending(false);
        if (!accepted) setActiveTaskId(null);
      }
    },
    [
      monitorDesignTask,
      project.id,
      project.media?.aspect,
      project.media?.audioKind,
      project.media?.durationSeconds,
      project.media?.languageBoost,
      project.media?.lengthSeconds,
      project.media?.model,
      project.media?.voice,
      project.surface,
    ],
  );

  useQueuedSendDrain({
    drainingQueueRef,
    tasksHydrated,
    sending,
    isMonitoringTask,
    activeTaskId,
    queuedSends,
    updateQueuedSends,
    runPrompt,
  });

  const enqueuePrompt = useCallback(
    (prompt: string) => {
      const trimmed = prompt.trim();
      if (!trimmed) return;
      updateQueuedSends((prev) => [...prev, createQueuedDesignSend(trimmed)]);
    },
    [updateQueuedSends],
  );

  const sendProjectPrompt = (prompt: string) => {
    const trimmed = prompt.trim();
    if (!trimmed) return;
    // Chat-loop mode (e.g. discovery answers) continues via the agent.
    if (chatLoopActive) {
      if (!chat.sending) void chat.send(trimmed, chatSendModel());
      return;
    }
    if (sending || activeTaskId) {
      enqueuePrompt(trimmed);
      return;
    }
    void runPrompt(trimmed);
  };
  const send = async () => {
    const typedPrompt = message.trim();
    const basePrompt =
      typedPrompt ||
      (!activeTaskId && !sending
        ? String(project.brief.prompt ?? '').trim()
        : '');
    if (!basePrompt) return;
    // Agentic surfaces with the chat loop enabled stream through the agent
    // runtime; everything else uses the media dispatcher / queue.
    if (chatLoopActive) {
      if (chat.sending) return;
      setMessage('');
      await chat.send(basePrompt, chatSendModel());
      return;
    }
    if (sending || activeTaskId) {
      enqueuePrompt(basePrompt);
      setMessage('');
      return;
    }
    setMessage('');
    await runPrompt(basePrompt);
  };

  const removeQueuedSend = useCallback(
    (id: string) => {
      updateQueuedSends((prev) => prev.filter((item) => item.id !== id));
    },
    [updateQueuedSends],
  );

  const editQueuedSend = useCallback(
    (id: string) => {
      const target = queuedSends.find((item) => item.id === id);
      if (target) setMessage(target.prompt);
      updateQueuedSends((prev) => prev.filter((item) => item.id !== id));
    },
    [queuedSends, updateQueuedSends],
  );

  const sendQueuedNow = useCallback(
    (id: string) => {
      updateQueuedSends((prev) => {
        const target = prev.find((item) => item.id === id);
        if (!target) return prev;
        return [
          retryQueuedDesignSend(target),
          ...prev.filter((item) => item.id !== id),
        ];
      });
    },
    [updateQueuedSends],
  );

  const cancelActiveTask = async () => {
    if (!activeTaskId) return;
    try {
      const result = await cancelDesignMediaTask(project.id, activeTaskId);
      setTasks((prev) =>
        prev.map((item) =>
          item.taskId === result.task.taskId ? result.task : item,
        ),
      );
    } catch (err) {
      setSendError(err instanceof Error ? err.message : String(err));
    } finally {
      setActiveTaskId(null);
    }
  };

  const resolvePrompt = async () => {
    const data = await resolveDesignPrompt(project.id, message);
    setResolved(data);
    setDebugOpen(false);
    setPromptDrawer(true);
    setRoutePanel('prompt');
  };

  const openDebug = async () => {
    setDebugOpen(true);
    setPromptDrawer(false);
    setRoutePanel('debug');
    await loadDebugSnapshot();
  };

  const selectPromptLibrarySample = async (sample: PromptLibrarySample) => {
    const next = await applyPromptLibrarySample(project, sample);
    setMessage(sample.prompt);
    onProjectChange(next);
  };

  return (
    <div
      className="bg-background flex h-full min-h-0 flex-col"
      data-testid="design-project-view"
    >
      <ProjectHeader
        project={project}
        title={title}
        designSystemInComposer={chatLoopActive}
        budget={budget}
        debugLoading={debugLoading}
        juryEnabled={juryEnabled}
        juryLoading={juryLoading}
        designMdState={designMdState}
        finalizing={finalizing}
        continueCopied={continueCopied}
        onBack={onBack}
        onTitleChange={setTitle}
        onTitleBlur={saveTitle}
        onResolvePrompt={resolvePrompt}
        onOpenDebug={openDebug}
        onRunJury={() => void runJury()}
        onFinalizeDesign={() => void finalizeDesign()}
        onContinueInCli={() => void continueInCli()}
        onOpenSettings={() => setRoutePanel('settings')}
        onProjectChange={onProjectChange}
        onCustomInstructionsSave={async (customInstructions) => {
          const { project: next } = await updateDesignProject(project.id, {
            customInstructions,
          });
          onProjectChange(next);
        }}
      />
      <ProjectViewWorkflowHeader
        project={project}
        chatLoopActive={chatLoopActive}
        hasOpenQuestions={questions.length > 0}
        activeTaskId={activeTaskId}
        sending={sending}
        chatSending={chat.sending}
        message={message}
        onMessageChange={setMessage}
        onSendProjectPrompt={sendProjectPrompt}
        onFinalizeDesign={finalizeDesign}
        onOpenProjectFile={openProjectFile}
        onCancelActiveTask={cancelActiveTask}
        onCancelChat={chat.cancel}
        onOpenQuestions={() => setChatSidebarTab('questions')}
      />
      <ProjectWorkspaceSplit
        activeTaskId={activeTaskId}
        chatPanelWidth={chatPanelWidth}
        juryError={juryError}
        juryRun={juryRun}
        message={message}
        project={project}
        sendError={sendError}
        sending={chatLoopActive ? chat.sending : sending}
        tasks={tasks}
        activeTab={chatSidebarTab}
        queuedSends={queuedSends}
        questions={questions}
        questionsStreaming={questionsStreaming}
        chatLoopActive={chatLoopActive}
        chatTurns={chat.turns}
        chatModelId={chatModelId}
        chatModelOptions={chatModelOptions}
        reloadSignal={fileReloadSignal}
        onChatModelChange={setChatModelId}
        onProjectChange={onProjectChange}
        onBriefSubmit={async (brief) => {
          const { project: next } = await updateDesignProject(project.id, {
            brief,
          });
          onProjectChange(next);
        }}
        onCancelActiveTask={() =>
          chatLoopActive ? chat.cancel() : void cancelActiveTask()
        }
        onEditQueuedSend={editQueuedSend}
        onMessageChange={setMessage}
        onRemoveQueuedSend={removeQueuedSend}
        onSampleSelected={(sample) => {
          void selectPromptLibrarySample(sample).catch((err) => {
            setSendError(err instanceof Error ? err.message : String(err));
          });
        }}
        onSend={() => void send()}
        onSendQueuedNow={sendQueuedNow}
        onProjectFileOpen={openProjectFile}
        onAnswerQuestion={sendProjectPrompt}
        onActiveTabChange={setChatSidebarTab}
        onWidthChange={setChatPanelWidth}
      />
      <ProjectViewPanels
        promptDrawer={promptDrawer}
        resolved={resolved}
        debugOpen={debugOpen}
        debugSnapshot={debugSnapshot}
        debugLoading={debugLoading}
        debugError={debugError}
        settingsOpen={settingsOpen}
        onClosePanel={() => setRoutePanel(null)}
        onSettingsOpenChange={(open) => setRoutePanel(open ? 'settings' : null)}
      />
    </div>
  );
}
