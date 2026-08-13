import JSZip from 'jszip';

import {
  generateNonce,
  SANDBOX_ATTR,
  wrapFullDocumentSrcdoc,
} from '@/components/artifacts/live/iframe-sandbox';
import {
  exportAsImage,
  requestPreviewSnapshot,
} from '@/components/artifacts/live/preview-snapshot';
import type { DesignSystemRecord } from '@/shared/types/design-mode';

import { loadComponentsHtml, loadShowcaseHtml } from './design-system-html';

/**
 * Client-side export helpers for the design-system Share menu (Open Design
 * parity). All run entirely in the browser against the active view's HTML:
 *   - PDF   : open the page in a popup and trigger print() — pick "Save as PDF".
 *   - HTML  : download the page as a single standalone .html file.
 *   - image : render the page in an offscreen sandboxed iframe and snapshot it.
 *   - zip   : pack DESIGN.md + tokens.css + components.html + showcase.html.
 *   - tab   : open the page in a new browser tab.
 */

function safeFilename(name: string, fallback = 'design-system'): string {
  const slug = (name || fallback)
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || fallback;
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke late — Safari may still be reading the blob when the click returns.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Blob URL for an HTML document, opened in a fresh same-origin window/tab. */
function htmlBlobUrl(html: string): string {
  return URL.createObjectURL(
    new Blob([html], { type: 'text/html;charset=utf-8' }),
  );
}

export function exportShowcaseAsHtml(html: string, title: string): void {
  triggerDownload(
    new Blob([html], { type: 'text/html;charset=utf-8' }),
    `${safeFilename(title)}.html`,
  );
}

export function openShowcaseInNewTab(html: string): void {
  const url = htmlBlobUrl(html);
  window.open(url, '_blank', 'noopener,noreferrer');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function exportShowcaseAsPdf(html: string): void {
  const url = htmlBlobUrl(html);
  const win = window.open(url, '_blank', 'noopener,noreferrer');
  if (!win) {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return;
  }
  // Print once the document has painted; the blob window is same-origin so we
  // can drive print() from here. A timeout backs up the load event.
  const print = () => {
    try {
      win.focus();
      win.print();
    } catch {
      // Pop-up blocked or cross-origin — the user can print manually.
    }
  };
  win.addEventListener?.('load', print);
  setTimeout(print, 800);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Render the page in an offscreen sandboxed iframe, ask its snapshot bridge for
 * a PNG, and download it. Self-contained — no dependency on the live preview's
 * iframe ref.
 */
export async function exportShowcaseAsImage(
  html: string,
  title: string,
): Promise<void> {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('sandbox', SANDBOX_ATTR);
  iframe.style.cssText =
    'position:fixed;left:-10000px;top:0;width:1280px;height:960px;border:0;';
  iframe.srcdoc = wrapFullDocumentSrcdoc(html, generateNonce());
  document.body.appendChild(iframe);
  try {
    await new Promise<void>((resolve) => {
      iframe.addEventListener('load', () => resolve(), { once: true });
      setTimeout(resolve, 1500);
    });
    // Give layout + fonts a beat to settle before snapshotting.
    await new Promise((r) => setTimeout(r, 250));
    const snapshot = await requestPreviewSnapshot(iframe);
    await exportAsImage(`${safeFilename(title)}.png`, snapshot);
  } finally {
    iframe.remove();
  }
}

export async function exportSystemAsZip(
  system: DesignSystemRecord,
  showcaseHtml: string | null,
  componentsHtml: string | null,
): Promise<void> {
  const zip = new JSZip();
  zip.file('DESIGN.md', system.body);
  if (system.tokenCss) zip.file('tokens.css', system.tokenCss);
  if (componentsHtml) zip.file('components.html', componentsHtml);
  if (showcaseHtml) zip.file('showcase.html', showcaseHtml);
  const blob = await zip.generateAsync({ type: 'blob' });
  triggerDownload(blob, `${safeFilename(system.title)}.zip`);
}

/**
 * Resolve the HTML for the active preview view. The Tokens view has no
 * standalone document, so it exports the generated showcase.
 */
export function resolveViewHtml(
  system: DesignSystemRecord,
  view: 'showcase' | 'reference' | 'tokens',
): Promise<string | null> {
  if (view === 'reference') {
    return system.componentsHtml
      ? Promise.resolve(system.componentsHtml)
      : loadComponentsHtml(system.id);
  }
  return loadShowcaseHtml(system.id);
}
