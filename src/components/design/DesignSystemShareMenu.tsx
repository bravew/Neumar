import { useState } from 'react';

import {
  Clipboard,
  Download,
  ExternalLink,
  FileCode,
  FileText,
  Image as ImageIcon,
  Loader2,
} from 'lucide-react';

import { useLanguage } from '@/shared/providers/language-provider';
import type { DesignSystemRecord } from '@/shared/types/design-mode';

import {
  exportShowcaseAsHtml,
  exportShowcaseAsImage,
  exportShowcaseAsPdf,
  exportSystemAsZip,
  openShowcaseInNewTab,
  resolveViewHtml,
} from './design-system-export';
import { loadComponentsHtml, loadShowcaseHtml } from './design-system-html';

type ActiveView = 'showcase' | 'reference' | 'tokens';

/**
 * Share / export popover for a design system (Open Design parity). A template
 * header naming what's exported, then file-export actions scoped to the active
 * view's HTML (the generated showcase, or the bespoke `components.html`
 * reference), plus copy-to-clipboard shortcuts.
 */
export function DesignSystemShareMenu({
  system,
  activeView,
  onClose,
}: {
  system: DesignSystemRecord;
  activeView: ActiveView;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const [busy, setBusy] = useState<string | null>(null);

  const viewLabel =
    activeView === 'reference' ? t.design.reference : t.design.showcase;
  const exportTitle = `${system.title} — ${viewLabel}`;

  const run = async (key: string, fn: () => void | Promise<void>) => {
    if (busy) return;
    setBusy(key);
    try {
      await fn();
    } catch {
      // Best-effort export — swallow so a failed snapshot/pop-up doesn't break.
    } finally {
      setBusy(null);
      onClose();
    }
  };

  const withHtml = async (fn: (html: string) => void | Promise<void>) => {
    const html = await resolveViewHtml(system, activeView);
    if (html) await fn(html);
  };

  return (
    <div
      role="menu"
      className="bg-popover text-popover-foreground absolute right-0 z-20 mt-2 w-60 rounded-md border p-1 shadow-md"
      data-testid="design-system-share-menu"
    >
      <div className="px-2 pt-1.5 pb-1">
        <div className="text-muted-foreground text-[10px] font-medium tracking-wide uppercase">
          {t.design.shareTemplate}
        </div>
        <div className="truncate text-sm font-medium">{exportTitle}</div>
      </div>
      <div className="bg-border my-1 h-px" />
      <div className="text-muted-foreground px-2 py-1 text-[10px] font-medium tracking-wide uppercase">
        {t.design.shareExportGroup}
      </div>
      <MenuItem
        icon={<FileText className="size-4" />}
        label={t.design.shareExportPdf}
        busy={busy === 'pdf'}
        onClick={() =>
          run('pdf', () => withHtml((h) => exportShowcaseAsPdf(h)))
        }
      />
      <MenuItem
        icon={<Download className="size-4" />}
        label={t.design.shareExportZip}
        busy={busy === 'zip'}
        onClick={() =>
          run('zip', async () => {
            const [showcase, components] = await Promise.all([
              loadShowcaseHtml(system.id),
              system.componentsHtml ?? loadComponentsHtml(system.id),
            ]);
            await exportSystemAsZip(system, showcase, components);
          })
        }
      />
      <MenuItem
        icon={<FileCode className="size-4" />}
        label={t.design.shareExportHtml}
        busy={busy === 'html'}
        onClick={() =>
          run('html', () =>
            withHtml((h) => exportShowcaseAsHtml(h, exportTitle)),
          )
        }
      />
      <MenuItem
        icon={<ImageIcon className="size-4" />}
        label={t.design.shareExportImage}
        busy={busy === 'image'}
        onClick={() =>
          run('image', () =>
            withHtml((h) => exportShowcaseAsImage(h, exportTitle)),
          )
        }
      />
      <MenuItem
        icon={<ExternalLink className="size-4" />}
        label={t.design.shareOpenNewTab}
        busy={busy === 'tab'}
        onClick={() =>
          run('tab', () => withHtml((h) => openShowcaseInNewTab(h)))
        }
      />
      <div className="bg-border my-1 h-px" />
      <MenuItem
        icon={<Clipboard className="size-4" />}
        label={t.design.copyDesignMarkdown}
        onClick={() =>
          run('copy-md', () => {
            navigator.clipboard?.writeText(system.body).catch(() => {});
          })
        }
      />
      <MenuItem
        icon={<Clipboard className="size-4" />}
        label={t.design.copyTokens}
        onClick={() =>
          run('copy-tokens', () => {
            navigator.clipboard
              ?.writeText(system.tokens.join('\n'))
              .catch(() => {});
          })
        }
      />
    </div>
  );
}

function MenuItem({
  icon,
  label,
  busy,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  busy?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={busy}
      className="hover:bg-accent flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm disabled:opacity-60"
      onClick={onClick}
    >
      {busy ? <Loader2 className="size-4 animate-spin" /> : icon}
      {label}
    </button>
  );
}
