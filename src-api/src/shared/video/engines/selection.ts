import { createLogger } from '@/shared/utils/logger';

import { listVideoEngines, type VideoEngineSummary } from './registry';
import type {
  EngineAvailability,
  EngineId,
  EngineUnavailableReason,
  VideoEngineAdapter,
} from './types';

const logger = createLogger('VideoEngineSelection');

/**
 * Runtime-selection contract (Phase E, P2-6).
 *
 * Three engines are real now (`remotion`, `html`, `hyperframes`), so "pick an
 * engine" stopped being a formality. The contract has three parts:
 *
 *  1. every option is presented with honest tradeoffs, not just the winner;
 *  2. the decision is logged with every option that was considered;
 *  3. an unavailable engine escalates with its typed reason — it is never
 *     silently substituted (Cross-Phase Principle 3).
 */

export type EngineSelectionReason =
  | 'explicit-request'
  | 'only-available'
  | 'preference-order';

export interface EngineSelectionOption {
  id: EngineId;
  name: string;
  version: string;
  installed: boolean;
  /** Typed unavailable reason, present only when `installed` is false. */
  unavailableReason?: EngineUnavailableReason;
  detectedVersion?: string;
  requiredVersion?: string;
  detail?: string;
  /** Honest tradeoffs, lifted verbatim from the adapter's capabilities. */
  bestFor: string[];
  weaknesses: string[];
  outputFormats: string[];
  alpha: boolean;
  renderSpeedHint?: 'realtime' | 'faster' | 'slower';
  licensing: string;
}

export interface EngineSelectionDecision {
  schema: 'neuma.video.engine-selection.v1';
  decidedAt: string;
  requestedEngineId?: EngineId;
  selectedEngineId: EngineId;
  reason: EngineSelectionReason;
  /** Every engine considered, in preference order — including rejected ones. */
  options: EngineSelectionOption[];
}

export type EngineSelectionErrorCode =
  | 'unknown-engine'
  | 'engine-unavailable'
  | 'no-engine-available';

export class EngineSelectionError extends Error {
  constructor(
    public readonly code: EngineSelectionErrorCode,
    message: string,
    public readonly decisionInput: {
      requestedEngineId?: EngineId;
      unavailableReason?: EngineUnavailableReason;
      options: EngineSelectionOption[];
    },
  ) {
    super(message);
    this.name = 'EngineSelectionError';
  }
}

/**
 * Fallback preference when the caller expressed no engine. Deliberately
 * ordered, and deliberately *not* a substitution rule: it only applies when
 * nothing was requested.
 */
const DEFAULT_PREFERENCE: EngineId[] = ['remotion', 'hyperframes', 'html'];

export function toEngineSelectionOption(
  summary: VideoEngineSummary,
): EngineSelectionOption {
  const availability = summary.availability;
  return {
    id: summary.id,
    name: summary.name,
    version: summary.upstreamVersion,
    installed: availability.installed,
    ...(availability.installed
      ? { detectedVersion: availability.version }
      : {
          unavailableReason: availability.reason,
          ...(availability.version
            ? { detectedVersion: availability.version }
            : {}),
          ...(availability.requiredVersion
            ? { requiredVersion: availability.requiredVersion }
            : {}),
          ...(availability.detail ? { detail: availability.detail } : {}),
        }),
    bestFor: summary.capabilities.bestFor ?? [],
    weaknesses: summary.capabilities.weaknesses ?? [],
    outputFormats: [...summary.capabilities.outputFormats],
    alpha: summary.capabilities.alpha,
    ...(summary.capabilities.renderSpeedHint
      ? { renderSpeedHint: summary.capabilities.renderSpeedHint }
      : {}),
    licensing: summary.capabilities.licensing,
  };
}

/** Options in preference order, each with its honest tradeoffs. */
export async function listEngineSelectionOptions(): Promise<
  EngineSelectionOption[]
> {
  const summaries = await listVideoEngines();
  return sortByPreference(summaries.map(toEngineSelectionOption));
}

function sortByPreference(
  options: EngineSelectionOption[],
): EngineSelectionOption[] {
  const rank = (id: EngineId) => {
    const index = DEFAULT_PREFERENCE.indexOf(id);
    return index === -1 ? DEFAULT_PREFERENCE.length : index;
  };
  return [...options].sort((left, right) => rank(left.id) - rank(right.id));
}

