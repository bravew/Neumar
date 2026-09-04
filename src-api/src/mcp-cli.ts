import type { ParsedMcpArgv } from '@/shared/mcp/public-server/argv';

const MCP_USAGE =
  'Usage: neumar-api mcp server [--daemon-url http://127.0.0.1:<port>]\n       neumar-api mcp video-server';

export async function runMcpArgv(parsed: ParsedMcpArgv): Promise<void> {
  if (parsed.kind === 'error') {
    process.stderr.write(`${parsed.message}\n`);
    process.exit(1);
  }
  if (parsed.kind === 'video-server') {
    const { startVideoMcpServer } =
      await import('@/shared/mcp/video-server/server');
    await startVideoMcpServer();
    return;
  }
  if (parsed.kind === 'server') {
    if (parsed.help) {
      process.stderr.write(`${MCP_USAGE}\n`);
      process.exit(0);
    }
    const { startPublicMcpServer } =
      await import('@/shared/mcp/public-server/server');
    await startPublicMcpServer({ daemonUrl: parsed.daemonUrl });
  }
}
