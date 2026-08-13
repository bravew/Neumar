/**
 * Link Safety Modal for Tauri
 *
 * Replaces Streamdown's default link safety modal which uses window.open()
 * (doesn't work in Tauri webview). This version uses @tauri-apps/plugin-opener.
 */

import { useCallback, useId, useState } from 'react';

import type { LinkSafetyConfig } from 'streamdown';

import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

/** Open a URL using Tauri's opener plugin, with browser fallback. */
async function openExternalUrl(url: string): Promise<void> {
  try {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
  } catch {
    window.open(url, '_blank', 'noreferrer');
  }
}

export function LinkSafetyModal({
  url,
  onClose,
}: {
  url: string;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);
  const titleId = useId();

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard not available
    }
  }, [url]);

  const handleOpen = useCallback(() => {
    openExternalUrl(url);
    onClose();
  }, [url, onClose]);

  return (
    <div
      className="bg-background/50 fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm"
      onClick={onClose}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
    >
      <div
        className="bg-background relative mx-4 flex w-full max-w-md flex-col gap-4 rounded-xl border p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
        role="presentation"
      >
        <button
          className="text-muted-foreground hover:bg-muted hover:text-foreground absolute top-4 right-4 rounded-md p-1 transition-all"
          onClick={onClose}
          type="button"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M12.47 13.53L13 14.06L14.06 13L13.53 12.47L9.06 8L13.53 3.53L14.06 3L13 1.94L12.47 2.47L8 6.94L3.53 2.47L3 1.94L1.94 3L2.47 3.53L6.94 8L2.47 12.47L1.94 13L3 14.06L3.53 13.53L8 9.06L12.47 13.53Z" />
          </svg>
        </button>
        <div className="flex flex-col gap-2">
          <div
            id={titleId}
            className="flex items-center gap-2 text-lg font-semibold"
          >
            <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor">
              <path d="M13.5 10.25V13.25C13.5 13.39 13.39 13.5 13.25 13.5H2.75C2.61 13.5 2.5 13.39 2.5 13.25V2.75C2.5 2.61 2.61 2.5 2.75 2.5H5.75H6.5V1H5.75H2.75C1.78 1 1 1.78 1 2.75V13.25C1 14.22 1.78 15 2.75 15H13.25C14.22 15 15 14.22 15 13.25V10.25V9.5H13.5V10.25ZM9 1H9.75H14.25C14.66 1 15 1.34 15 1.75V6.25V7H13.5V6.25V3.56L8.53 8.53L8 9.06L6.94 8L7.47 7.47L12.44 2.5H9.75H9V1Z" />
            </svg>
            <span>{t.common.linkSafety.openExternalLink}</span>
          </div>
          <p className="text-muted-foreground text-sm">
            {t.common.linkSafety.externalLinkWarning}
          </p>
        </div>
        <div
          className={cn(
            'bg-muted rounded-md p-3 font-mono text-sm break-all',
            url.length > 100 && 'max-h-32 overflow-y-auto',
          )}
        >
          {url}
        </div>
        <div className="flex gap-2">
          <button
            className="bg-background hover:bg-muted flex flex-1 items-center justify-center gap-2 rounded-md border px-4 py-2 text-sm font-medium transition-all"
            onClick={handleCopy}
            type="button"
          >
            {copied ? t.common.linkSafety.copied : t.common.linkSafety.copyLink}
          </button>
          <button
            className="bg-primary text-primary-foreground hover:bg-primary/90 flex flex-1 items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-all"
            onClick={handleOpen}
            type="button"
          >
            {t.common.linkSafety.openLink}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Streamdown linkSafety config with Tauri-compatible modal.
 * Use this as the `linkSafety` prop on all `<Streamdown>` instances.
 */
export const TAURI_LINK_SAFETY: LinkSafetyConfig = {
  enabled: true,
  renderModal: ({ isOpen, onClose, url }) => {
    if (!isOpen) return null;
    return <LinkSafetyModal url={url} onClose={onClose} />;
  },
};
