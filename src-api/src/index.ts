/**
 * Process entry. Parse MCP argv before loading the HTTP daemon so
 * `mcp server` never opens SQLite, sharp, or other native addons.
 */

import { parseMcpArgv } from '@/shared/mcp/public-server/argv';

function fatal(message: string, error?: unknown): never {
  const detail =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(detail ? `${message}\n${detail}\n` : `${message}\n`);
  process.exit(1);
}

const parsed = parseMcpArgv(process.argv.slice(2));

if (parsed.kind === 'none') {
  void import('./http-daemon.js')
    .then(({ start }) => start())
    .catch((error) => fatal('Failed to start server', error));
} else {
  process.env.MCP_STDIO = '1';
  void import('./mcp-cli.js')
    .then(({ runMcpArgv }) => runMcpArgv(parsed))
    .catch((error) => fatal('Failed to start MCP server', error));
}
