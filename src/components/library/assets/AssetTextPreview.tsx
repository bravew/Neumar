import { useCallback, useEffect, useState } from 'react';

import { code } from '@streamdown/code';
import { Download, Loader2 } from 'lucide-react';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { Streamdown } from 'streamdown';

import { Button } from '@/components/ui/button';
import { assetRawUrl } from '@/shared/assets/api';
import type { Asset } from '@/shared/assets/types';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

// Render text/markdown/HTML/code assets inline so a `DESIGN.md` doesn't fall
// through to the "Inline preview is not available" placeholder. Anything
// > MAX_INLINE_BYTES falls back to the download affordance so we never
// block the dialog reading a multi-megabyte log file.
const MAX_INLINE_BYTES = 1_000_000;
const STREAMDOWN_PLUGINS = { code };
const STREAMDOWN_REMARK_PLUGINS = [remarkGfm, remarkBreaks];
const MARKDOWN_PROSE_CLASS =
  'prose prose-sm text-foreground max-w-none min-w-0 break-words [&_:not(pre)>code]:bg-muted [&_:not(pre)>code]:rounded [&_:not(pre)>code]:px-1.5 [&_:not(pre)>code]:py-0.5 [&_:not(pre)>code]:text-[0.85em] [&_:not(pre)>code]:before:content-none [&_:not(pre)>code]:after:content-none [&_img]:max-h-80 [&_img]:rounded-lg [&_img]:object-contain [&_pre]:max-w-full [&_pre]:break-words [&_pre]:whitespace-pre-wrap [&_table]:w-full [&_table]:border-collapse [&_table]:text-sm [&_th]:border [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-medium [&_thead]:bg-muted [&_td]:border [&_td]:px-3 [&_td]:py-2';

// Show the rendered/raw toggle only for asset types that have a meaningful
// difference between the two views — markdown, HTML, code-like text.
// Plain `.txt` is already raw, so no toggle is offered.
export function isToggleableText(mime: string, title: string): boolean {
  const lower = title.toLowerCase();
  if (
    mime === 'text/markdown' ||
    mime === 'text/x-markdown' ||
    mime === 'text/html' ||
    lower.endsWith('.md') ||
    lower.endsWith('.markdown') ||
    lower.endsWith('.html') ||
    lower.endsWith('.htm')
  ) {
    return true;
  }
  return false;
}

