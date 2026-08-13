import { useState } from 'react';

import { RefreshCw, Trash2 } from 'lucide-react';

import { useLanguage } from '@/shared/providers/language-provider';
import type { VideoProject } from '@/shared/types/video';

import type { VideoProjectEditorActions } from './editorTypes';

interface VideoAssetProxyStatusProps {
  asset: VideoProject['assets'][number];
  actions: VideoProjectEditorActions;
}

export function VideoAssetProxyStatus({
  asset,
  actions,
}: VideoAssetProxyStatusProps) {
  const { t } = useLanguage();
  const copy = t.video.editor.inspector.proxy;
  const [busy, setBusy] = useState<'generate' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (asset.kind !== 'video') return null;

  const generate = async () => {
    setBusy('generate');
    setError(null);
    try {
      await actions.regenerateAssetProxy(asset.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy('delete');
    setError(null);
    try {
      await actions.deleteAssetProxy(asset.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const status = asset.proxy
    ? copy.ready.replace('{height}', String(asset.proxy.heightPx))
    : copy.notReady;

  return (
    <div className="border-border bg-muted/30 flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-xs">
      <div className="min-w-0">
        <div className="text-foreground truncate">{status}</div>
        {asset.proxy ? (
          <div className="text-muted-foreground truncate">
            {asset.proxy.path.split('/').pop()}
          </div>
        ) : null}
        {error ? (
          <div className="text-destructive truncate">{error}</div>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          className="hover:bg-accent rounded-md p-1 disabled:opacity-50"
          disabled={busy !== null}
          aria-label={asset.proxy ? copy.regenerate : copy.generate}
          title={asset.proxy ? copy.regenerate : copy.generate}
          onClick={() => void generate()}
        >
          <RefreshCw
            className={busy === 'generate' ? 'size-3 animate-spin' : 'size-3'}
          />
        </button>
        {asset.proxy ? (
          <button
            type="button"
            className="hover:bg-accent rounded-md p-1 disabled:opacity-50"
            disabled={busy !== null}
            aria-label={copy.delete}
            title={copy.delete}
            onClick={() => void remove()}
          >
            <Trash2 className="size-3" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
