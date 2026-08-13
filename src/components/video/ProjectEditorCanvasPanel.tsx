import { Panel } from 'react-resizable-panels';

import type { VideoProject, VideoStoryboardScene } from '@/shared/types/video';

import type { VideoEditorStep, VideoProjectEditorActions } from './editorTypes';
import { RenderActionsBar } from './RenderActionsBar';
import { StepBoardCanvas } from './StepBoardCanvas';
import { StepBriefCanvas } from './StepBriefCanvas';
import { StepGenerateCanvas } from './StepGenerateCanvas';
import { StepPlanCanvas } from './StepPlanCanvas';
import { StepPreviewCanvas } from './StepPreviewCanvas';
import type {
  TimelineSceneSelectOptions,
  TimelineSceneSelectionSource,
} from './timeline/TimelineTypes';

interface ProjectEditorCanvasPanelProps {
  project: VideoProject;
  actions: VideoProjectEditorActions;
  activeStep: VideoEditorStep;
  canvasDefaultSize: string;
  focusHtmlPanel: boolean;
  selectedScene: VideoStoryboardScene | null;
  selectedSceneId: string | null;
  selectedSceneSource: TimelineSceneSelectionSource;
  regeneratingSceneIds: Set<string>;
  selectedContextAssetIds: string[];
  onStepChange: (step: VideoEditorStep) => void;
  onSelectScene: (
    sceneId: string,
    options?: TimelineSceneSelectOptions,
  ) => void;
  onFindContext: (sceneId: string) => void;
  onToggleAssetContext: (asset: VideoProject['assets'][number]) => void;
}

export function ProjectEditorCanvasPanel({
  project,
  actions,
  activeStep,
  canvasDefaultSize,
  focusHtmlPanel,
  selectedScene,
  selectedSceneId,
  selectedSceneSource,
  regeneratingSceneIds,
  selectedContextAssetIds,
  onStepChange,
  onSelectScene,
  onFindContext,
  onToggleAssetContext,
}: ProjectEditorCanvasPanelProps) {
  return (
    <Panel id="canvas" defaultSize={canvasDefaultSize} minSize="30%">
      <main className="relative flex h-full min-w-0 flex-col">
        {activeStep === 'brief' ? (
          <StepBriefCanvas
            project={project}
            actions={actions}
            onStepChange={onStepChange}
            focusHtml={focusHtmlPanel}
          />
        ) : null}
        {activeStep === 'board' ? (
          <StepBoardCanvas
            project={project}
            selectedSceneId={selectedSceneId}
            onSelectScene={onSelectScene}
            actions={actions}
            onStepChange={onStepChange}
            regeneratingSceneIds={regeneratingSceneIds}
          />
        ) : null}
        {activeStep === 'plan' ? (
          <StepPlanCanvas
            project={project}
            actions={actions}
            onStepChange={onStepChange}
          />
        ) : null}
        {activeStep === 'generate' ? (
          <StepGenerateCanvas project={project} actions={actions} />
        ) : null}
        {activeStep === 'preview' ? (
          <StepPreviewCanvas
            project={project}
            actions={actions}
            selectedSceneId={selectedSceneId}
            selectedSceneSource={selectedSceneSource}
            selectedScene={selectedScene}
            onSelectScene={onSelectScene}
            onFindContext={onFindContext}
            selectedContextAssetIds={selectedContextAssetIds}
            onToggleAssetContext={onToggleAssetContext}
          />
        ) : null}
        {activeStep !== 'preview' ? (
          <RenderActionsBar
            project={project}
            actions={actions}
            onGenerated={() => onStepChange('board')}
            onApproved={() => onStepChange('plan')}
            onRendered={() => onStepChange('preview')}
          />
        ) : null}
      </main>
    </Panel>
  );
}
