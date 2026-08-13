import path from 'node:path';

export interface InlineAsset {
  body: Buffer;
  contentType: string;
}

export interface InlineAssetReadOptions {
  preferProxy?: boolean;
  fullResolution?: boolean;
}

export type InlineAssetReader = (
  relativePath: string,
  options?: InlineAssetReadOptions,
) => Promise<InlineAsset | null>;

interface Replacement {
  start: number;
  end: number;
  html: string;
}

interface Attribute {
  name: string;
  lowerName: string;
  value: string | null;
}

const LINK_TAG_RE = /<link\b[^>]*>/gi;
const IMG_TAG_RE = /<img\b[^>]*>/gi;
const SCRIPT_TAG_RE =
  /<script\b[^>]*\bsrc\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)[^>]*>(?:\s*<\/script\s*>)?/gi;
const ATTRIBUTE_RE =
  /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

export async function inlineRelativeAssets(
  html: string,
  ownerRelPath: string,
  fileReader: InlineAssetReader,
): Promise<string> {
  const matches = [
    ...Array.from(html.matchAll(LINK_TAG_RE), (match) =>
      buildLinkReplacement(match, ownerRelPath, fileReader),
    ),
    ...Array.from(html.matchAll(SCRIPT_TAG_RE), (match) =>
      buildScriptReplacement(match, ownerRelPath, fileReader),
    ),
    ...Array.from(html.matchAll(IMG_TAG_RE), (match) =>
      buildImageReplacement(match, ownerRelPath, fileReader),
    ),
  ];
  const replacements = (await Promise.all(matches))
    .filter((item): item is Replacement => Boolean(item))
    .sort((a, b) => a.start - b.start);
  if (replacements.length === 0) return html;

  let cursor = 0;
  let out = '';
  for (const replacement of replacements) {
    out += html.slice(cursor, replacement.start);
    out += replacement.html;
    cursor = replacement.end;
  }
  return out + html.slice(cursor);
}

async function buildImageReplacement(
  match: RegExpMatchArray,
  ownerRelPath: string,
  fileReader: InlineAssetReader,
): Promise<Replacement | null> {
  const tag = match[0];
  const attrs = parseAttributes(tag, 'img');
  const src = getAttr(attrs, 'src');
  if (!src) return null;
  const assetPath = resolveRelativeAsset(ownerRelPath, src);
  if (!assetPath) return null;

  const fullResolution = isTruthyAttr(attrs, 'data-full-resolution');
  const asset = await fileReader(assetPath, {
    preferProxy: !fullResolution,
    fullResolution,
  });
  if (!asset) return null;
  return {
    start: match.index ?? 0,
    end: (match.index ?? 0) + tag.length,
    html: replaceAttrValue(
      tag,
      'src',
      `data:${asset.contentType};base64,${asset.body.toString('base64')}`,
    ),
  };
}

async function buildLinkReplacement(
  match: RegExpMatchArray,
  ownerRelPath: string,
  fileReader: InlineAssetReader,
): Promise<Replacement | null> {
  const tag = match[0];
  const attrs = parseAttributes(tag, 'link');
  const rel = getAttr(attrs, 'rel');
  const href = getAttr(attrs, 'href');
  if (!rel || !href || !isStylesheetRel(rel)) return null;
  const assetPath = resolveRelativeAsset(ownerRelPath, href);
  if (!assetPath) return null;

  const asset = await fileReader(assetPath);
  if (!asset) return null;
  return {
    start: match.index ?? 0,
    end: (match.index ?? 0) + tag.length,
    html: `<style data-neuma-inline-asset="${escapeHtmlAttr(
      assetPath,
    )}"${preservedLinkStyleAttrs(attrs)}>${escapeStyleBody(
      asset.body.toString('utf-8'),
    )}</style>`,
  };
}

