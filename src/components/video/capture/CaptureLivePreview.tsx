import { useEffect, useRef } from 'react';

import { Camera, MonitorDot } from 'lucide-react';

import { useLanguage } from '@/shared/providers/language-provider';

type RecorderState = 'idle' | 'recording' | 'paused' | 'saving';

interface CaptureLivePreviewProps {
  stream: MediaStream | null;
  state: RecorderState;
  nativeActive: boolean;
}

export function CaptureLivePreview({
  stream,
  state,
  nativeActive,
}: CaptureLivePreviewProps) {
  const { t } = useLanguage();
  const labels = t.video.editor.capture.livePreview;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const active = state === 'recording' || state === 'paused';

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
    return () => {
      video.srcObject = null;
    };
  }, [stream]);

  const statusLabel =
    state === 'paused'
      ? labels.paused
      : state === 'saving'
        ? labels.saving
        : active
          ? labels.recording
          : labels.idle;

  return (
    <section className="border-border overflow-hidden rounded-md border">
      <div className="border-border bg-muted/40 flex items-center justify-between border-b px-3 py-2">
        <div className="text-foreground flex items-center gap-2 text-xs font-medium">
          {stream ? (
            <Camera className="size-3.5" />
          ) : (
            <MonitorDot className="size-3.5" />
          )}
          {labels.title}
        </div>
        <span className="text-muted-foreground text-xs">{statusLabel}</span>
      </div>
      {stream ? (
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          aria-label={labels.videoLabel}
          className="bg-muted aspect-video w-full object-cover"
        />
      ) : (
        <div className="bg-muted text-muted-foreground flex aspect-video items-center justify-center px-4 text-center text-sm">
          {nativeActive ? labels.nativeActive : labels.waiting}
        </div>
      )}
    </section>
  );
}
