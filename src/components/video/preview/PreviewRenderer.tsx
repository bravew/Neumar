import { forwardRef, useEffect, useState } from 'react';

import type { VideoAspectRatio, VideoProject } from '@/shared/types/video';
import { useWebCodecsCapabilities } from '@/shared/video/useWebCodecsCapabilities';

import type {
  TimelinePlaybackState,
  TimelinePlayheadUpdateSource,
} from '../timeline/useTimelineUiStore';
import { LazyRemotionPreview } from './LazyRemotionPreview';
import type { PreviewPlaybackRate } from './previewPlaybackRate';
import type { RemotionPreviewHandle } from './RemotionPreview';
import { WebCodecsPreview } from './WebCodecsPreview';

interface PreviewRendererProps {
  project: VideoProject;
  aspectRatio: VideoAspectRatio;
  playbackRate: PreviewPlaybackRate;
  playheadMs?: number;
  playheadUpdateSource?: TimelinePlayheadUpdateSource;
  onPlayheadChange?: (ms: number) => void;
  onPlaybackStateChange?: (state: TimelinePlaybackState) => void;
}

export const PreviewRenderer = forwardRef<
  RemotionPreviewHandle,
  PreviewRendererProps
>(function PreviewRenderer(
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
  const caps = useWebCodecsCapabilities();
  const [webCodecsFailure, setWebCodecsFailure] = useState<string | null>(null);

  useEffect(() => {
    setWebCodecsFailure(null);
  }, [aspectRatio, project.id]);

  if (caps.supported && webCodecsFailure === null) {
    return (
      <WebCodecsPreview
        ref={ref}
        project={project}
        aspectRatio={aspectRatio}
        playbackRate={playbackRate}
        playheadMs={playheadMs}
        playheadUpdateSource={playheadUpdateSource}
        onPlayheadChange={onPlayheadChange}
        onPlaybackStateChange={onPlaybackStateChange}
        onUnsupported={setWebCodecsFailure}
      />
    );
  }

  return (
    <LazyRemotionPreview
      ref={ref}
      project={project}
      aspectRatio={aspectRatio}
      playbackRate={playbackRate}
      playheadMs={playheadMs}
      playheadUpdateSource={playheadUpdateSource}
      onPlayheadChange={onPlayheadChange}
      onPlaybackStateChange={onPlaybackStateChange}
    />
  );
});
