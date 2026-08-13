import { Panel } from 'react-resizable-panels';

import { ResizeHandle } from '@/components/ui/resize-handle';
import type {
  VideoProject,
  VideoStoryboardScene,
  VideoTranscriptSelectionContext,
} from '@/shared/types/video';

import { AgentDock } from './AgentDock';
import type { VideoEditorStep, VideoProjectEditorActions } from './editorTypes';

interface EditorLeftColumnProps {
  project: VideoProject;
  actions: VideoProjectEditorActions;
  selectedScene: VideoStoryboardScene | null;
  activeStep: VideoEditorStep;
  showAgentDock: boolean;
  assetContextAssets?: VideoProject['assets'];
  transcriptSelection?: VideoTranscriptSelectionContext | null;
  onAgentClose: () => void;
  onAddAssetContext?: (assetId: string) => void;
  onRemoveAssetContext?: (assetId: string) => void;
  onClearAssetContext?: () => void;
  onAgentStreamingChange?: (streaming: boolean) => void;
}

/**
 * Left-side resizable panel — Video Mode chat.
 *
 * Positioning the chat on the left mirrors Design mode and the canonical
 * AI-first creative tools (Lovable-style persistent chat). The panel
 * disappears entirely when the agent is not active so the canvas reflows
 * to the full width.
 */
export function EditorLeftColumn({
  project,
  actions,
  selectedScene,
  activeStep,
  showAgentDock,
  assetContextAssets,
  transcriptSelection,
  onAgentClose,
  onAddAssetContext,
  onRemoveAssetContext,
  onClearAssetContext,
  onAgentStreamingChange,
}: EditorLeftColumnProps) {
  if (!showAgentDock) return null;
  return (
    <>
      <Panel id="agent" defaultSize="25%" minSize="18%" maxSize="45%">
        <AgentDock
          project={project}
          actions={actions}
          selectedScene={selectedScene}
          activeStep={activeStep}
          assetContextAssets={assetContextAssets}
          transcriptSelection={transcriptSelection}
          onClose={onAgentClose}
          onAddAssetContext={onAddAssetContext}
          onRemoveAssetContext={onRemoveAssetContext}
          onClearAssetContext={onClearAssetContext}
          onStreamingChange={onAgentStreamingChange}
        />
      </Panel>
      <ResizeHandle />
    </>
  );
}
