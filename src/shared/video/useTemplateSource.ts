import { useEffect, useState } from 'react';

import { API_BASE_URL } from '@/config';

// Slice K — raw template `source/index.html` for the live in-editor preview.

export interface UseTemplateSourceResult {
  html: string | null;
  loading: boolean;
  error: string | null;
}

export function useTemplateSource(
  templateId: string | null,
): UseTemplateSourceResult {
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!templateId) {
      setHtml(null);
      setError(null);
      return;
    }
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await fetch(
          `${API_BASE_URL}/video/html-gallery/${encodeURIComponent(templateId)}/source`,
          { signal: ac.signal },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { html: string };
        if (ac.signal.aborted) return;
        setHtml(json.html);
        setLoading(false);
      } catch (err) {
        if (ac.signal.aborted) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      }
    })();
    return () => ac.abort();
  }, [templateId]);

  return { html, loading, error };
}
