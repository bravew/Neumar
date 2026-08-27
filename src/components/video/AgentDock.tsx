import { useEffect, useMemo, useState } from 'react';

import { ChatPanel } from '@/components/shared/chat-panel';
import { ChatInput } from '@/components/shared/ChatInput';
import { OwnerRunDiagnostics } from '@/components/shared/run-diagnostics/ExecutionDiagnosticsPanel';
import type { MessageAttachment } from '@/shared/hooks/agent-types';
import { useLanguage } from '@/shared/providers/language-provider';
import type {
  VideoAspectRatio,
  VideoMediaItem,
  VideoProject,
  VideoStoryboardScene,
  VideoTranscriptSelectionContext,
} from '@/shared/types/video';

import {
  attachmentFiles,
  isVideoAgentAttachment,
  VIDEO_AGENT_ATTACHMENT_ACCEPT,
} from './agentDockAttachments';
import { AgentDockEmptyState } from './AgentDockEmptyState';
import { AgentDockHeader } from './AgentDockHeader';
import { AgentDockMessageList } from './AgentDockMessageList';
import { AgentDockTurnBudget } from './AgentDockTurnBudget';
import { buildAgentDockSuggestions } from './agentDockViewUtils';
import { latestAgentFailureDetail } from './agentFailureDetail';
import { AgentJournalList } from './AgentJournalList';
import { AgentPlanPanel } from './AgentPlanPanel';
import { ProjectAssetPreviewDialog } from './assets/ProjectAssetPreviewDialog';
import {
  projectAssetDisplayName,
  projectAssetMetaSummary,
} from './assets/ProjectAssetTile';
import type { VideoEditorStep, VideoProjectEditorActions } from './editorTypes';
import { useAgentDock } from './useAgentDock';
import { useAgentDockActionHandlers } from './useAgentDockActionHandlers';
import { useAgentDockSubmit } from './useAgentDockSubmit';
import { useAgentPluginSubmit } from './useAgentPluginSubmit';
import { useAgentProjectAssetDrop } from './useAgentProjectAssetDrop';
import { useVideoEditorSelectionContext } from './useVideoEditorSelectionContext';
import {
  VideoAgentAssetContextPills,
  type VideoAgentAssetContextItem,
} from './VideoAgentAssetContextPills';

interface AgentDockProps {
  project: VideoProject;
  selectedScene: VideoStoryboardScene | null;
  activeStep: VideoEditorStep;
  assetContextAssets?: VideoProject['assets'];
  transcriptSelection?: VideoTranscriptSelectionContext | null;
  actions: VideoProjectEditorActions;
  onClose: () => void;
  onAddAssetContext?: (assetId: string) => void;
  onRemoveAssetContext?: (assetId: string) => void;
  onClearAssetContext?: () => void;
  onStreamingChange?: (streaming: boolean) => void;
}

