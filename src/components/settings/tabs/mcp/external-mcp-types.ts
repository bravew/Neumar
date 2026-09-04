export interface ExternalMcpInstallInfo {
  serverName: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  daemonUrl: string;
  appDataDir: string;
  binaryExists: boolean;
  platform: string;
  buildHint: string | null;
  codexCommand: string;
  claudeCodeCommand: string;
  codexRemoveCommand: string;
  claudeCodeRemoveCommand: string;
  development: boolean;
}

export interface ExternalMcpStatus {
  ready: boolean;
  daemonUrl: string | null;
  flags: {
    enabled: boolean;
    writesEnabled: boolean;
    agentRunsEnabled: boolean;
  };
}

export type ExternalMcpHost = 'codex' | 'claude';
