/**
 * Shared Logger Utility
 *
 * Provides file-based logging with:
 * - Daily rotation (MM-DD format, 14-day retention)
 * - Category-based log separation (app, gateway, integrations, system)
 * - Sensitive data redaction (keys, tokens, credentials)
 * - Async file writes
 *
 * Log files: ~/.<slug>/logs/<category>-MM-DD.log
 */

import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { appendFile, readdir, stat, unlink } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';

import { APP_DATA_DIR, APP_SLUG } from '@/config/branding';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOG_DIR = join(homedir(), APP_DATA_DIR, 'logs');
const MAX_RETENTION_DAYS = 14;
function isConsoleEnabled(): boolean {
  if (process.env.MCP_STDIO === '1') return false;
  return process.env.DEBUG === '1' || process.env.NODE_ENV !== 'production';
}

/**
 * ISO-8601 timestamp in the local timezone with UTC offset, e.g.
 *   `2026-04-19T11:05:39.592-04:00`.
 *
 * Readable at a glance (no mental UTC→local conversion) while still
 * machine-parseable by `new Date(...)` and every JSON log shipper.
 */
function localTimestamp(): string {
  const d = new Date();
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  const ms = pad(d.getMilliseconds(), 3);
  const offsetMin = -d.getTimezoneOffset(); // east of UTC → positive
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  const offset = `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${ms}` +
    offset
  );
}

export type LogCategory = 'app' | 'gateway' | 'integrations' | 'system';

// ---------------------------------------------------------------------------
// Prefix → Category mapping
// ---------------------------------------------------------------------------

const GATEWAY_PREFIXES = new Set([
  'Gateway',
  'GatewayAPI',
  'GatewayBootstrap',
  'GatewaySessionMgr',
  'GatewayConfig',
  'GatewaySchema',
  'GatewayEventListener',
  'MessageRouter',
  'CommandHandlers',
  'ChannelRegistry',
  'DiscordAdapter',
  'DiscordVoice',
  'TelegramAdapter',
  'TelegramStreaming',
  'OutboundPipeline',
  'NotifDispatcher',
  'ToolApproval',
  'Guardrails',
  'RateLimiter',
  'IdentityResolver',
  'TokenBudget',
  'CdnUpload',
  'MediaPipeline',
  'RestartPolicy',
  'SlackGateway',
  'SlackCowork',
]);

const INTEGRATION_PREFIXES = new Set([
  'SlackService',
  'SlackConfig',
  'SlackFormat',
  'SlackIntegration',
  'LinearService',
  'LinearConfig',
  'LinearPoller',
  'NotionIntegration',
  'FigmaResolver',
  'CalendarIntegration',
  'ContactsIntegration',
  'DocsIntegration',
  'DriveIntegration',
  'GmailIntegration',
  'MeetIntegration',
  'PhotosIntegration',
  'SheetsIntegration',
  'SlidesIntegration',
  'TasksIntegration',
]);

const SYSTEM_PREFIXES = new Set([
  'App',
  'Database',
  'ProviderManager',
  'MemoryMonitor',
  'Health',
  'OAuthClient',
  'OAuthConfig',
  'TokenManager',
  'TokenRefreshService',
  'ConnectionBroker',
  'HealthMonitor',
  'AuthRoutes',
  'Automation',
  'AutomationStore',
  'AutomationDelivery',
  'AutomationHooks',
  'CronService',
  'WebhookHandler',
  'HeartbeatRunner',
  'UrlValidator',
  'McpRoutes',
]);

function resolveCategory(prefix: string): LogCategory {
  if (GATEWAY_PREFIXES.has(prefix)) return 'gateway';
  if (INTEGRATION_PREFIXES.has(prefix)) return 'integrations';
  if (SYSTEM_PREFIXES.has(prefix)) return 'system';
  return 'app';
}

// ---------------------------------------------------------------------------
// Sensitive data redaction
// ---------------------------------------------------------------------------

const SENSITIVE_KEYS =
  /^(password|passwd|token|secret|api[-_]?key|authorization|cookie|credential|access[-_]?token|refresh[-_]?token|client[-_]?secret|private[-_]?key|signing[-_]?key)$/i;