export function TextPreview({
  asset,
  name,
  showRaw,
}: {
  asset: Asset;
  name: string;
  showRaw: boolean;
}) {
  const { t } = useLanguage();
  const s = t.assets;
  const raw = assetRawUrl(asset.id);
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'ready'; body: string }
    | { status: 'error'; message: string }
    | { status: 'too_large' }
  >({ status: 'loading' });

  useEffect(() => {
    if (asset.bytes > MAX_INLINE_BYTES) {
      setState({ status: 'too_large' });
      return;
    }
    const ctrl = new AbortController();
    setState({ status: 'loading' });
    fetch(raw, { signal: ctrl.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
      .then((body) => {
        if (!ctrl.signal.aborted) setState({ status: 'ready', body });
      })
      .catch((error) => {
        if (ctrl.signal.aborted) return;
        if ((error as { name?: string }).name === 'AbortError') return;
        setState({
          status: 'error',
          message:
            error instanceof Error ? error.message : s.previewUnavailable,
        });
      });
    return () => ctrl.abort();
  }, [asset.bytes, asset.id, raw, s.previewUnavailable]);

  const title = asset.title?.toLowerCase() ?? '';
  const path = asset.storagePath?.toLowerCase() ?? '';
  const isMarkdown =
    asset.mime === 'text/markdown' ||
    asset.mime === 'text/x-markdown' ||
    path.endsWith('.md') ||
    path.endsWith('.markdown') ||
    title.endsWith('.md') ||
    title.endsWith('.markdown');
  const isHtml =
    asset.mime === 'text/html' ||
    asset.mime === 'application/xhtml+xml' ||
    path.endsWith('.html') ||
    path.endsWith('.htm') ||
    title.endsWith('.html') ||
    title.endsWith('.htm');

  if (state.status === 'loading') {
    return (
      <div className="text-muted-foreground flex flex-1 items-center justify-center gap-2 p-6 text-sm">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        {s.loading}
      </div>
    );
  }
  if (state.status === 'too_large' || state.status === 'error') {
    const message =
      state.status === 'error' ? state.message : s.previewUnavailable;
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="flex max-w-sm flex-col items-center gap-3 text-center">
          <p className="text-muted-foreground text-sm">{message}</p>
          <DownloadButton asset={asset} />
        </div>
      </div>
    );
  }

  if (isHtml && !showRaw) {
    // Sandbox the rendered HTML so a malicious asset can't access the host
    // app, but allow inline styles and script-driven layouts (the only way
    // most reference pages render correctly). `allow-same-origin` is left
    // off so cookies/storage are not exposed.
    return (
      <iframe
        srcDoc={state.body}
        title={name}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        className="min-h-0 flex-1 border-0 bg-white"
      />
    );
  }

  if (isMarkdown && !showRaw) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto bg-white p-6 dark:bg-zinc-900">
        <div className={MARKDOWN_PROSE_CLASS}>
          <Streamdown
            plugins={STREAMDOWN_PLUGINS}
            remarkPlugins={STREAMDOWN_REMARK_PLUGINS}
          >
            {state.body}
          </Streamdown>
        </div>
      </div>
    );
  }
  return (
    <pre className="bg-muted/40 min-h-0 flex-1 overflow-auto p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap">
      {state.body}
    </pre>
  );
}

// Download button that uses Tauri's save dialog + `writeFile` when running
// in the desktop shell, and falls back to a programmatic `<a download>` in
// the browser. Avoids the broken `target="_blank"` behaviour in the Tauri
// webview, and gives the user a real file on disk instead of streaming
// bytes into a tab that has no native viewer for the MIME.
export function DownloadButton({
  asset,
  className,
}: {
  asset: Asset;
  className?: string;
}) {
  const { t } = useLanguage();
  const s = t.assets;
  const [busy, setBusy] = useState(false);

  const handleDownload = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch(assetRawUrl(asset.id));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const filename = asset.title || asset.storagePath || `asset-${asset.id}`;
      await saveBlobToDisk(blob, filename);
    } catch (error) {
      if (import.meta.env.DEV) console.error('Asset download failed:', error);
    } finally {
      setBusy(false);
    }
  }, [asset.id, asset.storagePath, asset.title]);

  return (
    <Button
      type="button"
      variant="outline"
      disabled={busy}
      onClick={handleDownload}
      className={cn('gap-2', className)}
    >
      {busy ? (
        <Loader2 className="size-4 animate-spin" aria-hidden />
      ) : (
        <Download className="size-4" aria-hidden />
      )}
      {s.download}
    </Button>
  );
}

async function saveBlobToDisk(blob: Blob, filename: string): Promise<void> {
  // Try the Tauri path first — only available in the desktop shell. The
  // dynamic import lets the web build skip the plugin entirely.
  try {
    const [{ save }, { writeFile, BaseDirectory }] = await Promise.all([
      import('@tauri-apps/plugin-dialog'),
      import('@tauri-apps/plugin-fs'),
    ]);
    const target = await save({
      defaultPath: filename,
      title: filename,
    });
    if (!target) return; // user cancelled the dialog
    const data = new Uint8Array(await blob.arrayBuffer());
    if (target.includes('/') || target.includes('\\')) {
      // Absolute path returned by the system save dialog — write directly.
      await writeFile(target, data);
    } else {
      // Plain filename (rare on macOS but possible) — drop into Downloads.
      await writeFile(target, data, { baseDir: BaseDirectory.Download });
    }
    return;
  } catch {
    // Fall through to the browser download path.
  }
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}
