import { useEffect, useMemo, useRef, useState } from 'react';

import { useSettingsValue } from '@/shared/db/settings';
import {
  closeTeleprompterWindow,
  emitTeleprompterControl,
  emitTeleprompterState,
  openTeleprompterWindow,
  type TeleprompterStatePayload,
} from '@/shared/lib/teleprompter';
import {
  listNativeCaptureDevices,
  nativeCaptureFileUrl,
  pauseNativeCapture,
  resumeNativeCapture,
  startNativeCapture,
  stopNativeCapture,
  type NativeCaptureComposition,
  type NativeCaptureDevices,
  type NativeCaptureStartResult,
} from '@/shared/lib/video-capture';
import { useLanguage } from '@/shared/providers/language-provider';
import type {
  VideoMediaItem,
  VideoProject,
  VideoSourceMedia,
} from '@/shared/types/video';
import { randomUUID } from '@/shared/utils/uuid';

import type { VideoProjectEditorActions } from '../editorTypes';
import { useTimelineEditorStore } from '../timeline/useTimelineEditorStore';
import { useTimelineUiStore } from '../timeline/useTimelineUiStore';
import {
  bestMimeType,
  captureScript,
  currentPromptText,
  extension,
  selectNativeCapture,
  stopStream,
} from './captureUtils';

export type RecorderState = 'idle' | 'recording' | 'paused' | 'saving';

export interface CaptureReviewState {
  url: string;
  source: VideoSourceMedia;
  asset: VideoMediaItem;
  markers: Array<{ sceneId: string; confidence: number; startMs: number }>;
  insertedClipId?: string;
}

interface UseCaptureRecorderControllerInput {
  project: VideoProject;
  actions: VideoProjectEditorActions;
}

