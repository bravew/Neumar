/**
 * LocalModelBadge
 *
 * Displays the download/load state of a local speech model with action buttons.
 * Shared between TtsSection (kokoro, pocket, kitten) and SttSection (stt).
 */

import { AlertCircle, CheckCircle2, Download, Loader2 } from 'lucide-react';

import { useLanguage } from '@/shared/providers/language-provider';

import type {
  LocalModelState,
  LocalModelStatusEntry,
  TtsModelKey,
} from './types';

interface LocalModelBadgeProps {
  model: 'stt' | TtsModelKey;
  label: string;
  status: LocalModelStatusEntry | undefined;
  onDownload: (model: 'stt' | TtsModelKey) => void;
}

const STATE_COLORS: Record<LocalModelState, string> = {
  not_downloaded: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  downloading: 'bg-blue-500/10 text-blue-700 dark:text-blue-400',
  loading: 'bg-blue-500/10 text-blue-700 dark:text-blue-400',
  ready: 'bg-green-500/10 text-green-700 dark:text-green-400',
  error: 'bg-red-500/10 text-red-700 dark:text-red-400',
};

export function LocalModelBadge({
  model,
  label,
  status,
  onDownload,
}: LocalModelBadgeProps) {
  const { t } = useLanguage();
  const s = t.settings;

  if (!status) return null;

  const { state, downloadProgress, error: message } = status;

  return (
    <div
      className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm ${STATE_COLORS[state]}`}
    >
      {state === 'not_downloaded' && (
        <>
          <AlertCircle size={15} className="shrink-0" />
          <span className="flex-1">
            {label} — {s.speechLocalNotDownloaded}
          </span>
          <button
            type="button"
            onClick={() => onDownload(model)}
            className="inline-flex items-center gap-1 rounded bg-amber-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-amber-700"
          >
            <Download size={12} /> {s.speechLocalDownload}
          </button>
        </>
      )}
      {(state === 'downloading' || state === 'loading') && (
        <>
          <Loader2 size={15} className="shrink-0 animate-spin" />
          <div className="flex-1">
            <span>
              {label} —{' '}
              {status.phase ??
                (state === 'downloading'
                  ? s.speechLocalDownloading
                  : s.speechLocalLoadingModel)}
            </span>
            {state === 'downloading' &&
              downloadProgress &&
              downloadProgress.totalBytes > 0 && (
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-blue-200 dark:bg-blue-900">
                  <div
                    className="h-full rounded-full bg-blue-500 transition-all"
                    style={{
                      width: `${Math.round((downloadProgress.downloadedBytes / downloadProgress.totalBytes) * 100)}%`,
                    }}
                  />
                </div>
              )}
          </div>
        </>
      )}
      {state === 'ready' && (
        <>
          <CheckCircle2 size={15} className="shrink-0" />
          <span>
            {label} — {s.speechLocalReady}
          </span>
        </>
      )}
      {state === 'error' && (
        <>
          <AlertCircle size={15} className="shrink-0" />
          <span className="flex-1">
            {label} — {message ?? s.speechLocalError}
          </span>
          <button
            type="button"
            onClick={() => onDownload(model)}
            className="rounded bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700"
          >
            {s.speechLocalRetry}
          </button>
        </>
      )}
    </div>
  );
}
