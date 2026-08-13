import { X } from 'lucide-react';

import type {
  NativeCaptureComposition,
  NativeCaptureDevices,
} from '@/shared/lib/video-capture';
import { useLanguage } from '@/shared/providers/language-provider';

import { CaptureDevicePanel } from './CaptureDevicePanel';
import { CaptureLivePreview } from './CaptureLivePreview';
import { CaptureRecorderFooter } from './CaptureRecorderFooter';
import { CaptureReview } from './CaptureReview';
import { CaptureTeleprompterPanel } from './CaptureTeleprompterPanel';

type RecorderState = 'idle' | 'recording' | 'paused' | 'saving';

interface CaptureRecorderModalProps {
  state: RecorderState;
  elapsedMs: number;
  supported: boolean;
  hasNativeWorkspace: boolean;
  liveStream: MediaStream | null;
  nativeCaptureActive: boolean;
  nativeDevices: NativeCaptureDevices | null;
  nativeDevicesLoading: boolean;
  nativeComposition: NativeCaptureComposition;
  nativeCameraDevice: string;
  nativeScreenDevice: string;
  nativeMicDevice: string;
  promptText: string;
  wpm: number;
  mirror: boolean;
  fontSize: number;
  opacity: number;
  teleprompterOpen: boolean;
  error: string | null;
  review: {
    url: string;
    insertedClipId?: string;
    markers: Array<{ sceneId: string; confidence: number; startMs: number }>;
  } | null;
  canReplaceReview: boolean;
  onClose: () => void;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onWpmChange: (value: number) => void;
  onMirrorChange: (value: boolean) => void;
  onFontSizeChange: (value: number) => void;
  onOpacityChange: (value: number) => void;
  onNativeCompositionChange: (value: NativeCaptureComposition) => void;
  onNativeCameraDeviceChange: (value: string) => void;
  onNativeScreenDeviceChange: (value: string) => void;
  onNativeMicDeviceChange: (value: string) => void;
  onOpenTeleprompter: () => void;
  onCloseTeleprompter: () => void;
  onInsertReview: () => void;
  onReplaceReview: () => void;
  onDiscardReview: () => void;
}

export function CaptureRecorderModal({
  state,
  elapsedMs,
  supported,
  hasNativeWorkspace,
  liveStream,
  nativeCaptureActive,
  nativeDevices,
  nativeDevicesLoading,
  nativeComposition,
  nativeCameraDevice,
  nativeScreenDevice,
  nativeMicDevice,
  promptText,
  wpm,
  mirror,
  fontSize,
  opacity,
  teleprompterOpen,
  error,
  review,
  canReplaceReview,
  onClose,
  onStart,
  onPause,
  onResume,
  onStop,
  onWpmChange,
  onMirrorChange,
  onFontSizeChange,
  onOpacityChange,
  onNativeCompositionChange,
  onNativeCameraDeviceChange,
  onNativeScreenDeviceChange,
  onNativeMicDeviceChange,
  onOpenTeleprompter,
  onCloseTeleprompter,
  onInsertReview,
  onReplaceReview,
  onDiscardReview,
}: CaptureRecorderModalProps) {
  const { t } = useLanguage();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="border-border bg-background flex max-h-[90vh] w-full max-w-3xl flex-col rounded-md border shadow-xl">
        <header className="border-border flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-foreground text-sm font-semibold">
            {t.video.editor.capture.modal.title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="hover:bg-accent rounded-md p-1.5"
            aria-label={t.video.editor.capture.modal.cancel}
          >
            <X className="size-4" />
          </button>
        </header>
        <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
          {!supported && !hasNativeWorkspace ? (
            <p className="text-muted-foreground text-sm">
              {t.video.editor.capture.unsupported}
            </p>
          ) : null}
          <CaptureLivePreview
            stream={liveStream}
            state={state}
            nativeActive={nativeCaptureActive}
          />
          <CaptureDevicePanel
            devices={nativeDevices}
            loading={nativeDevicesLoading}
            browserSupported={supported}
            hasNativeWorkspace={hasNativeWorkspace}
            composition={nativeComposition}
            cameraDevice={nativeCameraDevice}
            screenDevice={nativeScreenDevice}
            micDevice={nativeMicDevice}
            onCompositionChange={onNativeCompositionChange}
            onCameraDeviceChange={onNativeCameraDeviceChange}
            onScreenDeviceChange={onNativeScreenDeviceChange}
            onMicDeviceChange={onNativeMicDeviceChange}
          />
          <CaptureTeleprompterPanel
            promptText={promptText}
            wpm={wpm}
            mirror={mirror}
            fontSize={fontSize}
            opacity={opacity}
            teleprompterOpen={teleprompterOpen}
            onWpmChange={onWpmChange}
            onMirrorChange={onMirrorChange}
            onFontSizeChange={onFontSizeChange}
            onOpacityChange={onOpacityChange}
            onOpenTeleprompter={onOpenTeleprompter}
            onCloseTeleprompter={onCloseTeleprompter}
          />
          {error ? <p className="text-destructive text-xs">{error}</p> : null}
          {review ? (
            <CaptureReview
              review={review}
              canReplace={canReplaceReview}
              onInsert={onInsertReview}
              onReplace={onReplaceReview}
              onDiscard={onDiscardReview}
            />
          ) : null}
        </div>
        <CaptureRecorderFooter
          state={state}
          elapsedMs={elapsedMs}
          onStart={onStart}
          onPause={onPause}
          onResume={onResume}
          onStop={onStop}
        />
      </div>
    </div>
  );
}
