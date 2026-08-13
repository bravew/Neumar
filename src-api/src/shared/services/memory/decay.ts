/**
 * Memory Decay Engine
 *
 * Implements exponential decay inspired by the Ebbinghaus forgetting curve.
 * Each memory has a type-specific decay rate (half-life); accessing a memory
 * resets its decay clock (spacing effect from cognitive science).
 *
 * Default half-lives by type:
 *   episodic: 7 days    (interactions fade quickly)
 *   semantic: 30 days   (facts persist moderately)
 *   procedural: 90 days (learned skills last long)
 *   pinned: ∞           (never decays)
 */

import { getDatabase } from '@/shared/db';
import { createLogger } from '@/shared/utils/logger';

import type {
  DecayConfig,
  LifecycleStatus,
  MemoryRow,
  MemoryType,
} from './types';

const logger = createLogger('MemoryDecay');

/**
 * Convert half-life (days) to exponential decay rate.
 * Formula: decayRate = ln(2) / halfLife
 */
export function halfLifeToDecayRate(halfLifeDays: number): number {
  if (halfLifeDays <= 0) return 0;
  return Math.LN2 / halfLifeDays;
}

/**
 * Calculate current memory strength using exponential decay.
 *
 * Formula: strength = importance × e^(-decayRate × daysSinceLastAccess)
 *
 * Each access resets the decay clock (spacing effect).
 * Higher importance = slower effective decay.
 * Pinned memories never decay.
 */
export function calculateStrength(memory: {
  importance: number;
  decayRate: number;
  lastAccessedAt: string | null;
  createdAt: string;
  memoryType: MemoryType;
}): number {
  if (memory.memoryType === 'pinned') return memory.importance;

  const referenceTime = memory.lastAccessedAt ?? memory.createdAt;
  const daysSince =
    (Date.now() - new Date(referenceTime).getTime()) / (1000 * 60 * 60 * 24);

  // Guard against future timestamps
  if (daysSince < 0) return memory.importance;

  return memory.importance * Math.exp(-memory.decayRate * daysSince);
}

/**
 * Prune memories whose strength has fallen below threshold.
 * Transitions: active → stale (below pruneThreshold), stale → archived (below archiveThreshold).
 * Pinned memories are never pruned.
 *
 * Returns counts of transitions performed.
 */
export function runDecayMaintenance(config: DecayConfig): {
  activeToStale: number;
  staleToArchived: number;
  staleToActive: number;
  reviewed: number;
} {
  if (!config.enabled) {
    return {
      activeToStale: 0,
      staleToArchived: 0,
      staleToActive: 0,
      reviewed: 0,
    };
  }

  const db = getDatabase();
  const archiveThreshold = config.pruneThreshold * 0.4; // ~0.02 by default

  // Get all non-pinned, non-archived memories
  const rows = db
    .prepare(
      `SELECT id, importance, decay_rate, last_accessed_at, created_at,
              memory_type, lifecycle_status
       FROM memories
       WHERE memory_type != 'pinned' AND lifecycle_status != 'archived'`,
    )
    .all() as Pick<
    MemoryRow,
    | 'id'
    | 'importance'
    | 'decay_rate'
    | 'last_accessed_at'
    | 'created_at'
    | 'memory_type'
    | 'lifecycle_status'
  >[];

  let activeToStale = 0;
  let staleToArchived = 0;
  let staleToActive = 0;

  const updateStatus = db.prepare(
    "UPDATE memories SET lifecycle_status = ?, updated_at = datetime('now') WHERE id = ?",
  );

  const runTransitions = db.transaction(() => {
    for (const row of rows) {
      const strength = calculateStrength({
        importance: row.importance,
        decayRate: row.decay_rate,
        lastAccessedAt: row.last_accessed_at,
        createdAt: row.created_at,
        memoryType: row.memory_type as MemoryType,
      });

      const currentStatus = row.lifecycle_status as LifecycleStatus;
      let newStatus: LifecycleStatus | null = null;

      if (currentStatus === 'active' && strength < config.pruneThreshold) {
        newStatus = 'stale';
        activeToStale++;
      } else if (currentStatus === 'stale' && strength < archiveThreshold) {
        newStatus = 'archived';
        staleToArchived++;
      } else if (
        currentStatus === 'stale' &&
        strength >= config.pruneThreshold
      ) {
        // Memory was re-accessed and strength recovered
        newStatus = 'active';
        staleToActive++;
      }

      if (newStatus) {
        updateStatus.run(newStatus, row.id);
      }
    }
  });

  runTransitions();

  if (activeToStale > 0 || staleToArchived > 0 || staleToActive > 0) {
    logger.info(
      `Decay maintenance: ${activeToStale} active→stale, ${staleToArchived} stale→archived, ` +
        `${staleToActive} stale→active (${rows.length} reviewed)`,
    );
  }

  return {
    activeToStale,
    staleToArchived,
    staleToActive,
    reviewed: rows.length,
  };
}

/** Interval handle for periodic decay maintenance */
let decayInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start periodic decay maintenance.
 * Runs once daily by default.
 */
export function startDecayMaintenance(
  config: DecayConfig,
  intervalMs: number = 24 * 60 * 60 * 1000,
): void {
  stopDecayMaintenance();

  if (!config.enabled) {
    logger.info('Decay maintenance disabled');
    return;
  }

  // Defer first run to avoid blocking the event loop on startup
  setImmediate(() => runDecayMaintenance(config));

  decayInterval = setInterval(() => {
    runDecayMaintenance(config);
  }, intervalMs);

  logger.info(
    `Decay maintenance started (interval: ${Math.round(intervalMs / 3600000)}h)`,
  );
}

/** Stop periodic decay maintenance. */
export function stopDecayMaintenance(): void {
  if (decayInterval) {
    clearInterval(decayInterval);
    decayInterval = null;
  }
}
