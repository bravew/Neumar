import { useMemo, useRef, useState } from 'react';

import { Loader2 } from 'lucide-react';

import { VideoApiError } from '@/shared/hooks/useVideoProject';
import { useLanguage } from '@/shared/providers/language-provider';
import type { VideoProject } from '@/shared/types/video';

import type { VideoProjectEditorActions } from '../editorTypes';
import { resolveClipAsset } from '../timeline/timelineMedia';
import { useTimelineEditorStore } from '../timeline/useTimelineEditorStore';
import { LocalTranscriptModelSetup } from './LocalTranscriptModelSetup';

/** Timeline assets without a word transcript, including attached linked media. */
export function getTranscribableAssets(project: VideoProject) {
  const transcribedIds = new Set(
    (project.sources ?? [])
      .filter((source) =>
        project.sourceAnalyses?.some(
          (analysis) =>
            analysis.sourceId === source.id &&
            Boolean(analysis.transcript?.words.length),
        ),
      )
      .map((source) => source.mediaItemId),
  );
  const assets = new Map<string, VideoProject['assets'][number]>();
  for (const track of project.timeline?.tracks ?? []) {
    for (const clip of track.clips) {
      if (clip.kind !== 'video' && clip.kind !== 'audio') continue;
      const linkedSourceId =
        clip.sourceRef.kind === 'linked' ? clip.sourceRef.sourceId : null;
      const linkedMediaItemId = project.sources?.find(
        (source) => source.id === linkedSourceId,
      )?.mediaItemId;
      const asset =
        resolveClipAsset(project, clip) ??
        (linkedMediaItemId
          ? project.assets.find((item) => item.id === linkedMediaItemId)
          : undefined);
      // Unknown audioTrackCount stays eligible: a false "no audio" guess would
      // hide a transcribable asset, while a false "has audio" is rejected with
      // an actionable backend error.
      if (
        !asset ||
        asset.kind === 'image' ||
        transcribedIds.has(asset.id) ||
        asset.metadata.audioTrackCount === 0
      )
        continue;
      assets.set(asset.id, asset);
    }
  }
  return [...assets.values()];
}

export function SourceTranscriptionAction({
  project,
  onTranscribe,
}: {
  project: VideoProject;
  onTranscribe: VideoProjectEditorActions['transcribeAsset'];
}) {
  const { t } = useLanguage();
  const labels = t.video.editor.transcript;
  const liveTimeline = useTimelineEditorStore((state) =>
    state.projectId === project.id ? state.timeline : null,
  );
  const assets = useMemo(
    () =>
      getTranscribableAssets({
        ...project,
        timeline: liveTimeline ?? project.timeline,
      }),
    [project, liveTimeline],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{
    message: string;
    needsModel: boolean;
  } | null>(null);
  const inFlight = useRef(false);
  const assetId = assets.some((asset) => asset.id === selectedId)
    ? selectedId
    : assets[0]?.id;

  const transcribe = async () => {
    if (!assetId || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setFailure(null);
    try {
      const updated = await onTranscribe(assetId);
      if (!updated) throw new Error(labels.transcribeFailed);
    } catch (error) {
      setFailure({
        message:
          error instanceof Error ? error.message : labels.transcribeFailed,
        needsModel:
          error instanceof VideoApiError &&
          error.data.code === 'local-model-not-ready',
      });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="border-border space-y-2 border-b p-3">
      <p className="text-muted-foreground text-xs">
        {labels.localTranscription}
      </p>
      {assets.length > 0 && (
        <label className="text-muted-foreground flex flex-col gap-1 text-xs">
          {labels.transcribeAssetLabel}
          <select
            aria-label={labels.transcribeAssetLabel}
            value={assetId ?? ''}
            disabled={busy}
            onChange={(event) => setSelectedId(event.target.value)}
            className="border-border bg-background text-foreground min-w-0 rounded border px-2 py-1.5"
          >
            {assets.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.provenance?.sourceDisplayName ??
                  asset.path.split(/[\\/]/).pop() ??
                  asset.id}
              </option>
            ))}
          </select>
        </label>
      )}
      <button
        type="button"
        disabled={busy || !assetId}
        onClick={() => void transcribe()}
        className="bg-primary text-primary-foreground flex items-center gap-1.5 rounded px-3 py-1.5 text-xs disabled:opacity-50"
      >
        {busy && <Loader2 className="size-3 animate-spin" aria-hidden="true" />}
        {busy ? labels.transcribing : labels.transcribeAction}
      </button>
      {busy && (
        <p role="status" className="text-muted-foreground text-xs">
          {labels.transcriptionProgress}
        </p>
      )}
      {!assetId && (
        <p className="text-muted-foreground text-xs">
          {labels.noTranscribableAssets}
        </p>
      )}
      {failure && (
        <div role="alert" className="text-destructive space-y-1 text-xs">
          <p>{failure.message}</p>
          {failure.needsModel && <LocalTranscriptModelSetup />}
        </div>
      )}
    </div>
  );
}
