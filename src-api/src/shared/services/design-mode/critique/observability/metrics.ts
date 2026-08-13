import { getDatabase } from '@/shared/db';
import { createLogger } from '@/shared/utils/logger';

export type CritiqueRunOutcome =
  | 'shipped'
  | 'degraded'
  | 'interrupted'
  | 'failed';

export interface DesignCritiqueMetricRow {
  runId: string;
  projectId: string;
  rolloutPhase: string;
  outcome: CritiqueRunOutcome;
  panelistCount: number;
  mustFixCount: number;
  totalScore: number;
  durationMs: number;
  conformanceOk: boolean;
  degradedPanelistCount: number;
  startedAt: string;
  endedAt: string;
}

export interface RecordDesignCritiqueMetricsInput extends DesignCritiqueMetricRow {}

const logger = createLogger('CritiqueTheater');
const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
type AppDatabase = ReturnType<typeof getDatabase>;
let vacuumScheduled = false;

export function recordDesignCritiqueMetrics(
  input: RecordDesignCritiqueMetricsInput,
  db: AppDatabase = getDatabase(),
) {
  db.prepare(
    `INSERT INTO design_critique_metrics (
       run_id, project_id, rollout_phase, outcome, panelist_count,
       must_fix_count, total_score, duration_ms, conformance_ok,
       degraded_panelist_count, started_at, ended_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.runId,
    input.projectId,
    input.rolloutPhase,
    input.outcome,
    input.panelistCount,
    input.mustFixCount,
    input.totalScore,
    input.durationMs,
    input.conformanceOk ? 1 : 0,
    input.degradedPanelistCount,
    input.startedAt,
    input.endedAt,
  );
}

export function listDesignCritiqueMetrics(options: {
  since?: string;
  limit?: number;
}) {
  const db = getDatabase();
  const limit = Math.max(1, Math.min(options.limit ?? 50, 50));
  const rows = (
    options.since
      ? db
          .prepare(
            `SELECT * FROM design_critique_metrics
             WHERE started_at >= ?
             ORDER BY started_at DESC
             LIMIT ?`,
          )
          .all(options.since, limit)
      : db
          .prepare(
            `SELECT * FROM design_critique_metrics
             ORDER BY started_at DESC
             LIMIT ?`,
          )
          .all(limit)
  ) as DesignCritiqueMetricsDbRow[];
  return rows.map(mapMetricRow);
}

export function scheduleDesignCritiqueMetricsVacuum(db: AppDatabase) {
  if (vacuumScheduled) return;
  vacuumScheduled = true;
  setImmediate(() => {
    try {
      vacuumDesignCritiqueMetrics(db);
    } catch (error) {
      logger.warn('critique.metrics.vacuum_failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

export function vacuumDesignCritiqueMetrics(db: AppDatabase, now = new Date()) {
  const cutoff = new Date(now.getTime() - RETENTION_MS).toISOString();
  const result = db
    .prepare('DELETE FROM design_critique_metrics WHERE started_at < ?')
    .run(cutoff);
  logger.info('critique.metrics.vacuum', {
    deletedRows: result.changes,
    cutoff,
  });
  return result.changes;
}

interface DesignCritiqueMetricsDbRow {
  run_id: string;
  project_id: string;
  rollout_phase: string;
  outcome: CritiqueRunOutcome;
  panelist_count: number;
  must_fix_count: number;
  total_score: number;
  duration_ms: number;
  conformance_ok: number;
  degraded_panelist_count: number;
  started_at: string;
  ended_at: string;
}

function mapMetricRow(
  row: DesignCritiqueMetricsDbRow,
): DesignCritiqueMetricRow {
  return {
    runId: row.run_id,
    projectId: row.project_id,
    rolloutPhase: row.rollout_phase,
    outcome: row.outcome,
    panelistCount: row.panelist_count,
    mustFixCount: row.must_fix_count,
    totalScore: row.total_score,
    durationMs: row.duration_ms,
    conformanceOk: row.conformance_ok === 1,
    degradedPanelistCount: row.degraded_panelist_count,
    startedAt: row.started_at,
    endedAt: row.ended_at,
  };
}
