/**
 * Direct Mermaid renderer (mermaid@11) following 2026 best practices for an
 * agent-driven streaming context:
 *   - Lazy `import('mermaid')` so the ~480 KB bundle only loads when a
 *     diagram appears.
 *   - `securityLevel: 'strict'` + agent-supplied `%%{init: ...}%%` directives
 *     stripped before parse — closes GHSA-r4hj-mc62-jmwj-style overrides.
 *   - `parse()`-then-`render()` so partial / mid-stream sources fall back to
 *     a code block instead of throwing visible errors.
 *   - Monotonic render token aborts stale renders if `source` changes
 *     mid-flight.
 *   - DOMPurify pass on the SVG output (`USE_PROFILES.svg`, `foreignObject`
 *     allowed but `on*` attrs forbidden) — defense-in-depth on top of
 *     Mermaid's own escaping.
 *   - Module-level LRU SVG cache keyed by (theme, source) so the same diagram
 *     in scrollback + side panel renders once.
 *
 * Pairs with the `@streamdown/mermaid` plugin in chat-text rendering, which
 * handles streaming-fence completion well and is kept for that surface.
 */

import { useEffect, useId, useRef, useState } from 'react';

import DOMPurify from 'dompurify';

import { injectMermaidContrast } from '@/shared/lib/mermaid-contrast';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import { useTheme } from '@/shared/providers/theme-provider';

const SVG_CACHE = new Map<string, string>();
const SVG_CACHE_MAX = 50;

const DIRECTIVE_RE = /%%\{[\s\S]*?\}%%/g;
const ON_ATTR_RE = /^on/i;

let mermaidLoader: Promise<typeof import('mermaid').default> | null = null;
let initializedTheme: MermaidTheme | null = null;

function loadMermaid(theme: MermaidTheme) {
  if (!mermaidLoader) {
    mermaidLoader = import('mermaid').then((m) => m.default);
  }
  if (initializedTheme !== theme) {
    initializedTheme = theme;
    void mermaidLoader.then((m) =>
      m.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme,
        fontFamily: 'system-ui, sans-serif',
      }),
    );
  }
  return mermaidLoader;
}

// Block any `on*` attribute (including those inside `foreignObject` HTML
// children) — DOMPurify's SVG profile does not govern HTML attribute filtering
// in foreignObject subtrees.
let purifyHookInstalled = false;
function ensurePurifyHook() {
  if (purifyHookInstalled) return;
  purifyHookInstalled = true;
  DOMPurify.addHook('uponSanitizeAttribute', (_node, data) => {
    if (ON_ATTR_RE.test(data.attrName)) {
      data.keepAttr = false;
    }
  });
}

function setCached(key: string, svg: string): void {
  if (SVG_CACHE.has(key)) {
    SVG_CACHE.delete(key);
  } else if (SVG_CACHE.size >= SVG_CACHE_MAX) {
    const oldest = SVG_CACHE.keys().next().value;
    if (oldest) SVG_CACHE.delete(oldest);
  }
  SVG_CACHE.set(key, svg);
}

function stripDirectives(source: string): string {
  return source.replace(DIRECTIVE_RE, '');
}

export type MermaidTheme = 'default' | 'dark';

export interface MermaidViewProps {
  source: string;
  /** Override theme; defaults to the app's resolvedTheme. */
  theme?: MermaidTheme;
  className?: string;
  /** Debounce window in ms for streaming sources. */
  debounceMs?: number;
}

const DEFAULT_DEBOUNCE_MS = 250;

export function MermaidView({
  source,
  theme,
  className,
  debounceMs = DEFAULT_DEBOUNCE_MS,
}: MermaidViewProps) {
  const { resolvedTheme } = useTheme();
  const { t } = useLanguage();
  const effectiveTheme: MermaidTheme =
    theme ?? (resolvedTheme === 'dark' ? 'dark' : 'default');

  // Stable component-scoped suffix for diagram ids — Mermaid requires unique
  // ids and React 19 `useId()` gives us one cheaply.
  const reactId = useId().replace(/:/g, '_');

  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const renderSeq = useRef(0);

  useEffect(() => {
    const safe = injectMermaidContrast(stripDirectives(source)).trim();
    if (!safe) {
      setSvg(null);
      setError(null);
      return;
    }

    const cacheKey = `${effectiveTheme}::${safe}`;
    const cached = SVG_CACHE.get(cacheKey);
    if (cached) {
      setSvg(cached);
      setError(null);
      return;
    }

    // Local cancellation flag — flipped in cleanup to invalidate any
    // in-flight async render so a stale Promise can't overwrite a newer SVG.
    let cancelled = false;
    const myToken = ++renderSeq.current;
    const timer = setTimeout(async () => {
      try {
        const mermaid = await loadMermaid(effectiveTheme);
        ensurePurifyHook();
        await mermaid.parse(safe);
        const out = await mermaid.render(`mmd-${reactId}-${myToken}`, safe);
        if (cancelled) return;
        const clean = DOMPurify.sanitize(out.svg, {
          USE_PROFILES: { svg: true, svgFilters: true },
          ADD_TAGS: ['foreignObject'],
        });
        setCached(cacheKey, clean);
        setSvg(clean);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      }
    }, debounceMs);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [source, effectiveTheme, reactId, debounceMs]);

  if (error) {
    return (
      <details
        className={cn(
          'border-border/50 bg-muted/30 my-2 rounded-md border',
          className,
        )}
      >
        <summary className="text-muted-foreground cursor-pointer px-3 py-1.5 text-xs">
          {t.artifacts.mermaidRenderFailed}
        </summary>
        <pre className="overflow-auto px-3 pt-0 pb-2 text-xs">
          <code>{source}</code>
        </pre>
      </details>
    );
  }

  if (!svg) {
    return (
      <div
        className={cn('text-muted-foreground p-3 text-xs', className)}
        aria-busy="true"
      >
        {t.artifacts.renderingDiagram}
      </div>
    );
  }

  return (
    <div
      className={cn(
        'overflow-auto p-3 [&_svg]:h-auto [&_svg]:max-w-full',
        className,
      )}
      // svg is sanitized via DOMPurify above; the iframe-less inline render is
      // intentional for inline-bubble use. The side-panel sandboxed iframe is
      // a separate path (`SvgSandbox`) for fully untrusted SVG.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

/** Test-only — clears the module-level SVG cache. */
export function _clearMermaidSvgCache(): void {
  SVG_CACHE.clear();
}
