/**
 * Automation Store
 *
 * JSON file persistence for automation state.
 * Follows the pipeline.ts pattern: read/write JSON with mkdir.
 *
 * Uses debounced writes to coalesce rapid status transitions
 * and prevent overlapping file writes under load.
 *
 * SCALE NOTE (future migration to SQLite):
 * ─────────────────────────────────────────
 * This JSON file approach works for the current scale (MAX_AUTOMATIONS=50)
 * but has known limitations that will require migrating to SQLite
 * (already used for tasks/sessions in src/shared/db/):
 *
 * 1. FULL REWRITE: Every saveStore() serializes the entire state and rewrites
 *    the file. With frequent heartbeats (every 1 min × N automations), this
 *    becomes O(N) I/O per tick. SQLite UPDATE touches only the changed row.
 *
 * 2. NO PARTIAL QUERIES: Loading all automations into memory just to find one
 *    by ID or filter by channel. SQLite WHERE clauses + indexes solve this.
 *
 * 3. NO ATOMIC TRANSACTIONS: Concurrent writes from heartbeat ticks, lifecycle
 *    checks, and API requests are serialized by debounce — but a crash mid-write
 *    can corrupt the file. SQLite with WAL mode gives atomic commits.
 *
 * 4. CHANNEL ISOLATION: Currently all channels share one file. SQLite would
 *    enable indexed queries by originChannel.platform for per-channel views
 *    without loading everything.
 *
 * 5. RUN HISTORY: With 50 automations × 100 runs each = 5000 run records in
 *    one JSON array. SQLite pagination + indexed automationId lookups scale better.
 *
 * Migration plan when needed:
 * - Create tables: automations, automation_runs, automation_cost_ledger
 * - Mirror the Automation/AutomationRun interfaces as columns
 * - Replace loadStore/saveStore/flushStore with DB operations
 * - Keep the debounced write pattern for high-frequency updates (nextRunAt,
 *   lastDeliveryHash) by batching into periodic DB flushes
 * - The existing store.ts API surface is small enough for a mechanical migration
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { getAppDir } from '@/config/constants';

import { createLogger } from '@/shared/utils/logger';

import { AUTOMATION_STORE_FILENAME } from './constants';
import type { Automation, AutomationStoreData } from './types';

const logger = createLogger('AutomationStore');

/** Current store schema version */
const CURRENT_VERSION = 2;

/** Debounce delay for coalescing rapid writes (ms) */
const SAVE_DEBOUNCE_MS = 500;

// ── Write coalescing state ──

let pendingWrite: ReturnType<typeof setTimeout> | null = null;
let writeInProgress = false;
let pendingData: AutomationStoreData | null = null;

/** Default empty store data */
function createEmptyStore(): AutomationStoreData {
  return {
    version: CURRENT_VERSION,
    automations: [],
    runs: [],
    cronState: {},
  };
}

/**
 * Migrate store data from older versions to current.
 * Adds default values for new fields on existing automations.
 */
function migrateStore(data: AutomationStoreData): void {
  if (data.version < 2) {
    // v1 → v2: Add lifecycle, channel delivery, origin, condition, policies
    for (const automation of data.automations) {
      const a = automation as Partial<Automation> & { id: string };
      a.runCount ??= 0;
      a.totalCost ??= 0;
      a.origin ??= 'api';
      a.locale ??= 'en-US';
      a.overlapPolicy ??= 'skip';
      a.missedFirePolicy ??= 'fire_once';
      a.consecutiveQuietRuns ??= 0;
    }
    if (!data.costLedger) {
      data.costLedger = { daily: [], monthly: [] };
    }
  }
  data.version = CURRENT_VERSION;
}

/**
 * Get the full path to the automation store file.
 */
export function getStorePath(): string {
  return join(getAppDir(), AUTOMATION_STORE_FILENAME);
}

/**
 * Load the automation store from disk.
 * Returns default empty store if the file does not exist.
 */
export async function loadStore(): Promise<AutomationStoreData> {
  try {
    const raw = await readFile(getStorePath(), 'utf-8');
    const data = JSON.parse(raw) as AutomationStoreData;

    // Migrate if needed
    if (data.version < CURRENT_VERSION) {
      logger.info('Migrating store from version', {
        from: data.version,
        to: CURRENT_VERSION,
      });
      migrateStore(data);
    }

    logger.info('Loaded automation store', {
      automations: data.automations.length,
      runs: data.runs.length,
    });

    return data;
  } catch (err) {
    // ENOENT or parse error — start fresh
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.warn('Failed to load store, starting fresh:', err);
    }
    return createEmptyStore();
  }
}

/**
 * Perform the actual disk write.
 * Called by the debounce timer and flushStore().
 */
async function writeToDisk(data: AutomationStoreData): Promise<void> {
  writeInProgress = true;
  try {
    const dir = getAppDir();
    await mkdir(dir, { recursive: true });
    await writeFile(getStorePath(), JSON.stringify(data, null, 2));
  } catch (err) {
    logger.error('Failed to save automation store:', err);
  } finally {
    writeInProgress = false;

    // If another save was requested while writing, process it now
    if (pendingData) {
      const nextData = pendingData;
      pendingData = null;
      await writeToDisk(nextData);
    }
  }
}

/**
 * Save the automation store to disk with debounced write coalescing.
 * Multiple rapid calls within SAVE_DEBOUNCE_MS are merged into a single write.
 */
export function saveStore(data: AutomationStoreData): void {
  // Clear any pending debounce timer — the latest data wins
  if (pendingWrite) {
    clearTimeout(pendingWrite);
    pendingWrite = null;
  }

  // If a write is in progress, queue the latest data for after it finishes
  if (writeInProgress) {
    pendingData = data;
    return;
  }

  pendingWrite = setTimeout(() => {
    pendingWrite = null;
    void writeToDisk(data);
  }, SAVE_DEBOUNCE_MS);
}

/**
 * Flush any pending writes immediately.
 * Called during engine shutdown to ensure state is persisted.
 */
export async function flushStore(data: AutomationStoreData): Promise<void> {
  if (pendingWrite) {
    clearTimeout(pendingWrite);
    pendingWrite = null;
  }
  pendingData = null;
  await writeToDisk(data);
}
