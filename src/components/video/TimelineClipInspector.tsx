import { useCallback, useEffect, useMemo, useState } from 'react';

import { Film, Move, Palette, Trash2, Wand2 } from 'lucide-react';

import { useLanguage } from '@/shared/providers/language-provider';
import type { VideoAspectRatio, VideoProject } from '@/shared/types/video';

import { AnimateSection } from './clipInspector/AnimateSection';
import { AudioClipSections } from './clipInspector/AudioClipSections';
import { CaptionStyleSection } from './clipInspector/CaptionStyleSection';
import {
  isAudioClip,
  isCaptionClip,
  isVisualClip,
  sourceAssetForClip,
} from './clipInspector/clipInspectorModel';
import { KeyframeSection } from './clipInspector/KeyframeSection';
import { OverlayClipSection } from './clipInspector/OverlayClipSection';
import {
  ClipNameField,
  TabButton,
} from './clipInspector/TimelineClipInspectorFields';
import { TransformAndPlaybackSections } from './clipInspector/TransformAndPlaybackSections';
import { findClipTransitionSeamContexts } from './clipInspector/transitionInspectorModel';
import { TransitionInspectorPanel } from './clipInspector/TransitionInspectorPanel';
import { formatMs } from './clipInspector/types';
import { useImportedOverlayClipDisplayName } from './clipInspector/useImportedOverlayClipDisplayName';
import {
  buildTransitionNames,
  VisualClipTransitionSummary,
} from './clipInspector/VisualClipTransitionSummary';
import { VisualFilterSection } from './clipInspector/VisualFilterSection';
import { useTimelineEditorStore } from './timeline/useTimelineEditorStore';
import { useTimelineUiStore } from './timeline/useTimelineUiStore';

type InspectorTabId = 'transform' | 'style' | 'animate' | 'effects';

interface TimelineClipInspectorProps {
  project: VideoProject;
  aspectRatio?: VideoAspectRatio;
}

