import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { migration as critiqueMetricsMigration } from '@/shared/db/migrations/022_design_critique_metrics';
import { saveSetting } from '@/shared/db/operations';
import {
  clearCritiqueObservabilityForTest,
  emitCritiqueEvent,
  hasCritiqueConformanceViolation,
} from '@/shared/services/design-mode/critique/observability/events';
import {
  listDesignCritiqueMetrics,
  recordDesignCritiqueMetrics,
  vacuumDesignCritiqueMetrics,
} from '@/shared/services/design-mode/critique/observability/metrics';
import {
  isCritiqueTracingEnabled,
  startCritiqueRunSpan,
} from '@/shared/services/design-mode/critique/observability/tracing';
import { setDesignTelemetrySink } from '@/shared/services/design-mode/telemetry';

describe('critique observability', () => {
  let home = '';

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'neumar-critique-obs-'));
    vi.stubEnv('HOME', home);
    clearCritiqueObservabilityForTest();
    setDesignTelemetrySink(null);
  });

  afterEach(async () => {
    const { closeDatabase } = await import('@/shared/db');
    closeDatabase();
    setDesignTelemetrySink(null);
    vi.unstubAllEnvs();
    rmSync(home, { recursive: true, force: true });
  });

  it('redacts and forwards critique events through the telemetry sink', async () => {
    const sent: unknown[] = [];
    saveSetting(
      'designMode',
      JSON.stringify({
        telemetry: {
          enabled: true,
          categories: { runs: true, schedules: true, errors: true },
        },
      }),
    );
    setDesignTelemetrySink({
      async send(event) {
        sent.push(event);
      },
    });

    await emitCritiqueEvent({
      type: 'critique.run.started',
      runId: 'jury_telemetry1',
      projectId: 'design_alice@example.com',
      rolloutPhase: 'M1',
    });

    expect(sent).toHaveLength(1);
    expect(JSON.stringify(sent[0])).toContain('<redacted:email>');
  });

  it('tracks conformance violations by run id for metrics rollups', async () => {
    await emitCritiqueEvent({
      type: 'critique.conformance.violation',
      adapterId: 'scoreboard-primary-designer',
      panelistId: 'designer',
      caseId: 'happy',
      fieldsDiffed: ['score'],
      runId: 'jury_conformance1',
    });

    expect(hasCritiqueConformanceViolation('jury_conformance1')).toBe(true);
    expect(hasCritiqueConformanceViolation('jury_other')).toBe(false);
  });

  it('persists critique metrics and vacuums rows older than 90 days', () => {
    const db = new Database(':memory:');
    critiqueMetricsMigration.up(db);
    recordDesignCritiqueMetrics(
      {
        runId: 'jury_metric1',
        projectId: 'design_metric',
        rolloutPhase: 'M1',
        outcome: 'shipped',
        panelistCount: 5,
        mustFixCount: 2,
        totalScore: 8,
        durationMs: 1200,
        conformanceOk: true,
        degradedPanelistCount: 0,
        startedAt: '2026-05-15T00:00:00.000Z',
        endedAt: '2026-05-15T00:00:01.200Z',
      },
      db,
    );
    recordDesignCritiqueMetrics(
      {
        runId: 'jury_old1',
        projectId: 'design_old',
        rolloutPhase: 'M1',
        outcome: 'failed',
        panelistCount: 0,
        mustFixCount: 0,
        totalScore: 0,
        durationMs: 1,
        conformanceOk: false,
        degradedPanelistCount: 0,
        startedAt: '2026-01-01T00:00:00.000Z',
        endedAt: '2026-01-01T00:00:00.001Z',
      },
      db,
    );

    expect(
      vacuumDesignCritiqueMetrics(db, new Date('2026-05-15T00:00:00Z')),
    ).toBe(1);
    expect(
      (
        db
          .prepare('SELECT run_id FROM design_critique_metrics ORDER BY run_id')
          .all() as { run_id: string }[]
      ).map((row) => row.run_id),
    ).toEqual(['jury_metric1']);
    db.close();
  });

  it('lists persisted metrics from the app database', () => {
    recordDesignCritiqueMetrics({
      runId: 'jury_metric2',
      projectId: 'design_metric',
      rolloutPhase: 'M1',
      outcome: 'degraded',
      panelistCount: 5,
      mustFixCount: 1,
      totalScore: 7,
      durationMs: 900,
      conformanceOk: false,
      degradedPanelistCount: 1,
      startedAt: '2026-05-15T00:00:00.000Z',
      endedAt: '2026-05-15T00:00:00.900Z',
    });

    expect(listDesignCritiqueMetrics({ limit: 50 })).toEqual([
      expect.objectContaining({
        runId: 'jury_metric2',
        outcome: 'degraded',
        conformanceOk: false,
      }),
    ]);
  });

  it('keeps tracing disabled unless the OTLP endpoint is configured', async () => {
    vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', '');

    expect(isCritiqueTracingEnabled()).toBe(false);
    await expect(startCritiqueRunSpan('jury_trace1')).resolves.toMatchObject({
      setAttribute: expect.any(Function),
      end: expect.any(Function),
    });
  });
});
