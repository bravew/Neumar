const MIN_HTML_ARTIFACT_CHARS = 64;
const HTML_DOCUMENT_START_RE = /^(?:<!doctype\s+html\b|<html\b)/i;
const HTML_STYLE_OR_SCRIPT_RE =
  /<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)>/gi;
const HTML_TAG_RE = /<[^>]+>/g;
const HTML_STUB_REFERENCE_RE =
  /\b(?:see|open|refer(?:red)?\s+to|look\s+at|view)\b[\s\S]{0,120}\.html?\b/i;
const HTML_STUB_PLACEHOLDER_RE =
  /\b(?:placeholder|stub|fallback|already\s+exists|saved\s+in)\b/i;
const HTML_REFERENCE_ATTR_RE =
  /\b(?:href|src|poster|action)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
const CSS_URL_RE = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"\s]+))\s*\)/gi;
const MAX_STUB_TEXT_CHARS = 280;
const RESERVED_PROJECT_PATH_SEGMENTS = new Set([
  '.deleted',
  '.live-artifacts',
  '.neuma',
  '.neuma-skills',
  '.tmp',
  'live-artifacts',
]);
const RESERVED_PROJECT_ROOT_FILES = new Set([
  'brief.json',
  'history.jsonl',
  'project.json',
]);

export type HtmlArtifactValidationResult =
  | { ok: true }
  | { ok: false; reason: string; reference?: string };

export function validateHtmlArtifact(
  content: string,
): HtmlArtifactValidationResult {
  const trimmed = content.replace(/^\uFEFF/, '').trim();
  if (!trimmed) {
    return { ok: false, reason: 'empty-html-artifact' };
  }
  if (trimmed.length < MIN_HTML_ARTIFACT_CHARS) {
    return { ok: false, reason: 'html-artifact-too-short' };
  }
  if (!HTML_DOCUMENT_START_RE.test(trimmed)) {
    return { ok: false, reason: 'html-artifact-missing-document-root' };
  }
  if (isLikelyStubHtmlArtifact(trimmed)) {
    return { ok: false, reason: 'html-artifact-placeholder-stub' };
  }
  const reservedReference = findReservedProjectReference(trimmed);
  if (reservedReference) {
    return {
      ok: false,
      reason: 'html-artifact-reserved-project-path',
      reference: reservedReference,
    };
  }
  return { ok: true };
}

function isLikelyStubHtmlArtifact(content: string): boolean {
  const text = content
    .replace(HTML_STYLE_OR_SCRIPT_RE, ' ')
    .replace(HTML_TAG_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length === 0 || text.length > MAX_STUB_TEXT_CHARS) return false;
  return (
    HTML_STUB_REFERENCE_RE.test(text) ||
    (HTML_STUB_PLACEHOLDER_RE.test(text) && /\.html?\b/i.test(text))
  );
}

function findReservedProjectReference(content: string): string | null {
  for (const reference of extractProjectReferences(content)) {
    if (isReservedProjectReference(reference)) return reference;
  }
  return null;
}

function extractProjectReferences(content: string): string[] {
  const references: string[] = [];
  for (const match of content.matchAll(HTML_REFERENCE_ATTR_RE)) {
    const reference = match[1] ?? match[2] ?? match[3];
    if (reference) references.push(reference);
  }
  for (const match of content.matchAll(CSS_URL_RE)) {
    const reference = match[1] ?? match[2] ?? match[3];
    if (reference) references.push(reference);
  }
  return references;
}

function isReservedProjectReference(reference: string): boolean {
  const cleaned = reference.trim();
  if (!cleaned || cleaned.startsWith('#')) return false;
  if (/^file:/i.test(cleaned)) return true;
  if (/^(?:data|blob|mailto|tel|javascript):/i.test(cleaned)) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(cleaned)) return false;

  const withoutFragment = cleaned.split('#', 1)[0] ?? '';
  const withoutQuery = withoutFragment.split('?', 1)[0] ?? '';
  const normalized = withoutQuery.replace(/\\/g, '/').replace(/^\/+/, '');
  const segments = normalized
    .split('/')
    .map((segment) => segment.trim().toLowerCase())
    .filter(Boolean);
  if (segments.length === 0) return false;
  if (RESERVED_PROJECT_ROOT_FILES.has(segments[0]!)) return true;
  if (
    segments.includes('..') &&
    segments.some((segment) => RESERVED_PROJECT_ROOT_FILES.has(segment))
  ) {
    return true;
  }
  return segments.some((segment) =>
    RESERVED_PROJECT_PATH_SEGMENTS.has(segment),
  );
}
