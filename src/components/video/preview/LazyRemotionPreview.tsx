import { forwardRef, lazy, Suspense } from 'react';

import type { VideoAspectRatio, VideoProject } from '@/shared/types/video';

import type {
  TimelinePlaybackState,
  TimelinePlayheadUpdateSource,
} from '../timeline/useTimelineUiStore';
import type { PreviewPlaybackRate } from './previewPlaybackRate';
import type { RemotionPreviewHandle } from './RemotionPreview';

interface LazyRemotionPreviewProps {
  project: VideoProject;
  aspectRatio: VideoAspectRatio;
  playbackRate: PreviewPlaybackRate;
  playheadMs?: number;
  playheadUpdateSource?: TimelinePlayheadUpdateSource;
  onPlayheadChange?: (ms: number) => void;
  onPlaybackStateChange?: (state: TimelinePlaybackState) => void;
}

const RemotionPreview = lazy(() =>
  import('./RemotionPreview').then((module) => ({
    default: module.RemotionPreview,
  })),
);

export const LazyRemotionPreview = forwardRef<
  RemotionPreviewHandle,
  LazyRemotionPreviewProps
>(function LazyRemotionPreview(
  {
    project,
    aspectRatio,
    playbackRate,
    playheadMs,
    playheadUpdateSource,
    onPlayheadChange,
    onPlaybackStateChange,
  },
  ref,
) {
  return (
    <Suspense
      fallback={
        <div
          className="size-full bg-black"
          aria-busy="true"
          aria-live="polite"
        />
      }
    >
      <RemotionPreview
        ref={ref}
        project={project}
        aspectRatio={aspectRatio}
        playbackRate={playbackRate}
        playheadMs={playheadMs}
        playheadUpdateSource={playheadUpdateSource}
        onPlayheadChange={onPlayheadChange}
        onPlaybackStateChange={onPlaybackStateChange}
      />
    </Suspense>
  );
});
