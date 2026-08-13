import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react';

import { Plus } from 'lucide-react';

import { useLanguage } from '@/shared/providers/language-provider';
import type {
  VideoAspectRatio,
  VideoCaptionTimelineClip,
  VideoProject,
  VideoSceneOverlayCaption,
  VideoStoryboardScene,
  VideoSubtitleStyle,
} from '@/shared/types/video';
import { randomUUID } from '@/shared/utils/uuid';

import type { VideoProjectEditorActions } from '../editorTypes';
import { useTimelineEditorStore } from '../timeline/useTimelineEditorStore';
import { useTimelineUiStore } from '../timeline/useTimelineUiStore';
import { CaptionBox } from './CaptionBox';
import type { CanvasBounds, CaptionLike } from './captionOverlayTypes';
import { ASPECT_RATIO_VALUE, DEFAULT_FONT_SIZE } from './captionOverlayTypes';

interface CaptionOverlayProps {
  project: VideoProject;
  scene: VideoStoryboardScene | null;
  actions: VideoProjectEditorActions;
  aspectRatio: VideoAspectRatio;
  containerRef: React.RefObject<HTMLElement | null>;
}

/**
 * Pointer-driven editor overlay for captions on the preview. Renders on top
 * of the Remotion preview, lets the user drag / resize / inline-edit each
 * caption, and persists changes back to either the storyboard scene
 * (scene.caption / scene.overlayCaptions) or a timeline caption clip,
 * whichever is the editing source.
 *
 * Selection rule: when a caption clip on the timeline overlaps the current
 * playhead, it takes priority over scene-level captions — that matches the
 * timeline-first editing model and means the user always edits the same
 * caption they see on the timeline. When there's no overlapping clip we
 * fall back to scene captions.
 *
 * Soft snaps to vertical thirds and horizontal center; hold Shift to bypass.
 */
