import { useMemo } from 'react';

import { cjk } from '@streamdown/cjk';
import { code } from '@streamdown/code';
import { math } from '@streamdown/math';
import { createMermaidPlugin, mermaid } from '@streamdown/mermaid';

import { useTheme } from '@/shared/providers/theme-provider';

export const STREAMDOWN_PLUGINS = { code, math, mermaid, cjk };
export const STREAMDOWN_CODE_PLUGINS = { code };
export const STREAMDOWN_MERMAID_PLUGINS = { mermaid };

/**
 * `@streamdown/mermaid`'s default plugin instance pins `theme: 'default'`
 * inside its module scope and overrides any external `mermaid.initialize`
 * call. Build a fresh plugin instance per resolvedTheme so dark mode
 * actually picks up dark fills/strokes — and bake in flowchart polish
 * (curved edges, padding, modern font) per Mermaid v11 best practices.
 *
 * Uses `theme: 'base'` because that's the only theme that fully respects
 * `themeVariables`. Identity changes on theme flip so Streamdown
 * re-renders mermaid blocks under the new palette.
 */
export function useStreamdownPlugins(): typeof STREAMDOWN_PLUGINS {
  const { resolvedTheme } = useTheme();
  return useMemo(() => {
    const dark = resolvedTheme === 'dark';
    const themedMermaid = createMermaidPlugin({
      config: {
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'base',
        look: 'classic',
        flowchart: {
          curve: 'basis',
          nodeSpacing: 56,
          rankSpacing: 64,
          padding: 14,
          htmlLabels: true,
          useMaxWidth: true,
        },
        themeVariables: {
          fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
          fontSize: '13px',
          // Default node fill — agent-generated diagrams without user
          // `style X fill:` overrides pick up these. Dark-mode default
          // is slate-800 with light text; light-mode is gray-50 with
          // near-black text.
          primaryColor: dark ? '#1e293b' : '#f9fafb',
          primaryTextColor: dark ? '#f9fafb' : '#111827',
          primaryBorderColor: dark ? '#475569' : '#d1d5db',
          secondaryColor: dark ? '#334155' : '#f3f4f6',
          tertiaryColor: dark ? '#475569' : '#e5e7eb',
          lineColor: dark ? '#cbd5e1' : '#6b7280',
          mainBkg: dark ? '#1e293b' : '#ffffff',
          edgeLabelBackground: dark ? '#0f172a' : '#ffffff',
          clusterBkg: dark ? '#1e293b' : '#f9fafb',
          clusterBorder: dark ? '#475569' : '#d1d5db',
        },
      },
    });
    return { code, math, mermaid: themedMermaid, cjk };
  }, [resolvedTheme]);
}
