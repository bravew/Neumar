import { useCallback, useRef } from 'react';

import { toast } from 'sonner';

import {
  applyVideoPlugin,
  type VideoPluginSummary,
} from '@/shared/hooks/useVideoPlugins';
import type {
  VideoAspectRatio,
  VideoEditorSelectionContext,
  VideoProject,
  VideoStoryboardScene,
  VideoTranscriptSelectionContext,
} from '@/shared/types/video';

import type { AgentPluginPickerLabels } from './AgentPluginPicker';
import type { VideoEditorStep } from './editorTypes';
import type { AgentDockContext } from './useAgentDock';

interface UseAgentPluginSubmitOptions {
  activeStep: VideoEditorStep;
  appendText: (role: 'assistant' | 'system', content: string) => void;
  aspectRatio: VideoAspectRatio;
  assetContextAssets: VideoProject['assets'];
  editorSelection?: VideoEditorSelectionContext;
  labels: Pick<
    AgentPluginPickerLabels,
    'applyFailed' | 'applyNetworkError' | 'retry' | 'reviewConfirm'
  >;
  selectedScene: VideoStoryboardScene | null;
  sendMessage: (content: string, context: AgentDockContext) => Promise<void>;
  transcriptSelection?: VideoTranscriptSelectionContext | null;
}

export function useAgentPluginSubmit({
  activeStep,
  appendText,
  aspectRatio,
  assetContextAssets,
  editorSelection,
  labels,
  selectedScene,
  sendMessage,
  transcriptSelection,
}: UseAgentPluginSubmitOptions) {
  // Lets the retry toast re-invoke the latest submit without threading the
  // callback through its own dependency list.
  const submitRef = useRef<
    ((plugin: VideoPluginSummary) => Promise<void>) | null
  >(null);

  const submit = useCallback(
    async (plugin: VideoPluginSummary) => {
      try {
        const reviewed =
          !plugin.requiresReview ||
          window.confirm(
            labels.reviewConfirm.replace('{plugin}', plugin.title),
          );
        if (!reviewed) return;

        const request = plugin.requiresReview
          ? {
              approvedCapabilities: plugin.capabilities,
              lastReviewedDigest: plugin.manifestDigest,
              signatureOk: null,
            }
          : {};

        const applied = await applyVideoPlugin(plugin.id, request);
        await sendMessage(
          `@plugin:${applied.context.pluginId}\n\n${applied.prompt}`,
          {
            selectedSceneId: selectedScene?.id,
            aspectRatio,
            step: activeStep,
            transcriptSelection: transcriptSelection ?? undefined,
            editorSelection,
            projectAssetIds: assetContextAssets.map((asset) => asset.id),
            pluginId: applied.context.pluginId,
            pluginInputs: applied.context.pluginInputs,
            approvedPluginCapabilities:
              applied.context.approvedPluginCapabilities,
            lastReviewedPluginDigest: applied.context.lastReviewedPluginDigest,
            pluginSignatureOk: applied.context.pluginSignatureOk,
          },
        );
      } catch (error) {
        // A network failure (fetch throws a TypeError, e.g. "Failed to fetch")
        // is transient — offer a retry toast instead of writing a permanent
        // error into the conversation history. Real apply errors (a rejected
        // capability, an unknown plugin) carry actionable detail, so those stay
        // in the dock as before.
        if (error instanceof TypeError) {
          toast.error(labels.applyNetworkError, {
            action: {
              label: labels.retry,
              onClick: () => void submitRef.current?.(plugin),
            },
          });
          return;
        }
        appendText(
          'system',
          labels.applyFailed.replace(
            '{error}',
            error instanceof Error ? error.message : String(error),
          ),
        );
      }
    },
    [
      activeStep,
      appendText,
      aspectRatio,
      assetContextAssets,
      editorSelection,
      labels.applyFailed,
      labels.applyNetworkError,
      labels.retry,
      labels.reviewConfirm,
      selectedScene?.id,
      sendMessage,
      transcriptSelection,
    ],
  );

  submitRef.current = submit;
  return submit;
}