export function CaptionOverlay({
  project,
  scene,
  actions,
  aspectRatio,
  containerRef,
}: CaptionOverlayProps) {
  const { t } = useLanguage();
  const inspectorLabels = t.video.editor.clipInspector;
  const captionBoxLabels = useMemo(
    () => ({
      resize: inspectorLabels.canvasResizeCaption,
      delete: inspectorLabels.canvasDeleteCaption,
    }),
    [inspectorLabels.canvasResizeCaption, inspectorLabels.canvasDeleteCaption],
  );
  const [bounds, setBounds] = useState<CanvasBounds | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const timeline = useTimelineEditorStore((state) => state.timeline);
  const selectedClipIds = useTimelineEditorStore(
    (state) => state.selectedClipIds,
  );
  const updateClip = useTimelineEditorStore((state) => state.updateClip);
  const selectClip = useTimelineEditorStore((state) => state.selectClip);
  const playheadMs = useTimelineUiStore((state) => state.playheadMs);

  useLayoutEffect(() => {
    let observer: ResizeObserver | null = null;
    let raf = 0;
    let cancelled = false;
    const aspect = ASPECT_RATIO_VALUE[aspectRatio];
    const measure = (container: HTMLElement) => {
      const rect = container.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const containerAspect = rect.width / rect.height;
      let w: number;
      let h: number;
      let x: number;
      let y: number;
      if (containerAspect > aspect) {
        h = rect.height;
        w = h * aspect;
        x = (rect.width - w) / 2;
        y = 0;
      } else {
        w = rect.width;
        h = w / aspect;
        x = 0;
        y = (rect.height - h) / 2;
      }
      setBounds({ x, y, width: w, height: h });
    };
    // Retry next frame if the container ref hasn't attached yet (StrictMode
    // double-mount); otherwise bounds stay null and every caption box hides.
    const setup = () => {
      if (cancelled) return;
      const container = containerRef.current;
      if (!container) {
        raf = requestAnimationFrame(setup);
        return;
      }
      measure(container);
      observer = new ResizeObserver(() => measure(container));
      observer.observe(container);
    };
    setup();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      observer?.disconnect();
    };
  }, [aspectRatio, containerRef]);

  const timelineCaptions = useMemo<CaptionLike[]>(() => {
    if (!timeline) return [];
    const captions: CaptionLike[] = [];
    // Surface caption clips that are *either* under the playhead *or* user-
    // selected. Selection-only inclusion is what makes editing survive a page
    // reload: the in-memory playhead resets to 0, so the previous rule
    // (`playheadMs in [startMs, endMs)`) would silently hide a caption clip
    // whose range starts later than 0 — the user would see a Remotion-rendered
    // caption when scrubbed in, but the editable CaptionBox would never mount.
    // The same defense also keeps the box mounted if the Remotion player
    // advances past the clip end mid-drag (which would otherwise unmount the
    // box, lose pointer capture, and silently kill the drag).
    for (const track of timeline.tracks) {
      if (track.kind !== 'caption' || track.muted) continue;
      for (const clip of track.clips as VideoCaptionTimelineClip[]) {
        const end = clip.startMs + clip.durationMs;
        const inRange = playheadMs >= clip.startMs && playheadMs < end;
        const isSelected = selectedClipIds.has(clip.id);
        if (!inRange && !isSelected) continue;
        captions.push({
          id: `clip:${clip.id}`,
          text: clip.text,
          style: clip.style,
          kind: 'timelineClip',
          clipId: clip.id,
        });
      }
    }
    return captions;
  }, [timeline, playheadMs, selectedClipIds]);

  const sceneCaptions = useMemo<CaptionLike[]>(() => {
    if (!scene) return [];
    const list: CaptionLike[] = [];
    if (scene.caption?.text != null) {
      list.push({
        id: `${scene.id}:primary`,
        text: scene.caption.text,
        style: scene.caption.style,
        kind: 'primary',
      });
    }
    for (const overlay of scene.overlayCaptions ?? []) {
      list.push({
        id: overlay.id,
        text: overlay.text,
        style: overlay.style,
        kind: 'overlay',
      });
    }
    return list;
  }, [scene]);

  const captions =
    timelineCaptions.length > 0 ? timelineCaptions : sceneCaptions;

  // When the user picks a caption clip from the timeline rail, light up its
  // box on the canvas immediately so the handles are visible without an extra
  // click. Skips if nothing matches (e.g. the selection is a visual clip).
  useEffect(() => {
    if (!selectedClipIds || selectedClipIds.size === 0) return;
    const match = timelineCaptions.find(
      (caption) =>
        caption.clipId !== undefined && selectedClipIds.has(caption.clipId),
    );
    if (match && match.id !== activeId) setActiveId(match.id);
  }, [activeId, selectedClipIds, timelineCaptions]);

  const commit = useCallback(
    async (
      caption: CaptionLike,
      patch: { text?: string; style?: VideoSubtitleStyle },
    ) => {
      if (caption.kind === 'timelineClip' && caption.clipId) {
        const next: Partial<VideoCaptionTimelineClip> = {};
        if (patch.text !== undefined) next.text = patch.text;
        if (patch.style !== undefined) next.style = patch.style;
        updateClip(caption.clipId, next);
        return;
      }
      if (!scene || !project.storyboard) return;
      const nextScenes = project.storyboard.scenes.map((candidate) => {
        if (candidate.id !== scene.id) return candidate;
        if (caption.kind === 'primary') {
          const baseText =
            patch.text ?? candidate.caption?.text ?? candidate.intent;
          const baseStyle = patch.style ?? candidate.caption?.style;
          return {
            ...candidate,
            caption: { text: baseText, style: baseStyle },
          };
        }
        const overlays = (candidate.overlayCaptions ?? []).map((entry) =>
          entry.id === caption.id
            ? {
                ...entry,
                text: patch.text ?? entry.text,
                style: patch.style ?? entry.style,
              }
            : entry,
        );
        return { ...candidate, overlayCaptions: overlays };
      });
      await actions.updateStoryboard({
        ...project.storyboard,
        scenes: nextScenes,
      });
    },
    [actions, project.storyboard, scene, updateClip],
  );

  const addOverlay = useCallback(async () => {
    if (!scene || !project.storyboard) return;
    const id = randomUUID();
    const newOverlay: VideoSceneOverlayCaption = {
      id,
      text: inspectorLabels.canvasNewCaptionDefaultText,
      style: {
        positionX: 0.5,
        positionY: 0.5,
        maxWidth: 0.6,
        fontSize: DEFAULT_FONT_SIZE,
      },
    };
    const next = project.storyboard.scenes.map((candidate) =>
      candidate.id === scene.id
        ? {
            ...candidate,
            overlayCaptions: [...(candidate.overlayCaptions ?? []), newOverlay],
          }
        : candidate,
    );
    await actions.updateStoryboard({ ...project.storyboard, scenes: next });
    setActiveId(id);
    setEditingId(id);
  }, [
    actions,
    inspectorLabels.canvasNewCaptionDefaultText,
    project.storyboard,
    scene,
  ]);

  const removeCaption = useCallback(
    async (caption: CaptionLike) => {
      if (caption.kind === 'timelineClip' && caption.clipId) {
        const captionId = caption.clipId;
        // Remove the clip from its track by writing an empty-text style patch
        // isn't enough — drop the clip. We don't expose a single deleteClip,
        // but the editor store's deleteSelectedClip works on the selection.
        // Select the clip first, then delete it.
        selectClip(captionId);
        useTimelineEditorStore.getState().deleteSelectedClip();
        setActiveId(null);
        return;
      }
      if (caption.kind !== 'overlay' || !scene || !project.storyboard) return;
      const next = project.storyboard.scenes.map((candidate) =>
        candidate.id === scene.id
          ? {
              ...candidate,
              overlayCaptions: (candidate.overlayCaptions ?? []).filter(
                (entry) => entry.id !== caption.id,
              ),
            }
          : candidate,
      );
      await actions.updateStoryboard({ ...project.storyboard, scenes: next });
      setActiveId(null);
    },
    [actions, project.storyboard, scene, selectClip],
  );

  const handleActivate = (caption: CaptionLike) => {
    setActiveId(caption.id);
    if (caption.kind === 'timelineClip' && caption.clipId) {
      selectClip(caption.clipId);
    }
  };

  if (!bounds) return null;
  if (captions.length === 0 && !scene) return null;

  return (
    <div
      className="pointer-events-none absolute inset-0"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setActiveId(null);
      }}
    >
      {captions.map((cap) => (
        <CaptionBox
          key={cap.id}
          caption={cap}
          bounds={bounds}
          active={activeId === cap.id}
          editing={editingId === cap.id}
          labels={captionBoxLabels}
          onActivate={() => handleActivate(cap)}
          onStartEdit={() => setEditingId(cap.id)}
          onFinishEdit={() => setEditingId(null)}
          onPatch={(patch) => void commit(cap, patch)}
          onDelete={
            cap.kind === 'overlay' || cap.kind === 'timelineClip'
              ? () => void removeCaption(cap)
              : undefined
          }
        />
      ))}
      {scene ? (
        <button
          type="button"
          onClick={() => void addOverlay()}
          className="border-border bg-background/90 text-foreground hover:bg-background pointer-events-auto absolute right-3 bottom-3 flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium shadow-md"
          title={inspectorLabels.canvasAddOverlayCaption}
        >
          <Plus className="size-3.5" />
          {inspectorLabels.canvasAddOverlayCaptionShort}
        </button>
      ) : null}
    </div>
  );
}
