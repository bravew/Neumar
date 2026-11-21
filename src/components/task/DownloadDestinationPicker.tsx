/**
 * The folder control for the "where should the videos go?" question.
 *
 * In the desktop app it opens the OS folder dialog and submits the chosen
 * folder. In a browser tab there is no folder dialog, so it says so and the
 * user picks one of the folders the task has already been allowed to write.
 * The server checks the folder again when the answer claims its grant.
 */

import { useState } from 'react';

import { FolderOpen } from 'lucide-react';

import { API_BASE_URL } from '@/config';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import { isTauriRuntime } from '@/shared/utils/tauri';

export interface DownloadDestinationPickerProps {
  taskId: string | undefined;
  /** The answer the card would submit; a picked folder is submitted instead. */
  onChoose: (folder: string) => void;
  disabled?: boolean;
}

async function pickFolder(): Promise<string | undefined> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const selected = await open({ directory: true, multiple: false });
  return typeof selected === 'string' && selected.length > 0
    ? selected
    : undefined;
}

async function checkFolder(
  taskId: string,
  path: string,
  signal: AbortSignal,
): Promise<{ ok: true; directory: string } | { ok: false; message: string }> {
  const response = await fetch(`${API_BASE_URL}/downloads/destination`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId, path }),
    signal,
  });
  const body = (await response.json().catch(() => null)) as {
    directory?: unknown;
    error?: unknown;
  } | null;
  if (response.ok && typeof body?.directory === 'string') {
    return { ok: true, directory: body.directory };
  }
  return {
    ok: false,
    message:
      typeof body?.error === 'string'
        ? body.error
        : 'This folder is unavailable or not permitted.',
  };
}

export function DownloadDestinationPicker({
  taskId,
  onChoose,
  disabled = false,
}: DownloadDestinationPickerProps) {
  const { t } = useLanguage();
  const copy = t.mediaDownload.destination;
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const native = isTauriRuntime();

  const choose = async () => {
    if (!taskId || disabled || picking) return;
    setError(null);
    setPicking(true);
    const controller = new AbortController();
    try {
      const folder = await pickFolder();
      if (!folder) return;
      const checked = await checkFolder(taskId, folder, controller.signal);
      if (!checked.ok) {
        setError(checked.message);
        return;
      }
      onChoose(checked.directory);
    } catch {
      setError(copy.pickFailed);
    } finally {
      setPicking(false);
      controller.abort();
    }
  };

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={() => void choose()}
        disabled={disabled || picking || !native}
        className={cn(
          'flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-all',
          'border-border/60 bg-background text-foreground',
          native && !disabled
            ? 'hover:border-primary/50 hover:bg-accent/50 cursor-pointer'
            : 'cursor-not-allowed opacity-60',
        )}
      >
        <FolderOpen className="size-5 shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{copy.chooseFolder}</span>
          <span className="text-muted-foreground mt-0.5 block text-xs">
            {native ? copy.hint : copy.browserHint}
          </span>
        </span>
      </button>
      {error ? (
        <p role="alert" className="text-destructive px-1 text-xs">
          {error}
        </p>
      ) : null}
    </div>
  );
}
