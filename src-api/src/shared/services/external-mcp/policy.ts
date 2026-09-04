import { getSetting } from '@/shared/db/operations';
import { ExternalMcpError } from '@/shared/mcp/public-server/errors';
import {
  DEFAULT_RESULT_LIMIT,
  EXTERNAL_MCP_SETTING_KEYS,
  MAX_PAGE_LIMIT,
} from '@/shared/mcp/public-server/schemas';

export interface ExternalMcpFlags {
  enabled: boolean;
  writesEnabled: boolean;
  agentRunsEnabled: boolean;
  resultLimit: number;
}

const CREDENTIAL_KEY =
  /^(password|passwd|token|secret|api[-_]?key|authorization|cookie|credential|access[-_]?token|refresh[-_]?token|client[-_]?secret|private[-_]?key|signing[-_]?key)$/i;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function settingEnabled(key: string): boolean {
  return getSetting(key) === 'true';
}

export function getExternalMcpFlags(): ExternalMcpFlags {
  const rawLimit = getSetting(EXTERNAL_MCP_SETTING_KEYS.resultLimit);
  const parsed = rawLimit
    ? Number.parseInt(rawLimit, 10)
    : DEFAULT_RESULT_LIMIT;
  const resultLimit = Number.isFinite(parsed)
    ? Math.min(MAX_PAGE_LIMIT, Math.max(1, parsed))
    : DEFAULT_RESULT_LIMIT;
  return {
    enabled: settingEnabled(EXTERNAL_MCP_SETTING_KEYS.enabled),
    writesEnabled: settingEnabled(EXTERNAL_MCP_SETTING_KEYS.writesEnabled),
    agentRunsEnabled: settingEnabled(
      EXTERNAL_MCP_SETTING_KEYS.agentRunsEnabled,
    ),
    resultLimit,
  };
}

export function assertFeatureEnabled(): void {
  if (!getExternalMcpFlags().enabled) {
    throw new ExternalMcpError(
      'FEATURE_DISABLED',
      'External MCP is disabled. Enable it in Settings.',
    );
  }
}

export function assertWritesEnabled(): void {
  assertFeatureEnabled();
  if (!getExternalMcpFlags().writesEnabled) {
    throw new ExternalMcpError(
      'WRITE_DISABLED',
      'External MCP writes are disabled.',
    );
  }
}

export function assertAgentRunsEnabled(): void {
  assertFeatureEnabled();
  if (!getExternalMcpFlags().agentRunsEnabled) {
    throw new ExternalMcpError(
      'RUN_DISABLED',
      'External MCP agent runs are disabled.',
    );
  }
}

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function requireUuid(value: string, field: string): string {
  if (!isUuid(value)) {
    throw new ExternalMcpError(
      'VALIDATION_FAILED',
      `${field} must be an exact UUID`,
    );
  }
  return value;
}

export function rejectCredentialShapedInput(value: unknown, path = ''): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      rejectCredentialShapedInput(item, `${path}[${index}]`);
    }
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (CREDENTIAL_KEY.test(key)) {
      throw new ExternalMcpError(
        'VALIDATION_FAILED',
        `Credential-shaped field is not allowed: ${key}`,
      );
    }
    rejectCredentialShapedInput(child, path ? `${path}.${key}` : key);
  }
}
