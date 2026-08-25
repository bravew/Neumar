import { useCallback, useEffect, useRef, useState } from 'react';

import { API_BASE_URL } from '@/config';

// Phase E (P2-1) — HyperFrames `check --json` in the QA panel: lint, runtime,
// layout, motion, and WCAG AA contrast from one browser session.

export interface HtmlCheckPass {
  key: string;
  ok: boolean;
  errorCount: number;
  warningCount: number;
  enabled: boolean;
}

export interface HtmlCheckSummary {
  ok: boolean;
  errorCount: number;
  warningCount: number;
  passes: HtmlCheckPass[];
}

export interface HtmlCheckFinding {
  code: string;
  severity: string;
  message: string;
  selector?: string;
  fixHint?: string;
}

export interface HtmlCheckResult {
  summary: HtmlCheckSummary;
  findings: HtmlCheckFinding[];
}

interface HtmlCheckResponse {
  summary: HtmlCheckSummary;
  report: Record<string, { findings?: HtmlCheckFinding[] } | unknown>;
}

const PASS_KEYS = ['lint', 'runtime', 'layout', 'motion', 'contrast'] as const;

export interface UseHtmlCompositionCheckResult {
  result: HtmlCheckResult | null;
  running: boolean;
  error: string | null;
  run: (compositionDir?: string) => void;
}

export function useHtmlCompositionCheck(
  projectId: string,
): UseHtmlCompositionCheckResult {
  const [result, setResult] = useState<HtmlCheckResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  const run = useCallback(
    (compositionDir = 'hyperframes') => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setRunning(true);
      setError(null);
      (async () => {
        try {
          const res = await fetch(
            `${API_BASE_URL}/video/projects/${encodeURIComponent(projectId)}/html-check`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ compositionDir }),
              signal: ac.signal,
            },
          );
          const json = (await res.json()) as HtmlCheckResponse & {
            error?: string;
          };
          if (ac.signal.aborted) return;
          if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
          setResult({
            summary: json.summary,
            findings: collectFindings(json.report),
          });
        } catch (err) {
          if (ac.signal.aborted) return;
          setError(err instanceof Error ? err.message : String(err));
        } finally {
          if (!ac.signal.aborted) setRunning(false);
        }
      })();
    },
    [projectId],
  );

  return { result, running, error, run };
}

function collectFindings(
  report: HtmlCheckResponse['report'],
): HtmlCheckFinding[] {
  const out: HtmlCheckFinding[] = [];
  for (const key of PASS_KEYS) {
    const pass = report?.[key] as { findings?: HtmlCheckFinding[] } | undefined;
    for (const finding of pass?.findings ?? []) out.push(finding);
  }
  return out;
}
