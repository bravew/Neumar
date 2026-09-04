import type {
  ExternalMcpHost,
  ExternalMcpInstallInfo,
} from './external-mcp-types';

export function hostAddCommand(
  info: ExternalMcpInstallInfo,
  host: ExternalMcpHost,
): string {
  return host === 'codex' ? info.codexCommand : info.claudeCodeCommand;
}

export function hostRemoveCommand(
  info: ExternalMcpInstallInfo,
  host: ExternalMcpHost,
): string {
  return host === 'codex'
    ? info.codexRemoveCommand
    : info.claudeCodeRemoveCommand;
}

/** Argv for an explicit one-click install. Uses daemon-provided command/args only. */
export function installCliPayload(
  info: ExternalMcpInstallInfo,
  host: ExternalMcpHost,
): { command: string; args: string[] } {
  const envArg = `NEUMAR_APP_DATA_DIR=${info.appDataDir}`;
  if (host === 'codex') {
    return {
      command: 'codex',
      args: [
        'mcp',
        'add',
        info.serverName,
        '--env',
        envArg,
        '--',
        info.command,
        ...info.args,
      ],
    };
  }
  return {
    command: 'claude',
    args: [
      'mcp',
      'add',
      '--scope',
      'user',
      info.serverName,
      '--env',
      envArg,
      '--',
      info.command,
      ...info.args,
    ],
  };
}

export function hostStatusHint(host: ExternalMcpHost): string {
  return host === 'codex' ? 'codex mcp list' : 'claude mcp list';
}
