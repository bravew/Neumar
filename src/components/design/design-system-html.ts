import { useEffect, useState } from 'react';

import {
  getDesignSystem,
  getDesignSystemShowcase,
} from '@/shared/hooks/useDesignMode';
import type { DesignSystemRecord } from '@/shared/types/design-mode';

/**
 * Lazy, process-wide HTML caches for the two preview surfaces a design system
 * exposes, keyed by id. Both are fetched on demand (the catalog list omits the
 * heavy HTML in summary mode) and de-duped so a grid card and its modal reuse a
 * single load. `null` means "fetched, none available".
 *
 * - **showcase**: the generated Open Design "The system that makes X feel like
 *   X" marketing page (GET `/design-systems/:id/showcase`). The grid card and
 *   the modal's Showcase tab render this.
 * - **components**: the bundled bespoke `components.html` reference fixture
 *   (carried on the full record). The modal's Reference tab renders this.
 */
function makeHtmlLoader(fetcher: (id: string) => Promise<string | null>) {
  const cache = new Map<string, string | null>();
  const inflight = new Map<string, Promise<string | null>>();

  const peek = (id: string): string | null | undefined =>
    cache.has(id) ? cache.get(id) : undefined;

  const load = (id: string): Promise<string | null> => {
    if (cache.has(id)) return Promise.resolve(cache.get(id) ?? null);
    let pending = inflight.get(id);
    if (!pending) {
      pending = fetcher(id)
        .then((html) => {
          cache.set(id, html);
          inflight.delete(id);
          return html;
        })
        .catch((err) => {
          inflight.delete(id);
          throw err;
        });
      inflight.set(id, pending);
    }
    return pending;
  };

  return { peek, load };
}

const showcase = makeHtmlLoader((id) =>
  getDesignSystemShowcase(id).catch(() => null),
);
const components = makeHtmlLoader((id) =>
  getDesignSystem(id).then((data) => data.designSystem?.componentsHtml ?? null),
);

/** Cached generated-showcase HTML for an id, or `undefined` if not yet fetched. */
export function peekShowcaseHtml(id: string): string | null | undefined {
  return showcase.peek(id);
}

export function loadShowcaseHtml(id: string): Promise<string | null> {
  return showcase.load(id);
}

/** Resolve a system's bundled `components.html` (lazy, cached). */
export function loadComponentsHtml(id: string): Promise<string | null> {
  return components.load(id);
}

/** Resolve a system's generated showcase HTML, fetching on mount. */
export function useDesignSystemShowcaseHtml(id: string): {
  html: string | null;
  loading: boolean;
} {
  return useLazyHtml(id, showcase.peek, showcase.load);
}

/**
 * Resolve a system's bundled `components.html`, fetching the full record when
 * the (summary-mode) list record omits it.
 */
export function useDesignSystemComponentsHtml(system: DesignSystemRecord): {
  html: string | null;
  loading: boolean;
} {
  const seeded = system.componentsHtml ?? components.peek(system.id) ?? null;
  const [state, setState] = useState<{ html: string | null; loading: boolean }>(
    { html: seeded, loading: false },
  );

  useEffect(() => {
    if (system.componentsHtml) {
      setState({ html: system.componentsHtml, loading: false });
      return;
    }
    const cached = components.peek(system.id);
    if (cached !== undefined) {
      setState({ html: cached, loading: false });
      return;
    }
    const ac = new AbortController();
    setState({ html: null, loading: true });
    components
      .load(system.id)
      .then((next) => {
        if (!ac.signal.aborted) setState({ html: next, loading: false });
      })
      .catch(() => {
        if (!ac.signal.aborted) setState({ html: null, loading: false });
      });
    return () => ac.abort();
  }, [system.id, system.componentsHtml]);

  return state;
}

/** Shared mount-time lazy loader for an id-keyed HTML cache. */
function useLazyHtml(
  id: string,
  peek: (id: string) => string | null | undefined,
  load: (id: string) => Promise<string | null>,
): { html: string | null; loading: boolean } {
  const [state, setState] = useState<{ html: string | null; loading: boolean }>(
    () => ({ html: peek(id) ?? null, loading: false }),
  );

  useEffect(() => {
    const cached = peek(id);
    if (cached !== undefined) {
      setState({ html: cached, loading: false });
      return;
    }
    const ac = new AbortController();
    setState({ html: null, loading: true });
    load(id)
      .then((next) => {
        if (!ac.signal.aborted) setState({ html: next, loading: false });
      })
      .catch(() => {
        if (!ac.signal.aborted) setState({ html: null, loading: false });
      });
    return () => ac.abort();
  }, [id, peek, load]);

  return state;
}
