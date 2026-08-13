import { useCallback, useEffect, useRef } from 'react';

import type {
  VideoAspectRatio,
  VideoEditorSelectionContext,
  VideoProject,
  VideoStoryboardScene,
  VideoTranscriptSelectionContext,
} from '@/shared/types/video';
import type { SourceIngestMessages } from '@/shared/video/ingest-composer-sources';
import { ingestComposerSources } from '@/shared/video/ingest-composer-sources';

import type { VideoEditorStep, VideoProjectEditorActions } from './editorTypes';
import type { AgentDockContext } from './useAgentDock';
import type { VideoAgentAssetContextItem } from './VideoAgentAssetContextPills';

interface AgentDockSubmitLabels {
  uploadFailed: string;
  attachedNote: string;
  assetContextNote: string;
  sourceIngest: SourceIngestMessages;
}

interface UseAgentDockSubmitInput {
  activeStep: VideoEditorStep;
  actions: VideoProjectEditorActions;
  appendText: (role: 'system', content: string) => void;
  aspectRatio: VideoAspectRatio;
  assetContextAssets: VideoProject['assets'];
  assetContextItems: VideoAgentAssetContextItem[];
  editorSelection?: VideoEditorSelectionContext;
  labels: AgentDockSubmitLabels;
  onClearAssetContext?: () => void;
  selectedScene: VideoStoryboardScene | null;
  sendMessage: (content: string, context: AgentDockContext) => void;
  setDraft: (value: string) => void;
  transcriptSelection?: VideoTranscriptSelectionContext | null;
}

export function useAgentDockSubmit({
  activeStep,
  actions,
  appendText,
  aspectRatio,
  assetContextAssets,
  assetContextItems,
  editorSelection,
  labels,
  onClearAssetContext,
  selectedScene,
  sendMessage,
  setDraft,
  transcriptSelection,
}: UseAgentDockSubmitInput) {
  const ingestAbortRef = useRef<AbortController | null>(null);
  useEffect(() => () => ingestAbortRef.current?.abort(), []);

  return useCallback(
    async (content: string, files: File[]) => {
      setDraft('');
      let prompt = content;
      const projectAssetIds = assetContextAssets.map((asset) => asset.id);
      if (assetContextItems.length > 0) {
        const names = assetContextItems.map((asset) => asset.name).join(', ');
        const note = labels.assetContextNote.replace('{names}', names);
        prompt = prompt ? `${prompt}\n\n${note}` : note;
      }
      if (files.length > 0) {
        try {
          const updated = await actions.uploadAssets(files);
          if (!updated) {
            appendText(
              'system',
              labels.uploadFailed.replace('{count}', String(files.length)),
            );
            return;
          }
          const names = files.map((file) => file.name).join(', ');
          const note = labels.attachedNote.replace('{names}', names);
          prompt = prompt ? `${prompt}\n\n${note}` : note;
        } catch (error) {
          appendText(
            'system',
            error instanceof Error ? error.message : String(error),
          );
          return;
        }
      }
      if (!prompt.trim()) return;
      ingestAbortRef.current?.abort();
      const ingestController = new AbortController();
      ingestAbortRef.current = ingestController;
      prompt = await ingestComposerSources(
        content,
        prompt,
        labels.sourceIngest,
        (text) => appendText('system', text),
        ingestController.signal,
      );
      if (ingestController.signal.aborted) return;
      sendMessage(prompt, {
        selectedSceneId: selectedScene?.id,
        aspectRatio,
        step: activeStep,
        transcriptSelection: transcriptSelection ?? undefined,
        editorSelection,
        projectAssetIds:
          projectAssetIds.length > 0 ? projectAssetIds : undefined,
      });
      if (projectAssetIds.length > 0) onClearAssetContext?.();
    },
    [
      actions,
      activeStep,
      appendText,
      aspectRatio,
      assetContextAssets,
      assetContextItems,
      editorSelection,
      labels,
      onClearAssetContext,
      selectedScene?.id,
      sendMessage,
      setDraft,
      transcriptSelection,
    ],
  );
}