export function TimelineClipInspector({
  project,
  aspectRatio = project.outputs?.[0]?.aspectRatio ?? '16:9',
}: TimelineClipInspectorProps) {
  const { t } = useLanguage();
  const labels = t.video.editor.clipInspector;
  const timeline = useTimelineEditorStore((state) => state.timeline);
  const selectedClipIds = useTimelineEditorStore(
    (state) => state.selectedClipIds,
  );
  const selectedSeamId = useTimelineEditorStore(
    (state) => state.selectedSeamId,
  );
  const updateClip = useTimelineEditorStore((state) => state.updateClip);
  const updateFilters = useTimelineEditorStore(
    (state) => state.updateSelectedVisualClipFilters,
  );
  const selectSeam = useTimelineEditorStore((state) => state.selectSeam);
  const setTransitionOnSeam = useTimelineEditorStore(
    (state) => state.setTransitionOnSeam,
  );
  const removeTransitionFromSeam = useTimelineEditorStore(
    (state) => state.removeTransitionFromSeam,
  );
  const setSelectedClipSpeed = useTimelineEditorStore(
    (state) => state.setSelectedClipSpeed,
  );
  const setSelectedClipReverse = useTimelineEditorStore(
    (state) => state.setSelectedClipReverse,
  );
  const setSelectedAudioClipFade = useTimelineEditorStore(
    (state) => state.setSelectedAudioClipFade,
  );
  const setSelectedAudioClipGain = useTimelineEditorStore(
    (state) => state.setSelectedAudioClipGain,
  );
  const setSelectedAudioClipMute = useTimelineEditorStore(
    (state) => state.setSelectedAudioClipMute,
  );
  const rotateSelectedVisualClips = useTimelineEditorStore(
    (state) => state.rotateSelectedVisualClips,
  );
  const flipSelectedVisualClips = useTimelineEditorStore(
    (state) => state.flipSelectedVisualClips,
  );
  const setSelectedVisualClipTransform = useTimelineEditorStore(
    (state) => state.setSelectedVisualClipTransform,
  );
  const deleteSelectedClip = useTimelineEditorStore(
    (state) => state.deleteSelectedClip,
  );
  const playheadMs = useTimelineUiStore((state) => state.playheadMs);
  const setHoverMs = useTimelineUiStore((state) => state.setHoverMs);
  const setPlayheadMs = useTimelineUiStore((state) => state.setPlayheadMs);
  const [tab, setTab] = useState<InspectorTabId>('transform');
  const handleTransitionPreviewSeek = useCallback(
    (nextPlayheadMs: number) => {
      setHoverMs(null);
      setPlayheadMs(nextPlayheadMs);
    },
    [setHoverMs, setPlayheadMs],
  );

  const selectedClip = useMemo(() => {
    if (!timeline || selectedClipIds.size === 0) return null;
    const firstId = selectedClipIds.values().next().value;
    if (!firstId) return null;
    for (const track of timeline.tracks) {
      const clip = track.clips.find((c) => c.id === firstId);
      if (clip) return clip;
    }
    return null;
  }, [selectedClipIds, timeline]);

  // Advertise the open inspector (clip + tab) so the agent can resolve "the
  // overlay" to the clip the user is actually looking at.
  const setInspectorPanel = useTimelineUiStore(
    (state) => state.setInspectorPanel,
  );
  const selectedClipId = selectedClip?.id;
  useEffect(() => {
    setInspectorPanel(selectedClipId ? { clipId: selectedClipId, tab } : null);
    return () => setInspectorPanel(null);
  }, [selectedClipId, setInspectorPanel, tab]);

  const sourceFrame = useMemo(() => {
    if (!selectedClip || !isVisualClip(selectedClip)) return undefined;
    const asset = sourceAssetForClip(selectedClip, project);
    return asset
      ? { width: asset.metadata.width, height: asset.metadata.height }
      : undefined;
  }, [project, selectedClip]);
  const selectedClipDisplayName =
    useImportedOverlayClipDisplayName(selectedClip);
  const transitionNames = useMemo(
    () =>
      buildTransitionNames(
        t.video.storyboard.transitions as Record<string, string>,
      ),
    [t.video.storyboard.transitions],
  );
  const selectedClipTransitionContexts = useMemo(() => {
    if (!timeline || !selectedClip || !isVisualClip(selectedClip)) return null;
    return findClipTransitionSeamContexts(timeline, selectedClip.id);
  }, [selectedClip, timeline]);

  if (selectedSeamId && timeline) {
    return (
      <TransitionInspectorPanel
        timeline={timeline}
        seamId={selectedSeamId}
        labels={labels}
        transitionNames={transitionNames}
        renderLabels={{
          remotionOnly: t.video.editor.timeline.remotionOnly,
          ffmpegOnly: t.video.editor.timeline.ffmpegOnly,
        }}
        onUpdate={setTransitionOnSeam}
        onRemove={removeTransitionFromSeam}
        onPreviewSeek={handleTransitionPreviewSeek}
      />
    );
  }

  if (!selectedClip) {
    return <p className="text-muted-foreground text-xs">{labels.empty}</p>;
  }

  const multi = selectedClipIds.size > 1;
  const isVisual = isVisualClip(selectedClip);
  const isAudio = isAudioClip(selectedClip);
  const isCaption = isCaptionClip(selectedClip);
  const animatableClip = isVisual || isAudio || isCaption ? selectedClip : null;
  const styleAvailable = isVisual || isCaption;
  const animateAvailable = !!animatableClip;

  return (
    <section className="space-y-4">
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <ClipNameField
            clip={selectedClip}
            displayName={selectedClipDisplayName}
            label={labels.name}
            onChange={(name) => updateClip(selectedClip.id, { name })}
          />
          <div className="text-muted-foreground mt-1 flex items-center gap-2 text-[10px] uppercase">
            <span>{labels.kind[selectedClip.kind]}</span>
            <span>·</span>
            <span>
              {formatMs(selectedClip.startMs)} →{' '}
              {formatMs(selectedClip.startMs + selectedClip.durationMs)}
            </span>
          </div>
          {multi ? (
            <div className="text-muted-foreground mt-1 text-[10px]">
              {labels.multiSelected.replace(
                '{count}',
                String(selectedClipIds.size),
              )}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          className="text-muted-foreground hover:text-destructive shrink-0"
          aria-label={labels.delete}
          onClick={() => deleteSelectedClip()}
        >
          <Trash2 className="size-4" />
        </button>
      </header>

      <nav
        role="tablist"
        aria-label={labels.title}
        className="border-border flex shrink-0 border-b"
      >
        <TabButton
          active={tab === 'transform'}
          onClick={() => setTab('transform')}
          icon={<Move className="size-3.5" />}
          label={labels.tabs.transform}
        />
        {styleAvailable ? (
          <TabButton
            active={tab === 'style'}
            onClick={() => setTab('style')}
            icon={<Palette className="size-3.5" />}
            label={labels.tabs.style}
          />
        ) : null}
        {animateAvailable ? (
          <TabButton
            active={tab === 'animate'}
            onClick={() => setTab('animate')}
            icon={<Film className="size-3.5" />}
            label={labels.tabs.animate}
          />
        ) : null}
        {isVisual ? (
          <TabButton
            active={tab === 'effects'}
            onClick={() => setTab('effects')}
            icon={<Wand2 className="size-3.5" />}
            label={labels.tabs.effects}
          />
        ) : null}
      </nav>

      {tab === 'transform' && isVisual ? (
        <>
          {selectedClipTransitionContexts ? (
            <VisualClipTransitionSummary
              contexts={selectedClipTransitionContexts}
              labels={labels}
              transitionNames={transitionNames}
              onSelectSeam={selectSeam}
            />
          ) : null}
          <TransformAndPlaybackSections
            clip={selectedClip}
            aspectRatio={aspectRatio}
            labels={labels}
            sourceFrame={sourceFrame}
            updateClip={(p) => updateClip(selectedClip.id, p)}
            setPlaybackSpeed={setSelectedClipSpeed}
            setPlaybackReverse={setSelectedClipReverse}
            rotateClips={rotateSelectedVisualClips}
            flipClips={flipSelectedVisualClips}
            setTransform={setSelectedVisualClipTransform}
          />
        </>
      ) : null}

      {tab === 'transform' && isAudio ? (
        <AudioClipSections
          clip={selectedClip}
          labels={labels}
          onFadeChange={setSelectedAudioClipFade}
          onGainChange={setSelectedAudioClipGain}
          onMuteChange={setSelectedAudioClipMute}
          updateTranscript={(transcriptText) =>
            updateClip(selectedClip.id, { transcriptText })
          }
        />
      ) : null}

      {tab === 'transform' && isCaption ? (
        <p className="text-muted-foreground text-xs">
          {labels.captionTransformHint}
        </p>
      ) : null}

      {tab === 'transform' && selectedClip.kind === 'effect' ? (
        <OverlayClipSection
          clip={selectedClip}
          updateClip={(p) => updateClip(selectedClip.id, p)}
        />
      ) : null}

      {tab === 'style' && isVisual ? (
        <VisualFilterSection
          clip={selectedClip}
          labels={labels}
          filterLabels={t.video.editor.timeline.filterControls}
          updateFilters={updateFilters}
        />
      ) : null}

      {tab === 'style' && isCaption ? (
        <CaptionStyleSection
          clip={selectedClip}
          labels={labels}
          updateClip={(p) => updateClip(selectedClip.id, p)}
        />
      ) : null}

      {tab === 'animate' && animatableClip ? (
        <div className="space-y-4">
          {isVisual || isCaption ? (
            <AnimateSection
              clip={selectedClip}
              labels={labels}
              updateClip={(p) => updateClip(selectedClip.id, p)}
            />
          ) : null}
          <KeyframeSection
            clip={animatableClip}
            labels={labels}
            playheadMs={playheadMs}
            updateClip={(p) => updateClip(selectedClip.id, p)}
          />
        </div>
      ) : null}

      {tab === 'effects' && isVisual ? (
        <p className="text-muted-foreground text-xs">
          {labels.effectsComingSoon}
        </p>
      ) : null}
    </section>
  );
}
