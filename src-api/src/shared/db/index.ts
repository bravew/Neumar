/**
 * Backend SQLite Database Layer
 *
 * Provides a unified database interface for both browser and desktop modes.
 * Uses better-sqlite3 for high-performance synchronous SQLite operations.
 *
 * Features:
 * - Singleton with reconnection on failure
 * - Versioned migrations via migrations/runner.ts
 */

import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';

import Database from 'better-sqlite3';

import { APP_DATA_DIR } from '@/config/branding';

import { seedDefaultPricing } from '@/shared/services/pricing';
import { createLogger } from '@/shared/utils/logger';

import { migration as migration001 } from './migrations/001_init';
import { migration as migration002 } from './migrations/002_add_thinking_config';
import { migration as migration003 } from './migrations/003_multi_bot';
import { migration as migration004 } from './migrations/004_add_file_provenance';
import { migration as migration005 } from './migrations/005_plugins';
import { migration as migration006 } from './migrations/006_agent_loop_v2';
import { migration as migration007 } from './migrations/007_trace_events';
import { migration as migration008 } from './migrations/008_gateway_routing_rules';
import { migration as migration009 } from './migrations/009_recall_audit';
import { migration as migration010 } from './migrations/010_workspace_chunks';
import { migration as migration011 } from './migrations/011_security_events';
import { migration as migration012 } from './migrations/012_feedback';
import { migration as migration013 } from './migrations/013_slack_app_home';
import { migration as migration014 } from './migrations/014_slack_app_home_per_bot';
import { migration as migration015 } from './migrations/015_design_projects';
import { migration as migration016 } from './migrations/016_cloud_storage_local';
import { migration as migration017 } from './migrations/017_cloud_storage_local_cursors';
import { migration as migration018 } from './migrations/018_cloud_storage_path_mappings';
import { migration as migration019 } from './migrations/019_publish_tables';
import { migration as migration020 } from './migrations/020_publish_leg_approvals';
import { migration as migration021 } from './migrations/021_design_routines';
import { migration as migration022 } from './migrations/022_design_critique_metrics';
import { migration as migration023 } from './migrations/023_connector_tool_overrides';
import { migration as migration024 } from './migrations/024_channel_leases';
import { migration as migration025 } from './migrations/025_agent_questions';
import { migration as migration026 } from './migrations/026_publish_workflows';
import { migration as migration027 } from './migrations/027_video_mode_foundation';
import { migration as migration028 } from './migrations/028_video_linked_sources';
import { migration as migration029 } from './migrations/029_video_linked_asset_search';
import { migration as migration030 } from './migrations/030_video_linked_asset_activity';
import { migration as migration031 } from './migrations/031_embedding_cache_lru';
import { migration as migration032 } from './migrations/032_video_conversation_mode';
import { migration as migration033 } from './migrations/033_video_recipe_tool_rename';
import { migration as migration034 } from './migrations/034_assets_catalog';
import { migration as migration035 } from './migrations/035_assets_materialization';
import { migration as migration036 } from './migrations/036_task_agent_session_id';
import { migration as migration037 } from './migrations/037_video_project_workspace_root';
import { migration as migration038 } from './migrations/038_plugin_runtime_trust';
import { migration as migration039 } from './migrations/039_video_intent_plugin_snapshot';
import { migration as migration040 } from './migrations/040_video_plugin_candidate_source_id';
import { migration as migration041 } from './migrations/041_video_agent_history';
import { migration as migration042 } from './migrations/042_video_media_frame_search';
import { migration as migration043 } from './migrations/043_plugin_config';
import { migration as migration044 } from './migrations/044_task_plugin_snapshot';
import { migration as migration045 } from './migrations/045_marketplace_sources';
import { migration as migration046 } from './migrations/046_agent_resume_identity';
import { migration as migration047 } from './migrations/047_runtime_state';
import { migration as migration048 } from './migrations/048_provider_conversation_state';
import { migration as migration049 } from './migrations/049_run_context_lineage';
import { migration as migration050 } from './migrations/050_owner_neutral_trace_events';
import { migration as migration051 } from './migrations/051_reconcile_run_context_schema';
import { migration as migration052 } from './migrations/052_reconcile_legacy_runtime_schema';
import { migration as migration053 } from './migrations/053_video_intent_plan_identity';
import { migration as migration054 } from './migrations/054_messages_is_error';
import { migration as migration055 } from './migrations/055_external_mcp';
import { runMigrations } from './migrations/runner';

const logger = createLogger('Database');
const critiqueLogger = createLogger('CritiqueTheater');

/** Database file name within the app data directory */
const DB_FILE_NAME = 'database.db';

