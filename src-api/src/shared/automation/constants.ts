/**
 * Automation Engine Constants
 *
 * Named constants for all automation system configuration.
 * Every magic number is extracted here for easy management.
 */

// ============================================================================
// Execution Limits
// ============================================================================

/**
 * Maximum concurrent automation runs (global across all channels).
 * Heartbeats are limited to MAX_CONCURRENT_RUNS - 1 to prevent starvation.
 *
 * SCALE: At higher automation counts, consider per-channel concurrency limits
 * or a weighted fair-share scheduler (e.g., DRF) instead of a flat global cap.
 */
export const MAX_CONCURRENT_RUNS = 3;

/** Default execution timeout per run (10 minutes) */
export const DEFAULT_RUN_TIMEOUT_MS = 10 * 60_000;

/** Maximum execution timeout per run (1 hour) */
export const MAX_RUN_TIMEOUT_MS = 60 * 60_000;

/**
 * Maximum automations allowed (global).
 * SCALE: Move to per-channel or per-user quotas when multi-tenant.
 */
export const MAX_AUTOMATIONS = 50;

// ============================================================================
// Run History
// ============================================================================

/** Maximum stored runs per automation before eviction */
export const MAX_STORED_RUNS_PER_AUTOMATION = 100;

/** Run history TTL (7 days) */
export const AUTOMATION_RUN_TTL_MS = 7 * 24 * 60 * 60_000;

// ============================================================================
// Cron Scheduling
// ============================================================================

/** Cron timer max delay to prevent Node.js drift */
export const CRON_MAX_TIMER_MS = 60_000;

/** Minimum gap between cron re-fires */
export const CRON_MIN_REFIRE_GAP_MS = 2_000;

/** Exponential backoff schedule for cron errors */
export const ERROR_BACKOFF_SCHEDULE_MS = [
  30_000, 60_000, 300_000, 900_000, 3_600_000,
];

// ============================================================================
// Heartbeat
// ============================================================================

/** Default heartbeat interval (30 minutes) */
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 30 * 60_000;

// ============================================================================
// Webhook
// ============================================================================

/** Webhook rate limit: max failures per window */
export const WEBHOOK_RATE_LIMIT_MAX_FAILURES = 20;

/** Webhook rate limit: window duration */
export const WEBHOOK_RATE_LIMIT_WINDOW_MS = 60_000;

/** Default webhook max body size (1 MB) */
export const WEBHOOK_DEFAULT_MAX_BODY_BYTES = 1_024 * 1_024;

/** Webhook token length in bytes */
export const WEBHOOK_TOKEN_BYTES = 32;

// ============================================================================
// UI
// ============================================================================

/** UI polling interval for active runs */
export const UI_POLLING_INTERVAL_MS = 5_000;

// ============================================================================
// Delivery
// ============================================================================

/** Max characters for error text in Slack notification */
export const SLACK_ERROR_MAX_LENGTH = 500;

/** Max characters for result text in Slack notification */
export const SLACK_RESULT_MAX_LENGTH = 1_000;

// ============================================================================
// Lifecycle
// ============================================================================

/** Lifecycle check interval — drift-corrected timer tick (60 seconds) */
export const LIFECYCLE_CHECK_INTERVAL_MS = 60_000;

/** Consecutive failures before auto-disabling an automation */
export const MAX_CONSECUTIVE_FAILURES = 5;

/** Default global daily cost budget (USD) */
export const DEFAULT_GLOBAL_DAILY_COST = 10;

/** Default global monthly cost budget (USD) */
export const DEFAULT_GLOBAL_MONTHLY_COST = 100;

/** Cost ledger: max daily entries to retain */
export const MAX_COST_LEDGER_DAILY_ENTRIES = 90;

/** Cost ledger: max monthly entries to retain */
export const MAX_COST_LEDGER_MONTHLY_ENTRIES = 24;

// ============================================================================
// Channel Delivery
// ============================================================================

/** Max deliveries per channel per hour */
export const CHANNEL_DELIVERY_RATE_LIMIT = 60;

/**
 * Global ceiling for an automation result body before truncation, applied
 * across all platforms (Slack, Telegram, Discord, Lark, desktop). Above this
 * the formatter inserts a `(truncated)` marker, even on platforms whose
 * per-platform max length is higher (Lark 30 000, desktop 100 000). Sized to
 * Slack's `type: "markdown"` block limit (12 000 chars) so a long report
 * still renders in full there; if a longer-body platform needs the full
 * body, raise this constant rather than the per-platform max.
 */
export const CHANNEL_DELIVERY_MAX_RESULT_LENGTH = 12_000;

// ============================================================================
// Startup Recovery
// ============================================================================

/** Missed-fire threshold — skip recovery if missed by more than this (2 hours) */
export const MISSED_FIRE_THRESHOLD_MS = 2 * 60 * 60_000;

/** Stagger delay between recovered missed fires to prevent thundering herd */
export const MISSED_FIRE_STAGGER_MS = 3_000;

// ============================================================================
// Graceful Shutdown
// ============================================================================

/** Grace period to wait for in-progress runs before aborting (10 seconds) */
export const SHUTDOWN_GRACE_PERIOD_MS = 10_000;

// ============================================================================
// Suppress-Empty
// ============================================================================

/** Structured token for "nothing to report" detection (language-agnostic) */
export const HEARTBEAT_OK_TOKEN = '@@HEARTBEAT_OK';

/** Minimum result length to consider as non-empty (chars) */
export const SUPPRESS_EMPTY_MIN_LENGTH = 50;

// ============================================================================
// MCP Schedule Tools
// ============================================================================

/** Max automations created per hour per session */
export const SCHEDULE_CREATE_RATE_LIMIT = 5;

/** Minimum cron interval (60 seconds — reject sub-minute cron expressions) */
export const MIN_CRON_INTERVAL_MS = 60_000;

// ============================================================================
// Persistence
// ============================================================================

/** Automation store filename */
export const AUTOMATION_STORE_FILENAME = 'automation-store.json';

// ============================================================================
// Validation
// ============================================================================

/** Pattern for safe path segments (no traversal, no special chars) */
export const SAFE_PATH_SEGMENT = /^[\w][\w.\-/]*$/;