export function AgentDock({
  project,
  selectedScene,
  activeStep,
  assetContextAssets = [],
  transcriptSelection,
  actions,
  onClose,
  onAddAssetContext,
  onRemoveAssetContext,
  onClearAssetContext,
  onStreamingChange,
}: AgentDockProps) {
  const { t } = useLanguage();
  const [draft, setDraft] = useState('');
  const [draftNonce, setDraftNonce] = useState(0);
  const [previewAsset, setPreviewAsset] = useState<VideoMediaItem | null>(null);
  const aspectRatio = useMemo<VideoAspectRatio>(
    () => project.settings?.defaultAspectRatios?.[0] ?? '16:9',
    [project.settings?.defaultAspectRatios],
  );
  const {
    messages,
    streaming,
    sendMessage,
    cancelStream,
    clearHistory,
    appendText,
    updateAction,
    model,
    turnBudget,
  } = useAgentDock({ projectId: project.id });
  const turnBudgetDetail = useMemo(
    () => latestAgentFailureDetail(messages),
    [messages],
  );
  const editorSelection = useVideoEditorSelectionContext({
    projectId: project.id,
    selectedSceneId: selectedScene?.id,
    aspectRatio,
  });

  const sceneIndex = useMemo(
    () =>
      selectedScene
        ? (project.storyboard?.scenes.findIndex(
            (scene) => scene.id === selectedScene.id,
          ) ?? -1) + 1
        : 0,
    [project.storyboard?.scenes, selectedScene],
  );
  const sceneLabel = selectedScene
    ? t.video.editor.agentDock.context.scene.replace(
        '{scene}',
        String(sceneIndex || 1),
      )
    : t.video.editor.agentDock.context.noScene;
  const suggestions = useMemo(
    () =>
      buildAgentDockSuggestions(
        t.video.editor.agentDock.suggestions,
        sceneIndex || 1,
        aspectRatio,
      ),
    [aspectRatio, sceneIndex, t.video.editor.agentDock.suggestions],
  );
  const assetContextItems = useMemo<VideoAgentAssetContextItem[]>(
    () =>
      assetContextAssets.map((asset) => ({
        id: asset.id,
        name: projectAssetDisplayName(asset),
        summary: projectAssetMetaSummary(asset) || undefined,
      })),
    [assetContextAssets],
  );
  const projectAssetDropHandlers = useAgentProjectAssetDrop({
    assets: project.assets,
    onAddAssetContext,
  });

  useEffect(() => {
    onStreamingChange?.(streaming);
  }, [onStreamingChange, streaming]);

  const sendWithAttachments = useAgentDockSubmit({
    activeStep,
    actions,
    appendText,
    aspectRatio,
    assetContextAssets,
    assetContextItems,
    editorSelection,
    labels: t.video.editor.agentDock.composer,
    onClearAssetContext,
    selectedScene,
    sendMessage,
    setDraft,
    transcriptSelection,
  });

  const send = (content: string) => void sendWithAttachments(content, []);
  const sendPlugin = useAgentPluginSubmit({
    activeStep,
    appendText,
    aspectRatio,
    assetContextAssets,
    editorSelection,
    labels: t.video.editor.agentDock.pluginPicker,
    selectedScene,
    sendMessage,
    transcriptSelection,
  });
  const sendFromChatInput = (
    content: string,
    attachments?: MessageAttachment[],
  ) => sendWithAttachments(content, attachmentFiles(attachments));

  const {
    journalBusyId,
    acceptAction,
    rejectAction,
    refineAction,
    cancelAction,
    runJournalAction,
  } = useAgentDockActionHandlers({
    project,
    actions,
    aspectRatio,
    t,
    appendText,
    updateAction,
    setDraft,
    bumpDraftNonce: () => setDraftNonce((value) => value + 1),
  });

  const assetContextPills = useMemo(() => {
    const labels = t.video.editor.agentDock.composer;
    return (
      <VideoAgentAssetContextPills
        assets={assetContextItems}
        assetContextLabel={labels.assetContext}
        removeAssetContextLabel={labels.removeAssetContextAction}
        onRemoveAssetContext={onRemoveAssetContext}
      />
    );
  }, [
    assetContextItems,
    onRemoveAssetContext,
    t.video.editor.agentDock.composer,
  ]);

  return (
    <ChatPanel aria-label={t.video.editor.agentDock.title} border="right">
      <AgentDockHeader
        title={t.video.editor.agentDock.title}
        sceneLabel={sceneLabel}
        aspectRatio={aspectRatio}
        stopLabel={t.video.editor.agentDock.stop}
        clearLabel={t.video.editor.agentDock.clear}
        closeLabel={t.video.editor.agentDock.close}
        model={model}
        streaming={streaming}
        onCancelStream={cancelStream}
        onClearHistory={clearHistory}
        onClose={onClose}
      />
      <ChatPanel.Messages
        autoScrollKey={messages.length}
        followOutput={streaming}
      >
        <AgentPlanPanel
          projectId={project.id}
          projectRevision={project.revision ?? 0}
          disabled={streaming || Boolean(journalBusyId)}
          labels={t.video.editor.agentDock.planPanel}
          onSend={send}
          onRollback={(entryId) => void runJournalAction(entryId, 'undo')}
        />
        <AgentJournalList
          entries={project.agentJournal ?? []}
          labels={t.video.editor.agentDock.journal}
          actionLabels={t.video.editor.agentDock.actions}
          busyEntryId={journalBusyId}
          onUndo={(entryId) => void runJournalAction(entryId, 'undo')}
          onRedo={(entryId) => void runJournalAction(entryId, 'redo')}
        />
        <OwnerRunDiagnostics mode="video" ownerKey={project.id} />
        {messages.length === 0 ? (
          <AgentDockEmptyState
            pluginLabels={t.video.editor.agentDock.pluginPicker}
            recipeLabels={t.video.editor.agentDock.recipePicker}
            suggestions={suggestions}
            disabled={streaming}
            onSelectPlugin={(plugin) => void sendPlugin(plugin)}
            onSelectPrompt={send}
          />
        ) : null}
        <AgentDockMessageList
          messages={messages}
          project={project}
          streaming={streaming}
          onPreview={setPreviewAsset}
          onSend={send}
          onAcceptAction={(action) => void acceptAction(action)}
          onRejectAction={rejectAction}
          onRefineAction={refineAction}
          onCancelAction={cancelAction}
        />
      </ChatPanel.Messages>

      <AgentDockTurnBudget
        outcome={turnBudget}
        detail={turnBudgetDetail}
        disabled={streaming}
        onContinue={() =>
          send(t.video.editor.agentDock.turnBudget.continuePrompt)
        }
      />

      <ChatPanel.Composer className="p-3" {...projectAssetDropHandlers}>
        <ChatInput
          variant="reply"
          inputBoxClassName="border-input rounded-md shadow-none"
          isRunning={streaming}
          onSubmit={sendFromChatInput}
          onStop={cancelStream}
          placeholder={t.video.editor.agentDock.composer.placeholder}
          initialValue={draft}
          initialValueNonce={draftNonce}
          beforeInput={assetContextPills}
          hasExternalSubmitContext={assetContextItems.length > 0}
          preserveAttachmentFiles
          attachmentPolicy={{
            accept: VIDEO_AGENT_ATTACHMENT_ACCEPT,
            allowCloudStorage: false,
            allowAssetCatalog: false,
            acceptsFile: isVideoAgentAttachment,
          }}
        />
      </ChatPanel.Composer>
      <ProjectAssetPreviewDialog
        projectId={project.id}
        asset={previewAsset}
        onOpenChange={(open) => {
          if (!open) setPreviewAsset(null);
        }}
      />
    </ChatPanel>
  );
}
