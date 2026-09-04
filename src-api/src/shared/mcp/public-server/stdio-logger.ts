/**
 * Stdio MCP logging: file + stderr only. Never write to stdout.
 */

import { createLogger } from '@/shared/utils/logger';

export function enableStdioSafeLogging(): void {
  process.env.MCP_STDIO = '1';
}

export function createStdioLogger(prefix = 'PublicMCP') {
  enableStdioSafeLogging();
  return createLogger(prefix);
}