async function buildScriptReplacement(
  match: RegExpMatchArray,
  ownerRelPath: string,
  fileReader: InlineAssetReader,
): Promise<Replacement | null> {
  const tag = match[0];
  const attrs = parseAttributes(tag, 'script');
  const src = getAttr(attrs, 'src');
  if (!src) return null;
  const assetPath = resolveRelativeAsset(ownerRelPath, src);
  if (!assetPath) return null;

  const asset = await fileReader(assetPath);
  if (!asset) return null;
  return {
    start: match.index ?? 0,
    end: (match.index ?? 0) + tag.length,
    html: `<script${preservedScriptAttrs(attrs)}>${escapeScriptBody(
      asset.body.toString('utf-8'),
    )}</script>`,
  };
}

function parseAttributes(tag: string, tagName: string): Attribute[] {
  const source = tag
    .replace(new RegExp(`^<${tagName}\\b`, 'i'), '')
    .replace(/\/?>$/i, '');
  const attrs: Attribute[] = [];
  for (const match of source.matchAll(ATTRIBUTE_RE)) {
    const name = match[1];
    if (!name) continue;
    attrs.push({
      name,
      lowerName: name.toLowerCase(),
      value: match[2] ?? match[3] ?? match[4] ?? null,
    });
  }
  return attrs;
}

function getAttr(attrs: Attribute[], name: string): string | null {
  return attrs.find((attr) => attr.lowerName === name)?.value ?? null;
}

function hasAttr(attrs: Attribute[], name: string): boolean {
  return attrs.some((attr) => attr.lowerName === name);
}

function isTruthyAttr(attrs: Attribute[], name: string): boolean {
  const value = getAttr(attrs, name);
  if (value === null) return hasAttr(attrs, name);
  return /^(1|true|yes|on)$/i.test(value);
}

function isStylesheetRel(rel: string) {
  const tokens = rel.toLowerCase().split(/\s+/).filter(Boolean);
  return (
    tokens.includes('stylesheet') &&
    !tokens.includes('preload') &&
    !tokens.includes('modulepreload')
  );
}

function resolveRelativeAsset(ownerRelPath: string, rawUrl: string) {
  const url = rawUrl.trim();
  if (
    !url ||
    url.startsWith('/') ||
    url.startsWith('//') ||
    url.startsWith('#') ||
    /^[a-z][a-z0-9+.-]*:/i.test(url)
  ) {
    return url.startsWith('asset:') ? url : null;
  }

  const withoutHash = url.split('#')[0] ?? '';
  const assetPath = withoutHash.split('?')[0] ?? '';
  if (!assetPath) return null;
  const ownerDir = path.posix.dirname(ownerRelPath.replace(/\\/g, '/'));
  const resolved = path.posix.normalize(path.posix.join(ownerDir, assetPath));
  if (resolved === '.' || resolved.startsWith('../') || resolved === '..') {
    return null;
  }
  return resolved;
}

function replaceAttrValue(
  tag: string,
  attrName: string,
  value: string,
): string {
  const re = new RegExp(
    `(${attrName}\\s*=\\s*)(?:"[^"]*"|'[^']*'|[^\\s>]+)`,
    'i',
  );
  return tag.replace(re, `$1"${escapeHtmlAttr(value)}"`);
}

function preservedLinkStyleAttrs(attrs: Attribute[]) {
  const preserved = ['media', 'title', 'nonce'];
  const valueAttrs = preserved
    .map((name) => {
      const value = getAttr(attrs, name);
      return value === null ? '' : ` ${name}="${escapeHtmlAttr(value)}"`;
    })
    .join('');
  return valueAttrs + (hasAttr(attrs, 'disabled') ? ' disabled' : '');
}

function preservedScriptAttrs(attrs: Attribute[]) {
  const valueAttrs = ['type', 'nonce']
    .map((name) => {
      const value = getAttr(attrs, name);
      return value === null ? '' : ` ${name}="${escapeHtmlAttr(value)}"`;
    })
    .join('');
  const boolAttrs = ['defer', 'async']
    .map((name) => (hasAttr(attrs, name) ? ` ${name}` : ''))
    .join('');
  return valueAttrs + boolAttrs;
}

function escapeScriptBody(value: string) {
  return value.replace(/<\/script/gi, '<\\/script');
}

function escapeStyleBody(value: string) {
  return value.replace(/<\/style/gi, '<\\/style');
}

function escapeHtmlAttr(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
