import { useEffect, useRef, useState } from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { API_BASE_URL } from '@/config';
import { toDisplayPath } from '@/shared/lib/toDisplayPath';
import { useLanguage } from '@/shared/providers/language-provider';

interface RewindResult {
  canRewind: boolean;
  error?: string;
  filesChanged?: string[];
  skippedLinks?: number;
}

interface Preview {
  stage: 'loading' | 'ready' | 'applying' | 'done' | 'error';
  filesChanged: string[];
  error?: string;
  skippedLinks?: number;
}

async function rewindRequest(
  taskId: string,
  userMessageId: string,
  dryRun: boolean,
  signal?: AbortSignal,
): Promise<RewindResult> {
  const response = await fetch(`${API_BASE_URL}/agent/rewind`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId, userMessageId, dryRun }),
    signal,
  });
  const result = (await response.json()) as RewindResult;
  if (!response.ok || !result.canRewind) {
    throw new Error(
      `${response.status}: ${result.error || response.statusText}`,
    );
  }
  return result;
}

export function RewindPreviewDialog({
  taskId,
  userMessageId,
  sessionRoot,
  onClose,
  onRewindComplete,
}: {
  taskId: string;
  userMessageId: string;
  sessionRoot?: string;
  onClose: () => void;
  onRewindComplete?: () => void;
}) {
  const { t, tt } = useLanguage();
  const [preview, setPreview] = useState<Preview>({
    stage: 'loading',
    filesChanged: [],
  });
  const requestRef = useRef(0);
  const rewindError = t.task.rewindError;

  useEffect(() => {
    const controller = new AbortController();
    const request = ++requestRef.current;
    void rewindRequest(taskId, userMessageId, true, controller.signal)
      .then((result) => {
        if (request !== requestRef.current || controller.signal.aborted) return;
        setPreview({ stage: 'ready', filesChanged: result.filesChanged ?? [] });
      })
      .catch((error) => {
        if (request !== requestRef.current || controller.signal.aborted) return;
        setPreview({
          stage: 'error',
          filesChanged: [],
          error: error instanceof Error ? error.message : rewindError,
        });
      });
    return () => {
      requestRef.current += 1;
      controller.abort();
    };
  }, [taskId, userMessageId, rewindError]);

  async function applyRewind() {
    if (preview.stage !== 'ready' || !preview.filesChanged.length) return;
    const { filesChanged } = preview;
    const request = ++requestRef.current;
    setPreview({ ...preview, stage: 'applying' });
    try {
      const result = await rewindRequest(taskId, userMessageId, false);
      if (request !== requestRef.current) return;
      setPreview({
        stage: 'done',
        filesChanged: result.filesChanged ?? filesChanged,
        skippedLinks: result.skippedLinks,
      });
      onRewindComplete?.();
    } catch (error) {
      if (request !== requestRef.current) return;
      setPreview({
        stage: 'error',
        filesChanged,
        error: error instanceof Error ? error.message : rewindError,
      });
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[85dvh] w-[calc(100vw-2rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t.task.rewindFiles}</DialogTitle>
          <DialogDescription>{t.task.rewindConfirm}</DialogDescription>
        </DialogHeader>
        <p className="text-muted-foreground text-xs">{t.task.rewindScope}</p>
        {preview.stage === 'loading' && (
          <p role="status">{t.task.rewindPreviewLoading}</p>
        )}
        {preview.stage === 'applying' && (
          <p role="status">{t.task.rewindApplying}</p>
        )}
        {preview.stage === 'done' && (
          <p role="status">{t.task.rewindComplete}</p>
        )}
        {preview.skippedLinks ? (
          <p role="status">
            {tt('task.rewindSkippedLinks', { count: preview.skippedLinks })}
          </p>
        ) : null}
        {preview.error && (
          <p role="alert" className="text-destructive text-sm break-words">
            {preview.error}
          </p>
        )}
        {preview.stage === 'ready' && !preview.filesChanged.length && (
          <p role="status">{t.task.rewindPreviewEmpty}</p>
        )}
        {preview.filesChanged.length > 0 && (
          <div>
            <p className="text-sm font-medium">
              {tt('task.rewindPreviewFiles', {
                count: preview.filesChanged.length,
              })}
            </p>
            <ul className="border-border mt-2 max-h-64 space-y-1 overflow-y-auto rounded-md border p-3 text-sm">
              {preview.filesChanged.map((file) => (
                <li key={file} title={file} className="break-all">
                  {toDisplayPath(file, sessionRoot)}
                </li>
              ))}
            </ul>
          </div>
        )}
        <DialogFooter>
          <button
            type="button"
            className="hover:bg-accent rounded-md px-3 py-2 text-sm"
            onClick={onClose}
          >
            {preview.stage === 'done' ? t.task.done : t.task.cancel}
          </button>
          {preview.stage === 'ready' && preview.filesChanged.length > 0 && (
            <button
              type="button"
              className="bg-destructive text-destructive-foreground rounded-md px-3 py-2 text-sm"
              onClick={() => void applyRewind()}
            >
              {t.task.rewindFiles}
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
