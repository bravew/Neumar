/**
 * The folder control for the "where should the videos go?" question.
 *
 * A path field accepts a typed or pasted folder in every runtime, because a
 * browser tab has no folder dialog. The desktop app adds a button that opens
 * the OS folder dialog. Either way the server checks the folder before the
 * card submits it, and checks it again when the answer claims its grant.
 */

import { useState, type FormEvent } from 'react';

import { FolderOpen } from 'lucide-react';

import { Button } from '@/components/ui/button';
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
  const [busy, setBusy] = useState(false);
  const [path, setPath] = useState('');
  const native = isTauriRuntime();

  /** Check a folder with the server, then submit what it resolved. */
  const submit = async (folder: () => Promise<string | undefined>) => {
    if (!taskId || disabled || busy) return;
    setError(null);
    setBusy(true);
    const controller = new AbortController();
    try {
      const chosen = await folder();
      if (!chosen) return;
      const checked = await checkFolder(taskId, chosen, controller.signal);
      if (!checked.ok) {
        setError(checked.message);
        return;
      }
      onChoose(checked.directory);
    } catch {
      setError(copy.pickFailed);
    } finally {
      setBusy(false);
      controller.abort();
    }
  };

  const typed = path.trim();
  const useTyped = (event: FormEvent) => {
    event.preventDefault();
    if (typed) void submit(async () => typed);
  };

  return (
    <div className="space-y-2">
      {native ? (
        <button
          type="button"
          onClick={() => void submit(pickFolder)}
          disabled={disabled || busy}
          className={cn(
            'flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-all',
            'border-border/60 bg-background text-foreground',
            disabled || busy
              ? 'cursor-not-allowed opacity-60'
              : 'hover:border-primary/50 hover:bg-accent/50 cursor-pointer',
          )}
        >
          <FolderOpen className="size-5 shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">
              {copy.chooseFolder}
            </span>
            <span className="text-muted-foreground mt-0.5 block text-xs">
              {copy.hint}
            </span>
          </span>
        </button>
      ) : (
        <p className="text-muted-foreground px-1 text-xs">{copy.browserHint}</p>
      )}
      <form onSubmit={useTyped} className="flex items-center gap-2">
        <input
          type="text"
          value={path}
          onChange={(event) => setPath(event.target.value)}
          placeholder={copy.pathPlaceholder}
          aria-label={copy.pathLabel}
          disabled={disabled || busy}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          className="border-border/60 bg-background text-foreground placeholder:text-muted-foreground focus:border-primary focus:ring-primary/30 min-w-0 flex-1 rounded-lg border px-3 py-2 font-mono text-xs focus:ring-1 focus:outline-none disabled:opacity-60"
        />
        <Button type="submit" size="sm" disabled={disabled || busy || !typed}>
          {copy.useFolder}
        </Button>
      </form>
      {error ? (
        <p role="alert" className="text-destructive px-1 text-xs">
          {error}
        </p>
      ) : null}
    </div>
  );
}