export const DATABASE_MIGRATIONS = [
  migration001,
  migration002,
  migration003,
  migration004,
  migration005,
  migration006,
  migration007,
  migration008,
  migration009,
  migration010,
  migration011,
  migration012,
  migration013,
  migration014,
  migration015,
  migration016,
  migration017,
  migration018,
  migration019,
  migration020,
  migration021,
  migration022,
  migration023,
  migration024,
  migration025,
  migration026,
  migration027,
  migration028,
  migration029,
  migration030,
  migration031,
  migration032,
  migration033,
  migration034,
  migration035,
  migration036,
  migration037,
  migration038,
  migration039,
  migration040,
  migration041,
  migration042,
  migration043,
  migration044,
  migration045,
  migration046,
  migration047,
  migration048,
  migration049,
  migration050,
  migration051,
  migration052,
  migration053,
  migration054,
  migration055,
];

const REQUIRED_SCHEMA_COLUMNS = {
  tasks: ['agent_session_id'],
} as const;

// Database instance (singleton)
let db: Database.Database | null = null;

/**
 * Get or create the database instance.
 * Includes reconnection logic — if the existing connection is broken,
 * it will be closed and a new one created.
 */
export function getDatabase(): Database.Database {
  if (db) {
    try {
      // Verify the connection is still alive
      db.pragma('journal_mode');
      return db;
    } catch {
      logger.warn('Database connection lost, reconnecting...');
      try {
        db.close();
      } catch {
        // Connection already broken, ignore
      }
      db = null;
    }
  }

  const homeDir = process.env.HOME || process.env.USERPROFILE || '';
  // APP_DATA_DIR already includes the leading dot (e.g., '.neumar')
  const appDir = join(homeDir, APP_DATA_DIR);
  const dbPath = join(appDir, DB_FILE_NAME);

  logger.debug(`Opening database at: ${dbPath}`);

  // Ensure directory exists
  if (!existsSync(appDir)) {
    mkdirSync(appDir, { recursive: true });
    logger.info(`Created database directory: ${appDir}`);
  }

  // Create database connection
  db = new Database(dbPath);

  // Enable WAL mode for better concurrency
  db.pragma('journal_mode = WAL');
  // Auto-checkpoint after every 100 pages (ensures cross-process visibility)
  db.pragma('wal_autocheckpoint = 100');

  // Run migrations
  runMigrations(db, DATABASE_MIGRATIONS);
  const reconciledRuns = db
    .prepare(
      `UPDATE agent_runs
       SET status = 'failed', finished_at = datetime('now'),
           completeness = 'unfinished', retry = 'user_action',
           failure_cause = 'process_restarted',
           error = COALESCE(error, 'Run interrupted by application restart')
       WHERE status = 'running'`,
    )
    .run().changes;
  if (reconciledRuns > 0) {
    logger.warn('Reconciled orphaned agent runs after restart', {
      count: reconciledRuns,
    });
  }
  assertRequiredSchema(db);

  // Seed default model pricing
  seedDefaultPricing();
  scheduleDesignCritiqueMetricsVacuum(db);

  logger.info('Database schema initialized successfully');

  return db;
}

let critiqueMetricsVacuumScheduled = false;

function scheduleDesignCritiqueMetricsVacuum(database: Database.Database) {
  if (critiqueMetricsVacuumScheduled) return;
  critiqueMetricsVacuumScheduled = true;
  setImmediate(() => {
    try {
      const cutoff = new Date(
        Date.now() - 90 * 24 * 60 * 60 * 1000,
      ).toISOString();
      const result = database
        .prepare('DELETE FROM design_critique_metrics WHERE started_at < ?')
        .run(cutoff);
      critiqueLogger.info('critique.metrics.vacuum', {
        deletedRows: result.changes,
        cutoff,
      });
    } catch (error) {
      critiqueLogger.warn('critique.metrics.vacuum_failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

/**
 * Perform a passive WAL checkpoint.
 * Ensures writes from other processes (e.g., a production sidecar running
 * alongside a dev API server) are visible to this connection.
 */
export function checkpointWal(): void {
  try {
    const database = getDatabase();
    database.pragma('wal_checkpoint(PASSIVE)');
  } catch {
    // Checkpoint failure is non-critical
  }
}

/**
 * Close the database connection
 */
export function closeDatabase() {
  if (db) {
    logger.info('Closing database connection');
    db.close();
    db = null;
  }
}

/**
 * Export the database instance for advanced usage
 */
export { Database };

function assertRequiredSchema(database: Database.Database): void {
  for (const [table, requiredColumns] of Object.entries(
    REQUIRED_SCHEMA_COLUMNS,
  )) {
    const columns = database.pragma(`table_info(${table})`) as {
      name: string;
    }[];
    const columnNames = new Set(columns.map((column) => column.name));
    const missingColumns = requiredColumns.filter(
      (column) => !columnNames.has(column),
    );

    if (missingColumns.length > 0) {
      throw new Error(
        `Database schema missing required column(s): ${missingColumns
          .map((column) => `${table}.${column}`)
          .join(', ')}`,
      );
    }
  }
}
