import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { FileText } from 'lucide-react';

import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import type {
  VideoNarrationSegment,
  VideoProject,
  VideoStoryboard,
  VideoStoryboardScene,
  VideoTranscriptSelectionContext,
} from '@/shared/types/video';

import {
  CaptionTranscriptView,
  captionCuesFromTimeline,
} from './CaptionTranscriptView';
import type { VideoProjectEditorActions } from './editorTypes';
import { useTimelineEditorStore } from './timeline/useTimelineEditorStore';
import { useTimelineUiStore } from './timeline/useTimelineUiStore';
import {
  buildTranscriptTimingContexts,
  hasWordAnchors,
  resolveTranscriptSelection,
} from './transcriptSelection';

const LIVE_COMMIT_DEBOUNCE_MS = 400;

interface TranscriptViewProps {
  project: VideoProject;
  actions: VideoProjectEditorActions;
  selectedSceneId?: string | null;
  onSelectScene?: (sceneId: string) => void;
  onTranscriptSelectionChange?: (
    selection: VideoTranscriptSelectionContext | null,
  ) => void;
  className?: string;
}

interface TranscriptEntry {
  scene: VideoStoryboardScene;
  narration?: VideoNarrationSegment;
}

function getTranscriptText(
  scene: VideoStoryboardScene,
  narration?: VideoNarrationSegment,
) {
  return narration?.text ?? scene.caption?.text ?? scene.intent;
}

function buildDrafts(entries: TranscriptEntry[]) {
  return Object.fromEntries(
    entries.map((entry) => [
      entry.scene.id,
      getTranscriptText(entry.scene, entry.narration),
    ]),
  );
}

