import { useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentType } from 'react';

import {
  ChevronsLeft,
  ChevronsRight,
  FileText,
  FolderOpen,
  Library,
  Palette,
  ScrollText,
  Shuffle,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react';

import { useLanguage } from '@/shared/providers/language-provider';
import type {
  VideoProject,
  VideoStoryboardScene,
  VideoTranscriptSelectionContext,
} from '@/shared/types/video';
import { useVideoFlags } from '@/shared/video/useVideoFlags';

import { AssetsRail } from './assets/AssetsRail';
import { BrandRail } from './BrandRail';
import type { VideoProjectEditorActions } from './editorTypes';
import { InputsPanel } from './InputsPanel';
import { OverlayLibraryRail } from './overlays/OverlayLibraryRail';
import { SceneInspector } from './SceneInspector';
import { SourcesPanel } from './SourcesPanel';
import { useTimelineEditorStore } from './timeline/useTimelineEditorStore';
import { TimelineClipInspector } from './TimelineClipInspector';
import { TranscriptView } from './TranscriptView';
import { TransitionLibraryRail } from './transitions/TransitionLibraryRail';

export type SideRailTab =
  | 'brief'
  | 'assets'
  | 'transitions'
  | 'overlays'
  | 'sources'
  | 'brand'
  | 'transcript'
  | 'inspector';

interface SideRailProps {
  project: VideoProject;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions: VideoProjectEditorActions;
  /** Recommended tab driven by the current step. Honored until the user
   * manually picks a tab — after that, the user's choice sticks. */
  recommendedTab?: SideRailTab;
  forceRecommendedTab?: boolean;
  /** Asset count badge for the collapsed state — surfaces newly registered
   * project assets the user might otherwise miss when the rail is closed. */
  collapsedBadge?: number;
  /** Which edge the rail sits on. Affects border and collapsed-state chevron
   * direction. */
  side?: 'left' | 'right';
  /** Selected scene — when non-null, an "Inspector" tab appears and auto-
   * activates so the scene's properties are immediately editable. */
  selectedScene?: VideoStoryboardScene | null;
  /** Callback when the inspector wants to surface linked-context search. */
  onFindContext?: (sceneId: string) => void;
  /** When true, surface the Transcript tab. Driven by the parent so the right
   * rail can show transcript-editing in steps where it's relevant (preview). */
  showTranscriptTab?: boolean;
  /** When true, hide the Assets tab (because it lives elsewhere in the layout). */
  hideAssetsTab?: boolean;
  /** When true, hide the Inspector tab — used on the Preview step where the
   * inspector now lives in a dedicated column next to the preview. */
  hideInspectorTab?: boolean;
  selectedSceneId?: string | null;
  onSelectScene?: (sceneId: string) => void;
  selectedContextAssetIds?: string[];
  onToggleAssetContext?: (asset: VideoProject['assets'][number]) => void;
  onTranscriptSelectionChange?: (
    selection: VideoTranscriptSelectionContext | null,
  ) => void;
}

const TAB_ICONS = {
  brief: FileText,
  assets: Library,
  transitions: Shuffle,
  overlays: Sparkles,
  sources: FolderOpen,
  brand: Palette,
  transcript: ScrollText,
  inspector: SlidersHorizontal,
} satisfies Record<SideRailTab, typeof FileText>;

export function SideRail({
  project,
  open,
  onOpenChange,
  actions,
  recommendedTab,
  forceRecommendedTab = false,
  collapsedBadge,
  side = 'left',
  selectedScene,
  onFindContext,
  showTranscriptTab,
  hideAssetsTab,
  hideInspectorTab,
  selectedSceneId,
  onSelectScene,
  selectedContextAssetIds,
  onToggleAssetContext,
  onTranscriptSelectionChange,
}: SideRailProps) {
  const selectedClipCount = useTimelineEditorStore(
    (state) => state.selectedClipIds.size,
  );
  const borderClass = side === 'right' ? 'border-l' : 'border-r';
  const CollapsedIcon: ComponentType<{ className?: string }> =
    side === 'right' ? ChevronsLeft : ChevronsRight;
  const { t } = useLanguage();
  const { flags } = useVideoFlags();
  const transitionsEnabled = flags['video.timelineTransitions'] !== false;
  const overlaysEnabled = flags['video.vividOverlays'] !== false;
  const [tab, setTab] = useState<SideRailTab>(recommendedTab ?? 'brief');
  const userPickedTabRef = useRef(false);
  useEffect(() => {
    if (forceRecommendedTab) {
      userPickedTabRef.current = false;
    } else if (userPickedTabRef.current) return;
    if (!recommendedTab) return;
    setTab((current) =>
      current === recommendedTab ? current : recommendedTab,
    );
  }, [forceRecommendedTab, recommendedTab]);

  // When a scene OR timeline clip becomes selected, jump to the inspector tab
  // regardless of user-picked stickiness — selection is a strong intent
  // signal. When both are cleared while on inspector, fall back to a sensible
  // tab.
  const sceneId = selectedScene?.id ?? null;
  const hasClipSelection = selectedClipCount > 0;
  const hasInspectable = hasClipSelection || Boolean(sceneId);
  const inspectorTabAvailable = hasInspectable && !hideInspectorTab;
  useEffect(() => {
    if (inspectorTabAvailable) {
      setTab('inspector');
      userPickedTabRef.current = false;
    } else {
      setTab((current) =>
        current === 'inspector' ? (recommendedTab ?? 'brief') : current,
      );
    }
  }, [inspectorTabAvailable, recommendedTab]);

  useEffect(() => {
    if (transitionsEnabled) return;
    setTab((current) =>
      current === 'transitions'
        ? recommendedTab && recommendedTab !== 'transitions'
          ? recommendedTab
          : 'brief'
        : current,
    );
  }, [recommendedTab, transitionsEnabled]);

  const visibleTabs = useMemo<readonly SideRailTab[]>(() => {
    const tabs: SideRailTab[] = ['brief'];
    if (!hideAssetsTab) tabs.push('assets');
    if (transitionsEnabled) tabs.push('transitions');
    if (overlaysEnabled) tabs.push('overlays');
    tabs.push('sources', 'brand');
    if (showTranscriptTab) tabs.push('transcript');
    if (inspectorTabAvailable) tabs.push('inspector');
    return tabs;
  }, [
    inspectorTabAvailable,
    hideAssetsTab,
    overlaysEnabled,
    showTranscriptTab,
    transitionsEnabled,
  ]);

  if (!open) {
    return (
      <aside
        className={`border-border bg-muted/10 flex w-12 flex-col items-center gap-2 py-3 ${borderClass}`}
      >
        <button
          type="button"
          className="hover:bg-accent text-muted-foreground relative rounded-md p-2"
          aria-label={t.video.editor.sideRail.open}
          onClick={() => onOpenChange(true)}
        >
          <CollapsedIcon className="size-4" />
          {typeof collapsedBadge === 'number' && collapsedBadge > 0 ? (
            <span
              className="bg-primary text-primary-foreground absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold"
              aria-label={`${collapsedBadge} assets`}
            >
              {collapsedBadge > 99 ? '99+' : collapsedBadge}
            </span>
          ) : null}
        </button>
      </aside>
    );
  }

  const CloseIcon: ComponentType<{ className?: string }> =
    side === 'right' ? ChevronsRight : ChevronsLeft;

  return (
    <aside
      className={`border-border bg-muted/10 flex h-full min-h-0 min-w-0 flex-col ${borderClass}`}
    >
      <div className="border-border flex items-center gap-1 border-b p-2">
        {visibleTabs.map((nextTab) => {
          const Icon = TAB_ICONS[nextTab];
          const active = tab === nextTab;
          return (
            <button
              key={nextTab}
              type="button"
              aria-pressed={active}
              onClick={() => {
                userPickedTabRef.current = true;
                setTab(nextTab);
              }}
              className={
                active
                  ? 'bg-background text-foreground flex min-w-0 flex-1 items-center justify-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium shadow-sm'
                  : 'text-muted-foreground hover:bg-background/70 hover:text-foreground flex min-w-0 flex-1 items-center justify-center gap-1 rounded-md px-2 py-1.5 text-xs'
              }
            >
              <Icon className="size-3.5 shrink-0" />
              <span className="truncate">
                {t.video.editor.sideRail[nextTab].label}
              </span>
            </button>
          );
        })}
        <button
          type="button"
          className="hover:bg-accent text-muted-foreground rounded-md p-1.5"
          aria-label={t.video.editor.sideRail.close}
          onClick={() => onOpenChange(false)}
        >
          <CloseIcon className="size-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {tab === 'brief' ? (
          <InputsPanel project={project} onPatch={actions.patchProject} />
        ) : null}
        {tab === 'assets' ? (
          <AssetsRail
            project={project}
            actions={actions}
            selectedContextAssetIds={selectedContextAssetIds}
            onToggleAssetContext={onToggleAssetContext}
          />
        ) : null}
        {transitionsEnabled && tab === 'transitions' ? (
          <TransitionLibraryRail />
        ) : null}
        {overlaysEnabled && tab === 'overlays' ? <OverlayLibraryRail /> : null}
        {tab === 'sources' ? (
          <SourcesPanel
            project={project}
            onImportPath={actions.importSourcePath}
            onImportFile={actions.importSourceFile}
            onImportUrl={actions.queueYtDlpImport}
            onAnalyze={actions.analyzeSource}
            onCreateCutPlan={actions.createCutPlan}
            actions={actions}
          />
        ) : null}
        {tab === 'brand' ? (
          <BrandRail project={project} onPatch={actions.patchProject} />
        ) : null}
        {tab === 'transcript' ? (
          <TranscriptView
            project={project}
            actions={actions}
            selectedSceneId={selectedSceneId}
            onSelectScene={onSelectScene}
            onTranscriptSelectionChange={onTranscriptSelectionChange}
            className="size-full"
          />
        ) : null}
        {tab === 'inspector' && hasClipSelection ? (
          <TimelineClipInspector project={project} />
        ) : null}
        {tab === 'inspector' && !hasClipSelection && selectedScene ? (
          <SceneInspector
            project={project}
            scene={selectedScene}
            open
            onOpenChange={() => undefined}
            actions={actions}
            onFindContext={onFindContext}
            inline
          />
        ) : null}
      </div>
    </aside>
  );
}
