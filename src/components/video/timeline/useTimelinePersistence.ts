import { useEffect, useRef } from 'react';

import { toast } from 'sonner';

import { useLanguage } from '@/shared/providers/language-provider';
import type { VideoProject, VideoTimeline } from '@/shared/types/video';

import { useTimelineEditorStore } from './useTimelineEditorStore';

const TIMELINE_SAVE_DEBOUNCE_MS = 300;
const TIMELINE_SAVE_RETRY_DELAYS_MS = [1000, 2500, 5000] as const;

interface TimelinePersistenceOptions {
  projectId: string;
  onTimelineChange?: (timeline: VideoTimeline) => Promise<VideoProject | null>;
}

interface PendingTimelineSave {
  projectId: string;
  revision: number;
  timeline: VideoTimeline;
  save: (timeline: VideoTimeline) => Promise<VideoProject | null>;
  retryCount: number;
}

interface TimelinePersistenceQueueOptions {
  markPersisted: (projectId: string, revision: number) => void;
  reportValidationError: (error: unknown) => void;
}

interface TimelinePersistenceQueue {
  flush: () => Promise<void>;
  queue: (save: Omit<PendingTimelineSave, 'retryCount'>) => void;
}

export function useTimelinePersistence({
  projectId,
  onTimelineChange,
}: TimelinePersistenceOptions) {
  const { t } = useLanguage();
  const saveFailedLabel =
    t.video.editor.timeline.saveFailed ??
    'Timeline changes could not be saved.';
  const storeProjectId = useTimelineEditorStore((state) => state.projectId);
  const storeTimeline = useTimelineEditorStore((state) => state.timeline);
  const revision = useTimelineEditorStore((state) => state.revision);
  const persistedRevision = useTimelineEditorStore(
    (state) => state.persistedRevision,
  );
  const markPersisted = useTimelineEditorStore((state) => state.markPersisted);
  const markPersistedRef = useRef(markPersisted);
  const saveFailedLabelRef = useRef(saveFailedLabel);
  const queueRef = useRef<TimelinePersistenceQueue | null>(null);

  markPersistedRef.current = markPersisted;
  saveFailedLabelRef.current = saveFailedLabel;

  if (!queueRef.current) {
    queueRef.current = createTimelinePersistenceQueue({
      markPersisted: (savedProjectId, savedRevision) => {
        markPersistedRef.current(savedProjectId, savedRevision);
      },
      reportValidationError: () => {
        toast.error(saveFailedLabelRef.current);
      },
    });
  }

  useEffect(() => {
    if (!onTimelineChange || storeProjectId !== projectId || !storeTimeline) {
      return;
    }
    if (revision <= persistedRevision) return;
    queueRef.current?.queue({
      projectId,
      revision,
      timeline: storeTimeline,
      save: onTimelineChange,
    });
  }, [
    onTimelineChange,
    persistedRevision,
    projectId,
    revision,
    storeProjectId,
    storeTimeline,
  ]);

  useEffect(() => {
    const flushPendingTimeline = () => {
      void queueRef.current?.flush();
    };
    window.addEventListener('pagehide', flushPendingTimeline);
    window.addEventListener('beforeunload', flushPendingTimeline);
    return () => {
      window.removeEventListener('pagehide', flushPendingTimeline);
      window.removeEventListener('beforeunload', flushPendingTimeline);
      flushPendingTimeline();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    void import('@tauri-apps/api/window')
      .then(({ getCurrentWindow }) => {
        const currentWindow = getCurrentWindow() as ReturnType<
          typeof getCurrentWindow
        > & {
          onCloseRequested?: (
            handler: () => void | Promise<void>,
          ) => Promise<() => void>;
        };
        if (typeof currentWindow.onCloseRequested !== 'function') return;
        return currentWindow.onCloseRequested(() => {
          void queueRef.current?.flush();
        });
      })
      .then((nextUnlisten) => {
        if (!nextUnlisten) return;
        if (cancelled) {
          nextUnlisten();
          return;
        }
        unlisten = nextUnlisten;
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
}

function createTimelinePersistenceQueue({
  markPersisted,
  reportValidationError,
}: TimelinePersistenceQueueOptions): TimelinePersistenceQueue {
  let pending: PendingTimelineSave | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null;
  let latestRevision = 0;

  const clearDebounceTimer = () => {
    if (!debounceTimer) return;
    clearTimeout(debounceTimer);
    debounceTimer = null;
  };

  const clearRetryTimer = () => {
    if (!retryTimer) return;
    clearTimeout(retryTimer);
    retryTimer = null;
  };

  const schedule = (delayMs: number) => {
    if (inFlight) return;
    clearDebounceTimer();
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void drain();
    }, delayMs);
  };

  const scheduleRetry = (retryCount: number) => {
    clearRetryTimer();
    const delayMs =
      TIMELINE_SAVE_RETRY_DELAYS_MS[
        Math.min(retryCount - 1, TIMELINE_SAVE_RETRY_DELAYS_MS.length - 1)
      ];
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void drain();
    }, delayMs);
  };

  const drain = async (): Promise<void> => {
    if (inFlight) return inFlight;
    clearDebounceTimer();
    const save = pending;
    if (!save) return;
    pending = null;

    inFlight = save
      .save(save.timeline)
      .then(() => {
        markPersisted(save.projectId, save.revision);
      })
      .catch((error) => {
        if (isValidationTimelinePersistenceError(error)) {
          reportValidationError(error);
          return;
        }

        const retryCount = save.retryCount + 1;
        const newerPending = pending?.revision ?? 0;
        pending =
          newerPending > save.revision && pending
            ? { ...pending, retryCount }
            : { ...save, retryCount };
        scheduleRetry(retryCount);
      })
      .finally(() => {
        inFlight = null;
        if (pending && !retryTimer) schedule(0);
      });

    return inFlight;
  };

  const flush = async (): Promise<void> => {
    clearDebounceTimer();
    clearRetryTimer();
    if (inFlight) await inFlight;
    if (pending) await drain();
    if (inFlight) await inFlight;
  };

  return {
    flush,
    queue: (save) => {
      latestRevision = Math.max(latestRevision, save.revision);
      pending = {
        ...save,
        retryCount: pending?.retryCount ?? 0,
      };
      if (save.revision < latestRevision) return;
      if (!retryTimer) schedule(TIMELINE_SAVE_DEBOUNCE_MS);
    },
  };
}

function isValidationTimelinePersistenceError(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status !== 'number') return false;
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}
