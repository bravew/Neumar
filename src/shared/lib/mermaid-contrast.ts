/**
 * Auto-contrast `style X fill:` lines in mermaid source.
 *
 * Background: when an agent emits `style Foo fill:#90EE90` without a
 * paired `color:` clause, mermaid uses the theme's primaryTextColor for
 * the label. In dark mode that's near-white — invisible against a light
 * user-supplied fill. CSS `mix-blend-mode: difference` is unreliable
 * inside SVG `<foreignObject>` so we preprocess the source instead and
 * inject `,color:#XXX` chosen by the YIQ luminance of the fill.
 *
 * Per Mermaid's canonical recipe (`style ... fill:X,color:Y`) — see
 * mermaid.js.org/syntax/flowchart.html#styling-and-classes.
 */

const STYLE_LINE_RE = /^(\s*style\s+\S+\s+)([^\n]+)$/gim;
// 6-digit alternation first — `[0-9a-f]{3}|[0-9a-f]{6}` would greedily
// match the first 3 chars and stop short.
const HEX_FILL_RE = /\bfill\s*:\s*(#(?:[0-9a-f]{6}|[0-9a-f]{3}))\b/i;
const HAS_COLOR_RE = /(?:^|,|\s)color\s*:/i;

function hexToRgb(hex: string): [number, number, number] | null {
  let h = hex.replace('#', '');
  if (h.length === 3)
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  if (h.length !== 6) return null;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if ([r, g, b].some((n) => Number.isNaN(n))) return null;
  return [r, g, b];
}

/** YIQ luminance — 0..255. Lighter than ~140 ⇒ light fill. */
function yiqLuminance([r, g, b]: [number, number, number]): number {
  return (r * 299 + g * 587 + b * 114) / 1000;
}

/**
 * Walk a single mermaid diagram's source and ensure each `style X fill:#XXX`
 * line has a paired `color:` matching the fill's contrast partner. Lines
 * that already specify `color:` are left untouched (respect agent intent).
 */
export function injectMermaidContrast(source: string): string {
  return source.replace(
    STYLE_LINE_RE,
    (full, prefix: string, decls: string) => {
      if (HAS_COLOR_RE.test(decls)) return full;
      const m = HEX_FILL_RE.exec(decls);
      if (!m) return full;
      const rgb = hexToRgb(m[1]);
      if (!rgb) return full;
      const isLight = yiqLuminance(rgb) > 140;
      const color = isLight ? '#0f172a' : '#f8fafc';
      return `${prefix}${decls.trimEnd()},color:${color}`;
    },
  );
}

const FENCED_MERMAID_RE = /(```mermaid\n)([\s\S]*?)(\n```)/g;

/**
 * Apply `injectMermaidContrast` to every fenced ```mermaid block inside a
 * markdown document. Non-mermaid content passes through unchanged.
 */
export function preprocessMermaidInMarkdown(markdown: string): string {
  return markdown.replace(FENCED_MERMAID_RE, (_full, open, body, close) => {
    return `${open}${injectMermaidContrast(body)}${close}`;
  });
}
