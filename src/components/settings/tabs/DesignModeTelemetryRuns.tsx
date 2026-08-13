import { useEffect, useState } from 'react';

import { API_BASE_URL } from '@/config';
import { useLanguage } from '@/shared/providers/language-provider';

interface CritiqueMetricRow {
  runId: string;
  outcome: 'shipped' | 'degraded' | 'interrupted' | 'failed';
  conformanceOk: boolean;
  panelistCount: number;
  mustFixCount: number;
  durationMs: number;
  startedAt: string;
}

export function DesignModeTelemetryRuns() {
  const { t } = useLanguage();
  const [rows, setRows] = useState<CritiqueMetricRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetch(`${API_BASE_URL}/design/critique/metrics`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<{ metrics?: CritiqueMetricRow[] }>;
      })
      .then((payload) => setRows(payload.metrics ?? []))
      .catch((err) => {
        if ((err as { name?: string }).name === 'AbortError') return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  return (
    <section className="space-y-4">
      <div>
        <h3 className="text-base font-semibold">
          {t.settings.designModeTelemetryRecentRuns}
        </h3>
        <p className="text-muted-foreground mt-1 text-sm">
          {t.settings.designModeTelemetryRecentRunsDescription}
        </p>
      </div>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">
                {t.settings.designModeTelemetryRunId}
              </th>
              <th className="px-3 py-2 font-medium">
                {t.settings.designModeTelemetryOutcome}
              </th>
              <th className="px-3 py-2 font-medium">
                {t.settings.designModeTelemetryConformance}
              </th>
              <th className="px-3 py-2 font-medium">
                {t.settings.designModeTelemetryPanelists}
              </th>
              <th className="px-3 py-2 font-medium">
                {t.settings.designModeTelemetryMustFix}
              </th>
              <th className="px-3 py-2 font-medium">
                {t.settings.designModeTelemetryDuration}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.runId} className="border-t">
                <td className="px-3 py-2 font-mono text-xs">
                  {truncateRunId(row.runId)}
                </td>
                <td className="px-3 py-2">
                  <OutcomeChip
                    label={outcomeLabel(row.outcome, {
                      shipped: t.settings.designModeTelemetryOutcomeShipped,
                      degraded: t.settings.designModeTelemetryOutcomeDegraded,
                      interrupted:
                        t.settings.designModeTelemetryOutcomeInterrupted,
                      failed: t.settings.designModeTelemetryOutcomeFailed,
                    })}
                  />
                </td>
                <td className="px-3 py-2">
                  <span
                    className={
                      row.conformanceOk
                        ? 'text-emerald-700 dark:text-emerald-300'
                        : 'text-destructive'
                    }
                  >
                    {row.conformanceOk
                      ? t.settings.designModeTelemetryConformanceOk
                      : t.settings.designModeTelemetryConformanceFailed}
                  </span>
                </td>
                <td className="px-3 py-2 tabular-nums">{row.panelistCount}</td>
                <td className="px-3 py-2 tabular-nums">{row.mustFixCount}</td>
                <td className="px-3 py-2 tabular-nums">
                  {formatDuration(row.durationMs)}
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="text-muted-foreground px-3 py-6 text-center text-sm"
                >
                  {error ?? t.settings.designModeTelemetryNoCritiqueRuns}
                </td>
              </tr>
            )}
            {loading && (
              <tr>
                <td
                  colSpan={6}
                  className="text-muted-foreground px-3 py-6 text-center text-sm"
                >
                  {t.settings.designModeTelemetryLoadingCritiqueRuns}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function OutcomeChip({ label }: { label: string }) {
  return (
    <span className="border-border bg-muted inline-flex rounded px-2 py-0.5 text-xs font-medium">
      {label}
    </span>
  );
}

function outcomeLabel(
  outcome: CritiqueMetricRow['outcome'],
  labels: Record<CritiqueMetricRow['outcome'], string>,
) {
  return labels[outcome] ?? outcome;
}

function truncateRunId(runId: string) {
  return runId.length <= 14 ? runId : `${runId.slice(0, 12)}...`;
}

function formatDuration(durationMs: number) {
  if (durationMs < 1000) return `${durationMs} ms`;
  return `${(durationMs / 1000).toFixed(1)} s`;
}
