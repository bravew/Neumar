import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { readProjectTextFile, resolveProjectPath } from '../fs';
import { getDesignProject } from '../projects';

const PDF_TITLE_FALLBACK = 'DesignMode export';
const PDF_FILENAME_FALLBACK = 'designmode-export';
const PDF_TITLE_MAX_CHARS = 120;
const PDF_FILENAME_MAX_CHARS = 80;
const CONTROL_FILENAME_CHARS_RE = /[\x00-\x1F\x7F]+/g;
const WINDOWS_FILENAME_CHARS_RE = /[\\/:*?"<>|]+/g;
const COMBINING_MARKS_RE = /[\u0300-\u036f]+/g;
const EXISTING_TITLE_TAG_RE = /<title\b[^>]*>[\s\S]*?<\/title>/i;

export interface ArtifactPdfInput {
  baseHref: string;
  deck: boolean;
  defaultFilename: string;
  html: string;
  title?: string;
}

export interface BuildArtifactPdfInputOptions {
  artifactPath?: string;
  deck?: boolean;
  fileName?: string;
  title?: string;
}

export class ArtifactPdfInputUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArtifactPdfInputUnavailableError';
  }
}

export const DECK_PRINT_CSS = `
@page {
  size: 1920px 1080px;
  margin: 0;
}
html,
body {
  margin: 0;
  padding: 0;
  background: #fff;
}
[data-neuma-deck-nav],
[data-neuma-deck-counter],
[data-od-deck-nav],
[data-od-deck-counter] {
  display: none !important;
}
section,
.slide,
[data-slide] {
  break-after: page;
  page-break-after: always;
}
`.trim();

export async function buildArtifactPdfInput(
  projectId: string,
  options: BuildArtifactPdfInputOptions = {},
): Promise<ArtifactPdfInput> {
  const project = await getDesignProject(projectId);
  const sourcePath =
    options.artifactPath ?? (await pickHtmlArtifactPath(projectId, project));
  if (!sourcePath) {
    throw new ArtifactPdfInputUnavailableError(
      'PDF export requires an HTML artifact.',
    );
  }

  const source = await readProjectTextFile(projectId, sourcePath);
  const resolved = resolveProjectPath(projectId, source.path);
  const deck = options.deck ?? project.surface === 'deck';
  const title = sanitizePdfDocumentTitle(
    options.title?.trim() || project.title,
  );

  return {
    baseHref: pathToFileURL(path.dirname(resolved.absolutePath) + path.sep)
      .href,
    deck,
    defaultFilename: safePdfFilename(options.fileName || title || project.id),
    html: wrapPrintableHtml(source.content, {
      baseHref: pathToFileURL(path.dirname(resolved.absolutePath) + path.sep)
        .href,
      deck,
      title,
    }),
    title,
  };
}

async function pickHtmlArtifactPath(
  projectId: string,
  project: Awaited<ReturnType<typeof getDesignProject>>,
) {
  for (const output of project.outputs) {
    if (!/\.html?$/i.test(output.path)) continue;
    const file = await readProjectTextFile(projectId, output.path).catch(
      () => null,
    );
    if (file) return file.path;
  }
  for (const candidate of [
    'artifacts/index.html',
    'artifacts/deck.html',
    'artifacts/slides.html',
  ]) {
    const file = await readProjectTextFile(projectId, candidate).catch(
      () => null,
    );
    if (file) return file.path;
  }
  return null;
}

function wrapPrintableHtml(
  source: string,
  {
    baseHref,
    deck,
    title,
  }: {
    baseHref: string;
    deck: boolean;
    title?: string;
  },
) {
  const sanitizedTitle = sanitizePdfDocumentTitle(title);
  const titleTag = `<title>${escapeHtml(sanitizedTitle)}</title>`;
  const baseTag = `<base href="${escapeHtml(baseHref)}">`;
  const printCss = deck ? `<style>${DECK_PRINT_CSS}</style>` : '';
  const readyScript = `<script>
(function(){
  var posted=false;
  function usable(){
    var body=document.body;
    var root=document.documentElement;
    var width=Math.max(root ? root.scrollWidth : 0, body ? body.scrollWidth : 0, root ? root.clientWidth : 0, body ? body.clientWidth : 0);
    var height=Math.max(root ? root.scrollHeight : 0, body ? body.scrollHeight : 0, root ? root.clientHeight : 0, body ? body.clientHeight : 0);
    return Number.isFinite(width) && Number.isFinite(height) && width > 1 && height > 1;
  }
  function post(){
    if(posted)return;
    posted=true;
    window.parent.postMessage('neuma:print-ready','*');
  }
  function check(){
    if(usable()){post();return;}
    if(window.requestAnimationFrame){window.requestAnimationFrame(check);}
    else{window.setTimeout(check,50);}
  }
  window.addEventListener('load',function(){
    window.setTimeout(check,0);
    window.setTimeout(post,1200);
  });
})();
</script>`;

  if (/<html[\s>]/i.test(source)) {
    return source
      .replace(EXISTING_TITLE_TAG_RE, '')
      .replace(/<head([^>]*)>/i, `<head$1>${baseTag}${titleTag}${printCss}`)
      .replace(/<\/body>/i, `${readyScript}</body>`);
  }
  return [
    '<!doctype html>',
    '<html>',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    baseTag,
    titleTag,
    printCss,
    '</head>',
    '<body>',
    source,
    readyScript,
    '</body>',
    '</html>',
  ].join('');
}

export function safePdfFilename(value: string) {
  const slug = sanitizePdfDocumentTitle(value, '')
    .normalize('NFKD')
    .replace(COMBINING_MARKS_RE, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, PDF_FILENAME_MAX_CHARS);
  return `${slug || PDF_FILENAME_FALLBACK}.pdf`;
}

export function sanitizePdfDocumentTitle(
  value: string | undefined,
  fallback = PDF_TITLE_FALLBACK,
) {
  const sanitized = (value ?? '')
    .normalize('NFC')
    .replace(CONTROL_FILENAME_CHARS_RE, ' ')
    .replace(WINDOWS_FILENAME_CHARS_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+|\.+$/g, '')
    .slice(0, PDF_TITLE_MAX_CHARS)
    .trim();
  return sanitized || fallback;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
