import { useEffect, useState } from 'react';

import { API_BASE_URL } from '@/config';

// Phase 6 M2 — fetch the HTML-video template gallery.

export interface GalleryTemplateSummary {
  id: string;
  rootKind: 'user' | 'branding';
  preview?: {
    mode: 'poster' | 'live';
    aspect: string;
    posterUrl: string | null;
  };
  metadata: {
    id: string;
    name: string;
    description?: string;
    engine: string;
    category: string;
    subcategory?: string;
    tags: string[];
    preview?: string;
    version: string;
    license: {
      spdx: string;
      attribution_required: boolean;
      redistribution_allowed: boolean;
      commercial_use: boolean;
    };
  };
  warnings: string[];
}

export interface UseHtmlGalleryResult {
  templates: GalleryTemplateSummary[];
  loading: boolean;
  error: string | null;
}

export function useHtmlGallery(): UseHtmlGalleryResult {
  const [templates, setTemplates] = useState<GalleryTemplateSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/video/html-gallery`, {
          signal: ac.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as {
          templates: GalleryTemplateSummary[];
        };
        if (ac.signal.aborted) return;
        setTemplates(json.templates);
        setLoading(false);
      } catch (err) {
        if (ac.signal.aborted) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      }
    })();
    return () => ac.abort();
  }, []);

  return { templates, loading, error };
}
