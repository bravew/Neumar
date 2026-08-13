/** Timeout for LLM title generation requests (ms). */
export const TITLE_GENERATION_TIMEOUT = 12_000;

/** Default max retries for fetchWithRetry(). */
export const DEFAULT_MAX_RETRIES = 3;

/** Default initial retry delay for fetchWithRetry() (ms). */
export const DEFAULT_RETRY_DELAY = 1000;

/** Default max conversation turns before history truncation. */
export const DEFAULT_MAX_CONVERSATION_TURNS = 30;

/** Short delay before removing a completed background task from state (ms). */
export const BACKGROUND_TASK_REMOVAL_DELAY = 50;

/** Max polling cycles (~10 minutes at 1 s interval) before declaring a task stale. */
export const MAX_STUCK_POLL_COUNT = 600;

/** Interval for polling background task messages (ms). */
export const MESSAGE_POLLING_INTERVAL = 1000;

/** Max characters of file content to store as a preview. */
export const FILE_PREVIEW_LENGTH = 500;

/** Delay before re-loading DB messages after continue-conversation SSE setup (ms). */
export const DEFERRED_DB_RELOAD_DELAY = 1500;

/** Multiplier for estimating max messages from max turns (user + assistant). */
export const STEP_HEURISTIC_MULTIPLIER = 2;

/** Max concurrent attachment loads. */
export const ATTACHMENT_LOAD_CONCURRENCY = 2;

/** Max characters for a truncated URL title. */
export const TITLE_TRUNCATION_LENGTH = 60;

/**
 * Regex-alternation of file extensions detected as artifacts (documents + media).
 * Single source of truth — used by file-detection patterns in useAgent and TaskDetail.
 */
export const DETECTABLE_FILE_EXT =
  'pptx|xlsx|docx|pdf|png|jpg|jpeg|gif|webp|svg|bmp|mp4|webm|mov|mp3|wav|flac';

/** Same as DETECTABLE_FILE_EXT plus html (used by Skill output detection). */
export const DETECTABLE_FILE_EXT_WITH_HTML = `${DETECTABLE_FILE_EXT}|html`;

/**
 * Maximum time (ms) to wait for any data on the planning SSE stream
 * before considering the backend unresponsive. Resets on each chunk.
 */
export const PLANNING_STREAM_IDLE_TIMEOUT = 90_000;