const SENSITIVE_PATTERNS: Array<[RegExp, string]> = [
  [/sk-[a-zA-Z0-9_-]{20,}/g, 'sk-[REDACTED]'],
  [/sk-ant-[a-zA-Z0-9_-]{20,}/g, 'sk-ant-[REDACTED]'],
  [/xoxb-[a-zA-Z0-9-]+/g, 'xoxb-[REDACTED]'],
  [/xoxp-[a-zA-Z0-9-]+/g, 'xoxp-[REDACTED]'],
  [/xapp-[a-zA-Z0-9-]+/g, 'xapp-[REDACTED]'],
  [/ghp_[a-zA-Z0-9]{36,}/g, 'ghp_[REDACTED]'],
  [/gho_[a-zA-Z0-9]{36,}/g, 'gho_[REDACTED]'],
  [/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]'],
  [/Basic\s+[^\s"']+/gi, 'Basic [REDACTED]'],
  [
    /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g,
    '[JWT_REDACTED]',
  ],
  [/AKIA[0-9A-Z]{16}/g, 'AKIA[REDACTED]'],
  [/key-[a-zA-Z0-9]{20,}/g, 'key-[REDACTED]'],
];

function redactString(str: string): string {
  let result = str;
  for (const [pattern, replacement] of SENSITIVE_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

export function redactValue(data: unknown, depth = 0): unknown {
  if (depth > 8) return '[MAX_DEPTH]';

  if (typeof data === 'string') {
    return redactString(data);
  }

  if (data instanceof Error) {
    return {
      name: data.name,
      message: redactString(data.message),
      stack: data.stack ? redactString(data.stack) : undefined,
    };
  }

  if (Array.isArray(data)) {
    return data.map((item) => redactValue(item, depth + 1));
  }

  if (data !== null && typeof data === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(
      data as Record<string, unknown>,
    )) {
      if (SENSITIVE_KEYS.test(key)) {
        result[key] = '[REDACTED]';
      } else {
        result[key] = redactValue(value, depth + 1);
      }
    }
    return result;
  }

  return data;
}

// ---------------------------------------------------------------------------
// Log file management
// ---------------------------------------------------------------------------

let logDirEnsured = false;

function ensureLogDir() {
  if (logDirEnsured) return;
  try {
    if (!existsSync(LOG_DIR)) {
      mkdirSync(LOG_DIR, { recursive: true });
    }
    logDirEnsured = true;
  } catch {
    // Ignore errors
  }
}

function getDateStamp(): string {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${mm}-${dd}`;
}

function getCategoryLogPath(category: LogCategory): string {
  return join(LOG_DIR, `${category}-${getDateStamp()}.log`);
}

export function getLogDirectory(): string {
  return LOG_DIR;
}

// ---------------------------------------------------------------------------
// Log retention cleanup (runs once per process, async)
// ---------------------------------------------------------------------------

let cleanupScheduled = false;

function scheduleCleanup() {
  if (cleanupScheduled) return;
  cleanupScheduled = true;

  // Run cleanup after a short delay to not block startup
  setTimeout(async () => {
    try {
      const files = await readdir(LOG_DIR);
      const now = Date.now();
      const maxAge = MAX_RETENTION_DAYS * 24 * 60 * 60 * 1000;
      const logFilePattern =
        /^(app|gateway|integrations|system)-\d{2}-\d{2}\.log$/;
      // Also clean up legacy single-file logs
      const legacyPattern = new RegExp(`^${APP_SLUG}\\.log$`);

      for (const file of files) {
        if (!logFilePattern.test(file) && !legacyPattern.test(file)) continue;

        // Parse date from filename (e.g. "app-03-07.log" → month=03, day=07)
        const dateMatch = file.match(/-(\d{2})-(\d{2})\.log$/);
        if (dateMatch) {
          const month = parseInt(dateMatch[1]!, 10) - 1;
          const day = parseInt(dateMatch[2]!, 10);
          const year = new Date().getFullYear();
          const fileDate = new Date(year, month, day);
          // Handle year boundary: if file date is in the future, it's from last year
          if (fileDate.getTime() > now) {
            fileDate.setFullYear(year - 1);
          }
          if (now - fileDate.getTime() > maxAge) {
            await unlink(join(LOG_DIR, file)).catch(() => {});
          }
        } else if (legacyPattern.test(file)) {
          // Legacy files: use mtime as fallback
          try {
            const stats = await stat(join(LOG_DIR, file));
            if (now - stats.mtimeMs > maxAge) {
              await unlink(join(LOG_DIR, file)).catch(() => {});
            }
          } catch {
            // Ignore
          }
        }
      }
    } catch {
      // Ignore cleanup errors
    }
  }, 5000);
}

// ---------------------------------------------------------------------------
// Shared log-line builder (redacts, formats, appends newline)
// ---------------------------------------------------------------------------

function buildLogLine(
  level: string,
  prefix: string,
  message: string,
  data?: unknown,
): string {
  const timestamp = localTimestamp();
  const safeMessage = redactString(message);
  let logLine = `[${timestamp}] [${level}] [${prefix}] ${safeMessage}`;

  if (data !== undefined) {
    const redacted = redactValue(data);
    logLine +=
      typeof redacted === 'string'
        ? ` ${redacted}`
        : ` ${JSON.stringify(redacted, null, 2)}`;
  }
  return logLine + '\n';
}

// ---------------------------------------------------------------------------
// Core write function (async, fire-and-forget)
// ---------------------------------------------------------------------------

function writeLog(
  category: LogCategory,
  level: string,
  prefix: string,
  message: string,
  data?: unknown,
) {
  try {
    ensureLogDir();
    scheduleCleanup();

    const logLine = buildLogLine(level, prefix, message, data);
    const filePath = getCategoryLogPath(category);
    appendFile(filePath, logLine).catch(() => {
      // Ignore async write errors
    });
  } catch {
    // Ignore logging errors
  }
}

// ---------------------------------------------------------------------------
// Synchronous write (for fatal errors before process.exit)
// ---------------------------------------------------------------------------

function writeLogSync(
  category: LogCategory,
  level: string,
  prefix: string,
  message: string,
  data?: unknown,
) {
  try {
    ensureLogDir();

    const logLine = buildLogLine(level, prefix, message, data);
    const filePath = getCategoryLogPath(category);
    appendFileSync(filePath, logLine);
  } catch {
    // Ignore logging errors
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a logger instance with a specific prefix.
 * The prefix determines which log file category the output goes to.
 *
 * @param prefix - e.g. 'ClaudeAgent', 'Gateway', 'SlackService', 'App'
 */
export function createLogger(prefix: string) {
  const category = resolveCategory(prefix);

  return {
    info: (message: string, data?: unknown) => {
      if (isConsoleEnabled()) {
        const ts = localTimestamp();
        const safeData = data !== undefined ? redactValue(data) : undefined;
        console.log(`[${ts}] [${prefix}] ${message}`, safeData ?? '');
      }
      writeLog(category, 'INFO', prefix, message, data);
    },
    error: (message: string, data?: unknown) => {
      // Always log errors to stderr so Tauri sidecar captures them
      const ts = localTimestamp();
      const safeData = data !== undefined ? redactValue(data) : undefined;
      console.error(`[${ts}] [${prefix}] ${message}`, safeData ?? '');
      writeLog(category, 'ERROR', prefix, message, data);
    },
    warn: (message: string, data?: unknown) => {
      if (isConsoleEnabled()) {
        const ts = localTimestamp();
        const safeData = data !== undefined ? redactValue(data) : undefined;
        console.warn(`[${ts}] [${prefix}] ${message}`, safeData ?? '');
      }
      writeLog(category, 'WARN', prefix, message, data);
    },
    debug: (message: string, data?: unknown) => {
      // Debug only logs to file, not console
      writeLog(category, 'DEBUG', prefix, message, data);
    },
    /**
     * Synchronous error log — use only before process.exit() to guarantee
     * the message is flushed to disk.
     */
    fatal: (message: string, data?: unknown) => {
      const ts = localTimestamp();
      const safeData = data !== undefined ? redactValue(data) : undefined;
      console.error(`[${ts}] [${prefix}] ${message}`, safeData ?? '');
      writeLogSync(category, 'FATAL', prefix, message, data);
    },
  };
}

/** Primary app log file path (for error messages referencing log location) */
export function getLogFilePath(): string {
  return join(LOG_DIR, `app-${getDateStamp()}.log`);
}

/** @deprecated Use getLogFilePath() — this value is stale after midnight */
export const LOG_FILE_PATH = join(LOG_DIR, `app-${getDateStamp()}.log`);

/** Log directory path */
export const LOG_DIR_PATH = LOG_DIR;