export function useCaptureRecorderController({
  project,
  actions,
}: UseCaptureRecorderControllerInput) {
  const { t } = useLanguage();
  const settings = useSettingsValue();
  const [state, setState] = useState<RecorderState>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [wpm, setWpm] = useState(150);
  const [mirror, setMirror] = useState(false);
  const [fontSize, setFontSize] = useState(32);
  const [opacity, setOpacity] = useState(90);
  const [teleprompterOpen, setTeleprompterOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<CaptureReviewState | null>(null);
  const [liveStream, setLiveStream] = useState<MediaStream | null>(null);
  const [nativeCaptureActive, setNativeCaptureActive] = useState(false);
  const [nativeDevices, setNativeDevices] =
    useState<NativeCaptureDevices | null>(null);
  const [nativeDevicesLoading, setNativeDevicesLoading] = useState(false);
  const [nativeComposition, setNativeComposition] =
    useState<NativeCaptureComposition>('screen+camera+mic');
  const [nativeCameraDevice, setNativeCameraDevice] = useState('');
  const [nativeScreenDevice, setNativeScreenDevice] = useState('');
  const [nativeMicDevice, setNativeMicDevice] = useState('');
  const selectedClipId = useTimelineEditorStore((timelineState) =>
    timelineState.projectId === project.id &&
    timelineState.selectedClipIds.size === 1
      ? timelineState.selectedClipId
      : null,
  );
  const selectedTrackId = useTimelineUiStore(
    (timelineState) => timelineState.selectedTrackId,
  );
  const recorderRef = useRef<MediaRecorder | null>(null);
  const nativeSessionRef = useRef<NativeCaptureStartResult | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const startedAtRef = useRef<number>(0);
  const elapsedMsRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const supported =
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof MediaRecorder !== 'undefined';
  const script = useMemo(() => captureScript(project), [project]);
  const promptText = useMemo(
    () => currentPromptText(script, elapsedMs, wpm),
    [elapsedMs, script, wpm],
  );
  const teleprompterBaseState = useMemo(
    () => ({ script, wpm, fontSize, mirror, opacity }),
    [fontSize, mirror, opacity, script, wpm],
  );
  elapsedMsRef.current = elapsedMs;

  useEffect(() => {
    return () => {
      stopTimer();
      stopStream(streamRef.current);
      if (review?.url) URL.revokeObjectURL(review.url);
    };
  }, [review?.url]);

  useEffect(() => {
    if (!teleprompterOpen) return;
    void emitTeleprompterState({
      ...teleprompterBaseState,
      running: state === 'recording',
      elapsedMs: elapsedMsRef.current,
    });
  }, [state, teleprompterBaseState, teleprompterOpen]);

  useEffect(() => {
    if (!settings.workDir) {
      setNativeDevices(null);
      return;
    }
    let cancelled = false;
    setNativeDevicesLoading(true);
    void listNativeCaptureDevices()
      .then((devices) => {
        if (cancelled) return;
        setNativeDevices(devices);
        const selection = selectNativeCapture(devices);
        if (!selection) return;
        setNativeComposition(selection.composition);
        setNativeCameraDevice(selection.cameraDevice ?? '');
        setNativeScreenDevice(selection.screenDevice ?? '');
        setNativeMicDevice(selection.micDevice ?? '');
      })
      .finally(() => {
        if (!cancelled) setNativeDevicesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [settings.workDir]);

  const start = async () => {
    if (settings.workDir) {
      const startedNative = await startNativeIfAvailable();
      if (startedNative) return;
    }
    if (!supported) {
      setError(t.video.editor.capture.unsupported);
      return;
    }
    setError(null);
    setReview(null);
    setNativeCaptureActive(false);
    chunksRef.current = [];
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      streamRef.current = stream;
      setLiveStream(stream);
      const mimeType = bestMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        void saveCapture(mimeType || recorder.mimeType || 'video/webm');
      };
      startedAtRef.current = Date.now();
      recorder.start(1000);
      setElapsedMs(0);
      setState('recording');
      startTimer();
      void sendTeleprompterState(true, 0);
      void emitTeleprompterControl({ type: 'start', elapsedMs: 0 });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      stopStream(streamRef.current);
      streamRef.current = null;
      setLiveStream(null);
      setState('idle');
    }
  };

  const pause = async () => {
    const nativeSession = nativeSessionRef.current;
    if (nativeSession) {
      try {
        await pauseNativeCapture(nativeSession.sessionId);
        stopTimer();
        setState('paused');
        void sendTeleprompterState(false, elapsedMs);
        void emitTeleprompterControl({ type: 'pause', elapsedMs });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
      return;
    }
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== 'recording') return;
    recorder.pause();
    stopTimer();
    setState('paused');
    void sendTeleprompterState(false, elapsedMs);
    void emitTeleprompterControl({ type: 'pause', elapsedMs });
  };

  const resume = async () => {
    const nativeSession = nativeSessionRef.current;
    if (nativeSession) {
      try {
        await resumeNativeCapture(nativeSession.sessionId);
        startedAtRef.current = Date.now() - elapsedMs;
        startTimer();
        setState('recording');
        void sendTeleprompterState(true, elapsedMs);
        void emitTeleprompterControl({ type: 'start', elapsedMs });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
      return;
    }
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== 'paused') return;
    recorder.resume();
    startedAtRef.current = Date.now() - elapsedMs;
    startTimer();
    setState('recording');
    void sendTeleprompterState(true, elapsedMs);
    void emitTeleprompterControl({ type: 'start', elapsedMs });
  };

  const stop = async () => {
    const nativeSession = nativeSessionRef.current;
    if (nativeSession) {
      setState('saving');
      stopTimer();
      void sendTeleprompterState(false, elapsedMs);
      void emitTeleprompterControl({ type: 'pause', elapsedMs });
      try {
        const stopped = await stopNativeCapture(nativeSession.sessionId);
        nativeSessionRef.current = null;
        await saveNativeCapture(stopped.outputPath);
      } catch (err) {
        nativeSessionRef.current = null;
        setError(err instanceof Error ? err.message : String(err));
        setState('idle');
      } finally {
        setNativeCaptureActive(false);
      }
      return;
    }
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;
    setState('saving');
    stopTimer();
    void sendTeleprompterState(false, elapsedMs);
    void emitTeleprompterControl({ type: 'pause', elapsedMs });
    recorder.stop();
    setLiveStream(null);
    stopStream(streamRef.current);
    streamRef.current = null;
  };

  const openPrompter = async () => {
    const payload = buildTeleprompterState(state === 'recording', elapsedMs);
    try {
      const opened = await openTeleprompterWindow(payload);
      if (!opened) {
        setError(t.video.editor.capture.teleprompter.windowUnavailable);
        return;
      }
      setTeleprompterOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const closePrompter = async () => {
    try {
      await closeTeleprompterWindow();
      setTeleprompterOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const insertReviewAtPlayhead = async () => {
    if (!review) return;
    await applyReviewToTimeline('insert');
  };

  const replaceSelectedClipWithReview = async () => {
    if (!review) return;
    if (!selectedClipId) {
      setError(t.video.editor.capture.takeReview.replaceUnavailable);
      return;
    }
    await applyReviewToTimeline('replace');
  };

  const discardReview = () => {
    if (review?.url) URL.revokeObjectURL(review.url);
    setReview(null);
  };

  return {
    state,
    elapsedMs,
    supported,
    hasNativeWorkspace: Boolean(settings.workDir),
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
    start,
    pause,
    resume,
    stop,
    setWpm,
    setMirror,
    setFontSize,
    setOpacity,
    setNativeComposition,
    setNativeCameraDevice,
    setNativeScreenDevice,
    setNativeMicDevice,
    openPrompter,
    closePrompter,
    canReplaceReview: Boolean(selectedClipId),
    insertReviewAtPlayhead,
    replaceSelectedClipWithReview,
    discardReview,
  };

  async function startNativeIfAvailable() {
    const devices = nativeDevices ?? (await listNativeCaptureDevices());
    if (!nativeDevices) setNativeDevices(devices);
    const selection = selectNativeCapture(devices, {
      composition: nativeComposition,
      cameraDevice: nativeCameraDevice || undefined,
      screenDevice: nativeScreenDevice || undefined,
      micDevice: nativeMicDevice || undefined,
    });
    if (!selection || !settings.workDir) return false;
    setError(null);
    setReview(null);
    setLiveStream(null);
    try {
      nativeSessionRef.current = await startNativeCapture({
        projectId: project.id,
        workspaceRoot: settings.workDir,
        fps: 30,
        resolution: { width: 1920, height: 1080 },
        teleprompter: { enabled: true, wpm, mirror },
        ...selection,
      });
      setNativeCaptureActive(true);
      startedAtRef.current = Date.now();
      setElapsedMs(0);
      setState('recording');
      startTimer();
      void sendTeleprompterState(true, 0);
      void emitTeleprompterControl({ type: 'start', elapsedMs: 0 });
      return true;
    } catch (err) {
      setNativeCaptureActive(false);
      setError(err instanceof Error ? err.message : String(err));
      setState('idle');
      return true;
    }
  }

  async function saveCapture(mimeType: string) {
    try {
      const blob = new Blob(chunksRef.current, { type: mimeType });
      const file = new File(
        [blob],
        `capture-${randomUUID()}.${extension(mimeType)}`,
        { type: mimeType },
      );
      const url = URL.createObjectURL(blob);
      const imported = await actions.importCaptureFiles([file]);
      const source = imported?.sources[0];
      const asset = imported?.assets[0];
      if (!source || !asset) throw new Error('Capture import failed');
      const aligned = source ? await actions.alignCapture(source.id) : null;
      setReview({
        url,
        source,
        asset,
        markers: reviewMarkers(aligned?.markers),
      });
      setState('idle');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState('idle');
    } finally {
      recorderRef.current = null;
      chunksRef.current = [];
    }
  }

  async function saveNativeCapture(outputPath: string) {
    const imported = await actions.importCapturePaths([outputPath]);
    const source = imported?.sources[0];
    const asset = imported?.assets[0];
    if (!source || !asset) throw new Error('Capture import failed');
    const aligned = source ? await actions.alignCapture(source.id) : null;
    setReview({
      url: await nativeCaptureFileUrl(outputPath),
      source,
      asset,
      markers: reviewMarkers(aligned?.markers),
    });
    setState('idle');
  }

  async function applyReviewToTimeline(mode: 'insert' | 'replace') {
    if (!review) return;
    setError(null);
    try {
      const execution = await actions.applyAgentTool({
        name: 'applyCaptureToTimeline',
        args: {
          captureId: review.source.id,
          targetTrackId: selectedTrackId ?? undefined,
          atMs: useTimelineUiStore.getState().playheadMs,
          replaceClipId: mode === 'replace' ? selectedClipId : undefined,
        },
      });
      const timeline = execution?.project.timeline;
      if (!timeline) return;
      const clipId = findCaptureTimelineClipId(timeline, review.source.id);
      useTimelineEditorStore
        .getState()
        .setProjectTimeline(project.id, timeline);
      if (clipId) useTimelineEditorStore.getState().selectClip(clipId);
      setReview((current) =>
        current && clipId ? { ...current, insertedClipId: clipId } : current,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function buildTeleprompterState(
    running: boolean,
    currentElapsedMs: number,
  ): TeleprompterStatePayload {
    return {
      ...teleprompterBaseState,
      running,
      elapsedMs: currentElapsedMs,
    };
  }

  async function sendTeleprompterState(
    running: boolean,
    currentElapsedMs: number,
  ) {
    if (!teleprompterOpen) return;
    await emitTeleprompterState(
      buildTeleprompterState(running, currentElapsedMs),
    );
  }

  function startTimer() {
    stopTimer();
    timerRef.current = setInterval(() => {
      setElapsedMs(Date.now() - startedAtRef.current);
    }, 250);
  }

  function stopTimer() {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  }
}

function reviewMarkers(
  markers:
    | Array<{ sceneId: string; confidence: number; startMs: number }>
    | undefined,
): CaptureReviewState['markers'] {
  return (
    markers?.map((marker) => ({
      sceneId: marker.sceneId,
      confidence: marker.confidence,
      startMs: marker.startMs,
    })) ?? []
  );
}

function findCaptureTimelineClipId(
  timeline: NonNullable<VideoProject['timeline']>,
  captureId: string,
): string | null {
  let clipId: string | null = null;
  for (const track of timeline.tracks) {
    for (const clip of track.clips) {
      if (clip.params?.captureId === captureId) clipId = clip.id;
    }
  }
  return clipId;
}
