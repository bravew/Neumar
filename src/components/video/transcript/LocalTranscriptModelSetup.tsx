import { useEffect, useState } from 'react';

import { z } from 'zod';

import { API_BASE_URL } from '@/config';
import { useLanguage } from '@/shared/providers/language-provider';

const statusSchema = z.object({
  sttModels: z.object({
    parakeet: z.object({
      state: z.enum([
        'not_downloaded',
        'downloading',
        'loading',
        'ready',
        'error',
      ]),
      error: z.string().optional(),
    }),
  }),
});
const errorSchema = z.object({ error: z.string().optional() });

type SetupState = 'checking' | 'missing' | 'downloading' | 'ready' | 'error';

/** Explicit model download; media stays local and retry remains a user action. */
export function LocalTranscriptModelSetup() {
  const { t } = useLanguage();
  const labels = t.video.editor.transcript;
  const [state, setState] = useState<SetupState>('checking');
  const [failure, setFailure] = useState<string | null>(null);
  const [poll, setPoll] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/speech/local/status`, {
          signal: controller.signal,
        });
        const data: unknown = await response.json();
        if (!response.ok) {
          throw new Error(
            errorSchema.safeParse(data).data?.error ?? labels.modelStatusFailed,
          );
        }
        const parsed = statusSchema.safeParse(data);
        if (!parsed.success) throw new Error(labels.modelStatusFailed);
        if (controller.signal.aborted) return;
        const model = parsed.data.sttModels.parakeet;
        if (model.state === 'downloading' || model.state === 'loading') {
          setState('downloading');
          timer = setTimeout(() => void check(), 1500);
        } else if (model.state === 'ready') {
          setState('ready');
          setFailure(null);
        } else if (model.state === 'error') {
          setState('error');
          setFailure(model.error ?? labels.modelDownloadFailed);
        } else {
          setState('missing');
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        setState('error');
        setFailure(
          error instanceof Error ? error.message : labels.modelStatusFailed,
        );
      }
    };
    void check();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [poll, labels.modelStatusFailed, labels.modelDownloadFailed]);

  const download = async () => {
    setState('downloading');
    setFailure(null);
    try {
      const response = await fetch(`${API_BASE_URL}/speech/local/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'parakeet' }),
      });
      if (!response.ok) {
        const data: unknown = await response.json();
        throw new Error(
          errorSchema.safeParse(data).data?.error ?? labels.modelDownloadFailed,
        );
      }
      setPoll((value) => value + 1);
    } catch (error) {
      setState('error');
      setFailure(
        error instanceof Error ? error.message : labels.modelDownloadFailed,
      );
    }
  };

  return (
    <div className="text-foreground space-y-2">
      <p>{labels.modelSetup}</p>
      {state === 'checking' || state === 'downloading' ? (
        <p role="status">
          {state === 'checking'
            ? labels.modelChecking
            : labels.modelDownloading}
        </p>
      ) : state === 'ready' ? (
        <p role="status">{labels.modelReady}</p>
      ) : (
        <button
          type="button"
          onClick={() => void download()}
          className="border-border rounded border px-2 py-1"
        >
          {labels.downloadModel}
        </button>
      )}
      {failure && (
        <p role="alert" className="text-destructive">
          {failure}
        </p>
      )}
    </div>
  );
}