export function TranscriptView({
  project,
  actions,
  selectedSceneId,
  onSelectScene,
  onTranscriptSelectionChange,
  className,
}: TranscriptViewProps) {
  const { t } = useLanguage();
  const storyboard = project.storyboard;
  // The live timeline is the source of truth for generated captions; fall back
  // to the persisted project timeline before the editor store has hydrated.
  const storeTimeline = useTimelineEditorStore((state) => state.timeline);
  const captionCues = useMemo(
    () => captionCuesFromTimeline(storeTimeline ?? project.timeline),
    [storeTimeline, project.timeline],
  );
  const hasCaptions = captionCues.length > 0;
  const narrationByScene = useMemo(
    () =>
      new Map(
        (storyboard?.narration?.segments ?? []).map((segment) => [
          segment.sceneId,
          segment,
        ]),
      ),
    [storyboard?.narration?.segments],
  );
  const entries = useMemo<TranscriptEntry[]>(
    () =>
      (storyboard?.scenes ?? []).map((scene) => ({
        scene,
        narration: narrationByScene.get(scene.id),
      })),
    [narrationByScene, storyboard?.scenes],
  );
  const setPlayheadMs = useTimelineUiStore((state) => state.setPlayheadMs);
  const sceneStartByIdMs = useMemo(() => {
    const out = new Map<string, number>();
    let acc = 0;
    for (const scene of storyboard?.scenes ?? []) {
      out.set(scene.id, acc);
      acc += Math.max(0, scene.durationMs);
    }
    return out;
  }, [storyboard?.scenes]);
  const timingContextBySceneId = useMemo(
    () =>
      buildTranscriptTimingContexts({
        project,
        sceneStartByIdMs,
      }),
    [project, sceneStartByIdMs],
  );
  const seekToScene = useCallback(
    (sceneId: string) => {
      const startMs = sceneStartByIdMs.get(sceneId) ?? 0;
      setPlayheadMs(startMs);
      onSelectScene?.(sceneId);
    },
    [onSelectScene, sceneStartByIdMs, setPlayheadMs],
  );
  const updateTranscriptSelection = useCallback(
    (entry: TranscriptEntry, textarea: HTMLTextAreaElement) => {
      if (!onTranscriptSelectionChange) return;
      const context = timingContextBySceneId.get(entry.scene.id) ?? {
        sceneId: entry.scene.id,
        sceneStartMs: sceneStartByIdMs.get(entry.scene.id) ?? 0,
        sceneDurationMs: Math.max(1, entry.scene.durationMs),
      };
      const selection = resolveTranscriptSelection(
        context,
        textarea.value,
        textarea.selectionStart,
        textarea.selectionEnd,
      );
      onTranscriptSelectionChange(selection);
    },
    [onTranscriptSelectionChange, sceneStartByIdMs, timingContextBySceneId],
  );
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    buildDrafts(entries),
  );
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  const storyboardRef = useRef(storyboard);
  storyboardRef.current = storyboard;
  const debounceTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );
  const articleRefs = useRef<Map<string, HTMLElement>>(new Map());

  useEffect(() => {
    setDrafts(buildDrafts(entries));
  }, [entries]);

  const commitSceneText = useCallback(
    async (sceneId: string) => {
      const timer = debounceTimersRef.current.get(sceneId);
      if (timer) {
        clearTimeout(timer);
        debounceTimersRef.current.delete(sceneId);
      }
      const currentStoryboard = storyboardRef.current;
      if (!currentStoryboard) return;
      const scene = currentStoryboard.scenes.find(
        (candidate) => candidate.id === sceneId,
      );
      if (!scene) return;
      const text = draftsRef.current[sceneId] ?? '';
      const narration = currentStoryboard.narration?.segments.find(
        (segment) => segment.sceneId === sceneId,
      );
      if (
        scene.caption?.text === text &&
        (!narration || narration.text === text)
      ) {
        return;
      }

      let nextStoryboard: VideoStoryboard = {
        ...currentStoryboard,
        scenes: currentStoryboard.scenes.map((candidate) =>
          candidate.id === sceneId
            ? {
                ...candidate,
                caption: { ...(candidate.caption ?? {}), text },
              }
            : candidate,
        ),
      };
      if (currentStoryboard.narration) {
        nextStoryboard = {
          ...nextStoryboard,
          narration: {
            ...currentStoryboard.narration,
            segments: currentStoryboard.narration.segments.map((segment) =>
              segment.sceneId === sceneId ? { ...segment, text } : segment,
            ),
          },
        };
      }

      await actions.updateStoryboard(nextStoryboard);
    },
    [actions],
  );

  const updateDraft = useCallback(
    (sceneId: string, text: string) => {
      setDrafts((prev) => ({ ...prev, [sceneId]: text }));
      const existing = debounceTimersRef.current.get(sceneId);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        debounceTimersRef.current.delete(sceneId);
        void commitSceneText(sceneId);
      }, LIVE_COMMIT_DEBOUNCE_MS);
      debounceTimersRef.current.set(sceneId, timer);
    },
    [commitSceneText],
  );

  useEffect(() => {
    const timers = debounceTimersRef.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  useEffect(() => {
    if (!selectedSceneId) return;
    const node = articleRefs.current.get(selectedSceneId);
    if (!node) return;
    node.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [selectedSceneId]);

  return (
    <section
      className={cn(
        'border-border bg-background flex min-h-0 flex-col rounded-md border',
        className,
      )}
      aria-label={t.video.editor.transcript.title}
    >
      <div className="border-border flex items-start gap-2 border-b px-3 py-2">
        <FileText className="text-muted-foreground mt-0.5 size-4 shrink-0" />
        <div>
          <h3 className="text-foreground text-sm font-semibold">
            {t.video.editor.transcript.title}
          </h3>
          <p className="text-muted-foreground text-xs">
            {hasCaptions
              ? t.video.editor.transcript.captionsDescription
              : t.video.editor.transcript.description}
          </p>
        </div>
      </div>
      {hasCaptions ? (
        <CaptionTranscriptView cues={captionCues} />
      ) : entries.length === 0 ? (
        <div className="text-muted-foreground flex min-h-40 items-center justify-center p-4 text-center text-xs">
          {t.video.editor.transcript.empty}
        </div>
      ) : (
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
          {entries.map((entry, index) => {
            const selected = selectedSceneId === entry.scene.id;
            const timingContext = timingContextBySceneId.get(entry.scene.id);
            return (
              <article
                key={entry.scene.id}
                ref={(node) => {
                  if (node) articleRefs.current.set(entry.scene.id, node);
                  else articleRefs.current.delete(entry.scene.id);
                }}
                className={
                  selected
                    ? 'border-primary bg-primary/5 rounded-md border p-2'
                    : 'border-border bg-muted/20 rounded-md border p-2'
                }
              >
                <button
                  type="button"
                  className="hover:text-foreground text-muted-foreground flex w-full items-center text-left text-[11px] font-medium"
                  onClick={() => seekToScene(entry.scene.id)}
                  aria-current={selected ? 'true' : undefined}
                >
                  {t.video.storyboard.sceneLabel.replace(
                    '{index}',
                    String(index + 1),
                  )}
                </button>
                <div className="text-muted-foreground mt-0.5 text-[10px]">
                  {hasWordAnchors(timingContext)
                    ? t.video.editor.transcript.wordAnchored
                    : t.video.editor.transcript.timingEstimated}
                </div>
                <label className="mt-1.5 block">
                  <span className="sr-only">
                    {t.video.editor.transcript.textLabel}
                  </span>
                  <textarea
                    rows={1}
                    value={drafts[entry.scene.id] ?? ''}
                    onFocus={() => seekToScene(entry.scene.id)}
                    onSelect={(event) =>
                      updateTranscriptSelection(entry, event.currentTarget)
                    }
                    onKeyUp={(event) =>
                      updateTranscriptSelection(entry, event.currentTarget)
                    }
                    onMouseUp={(event) =>
                      updateTranscriptSelection(entry, event.currentTarget)
                    }
                    onChange={(event) => {
                      updateDraft(entry.scene.id, event.target.value);
                      updateTranscriptSelection(entry, event.currentTarget);
                    }}
                    onBlur={() => void commitSceneText(entry.scene.id)}
                    className="border-input bg-background text-foreground field-sizing-content max-h-48 w-full resize-none overflow-y-auto rounded-md border px-2 py-1.5 text-xs leading-5"
                  />
                </label>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
