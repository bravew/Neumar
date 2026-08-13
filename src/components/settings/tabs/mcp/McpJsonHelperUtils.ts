import type { MCPServerUI } from '../../types';

export type Transport = 'stdio' | 'http' | 'sse';
export type AuthType = 'oauth2.1' | 'none';

export interface EnvRow {
  id: string;
  key: string;
  valueLength: number;
}

export interface McpHelperDraft {
  name: string;
  transport: Transport;
  command: string;
  argsText: string;
  url: string;
  authType: AuthType;
  envRows: EnvRow[];
}

export interface McpHelperValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

function parseArgs(argsText: string): string[] {
  return argsText
    .split('\n')
    .map((arg) => arg.trim())
    .filter(Boolean);
}

function maskSecret(length: number): string {
  return length > 0 ? `**** (${length} chars)` : '';
}

export function validateMcpHelperDraft(
  draft: McpHelperDraft,
): McpHelperValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!draft.name.trim()) errors.push('mcpJsonHelperErrorName');
  if (draft.transport === 'stdio' && !draft.command.trim()) {
    errors.push('mcpJsonHelperErrorCommand');
  }
  if (draft.transport !== 'stdio') {
    if (!draft.url.trim()) {
      errors.push('mcpJsonHelperErrorUrlRequired');
    } else {
      try {
        const parsed = new URL(draft.url);
        if (parsed.protocol !== 'https:' && !isLoopbackHttpUrl(parsed)) {
          errors.push('mcpJsonHelperErrorHttps');
        }
      } catch {
        errors.push('mcpJsonHelperErrorUrlInvalid');
      }
    }
  }
  for (const row of draft.envRows) {
    if (!row.key.trim()) warnings.push('mcpJsonHelperWarningEmptyEnv');
  }
  return { valid: errors.length === 0, errors, warnings };
}

function isLoopbackHttpUrl(url: URL) {
  if (url.protocol !== 'http:') return false;
  return (
    url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    url.hostname === '[::1]'
  );
}

export function buildMcpPreview(
  draft: McpHelperDraft,
  envValues: Map<string, string>,
  masked: boolean,
) {
  const name = draft.name.trim() || 'server-name';
  const env = Object.fromEntries(
    draft.envRows
      .filter((row) => row.key.trim())
      .map((row) => [
        row.key.trim(),
        masked ? maskSecret(row.valueLength) : (envValues.get(row.id) ?? ''),
      ]),
  );
  const server =
    draft.transport === 'stdio'
      ? {
          command: draft.command.trim(),
          ...(parseArgs(draft.argsText).length
            ? { args: parseArgs(draft.argsText) }
            : {}),
          ...(Object.keys(env).length ? { env } : {}),
        }
      : {
          ...(draft.transport === 'sse' ? { type: 'sse' } : {}),
          url: draft.url.trim(),
          auth: {
            type: draft.authType,
            ...(draft.authType === 'oauth2.1' ? { pkce: 'S256' } : {}),
          },
        };
  return { mcpServers: { [name]: server } };
}

export function buildMcpServerFromHelper(
  draft: McpHelperDraft,
  envValues: Map<string, string>,
): MCPServerUI {
  const preview = buildMcpPreview(draft, envValues, false);
  const name = Object.keys(preview.mcpServers)[0]!;
  const server = preview.mcpServers[name] as Record<string, unknown>;
  return {
    id: `app-${name}`,
    name,
    type: draft.transport,
    enabled: true,
    command: server.command as string | undefined,
    args: server.args as string[] | undefined,
    env: server.env as Record<string, string> | undefined,
    url: server.url as string | undefined,
    auth: server.auth as MCPServerUI['auth'],
    autoExecute: true,
    source: 'app',
    requiresOAuth: draft.transport !== 'stdio' && draft.authType === 'oauth2.1',
  };
}
