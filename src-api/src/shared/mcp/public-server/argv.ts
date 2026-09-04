/**
 * Parse sidecar argv for MCP subcommands.
 *
 * `mcp video-server` stays an exact two-token match so extra flags cannot
 * accidentally start the HTTP daemon (the previous join-equality check
 * fell through to `start()` on any extra token).
 * `mcp server` accepts `--daemon-url` and `--help`.
 */

export type ParsedMcpArgv =
  | { kind: 'none' }
  | { kind: 'video-server' }
  | { kind: 'server'; daemonUrl?: string; help: boolean }
  | { kind: 'error'; message: string };

export function parseMcpArgv(argv: readonly string[]): ParsedMcpArgv {
  if (argv.length === 0 || argv[0] !== 'mcp') return { kind: 'none' };

  const subcommand = argv[1];
  if (subcommand === 'video-server') {
    if (argv.length !== 2) {
      return {
        kind: 'error',
        message: 'mcp video-server does not accept additional arguments',
      };
    }
    return { kind: 'video-server' };
  }

  if (subcommand === 'server') {
    return parseServerArgv(argv.slice(2));
  }

  if (
    subcommand === undefined ||
    subcommand === '--help' ||
    subcommand === '-h'
  ) {
    return {
      kind: 'error',
      message:
        'Usage: neumar-api mcp server [--daemon-url http://127.0.0.1:<port>]\n       neumar-api mcp video-server',
    };
  }

  return {
    kind: 'error',
    message: `Unknown mcp subcommand: ${subcommand}`,
  };
}

function parseServerArgv(flags: readonly string[]): ParsedMcpArgv {
  let daemonUrl: string | undefined;
  let help = false;

  for (let i = 0; i < flags.length; i += 1) {
    const token = flags[i];
    if (token === '--help' || token === '-h') {
      help = true;
      continue;
    }
    if (token === '--daemon-url') {
      const value = flags[i + 1];
      if (!value || value.startsWith('-')) {
        return { kind: 'error', message: '--daemon-url requires a URL value' };
      }
      daemonUrl = value;
      i += 1;
      continue;
    }
    if (token?.startsWith('--daemon-url=')) {
      const value = token.slice('--daemon-url='.length);
      if (!value) {
        return { kind: 'error', message: '--daemon-url requires a URL value' };
      }
      daemonUrl = value;
      continue;
    }
    return {
      kind: 'error',
      message: `Unknown argument: ${token}`,
    };
  }

  return { kind: 'server', daemonUrl, help };
}
