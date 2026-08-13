import { useCallback, useEffect, useRef, useState } from 'react';

import { API_BASE_URL } from '@/config';

// Slice K — the editor's persisted HTML template choice + variable values
// (GET/PUT /video/projects/:id/html-selection). The server reuses the
// file-backed selectTemplate the render path reads, so the UI selection and the
// agent/materializer stay in sync.

export interface HtmlSelection {
  templateId: string | null;
  variables: Record<string, unknown>;
}

export interface UseHtmlSelectionResult {
  selection: HtmlSelection;
  loading: boolean;
  error: string | null;
  setTemplate: (templateId: string) => Promise<void>;
  setVariables: (variables: Record<string, unknown>) => Promise<void>;
}

const EMPTY: HtmlSelection = { templateId: null, variables: {} };

export function useHtmlSelection(
  projectId: string | null,
): UseHtmlSelectionResult {
  const [selection, setSelection] = useState<HtmlSelection>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const putAbortRef = useRef<AbortController | null>(null);
  const getAbortRef = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      mountedRef.current = false;
      putAbortRef.current?.abort();
      getAbortRef.current?.abort();
    },
    [],
  );

  useEffect(() => {
    if (!projectId) {
      setSelection(EMPTY);
      return;
    }
    const ac = new AbortController();
    getAbortRef.current = ac;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await fetch(
          `${API_BASE_URL}/video/projects/${encodeURIComponent(projectId)}/html-selection`,
          { signal: ac.signal },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as HtmlSelection;
        if (ac.signal.aborted) return;
        setSelection({
          templateId: json.templateId,
          variables: json.variables,
        });
        setLoading(false);
      } catch (err) {
        if (ac.signal.aborted) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      }
    })();
    return () => ac.abort();
  }, [projectId]);

  const put = useCallback(
    async (body: Partial<HtmlSelection>) => {
      if (!projectId) return;
      if (mountedRef.current) setError(null);
      // Cancel any in-flight initial GET so a slow read can't resolve after
      // this write and clobber it (last-write-wins).
      getAbortRef.current?.abort();
      // Supersede any in-flight save and let unmount cancel this one.
      putAbortRef.current?.abort();
      const ac = new AbortController();
      putAbortRef.current = ac;
      try {
        const res = await fetch(
          `${API_BASE_URL}/video/projects/${encodeURIComponent(projectId)}/html-selection`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: ac.signal,
          },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as HtmlSelection;
        if (mountedRef.current && !ac.signal.aborted) {
          setSelection({
            templateId: json.templateId,
            variables: json.variables,
          });
        }
      } catch (err) {
        // A cancellation from unmount/supersede isn't a user-facing failure.
        if (ac.signal.aborted) return;
        // Surface PUT failures via the hook's error state (the GET is no longer
        // the only writer) and re-throw so awaiting callers can react.
        if (mountedRef.current) {
          setError(err instanceof Error ? err.message : String(err));
        }
        throw err;
      }
    },
    [projectId],
  );

  const setTemplate = useCallback(
    (templateId: string) => put({ templateId }),
    [put],
  );
  const setVariables = useCallback(
    (variables: Record<string, unknown>) => put({ variables }),
    [put],
  );

  return { selection, loading, error, setTemplate, setVariables };
}
