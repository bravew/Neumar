import { useRef } from 'react';

import { ExternalLink, Video } from 'lucide-react';

import { AILoadingIndicator } from '@/components/ui/AILoadingIndicator';
import { usePreviewUrl } from '@/shared/hooks/usePreviewUrl';

import type { PreviewComponentProps } from './types';
import { openFileExternal } from './utils';

export function VideoPreview({ artifact }: PreviewComponentProps) {
  const {
    url: videoUrl,
    loading,
    error,
  } = usePreviewUrl({ path: artifact.path, content: artifact.content });
  const videoRef = useRef<HTMLVideoElement>(null);

  const handleOpenExternal = () => {
    if (artifact.path) {
      openFileExternal(artifact.path);
    }
  };

  if (loading) {
    return (
      <div className="bg-muted/20 flex h-full flex-col items-center justify-center p-8">
        <div className="relative mb-4">
          <div className="bg-primary/10 flex size-20 items-center justify-center rounded-2xl">
            <Video className="text-primary size-10" />
          </div>
        </div>
        <h3 className="text-foreground mb-2 max-w-md truncate text-center text-lg font-semibold">
          {artifact.name.replace(/\.[^/.]+$/, '')}
        </h3>
        <div className="text-muted-foreground mt-4 flex items-center gap-2">
          <AILoadingIndicator size="sm" />
          <span className="text-sm">Loading video...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-muted/20 flex h-full flex-col items-center justify-center p-8">
        <div className="flex max-w-md flex-col items-center text-center">
          <div className="mb-4 flex size-20 items-center justify-center rounded-full bg-red-500/10">
            <Video className="size-10 text-red-500" />
          </div>
          <h3 className="text-foreground mb-2 text-lg font-medium">
            {artifact.name}
          </h3>
          <p className="text-muted-foreground mb-4 text-sm break-all whitespace-pre-wrap">
            {error}
          </p>
          <button
            onClick={handleOpenExternal}
            className="bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors"
          >
            <ExternalLink className="size-4" />
            Open in Video Player
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-muted/30 flex h-full flex-col items-center justify-center p-4">
      <div className="w-full max-w-4xl">
        <video
          ref={videoRef}
          src={videoUrl || undefined}
          controls
          className="h-auto max-h-[70vh] w-full rounded-lg bg-black shadow-xl"
          preload="metadata"
        >
          Your browser does not support the video tag.
        </video>
        <div className="text-muted-foreground mt-3 text-center text-sm">
          {artifact.name}
        </div>
      </div>
    </div>
  );
}
