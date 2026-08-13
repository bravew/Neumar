import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useLocation, useParams } from 'react-router-dom';

import { motion } from 'motion/react';
import { Panel, Group as PanelGroup } from 'react-resizable-panels';

import { LiveArtifactPanel } from '@/components/artifacts/live';
import type { Artifact } from '@/components/artifacts/types';
import { getArtifactTypeFromExt } from '@/components/artifacts/utils';
import { SidebarProvider } from '@/components/layout';
import { LeftSidebar } from '@/components/layout/left-sidebar';
import {
  dbMessagesToAGUI,
  InitialMessageSender,
} from '@/components/task/InitialMessageSender';
import type {
  LocationState,
  ProfileDisplayInfo,
} from '@/components/task/InitialMessageSender';
import { RightSidebar } from '@/components/task/RightSidebar';
import { TaskV2Header } from '@/components/task/TaskV2Header';
import { TaskV2Thread } from '@/components/task/TaskV2Thread';
import { ResizeHandle } from '@/components/ui/resize-handle';
import type { MediaVersion } from '@/components/workspace';
import { WorkspacePanel } from '@/components/workspace';
import { API_BASE_URL } from '@/config';
import { SPRING } from '@/config/animation/constants';
import { getMessagesByTaskId, getTask } from '@/shared/db';
import { parseAdditionalWorkDirs } from '@/shared/db/types';
import { mapDbMessageToAgentMessage } from '@/shared/hooks/agent-messages';
import type { AgentMessage } from '@/shared/hooks/agent-types';
import { buildModelOverride } from '@/shared/hooks/agent-utils';
import type { MessageAttachment } from '@/shared/hooks/useAgent';
import { useFileDiffs } from '@/shared/hooks/useFileDiffs';
import { useLiveArtifacts } from '@/shared/hooks/useLiveArtifacts';
import { useMediaVersions } from '@/shared/hooks/useMediaVersions';
import { useTaskModelSelector } from '@/shared/hooks/useTaskModelSelector';
import { useV2Artifacts } from '@/shared/hooks/useV2Artifacts';
import { useV2TaskLoader } from '@/shared/hooks/useV2TaskLoader';
import { useVitePreview } from '@/shared/hooks/useVitePreview';
import { setActiveTaskThread } from '@/shared/lib/notifications';
import { AgUiProvider } from '@/shared/providers/agui-provider';
import {
  selectRunningTaskIds,
  useThreadStore,
} from '@/shared/stores/thread-store';

const PREVIEW_SIZE_KEY = 'task-v2-preview-size';

/**
 * AG-UI route: /task-v2/:taskId
 *
 * Renders the CopilotKit-backed thread with the standard left task sidebar.
 * On first mount with location.state.prompt, creates the task and starts the agent.
 */
