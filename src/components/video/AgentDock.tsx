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

import { executeAgentAction } from './agentDockActions';
import {
  attachmentFiles,
  isVideoAgentAttachment,
  VIDEO_AGENT_ATTACHMENT_ACCEPT,
} from './agentDockAttachments';
import { AgentDockEmptyState } from './AgentDockEmptyState';
import { AgentDockHeader } from './AgentDockHeader';
import { AgentDockMessageList } from './AgentDockMessageList';
import { respondToAgentPermission } from './agentDockPermissions';
import {
  agentActionTitle,
  buildAgentDockSuggestions,
} from './agentDockViewUtils';
import { AgentJournalList } from './AgentJournalList';
import { agentActionToToolCall } from './agentToolMapping';
import { ProjectAssetPreviewDialog } from './assets/ProjectAssetPreviewDialog';
import {
  projectAssetDisplayName,
  projectAssetMetaSummary,
} from './assets/ProjectAssetTile';
import type { VideoEditorStep, VideoProjectEditorActions } from './editorTypes';
import { type AgentActionRecord, useAgentDock } from './useAgentDock';
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
  const [journalBusyId, setJournalBusyId] = useState<string | null>(null);
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
  } = useAgentDock({ projectId: project.id });
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

  const acceptAction = async (action: AgentActionRecord) => {
    updateAction(action.id, { status: 'running', error: undefined });
    try {
      if (action.permissionId) {
        await respondToAgentPermission(action.permissionId, true);
        updateAction(action.id, { status: 'completed' });
        return;
      }
      const toolCall = agentActionToToolCall(action);
      if (toolCall) {
        await actions.applyAgentTool(toolCall);
      } else {
        await executeAgentAction({ action, project, actions, aspectRatio });
      }
      updateAction(action.id, { status: 'completed' });
      appendText(
        'assistant',
        t.video.editor.agentDock.actionCompleted.replace(
          '{action}',
          agentActionTitle(action.name, t.video.editor.agentDock.actions),
        ),
      );
    } catch (error) {
      updateAction(action.id, {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const rejectAction = (action: AgentActionRecord) => {
    if (action.permissionId) {
      void respondToAgentPermission(action.permissionId, false);
    }
    updateAction(action.id, { status: 'rejected' });
    appendText(
      'system',
      t.video.editor.agentDock.actionRejected.replace(
        '{action}',
        agentActionTitle(action.name, t.video.editor.agentDock.actions),
      ),
    );
  };

  const refineAction = (action: AgentActionRecord) => {
    setDraft(
      t.video.editor.agentDock.refinePrompt.replace('{action}', action.summary),
    );
    setDraftNonce((value) => value + 1);
  };

  const cancelAction = (action: AgentActionRecord) => {
    updateAction(action.id, { status: 'cancelled' });
  };

  const runJournalAction = async (entryId: string, mode: 'undo' | 'redo') => {
    if (journalBusyId) return;
    setJournalBusyId(entryId);
    try {
      if (mode === 'undo') {
        await actions.undoAgentJournalEntry(entryId);
      } else {
        await actions.redoAgentJournalEntry(entryId);
      }
    } catch (error) {
      appendText(
        'system',
        t.video.editor.agentDock.journal.actionFailed.replace(
          '{error}',
          error instanceof Error ? error.message : String(error),
        ),
      );
    } finally {
      setJournalBusyId(null);
    }
  };

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
