import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';

import { Group as PanelGroup } from 'react-resizable-panels';

import { CreativeWorkflowHeader } from '@/components/creative/CreativeWorkflowHeader';
import { API_BASE_URL } from '@/config';
import {
  deriveVideoCreativeWorkflowState,
  type CreativeWorkflowStep,
} from '@/shared/creative-workflow';
import {
  deriveVideoEditorStep,
  useVideoProjectPolling,
} from '@/shared/hooks/useVideoProject';
import type {
  VideoProject,
  VideoTranscriptSelectionContext,
} from '@/shared/types/video';

import { EditorLeftColumn } from './EditorLeftColumn';
import { EditorRightColumn } from './EditorRightColumn';
import type { VideoEditorStep, VideoProjectEditorActions } from './editorTypes';
import { LinkedAssetsBrowser } from './LinkedAssetsBrowser';
import { ProjectEditorCanvasPanel } from './ProjectEditorCanvasPanel';
import {
  ProjectStepperLeading,
  ProjectStepperTrailing,
} from './ProjectEditorStepperContent';
import { ProjectStepper } from './ProjectStepper';
import type { SideRailTab } from './SideRail';
import type {
  TimelineSceneSelectOptions,
  TimelineSceneSelectionSource,
} from './timeline/TimelineTypes';
import { useAgentAssetContext } from './useAgentAssetContext';
import { useRegeneratingSceneActions } from './useRegeneratingSceneActions';
import { useStoredBoolean } from './useStoredEditorPreference';
import {
  parseVideoEditorStep,
  videoWorkflowSelectionForStep,
} from './workflowSelection';

interface ProjectEditorProps {
  project: VideoProject;
  actions: VideoProjectEditorActions;
  setProject: (project: VideoProject) => void;
  /** Optional back handler — when provided, a back arrow renders next to the project title. */
  onBack?: () => void;
}

const STORAGE_KEYS = {
  sideRail: 'video.editor.sideRailOpen',
  agentDock: 'video.editor.agentDockOpen',
};