export interface SelectVideoEngineInput {
  /** The engine the caller asked for. Omit to let the preference order decide. */
  requestedEngineId?: EngineId;
  /** Pre-computed options; omit to probe the registry. */
  options?: EngineSelectionOption[];
}

/**
 * Resolve one engine, or escalate. Never substitutes a different engine for an
 * unavailable requested one — the caller (ultimately the user) chooses.
 */
export async function selectVideoEngine(
  input: SelectVideoEngineInput = {},
): Promise<EngineSelectionDecision> {
  const options = sortByPreference(
    input.options ?? (await listEngineSelectionOptions()),
  );
  const requestedEngineId = input.requestedEngineId;

  if (requestedEngineId) {
    const requested = options.find((option) => option.id === requestedEngineId);
    if (!requested) {
      throw new EngineSelectionError(
        'unknown-engine',
        `No video engine registered for id "${requestedEngineId}". Available: ${
          options.map((option) => option.id).join(', ') || 'none'
        }.`,
        { requestedEngineId, options },
      );
    }
    if (!requested.installed) {
      throw new EngineSelectionError(
        'engine-unavailable',
        unavailableMessage(requested),
        {
          requestedEngineId,
          ...(requested.unavailableReason
            ? { unavailableReason: requested.unavailableReason }
            : {}),
          options,
        },
      );
    }
    return logDecision({
      schema: 'neuma.video.engine-selection.v1',
      decidedAt: new Date().toISOString(),
      requestedEngineId,
      selectedEngineId: requested.id,
      reason: 'explicit-request',
      options,
    });
  }

  const installed = options.filter((option) => option.installed);
  if (installed.length === 0) {
    throw new EngineSelectionError(
      'no-engine-available',
      'No video render engine is available on this host.',
      { options },
    );
  }
  const selected = installed[0]!;
  return logDecision({
    schema: 'neuma.video.engine-selection.v1',
    decidedAt: new Date().toISOString(),
    selectedEngineId: selected.id,
    reason: installed.length === 1 ? 'only-available' : 'preference-order',
    options,
  });
}

/**
 * Pre-flight for a render that already knows its engine (template metadata
 * picks it today). Escalates with the typed reason instead of falling back.
 */
export async function assertVideoEngineSelectable(
  engineId: EngineId,
  options?: EngineSelectionOption[],
): Promise<EngineSelectionDecision> {
  return selectVideoEngine({
    requestedEngineId: engineId,
    ...(options ? { options } : {}),
  });
}

/**
 * Same contract, but against an adapter instance the caller already holds —
 * the render path resolves its adapter from template metadata, and test
 * harnesses inject one that was never put in the global registry.
 */
export async function assertEngineAdapterAvailable(
  adapter: VideoEngineAdapter,
): Promise<EngineSelectionDecision> {
  let availability: EngineAvailability;
  try {
    availability = await Promise.resolve(adapter.probeAvailability());
  } catch (error) {
    availability = {
      installed: false,
      reason: 'not-found',
      detail: error instanceof Error ? error.message : String(error),
    };
  }
  const option = toEngineSelectionOption({
    id: adapter.id,
    name: adapter.name,
    upstreamVersion: adapter.upstreamVersion,
    installed: availability.installed,
    availability,
    capabilities: adapter.capabilities,
  });
  return selectVideoEngine({
    requestedEngineId: adapter.id,
    options: [option],
  });
}

export function unavailableMessage(option: EngineSelectionOption): string {
  const detail = option.detail ? ` (${option.detail})` : '';
  switch (option.unavailableReason) {
    case 'version-too-old':
      return `${option.name} ${option.detectedVersion ?? 'unknown'} is older than the required ${
        option.requiredVersion ?? option.version
      }${detail}. Upgrade it, or pick another engine — Neuma will not substitute one silently.`;
    case 'browser-missing':
      return `${option.name} is installed but its rendering browser is missing${detail}. Install the browser, or pick another engine — Neuma will not substitute one silently.`;
    case 'not-found':
    default:
      return `${option.name} is not installed on this host${detail}. Install it, or pick another engine — Neuma will not substitute one silently.`;
  }
}

function logDecision(
  decision: EngineSelectionDecision,
): EngineSelectionDecision {
  logger.info(
    `engine selected: ${decision.selectedEngineId} (${decision.reason}); considered ${decision.options
      .map(
        (option) =>
          `${option.id}=${option.installed ? 'available' : (option.unavailableReason ?? 'unavailable')}`,
      )
      .join(', ')}`,
  );
  return decision;
}
