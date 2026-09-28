import { resourceCspFromMeta } from '@/components/artifacts/live/csp-intersect';

const MAX_HTML_CHARS = 500_000;
const IMAGE_MIME = /^image\/(?:png|jpeg|gif|webp)$/;

export interface McpResourceContent {
  mimeType?: string;
  text?: string;
  blob?: string;
  _meta?: Record<string, unknown>;
}

export function parseMcpToolName(
  name: string,
): { serverName: string; toolName: string } | null {
  const parts = name.split('__');
  if (parts[0] !== 'mcp' || parts.length < 3 || !parts[1]) return null;
  const toolName = parts.slice(2).join('__');
  if (!toolName) return null;
  return { serverName: parts[1], toolName };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function isAppHtml(mime: string): boolean {
  const normalized = mime.trim().toLowerCase().replaceAll(/\s+/g, '');
  return (
    normalized === 'text/html' || normalized === 'text/html;profile=mcp-app'
  );
}

function isBase64(value: string): boolean {
  return /^[A-Za-z0-9+/]+={0,2}$/.test(value) && value.length % 4 === 0;
}

/** Turn a resources/read payload into sandboxed HTML. Non-HTML text is escaped. */
export function mcpAppDocument(contents: readonly McpResourceContent[]): {
  html: string;
  resourceCsp?: string;
} | null {
  for (const item of contents) {
    const mime = item.mimeType ?? 'text/html';
    const resourceCsp = resourceCspFromMeta(item._meta);
    if (
      (isAppHtml(mime) || mime === 'text/plain') &&
      typeof item.text === 'string' &&
      item.text.length > 0 &&
      item.text.length <= MAX_HTML_CHARS
    ) {
      return {
        html: isAppHtml(mime)
          ? item.text
          : `<pre>${escapeHtml(item.text)}</pre>`,
        resourceCsp,
      };
    }
    if (
      IMAGE_MIME.test(mime) &&
      typeof item.blob === 'string' &&
      item.blob.length > 0 &&
      item.blob.length <= MAX_HTML_CHARS &&
      isBase64(item.blob)
    ) {
      return {
        html: `<img alt="" src="data:${mime};base64,${item.blob}">`,
        resourceCsp,
      };
    }
  }
  return null;
}
