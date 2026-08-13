import { useState } from 'react';

import { Video } from 'lucide-react';

import { useLanguage } from '@/shared/providers/language-provider';
import type { VideoProject } from '@/shared/types/video';

import type { VideoProjectEditorActions } from '../editorTypes';
import { CaptureRecorderModal } from './CaptureRecorderModal';
import { useCaptureRecorderController } from './useCaptureRecorderController';

interface CaptureRecorderProps {
  project: VideoProject;
  actions: VideoProjectEditorActions;
}

export function CaptureRecorder({ project, actions }: CaptureRecorderProps) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const recorder = useCaptureRecorderController({ project, actions });

  const close = () => {
    if (recorder.state === 'recording' || recorder.state === 'paused') {
      void recorder.stop();
    }
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="border-border hover:bg-accent inline-flex w-full items-center justify-center gap-2 rounded-md border px-3 py-2 text-xs"
      >
        <Video className="size-4" />
        {t.video.editor.capture.action}
      </button>
      {open ? (
        <CaptureRecorderModal
          state={recorder.state}
          elapsedMs={recorder.elapsedMs}
          supported={recorder.supported}
          hasNativeWorkspace={recorder.hasNativeWorkspace}
          liveStream={recorder.liveStream}
          nativeCaptureActive={recorder.nativeCaptureActive}
          nativeDevices={recorder.nativeDevices}
          nativeDevicesLoading={recorder.nativeDevicesLoading}
          nativeComposition={recorder.nativeComposition}
          nativeCameraDevice={recorder.nativeCameraDevice}
          nativeScreenDevice={recorder.nativeScreenDevice}
          nativeMicDevice={recorder.nativeMicDevice}
          promptText={recorder.promptText}
          wpm={recorder.wpm}
          mirror={recorder.mirror}
          fontSize={recorder.fontSize}
          opacity={recorder.opacity}
          teleprompterOpen={recorder.teleprompterOpen}
          error={recorder.error}
          review={recorder.review}
          canReplaceReview={recorder.canReplaceReview}
          onClose={close}
          onStart={() => void recorder.start()}
          onPause={() => void recorder.pause()}
          onResume={() => void recorder.resume()}
          onStop={() => void recorder.stop()}
          onWpmChange={recorder.setWpm}
          onMirrorChange={recorder.setMirror}
          onFontSizeChange={recorder.setFontSize}
          onOpacityChange={recorder.setOpacity}
          onNativeCompositionChange={recorder.setNativeComposition}
          onNativeCameraDeviceChange={recorder.setNativeCameraDevice}
          onNativeScreenDeviceChange={recorder.setNativeScreenDevice}
          onNativeMicDeviceChange={recorder.setNativeMicDevice}
          onOpenTeleprompter={() => void recorder.openPrompter()}
          onCloseTeleprompter={() => void recorder.closePrompter()}
          onInsertReview={() => void recorder.insertReviewAtPlayhead()}
          onReplaceReview={() => void recorder.replaceSelectedClipWithReview()}
          onDiscardReview={recorder.discardReview}
        />
      ) : null}
    </>
  );
}
