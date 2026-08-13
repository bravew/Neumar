import { Panel } from 'react-resizable-panels';

import { ResizeHandle } from '@/components/ui/resize-handle';
import type {
  VideoProject,
  VideoStoryboardScene,
  VideoTranscriptSelectionContext,
} from '@/shared/types/video';

import type { VideoEditorStep, VideoProjectEditorActions } from './editorTypes';
import { SideRail } from './SideRail';
import type { SideRailTab } from './SideRail';

interface EditorRightColumnProps {
  project: VideoProject;
  actions: VideoProjectEditorActions;
  activeStep: VideoEditorStep;
  sideRailOpen: boolean;
  onSideRailOpenChange: (open: boolean) => void;
  selectedScene: VideoStoryboardScene | null;
  selectedSceneId?: string | null;
  onSelectScene?: (sceneId: string) => void;
  selectedContextAssetIds?: string[];
  onToggleAssetContext?: (asset: VideoProject['assets'][number]) => void;
  onTranscriptSelectionChange?: (
    selection: VideoTranscriptSelectionContext | null,
  ) => void;
  onFindContext: (sceneId: string) => void;
  recommendedTab?: SideRailTab;
  forceRecommendedTab?: boolean;
}

/**
 * Right-side panel — Library + scene Inspector.
 *
 * The Inspector now lives as the 5th tab here, auto-activated whenever a
 * scene is selected. Replaces the older bottom-sheet drawer.
 */
export function EditorRightColumn({
  project,
  actions,
  activeStep,
  sideRailOpen,
  onSideRailOpenChange,
  selectedScene,
  selectedSceneId,
  onSelectScene,
  selectedContextAssetIds,
  onToggleAssetContext,
  onTranscriptSelectionChange,
  onFindContext,
  recommendedTab,
  forceRecommendedTab = false,
}: EditorRightColumnProps) {
  const isPreview = activeStep === 'preview';
  const defaultRecommendedTab = isPreview ? 'transcript' : 'brief';
  if (sideRailOpen) {
    return (
      <>
        <ResizeHandle />
        <Panel id="library" defaultSize="22%" minSize="16%" maxSize="40%">
          <SideRail
            project={project}
            open
            onOpenChange={onSideRailOpenChange}
            actions={actions}
            recommendedTab={recommendedTab ?? defaultRecommendedTab}
            forceRecommendedTab={forceRecommendedTab}
            collapsedBadge={project.assets.length}
            side="right"
            selectedScene={selectedScene}
            selectedSceneId={selectedSceneId}
            onSelectScene={onSelectScene}
            selectedContextAssetIds={selectedContextAssetIds}
            onToggleAssetContext={onToggleAssetContext}
            onTranscriptSelectionChange={onTranscriptSelectionChange}
            onFindContext={onFindContext}
            showTranscriptTab={isPreview}
            hideAssetsTab={isPreview}
            hideInspectorTab={isPreview}
          />
        </Panel>
      </>
    );
  }

  return (
    <SideRail
      project={project}
      open={false}
      onOpenChange={onSideRailOpenChange}
      actions={actions}
      collapsedBadge={project.assets.length}
      side="right"
      selectedScene={selectedScene}
      selectedSceneId={selectedSceneId}
      onSelectScene={onSelectScene}
      selectedContextAssetIds={selectedContextAssetIds}
      onToggleAssetContext={onToggleAssetContext}
      onTranscriptSelectionChange={onTranscriptSelectionChange}
      onFindContext={onFindContext}
      showTranscriptTab={isPreview}
    />
  );
}