export function ProjectEditor({
  project,
  actions,
  setProject,
  onBack,
}: ProjectEditorProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const derivedStep = deriveVideoEditorStep(project);
  const workflowState = useMemo(
    () => deriveVideoCreativeWorkflowState(project),
    [project],
  );
  const urlStep = parseVideoEditorStep(searchParams.get('step'));
  const timelineRoute = location.pathname.endsWith('/timeline');
  const conversationRoute = !timelineRoute && urlStep === null;
  const activeStep =
    timelineRoute || conversationRoute ? 'preview' : (urlStep ?? derivedStep);
  const focusHtmlPanel = searchParams.get('html') === '1';
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);
  const [selectedSceneSource, setSelectedSceneSource] =
    useState<TimelineSceneSelectionSource>('user');
  const [transcriptSelection, setTranscriptSelection] =
    useState<VideoTranscriptSelectionContext | null>(null);
  const [sideRailOpen, setSideRailOpen] = useStoredBoolean(
    STORAGE_KEYS.sideRail,
    true,
  );
  const [agentDockOpen, setAgentDockOpen] = useStoredBoolean(
    STORAGE_KEYS.agentDock,
    false,
  );
  const [workflowSideRailTab, setWorkflowSideRailTab] =
    useState<SideRailTab | null>(null);
  const [contextSearchSceneId, setContextSearchSceneId] = useState<
    string | null
  >(null);
  const actionsWithProjectUpdates = useMemo<VideoProjectEditorActions>(
    () => ({ ...actions, onProjectUpdated: setProject }),
    [actions, setProject],
  );
  const { editorActions, regeneratingSceneIds } = useRegeneratingSceneActions(
    actionsWithProjectUpdates,
  );
  const handleSelectScene = useCallback(
    (sceneId: string, options?: TimelineSceneSelectOptions) => {
      setSelectedSceneSource(options?.source ?? 'user');
      setSelectedSceneId(sceneId);
    },
    [],
  );

  const scenes = useMemo(
    () => project.storyboard?.scenes ?? [],
    [project.storyboard?.scenes],
  );
  const selectedScene = useMemo(
    () => scenes.find((scene) => scene.id === selectedSceneId) ?? null,
    [scenes, selectedSceneId],
  );
  const [agentStreaming, setAgentStreaming] = useState(false);

  useVideoProjectPolling({
    projectId: project.id,
    // Poll during renders OR while the agent is mid-turn — the agentic
    // runtime mutates project state (asset library, journal) from MCP
    // tool handlers that don't return to the React tree, so without this
    // the Assets panel stays stale until the next manual refresh.
    active: project.render?.status === 'running' || agentStreaming,
    onProject: setProject,
  });

  // Auto-surface newly registered assets. When the agent (or any path) adds
  // assets to project.assets[], pop the SideRail open so the user can find
  // them without hunting for the collapsed-rail chevron.
  const lastSeenAssetCountRef = useRef(project.assets.length);
  useEffect(() => {
    const previous = lastSeenAssetCountRef.current;
    const current = project.assets.length;
    if (current > previous) {
      setSideRailOpen(true);
    }
    lastSeenAssetCountRef.current = current;
  }, [project.assets.length, setSideRailOpen]);

  // When a scene is selected, ensure the right rail is open so the Inspector
  // tab is visible. The selection itself is the strong intent signal.
  useEffect(() => {
    if (selectedSceneId && selectedSceneSource !== 'timeline') {
      setSideRailOpen(true);
    }
  }, [selectedSceneId, selectedSceneSource, setSideRailOpen]);

  useEffect(() => {
    const firstScene = scenes[0]?.id ?? null;
    if (
      !selectedSceneId ||
      !scenes.some((scene) => scene.id === selectedSceneId)
    ) {
      if (firstScene) {
        handleSelectScene(firstScene);
      } else {
        setSelectedSceneSource('user');
        setSelectedSceneId(null);
      }
    }
  }, [handleSelectScene, project.id, scenes, selectedSceneId]);

  useEffect(() => {
    setTranscriptSelection(null);
  }, [project.id]);

  useEffect(() => {
    if (
      transcriptSelection?.sceneId &&
      selectedSceneId &&
      transcriptSelection.sceneId !== selectedSceneId
    ) {
      setTranscriptSelection(null);
    }
  }, [selectedSceneId, transcriptSelection?.sceneId]);

  const setStep = useCallback(
    (step: VideoEditorStep) => {
      if (timelineRoute || conversationRoute) {
        navigate(`/video/${encodeURIComponent(project.id)}?step=${step}`);
        return;
      }
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('step', step);
        return next;
      });
    },
    [conversationRoute, navigate, project.id, setSearchParams, timelineRoute],
  );
  const selectWorkflowStep = useCallback(
    (step: CreativeWorkflowStep) => {
      const selection = videoWorkflowSelectionForStep(step, workflowState);
      setStep(selection.editorStep);
      if (selection.sideRailTab) {
        setSideRailOpen(true);
        setWorkflowSideRailTab(selection.sideRailTab);
        return;
      }
      setWorkflowSideRailTab(null);
    },
    [setSideRailOpen, setStep, workflowState],
  );

  const toggleTimelineRoute = useCallback(() => {
    navigate(
      timelineRoute
        ? `/video/${encodeURIComponent(project.id)}`
        : `/video/${encodeURIComponent(project.id)}/timeline`,
    );
  }, [navigate, project.id, timelineRoute]);

  const showInspector = activeStep !== 'brief';
  const showAgentDock = conversationRoute || agentDockOpen;
  const showCreativeWorkflowHeader = !conversationRoute;
  // Canvas starts narrower when side panels are visible.
  const visibleSidePanels = (showAgentDock ? 1 : 0) + (sideRailOpen ? 1 : 0);
  const canvasDefaultSize =
    visibleSidePanels >= 2 ? '53%' : visibleSidePanels === 1 ? '75%' : '100%';
  const closeAgentDock = useCallback(() => {
    if (conversationRoute) {
      navigate(`/video/${encodeURIComponent(project.id)}?step=preview`);
      return;
    }
    setAgentDockOpen(false);
  }, [conversationRoute, navigate, project.id, setAgentDockOpen]);
  const activateAgentForAssetContext = useCallback(() => {
    setAgentDockOpen(true);
  }, [setAgentDockOpen]);
  const {
    addAssetContext,
    assetContextAssets,
    assetContextIds,
    clearAssetContext,
    removeAssetContext,
    toggleAssetContext,
  } = useAgentAssetContext({
    assets: project.assets,
    onActivateAgent: activateAgentForAssetContext,
  });

  return (
    <div className="relative isolate flex min-h-0 flex-1 flex-col">
      <ProjectStepper
        value={activeStep}
        derived={derivedStep}
        onChange={(step) => {
          setWorkflowSideRailTab(null);
          setStep(step);
        }}
        leading={
          <ProjectStepperLeading
            project={project}
            onBack={onBack}
            onRename={(name) =>
              actions.patchProject({ name }).then(() => undefined)
            }
          />
        }
        trailing={
          <ProjectStepperTrailing
            timelineRoute={timelineRoute}
            sideRailOpen={sideRailOpen}
            agentDockOpen={agentDockOpen}
            onToggleTimelineRoute={toggleTimelineRoute}
            onToggleSideRail={() => setSideRailOpen(!sideRailOpen)}
            onToggleAgentDock={() => setAgentDockOpen(!agentDockOpen)}
          />
        }
      />
      {showCreativeWorkflowHeader && (
        <CreativeWorkflowHeader
          workflow={workflowState}
          onPrimaryAction={() =>
            selectWorkflowStep(workflowState.primaryAction.step)
          }
          onStepSelect={selectWorkflowStep}
        />
      )}
      <div className="relative flex min-h-0 flex-1">
        <PanelGroup orientation="horizontal" className="min-h-0 flex-1">
          <EditorLeftColumn
            project={project}
            actions={editorActions}
            selectedScene={selectedScene}
            activeStep={activeStep}
            showAgentDock={showAgentDock}
            assetContextAssets={assetContextAssets}
            transcriptSelection={transcriptSelection}
            onAgentClose={closeAgentDock}
            onAddAssetContext={addAssetContext}
            onRemoveAssetContext={removeAssetContext}
            onClearAssetContext={clearAssetContext}
            onAgentStreamingChange={setAgentStreaming}
          />

          <ProjectEditorCanvasPanel
            project={project}
            actions={editorActions}
            activeStep={activeStep}
            canvasDefaultSize={canvasDefaultSize}
            focusHtmlPanel={focusHtmlPanel}
            selectedScene={selectedScene}
            selectedSceneId={selectedSceneId}
            selectedSceneSource={selectedSceneSource}
            regeneratingSceneIds={regeneratingSceneIds}
            selectedContextAssetIds={assetContextIds}
            onStepChange={setStep}
            onSelectScene={handleSelectScene}
            onFindContext={setContextSearchSceneId}
            onToggleAssetContext={toggleAssetContext}
          />

          <EditorRightColumn
            project={project}
            actions={editorActions}
            activeStep={activeStep}
            sideRailOpen={sideRailOpen}
            onSideRailOpenChange={setSideRailOpen}
            selectedScene={showInspector ? selectedScene : null}
            selectedSceneId={selectedSceneId}
            onSelectScene={handleSelectScene}
            selectedContextAssetIds={assetContextIds}
            onToggleAssetContext={toggleAssetContext}
            onTranscriptSelectionChange={setTranscriptSelection}
            onFindContext={(sceneId) => setContextSearchSceneId(sceneId)}
            recommendedTab={workflowSideRailTab ?? undefined}
            forceRecommendedTab={Boolean(workflowSideRailTab)}
          />
        </PanelGroup>
      </div>
      {contextSearchSceneId ? (
        <LinkedAssetsBrowser
          project={project}
          actions={editorActions}
          initialSceneId={contextSearchSceneId}
          initialQuery={
            scenes.find((scene) => scene.id === contextSearchSceneId)?.intent ??
            ''
          }
          role="context"
          onClose={() => setContextSearchSceneId(null)}
          thumbnailBaseUrl={`${API_BASE_URL}/video/projects/${encodeURIComponent(
            project.id,
          )}/linked-assets`}
        />
      ) : null}
    </div>
  );
}
