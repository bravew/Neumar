import { getSetting } from '@/shared/db/operations';
import { redactDesignTelemetryPayload } from '@/shared/services/design-mode/redact';
import {
  getDesignTelemetrySettings,
  getDesignTelemetrySink,
} from '@/shared/services/design-mode/telemetry';
import { createLogger } from '@/shared/utils/logger';

import type { CritiqueAdapterFailureReason } from '../adapters/types';
import type { CritiqueRunOutcome } from './metrics';

// EVENT_TAXONOMY
// The critique taxonomy is intentionally closed. Additions must update
// rollup persistence and rollout-ratchet rules before this list changes.
export const CRITIQUE_EVENT_TYPES = [
  'critique.run.started',
  'critique.run.ended',
  'critique.panelist.started',
  'critique.panelist.ended',
  'critique.panelist.failed',
  'critique.adapter.degraded',
  'critique.parser.warning',
  'critique.conformance.violation',
  'critique.rollout.ratchet',
] as const;

export type CritiqueEventType = (typeof CRITIQUE_EVENT_TYPES)[number];

export type CritiqueEventPayload =
  | {
      type: 'critique.run.started';
      runId: string;
      projectId: string;
      rolloutPhase: string;
    }
  | {
      type: 'critique.run.ended';
      runId: string;
      projectId: string;
      rolloutPhase: string;
      outcome: CritiqueRunOutcome;
      durationMs: number;
      panelistCount: number;
      mustFixCount: number;
      totalScore: number;
      conformanceOk: boolean;
      degradedPanelistCount: number;
      startedAt: string;
      endedAt: string;
    }
  | {
      type: 'critique.panelist.started';
      runId: string;
      projectId: string;
      panelistId: string;
      round: number;
      capability: 'primary' | 'degraded';
    }
  | {
      type: 'critique.panelist.ended';
      runId: string;
      projectId: string;
      panelistId: string;
      round: number;
      capability: 'primary' | 'degraded';
      ok: boolean;
      durationMs: number;
      score?: number;
      mustFixCount?: number;
    }
  | {
      type: 'critique.panelist.failed';
      runId: string;
      projectId: string;
      panelistId: string;
      round: number;
      reason: CritiqueAdapterFailureReason;
    }
  | {
      type: 'critique.adapter.degraded';
      runId: string;
      projectId: string;
      panelistId: string;
      round: number;
      primaryReason: CritiqueAdapterFailureReason;
    }
  | {
      type: 'critique.parser.warning';
      runId: string;
      projectId: string;
      panelistId: string;
      round: number;
      warning: string;
    }
  | {
      type: 'critique.conformance.violation';
      adapterId: string;
      panelistId: string;
      caseId: string;
      fieldsDiffed: string[];
      runId?: string;
    }
  | {
      type: 'critique.rollout.ratchet';
      from: string;
      to: string;
      reason: string;
      runId?: string;
    };

export interface CritiqueTelemetryEvent {
  type: CritiqueEventType;
  at: string;
  payload: Omit<CritiqueEventPayload, 'type'>;
}

const logger = createLogger('CritiqueTheater');
const conformanceViolationsByRunId = new Map<string, number>();

export async function emitCritiqueEvent(
  event: CritiqueEventPayload,
): Promise<CritiqueTelemetryEvent> {
  const at = new Date().toISOString();
  const settings = getDesignTelemetrySettings();
  const { type, ...payload } = event;
  const redactedPayload = redactDesignTelemetryPayload(payload, {
    sendIdentity: settings.sendIdentity,
    workspaceRoot: getSetting('workDir') ?? undefined,
  });
  const telemetryEvent = {
    type,
    at,
    payload: redactedPayload,
  } satisfies CritiqueTelemetryEvent;

  if (event.type === 'critique.conformance.violation' && event.runId) {
    conformanceViolationsByRunId.set(
      event.runId,
      (conformanceViolationsByRunId.get(event.runId) ?? 0) + 1,
    );
  }
  writeStructuredLog(telemetryEvent);

  const sink = getDesignTelemetrySink();
  if (sink && settings.enabled && telemetryCategoryEnabled(type, settings)) {
    try {
      await sink.send(telemetryEvent);
    } catch (error) {
      logger.warn('critique.telemetry.forward_failed', {
        type,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return telemetryEvent;
}

export function hasCritiqueConformanceViolation(runId: string) {
  return (conformanceViolationsByRunId.get(runId) ?? 0) > 0;
}

export function clearCritiqueRunViolations(runId: string) {
  conformanceViolationsByRunId.delete(runId);
}

export function clearCritiqueObservabilityForTest() {
  conformanceViolationsByRunId.clear();
}

function telemetryCategoryEnabled(
  type: CritiqueEventType,
  settings: ReturnType<typeof getDesignTelemetrySettings>,
) {
  if (
    type === 'critique.panelist.failed' ||
    type === 'critique.conformance.violation'
  ) {
    return settings.categories.errors;
  }
  return settings.categories.runs;
}

function writeStructuredLog(event: CritiqueTelemetryEvent) {
  switch (event.type) {
    case 'critique.run.started':
    case 'critique.run.ended':
    case 'critique.rollout.ratchet':
      logger.info(event.type, event.payload);
      return;
    case 'critique.panelist.failed':
    case 'critique.adapter.degraded':
      logger.warn(event.type, event.payload);
      return;
    case 'critique.conformance.violation':
      logger.error(event.type, event.payload);
      return;
    case 'critique.panelist.started':
    case 'critique.panelist.ended':
    case 'critique.parser.warning':
      return;
    default:
      return;
  }
}