export function TaskDetailV2Page() {
  const { taskId } = useParams<{ taskId: string }>();
  const { allTasks, handleDeleteTask, handleToggleFavorite, addTask } =
    useV2TaskLoader(taskId);
  const runningTaskIds = useThreadStore(selectRunningTaskIds);

  const location = useLocation();
  const navModelOverride = (location.state as LocationState | null)
    ?.modelOverride;

  // Seed per-task model from navigation state BEFORE the hook reads localStorage.
  // This ensures the first render already has the correct model.
  // Uses a ref guard to run only once per mount (not on every render).
  const modelSeededRef = useRef(false);
  if (
    !modelSeededRef.current &&
    navModelOverride?.model &&
    taskId &&
    !localStorage.getItem(`task_model_${taskId}`)
  ) {
    modelSeededRef.current = true;
    try {
      localStorage.setItem(`task_model_${taskId}`, navModelOverride.model);
    } catch {
      /* */
    }
  }

  // Mark this thread as actively viewed so the redundant "completed" toast is
  // suppressed while it's open — completion is already visible in the thread.
  useEffect(() => {
    setActiveTaskThread(taskId ?? null);
    return () => setActiveTaskThread(null);
  }, [taskId]);

  // Resolve model config from the per-task model selector (persisted in localStorage).
  const [modelId, setModelId] = useTaskModelSelector(taskId ?? '');
  const modelConfig = useMemo(
    () =>
      modelId
        ? (buildModelOverride(modelId) as Record<string, unknown>)
        : undefined,
    [modelId],
  );

  // Load history from DB — independent of CopilotKit agent lifecycle.
  type HistoryMsg = { id: string; role: 'user' | 'assistant'; content: string };
  const [historyMessages, setHistoryMessages] = useState<HistoryMsg[]>([]);
  // V1-format messages for RightSidebar (tools, skills, output extraction)
  const [v1Messages, setV1Messages] = useState<AgentMessage[]>([]);
  const hasPrompt = !!(location.state as LocationState | null)?.prompt;

  const loadDbMessages = useCallback(() => {
    if (!taskId) return;
    getMessagesByTaskId(taskId)
      .then((dbMsgs) => {
        setHistoryMessages(dbMessagesToAGUI(dbMsgs));
        setV1Messages(dbMsgs.map(mapDbMessageToAgentMessage));

        // Restore attachment previews from persisted messages.
        // ID must match what dbMessagesToAGUI produces for this message.
        for (const msg of dbMsgs) {
          if (msg.attachments) {
            try {
              const atts = JSON.parse(msg.attachments) as MessageAttachment[];
              if (atts.length > 0) {
                const id = msg.message_id ?? String(msg.id);
                attachmentMapRef.current.set(id, atts);
              }
            } catch {
              /* ignore malformed JSON */
            }
          }
        }
      })
      .catch(() => {});
  }, [taskId]);

  useEffect(() => {
    if (!taskId || hasPrompt) {
      setHistoryMessages([]);
      setV1Messages([]);
      return;
    }
    loadDbMessages();
  }, [taskId, hasPrompt, loadDbMessages]);

  // Refresh V1 messages and task workDir when files are updated (tool calls persisted).
  // The agent's session message updates the task's work_dir in the DB to the actual
  // session CWD, so re-reading it keeps the workspace panel pointing at the right folder.
  useEffect(() => {
    const handler = () => {
      loadDbMessages();
      if (taskId) {
        getTask(taskId)
          .then((t) => {
            if (t?.work_dir) setTaskWorkDir(t.work_dir);
          })
          .catch(() => {});
      }
    };
    window.addEventListener('task-files-updated', handler);
    return () => window.removeEventListener('task-files-updated', handler);
  }, [loadDbMessages, taskId]);

  // Shared attachment map — used by both InitialMessageSender and TaskV2Thread
  const attachmentMapRef = useRef<Map<string, MessageAttachment[]>>(new Map());
  const handleAttachMessage = useCallback(
    (msgId: string, atts: MessageAttachment[]) => {
      attachmentMapRef.current.set(msgId, atts);
    },
    [],
  );

  // ── Artifact & Workspace state ───────────────────────────────────────────
  const artifacts = useV2Artifacts(taskId ?? '');
  const { diffs: workspaceDiffs } = useFileDiffs(taskId, artifacts.length);
  const [selectedArtifact, setSelectedArtifact] = useState<Artifact | null>(
    null,
  );
  const [isPreviewVisible, setIsPreviewVisible] = useState(false);
  const [isRightSidebarVisible, setIsRightSidebarVisible] = useState(false);

  // Auto-expand right sidebar on first artifact (once per task mount)
  const hasAutoExpandedRef = useRef(false);
  useEffect(() => {
    if (
      artifacts.length > 0 &&
      !hasAutoExpandedRef.current &&
      !isRightSidebarVisible
    ) {
      hasAutoExpandedRef.current = true;
      setIsRightSidebarVisible(true);
    }
  }, [artifacts.length, isRightSidebarVisible]);

  // Reset workspace state when switching tasks
  useEffect(() => {
    hasAutoExpandedRef.current = false;
    setSelectedArtifact(null);
    setIsPreviewVisible(false);
    setIsRightSidebarVisible(false);
    // Clear stale workDir from previous task — the DB effect below will set
    // the correct value for the new task once the async read completes.
    setTaskWorkDir(undefined);
    setTaskAdditionalDirs(undefined);
    setTaskTitle('');
  }, [taskId]);

  // ── Task metadata from DB (title, workDir, additionalWorkDirs) ──────────
  // Initialize workDir from navigation state so it's available immediately
  // (before async DB read completes). The DB effect will update if needed.
  const navState = location.state as LocationState | null;
  const [taskTitle, setTaskTitle] = useState('');
  const [taskWorkDir, setTaskWorkDir] = useState<string | undefined>(
    navState?.workDir,
  );
  const [taskAdditionalDirs, setTaskAdditionalDirs] = useState<
    string[] | undefined
  >(navState?.additionalWorkDirs);
  const [profileInfo, setProfileInfo] = useState<ProfileDisplayInfo | null>(
    null,
  );
  // Track which taskId the nav state was intended for (first mount only)
  const navStateTaskIdRef = useRef<string | undefined>(taskId);
  useEffect(() => {
    if (!taskId) return;
    const ac = new AbortController();

    // Nav state is only valid for the task it was created with (first mount).
    // On sidebar task switches, taskId changes but location.state is stale.
    const isNavStateValid = taskId === navStateTaskIdRef.current;
    const navProfile = isNavStateValid ? navState?.profileDisplay : undefined;
    const navProfileId = isNavStateValid
      ? navState?.assigneeProfileId
      : undefined;

    if (navProfile && navProfileId) {
      setProfileInfo({ ...navProfile, id: navProfileId });
    } else {
      setProfileInfo(null);
    }

    getTask(taskId)
      .then(async (t) => {
        if (ac.signal.aborted) return;
        if (t?.title) setTaskTitle(t.title);
        else if (t?.prompt) setTaskTitle(t.prompt);
        if (t?.work_dir) setTaskWorkDir(t.work_dir);
        const parsedDirs = parseAdditionalWorkDirs(t?.additional_work_dirs);
        if (parsedDirs.length > 0) setTaskAdditionalDirs(parsedDirs);

        const profileId = t?.assignee_profile_id ?? navProfileId;
        if (!profileId) {
          if (!ac.signal.aborted) setProfileInfo(null);
          return;
        }

        try {
          const res = await fetch(
            `${API_BASE_URL}/db/agent-profiles/${profileId}`,
            { signal: ac.signal },
          );
          if (res.ok) {
            const p = (await res.json()) as {
              id: string;
              name: string;
              role?: string | null;
              avatar_icon?: string | null;
              avatar_color?: string | null;
            };
            setProfileInfo({
              id: p.id,
              name: p.name,
              role: p.role,
              avatarIcon: p.avatar_icon,
              avatarColor: p.avatar_color,
            });
          } else {
            setProfileInfo(null);
          }
        } catch {
          // Abort or network error
        }
      })
      .catch(() => {});
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  useEffect(() => {
    function handleTitleUpdate(e: Event) {
      const { taskId: id, title } = (
        e as CustomEvent<{ taskId: string; title: string }>
      ).detail;
      if (id === taskId) setTaskTitle(title);
    }
    window.addEventListener('task-title-updated', handleTitleUpdate);
    return () =>
      window.removeEventListener('task-title-updated', handleTitleUpdate);
  }, [taskId]);

  // Derive isRunning from thread store
  const isTaskRunning = runningTaskIds.includes(taskId ?? '');

  const liveArtifacts = useLiveArtifacts(taskId, isTaskRunning);
  const hasLiveArtifacts = liveArtifacts.size > 0;
  const showLiveArtifacts = hasLiveArtifacts && !selectedArtifact;

  const liveAutoOpenedRef = useRef(false);
  useEffect(() => {
    if (!hasLiveArtifacts) {
      liveAutoOpenedRef.current = false;
      return;
    }
    if (!liveAutoOpenedRef.current && !isPreviewVisible) {
      liveAutoOpenedRef.current = true;
      setIsPreviewVisible(true);
    }
  }, [hasLiveArtifacts, isPreviewVisible]);

  const handleSelectArtifact = useCallback((artifact: Artifact) => {
    setSelectedArtifact(artifact);
    setIsPreviewVisible(true);
  }, []);

  // File tree click → create a virtual artifact for preview
  const handleFileSelect = useCallback((filePath: string, fileName: string) => {
    const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
    const artifactType: Artifact['type'] = getArtifactTypeFromExt(ext);

    const virtualArtifact: Artifact = {
      id: `file-${filePath}`,
      name: fileName,
      type: artifactType,
      path: filePath,
    };
    setSelectedArtifact(virtualArtifact);
    setIsPreviewVisible(true);
  }, []);

  // ── Media versions & live preview ────────────────────────────────────────
  const { versions: mediaVersions, selectVersion: selectMediaVersion } =
    useMediaVersions(taskId ?? '', [], artifacts);

  const {
    previewUrl: livePreviewUrl,
    status: livePreviewStatus,
    error: livePreviewError,
    startPreview: handleStartLivePreview,
    stopPreview: handleStopLivePreview,
  } = useVitePreview(taskId ?? null);

  // Workspace context (V2 doesn't expose V1-format messages — pass empty)
  const workspaceContext = useMemo(
    () => ({ taskId: taskId || '', messages: [], isRunning: false }),
    [taskId],
  );

  const handleSelectVersion = useCallback(
    (version: MediaVersion) => {
      selectMediaVersion(version);
      const artifact = artifacts.find((a) => a.id === version.artifactId);
      if (artifact) setSelectedArtifact(artifact);
    },
    [selectMediaVersion, artifacts],
  );

  // Ref for workspace inline reply → calls TaskV2Thread's handleSubmit
  const submitRef = useRef<((text: string) => void) | null>(null);
  const handleWorkspaceMessage = useCallback((text: string) => {
    submitRef.current?.(text);
  }, []);

  // Saved preview size persisted across sessions via localStorage
  const savedPreviewSize = useRef<number>(
    (() => {
      try {
        const v = localStorage.getItem(PREVIEW_SIZE_KEY);
        return v ? Number(v) : 45;
      } catch {
        return 45;
      }
    })(),
  );

  // Persist preview panel size when user drags the splitter
  const handlePreviewResize = useCallback(
    (panelSize: { asPercentage: number }) => {
      if (panelSize.asPercentage > 5) {
        savedPreviewSize.current = panelSize.asPercentage;
        try {
          localStorage.setItem(
            PREVIEW_SIZE_KEY,
            String(panelSize.asPercentage),
          );
        } catch {
          /* quota exceeded */
        }
      }
    },
    [],
  );

  if (!taskId) return null;

  const displayTitle =
    taskTitle ||
    (location.state as LocationState | null)?.prompt ||
    `Task ${taskId.slice(0, 8)}`;

  return (
    <SidebarProvider>
      <AgUiProvider key={taskId} threadId={taskId} isNewTask={hasPrompt}>
        <InitialMessageSender
          taskId={taskId}
          addTask={addTask}
          onAttachMessage={handleAttachMessage}
          modelConfig={modelConfig}
        />
        <div className="bg-sidebar flex h-svh overflow-hidden">
          <LeftSidebar
            tasks={allTasks}
            currentTaskId={taskId}
            onDeleteTask={handleDeleteTask}
            onToggleFavorite={handleToggleFavorite}
            runningTaskIds={runningTaskIds}
          />
          <div className="bg-background my-2 mr-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl shadow-sm">
            {/* ── Header ── */}
            <TaskV2Header
              title={displayTitle}
              isRunning={isTaskRunning}
              isRightSidebarVisible={isRightSidebarVisible}
              onToggleRightSidebar={() => setIsRightSidebarVisible((v) => !v)}
              profileInfo={profileInfo}
            />

            {/* ── Content area ── */}
            <div className="flex min-h-0 flex-1 overflow-hidden">
              {/* ── Main area: chat + optional preview (resizable) ── */}
              <PanelGroup
                key={isPreviewVisible ? 'split' : 'chat-only'}
                orientation="horizontal"
                className="h-full min-w-0 flex-1"
              >
                <Panel
                  id="chat"
                  defaultSize={
                    isPreviewVisible ? 100 - savedPreviewSize.current : 100
                  }
                  minSize={35}
                  className="min-w-0 overflow-hidden"
                >
                  <TaskV2Thread
                    attachmentMapRef={attachmentMapRef}
                    taskId={taskId}
                    historyMessages={historyMessages}
                    modelConfig={modelConfig}
                    onSubmitRef={submitRef}
                    selectedModel={modelId}
                    onModelChange={setModelId}
                    workDir={taskWorkDir}
                    additionalWorkDirs={taskAdditionalDirs}
                    allArtifacts={artifacts}
                  />
                </Panel>

                {isPreviewVisible && <ResizeHandle id="chat-preview-handle" />}
                {isPreviewVisible && (
                  <Panel
                    id="preview"
                    defaultSize={savedPreviewSize.current}
                    minSize={15}
                    onResize={handlePreviewResize}
                    className="flex min-w-0 flex-col overflow-hidden"
                  >
                    <motion.div
                      initial={{ opacity: 0, x: 24 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={SPRING.gentle}
                      className="flex h-full flex-col"
                    >
                      {showLiveArtifacts && taskId ? (
                        <LiveArtifactPanel
                          taskId={taskId}
                          isRunning={isTaskRunning}
                          onClose={() => setIsPreviewVisible(false)}
                          className="h-full"
                        />
                      ) : (
                        <WorkspacePanel
                          artifact={selectedArtifact}
                          allArtifacts={artifacts}
                          versions={mediaVersions}
                          context={workspaceContext}
                          onClose={() => {
                            setIsPreviewVisible(false);
                            setSelectedArtifact(null);
                          }}
                          onSelectVersion={handleSelectVersion}
                          onSendMessage={handleWorkspaceMessage}
                          livePreviewUrl={livePreviewUrl}
                          livePreviewStatus={livePreviewStatus}
                          livePreviewError={livePreviewError}
                          onStartLivePreview={() => {
                            const workDir =
                              selectedArtifact?.path?.split('/sessions/')[0] ||
                              '';
                            handleStartLivePreview(workDir);
                          }}
                          onStopLivePreview={handleStopLivePreview}
                          workDir={taskWorkDir}
                          onSelectFile={handleFileSelect}
                          diffs={workspaceDiffs}
                          messages={v1Messages}
                          isRunning={isTaskRunning}
                          taskId={taskId}
                        />
                      )}
                    </motion.div>
                  </Panel>
                )}
              </PanelGroup>

              {/* ── Right sidebar: fixed-width, show/hide ── */}
              {isRightSidebarVisible && (
                <div className="border-border/40 flex h-full w-72 shrink-0 flex-col overflow-hidden border-l">
                  <RightSidebar
                    messages={v1Messages}
                    artifacts={artifacts}
                    selectedArtifact={selectedArtifact}
                    onSelectArtifact={handleSelectArtifact}
                    workingDir={taskWorkDir}
                    taskId={taskId}
                    filesVersion={artifacts.length}
                    isRunning={isTaskRunning}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </AgUiProvider>
    </SidebarProvider>
  );
}
