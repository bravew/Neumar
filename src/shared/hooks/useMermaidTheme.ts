/**
 * Lazy-init mermaid with the app's resolved theme so that
 * `@streamdown/mermaid` renders dark diagrams on a dark page (and light
 * on light). Idempotent across components — re-runs only when the
 * resolved theme actually flips.
 *
 * `MermaidView` (the dedicated artifact renderer) bypasses this and
 * controls its own initialize() per render so it can pin a theme via
 * prop. This hook is the *implicit* path used by Streamdown's mermaid
 * plugin which doesn't expose a theme prop.
 */

import { useEffect } from 'react';

import { useTheme } from '@/shared/providers/theme-provider';

let lastInitializedTheme: 'default' | 'dark' | null = null;

export function useMermaidTheme(): void {
  const { resolvedTheme } = useTheme();
  const theme: 'default' | 'dark' =
    resolvedTheme === 'dark' ? 'dark' : 'default';

  useEffect(() => {
    if (lastInitializedTheme === theme) return;
    let cancelled = false;
    void import('mermaid').then(({ default: mermaid }) => {
      if (cancelled) return;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme,
        fontFamily: 'system-ui, sans-serif',
      });
      lastInitializedTheme = theme;
    });
    return () => {
      cancelled = true;
    };
  }, [theme]);
}
