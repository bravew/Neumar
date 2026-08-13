import type { BoundedJsonObject } from './bounded-json';
import { cloneBoundedJsonObject } from './bounded-json';

export type ConnectorProvider = 'composio' | 'native' | 'local';
export type ConnectorAuthProvider = 'composio' | 'oauth' | 'apikey' | 'none';
export type ConnectorStatus =
  | 'available'
  | 'pending'
  | 'connected'
  | 'error'
  | 'disabled';
export type ConnectorToolSideEffect = 'read' | 'write' | 'destructive';
export type ConnectorToolApproval = 'auto' | 'confirm' | 'disabled';
export type ConnectorToolUseCase =
  | 'agent_tooling'
  | 'design_mode_refresh'
  | 'personal_daily_digest';

export interface ConnectorToolSafety {
  sideEffect: ConnectorToolSideEffect;
  approval: ConnectorToolApproval;
  reason: string;
}

export interface ConnectorToolCuration {
  useCases?: ConnectorToolUseCase[];
  reason?: string;
}

export interface ConnectorToolDetail {
  name: string;
  title: string;
  description?: string;
  inputSchemaJson?: BoundedJsonObject;
  outputSchemaJson?: BoundedJsonObject;
  safety: ConnectorToolSafety;
  refreshEligible: boolean;
  curation?: ConnectorToolCuration;
  requiredScopes?: string[];
  providerToolId?: string;
  version?: string;
}

export interface ConnectorCatalogToolDefinition extends ConnectorToolDetail {
  requiredScopes: string[];
  providerToolId?: string;
}

export interface ConnectorAuthDetail {
  provider: ConnectorAuthProvider;
  configured: boolean;
}

export interface ConnectorScopeConnection {
  scopeKey: string;
  label: string;
  accountLabel?: string;
  connectedAccountId?: string;
  status: ConnectorStatus;
}

export interface ConnectorDetail {
  id: string;
  name: string;
  provider: ConnectorProvider;
  category: string;
  description?: string;
  apiKeyUrl?: string;
  status: ConnectorStatus;
  accountLabel?: string;
  scopeConnections?: ConnectorScopeConnection[];
  tools: ConnectorToolDetail[];
  allowedToolNames: string[];
  curatedToolNames: string[];
  toolCount?: number;
  toolsNextCursor?: string;
  toolsHasMore?: boolean;
  featuredToolNames?: string[];
  minimumApproval?: ConnectorToolApproval;
  lastError?: string;
  auth: ConnectorAuthDetail;
}

export interface ConnectorCatalogDefinition {
  id: string;
  name: string;
  provider: ConnectorProvider;
  category: string;
  description?: string;
  apiKeyUrl?: string;
  tools: ConnectorCatalogToolDefinition[];
  allowedToolNames: string[];
  curatedToolNames?: string[];
  toolCount?: number;
  toolsNextCursor?: string;
  toolsHasMore?: boolean;
  authentication?: ConnectorAuthProvider;
  providerConnectorId?: string;
  featuredToolNames?: string[];
  minimumApproval?: ConnectorToolApproval;
  disabled?: boolean;
}

export interface ConnectorToolSafetyClassificationInput {
  name: string;
  title?: string;
  description?: string;
  requiredScopes?: readonly string[];
}

const destructiveHintPattern =
  /(?:^|[._:\-/\s])(?:destructive|destroy|drop|truncate|purge|erase|wipe|remove-all|remove_all|revoke|reset)(?:$|[._:\-/\s])/i;
const highImpactDeletePattern =
  /(?:delete|remove|deactivate|disable).*(?:repository|repo|workspace|organization|org|account|database|project|site|app|user|team|billing|subscription)/i;
const writeHintPattern =
  /(?:^|[._:\-/\s])(?:write|create|update|delete|admin|send|post|manage)(?:$|[._:\-/\s])/i;
const readOnlyHintPattern =
  /(?:^|[._:\-/\s])(?:read|readonly|read-only|read_only|get|list|search|fetch|view|query|inspect|summary|status)(?:$|[._:\-/\s])/i;

export function classifyConnectorToolSafety(
  input: ConnectorToolSafetyClassificationInput,
): ConnectorToolSafety {
  const haystack = connectorToolSafetyHaystack(input);

  if (destructiveHintPattern.test(haystack)) {
    return {
      sideEffect: 'destructive',
      approval: 'disabled',
      reason:
        'Tool name, scope, or description contains destructive hints; destructive tools are disabled by default.',
    };
  }

  if (highImpactDeletePattern.test(haystack)) {
    return {
      sideEffect: 'destructive',
      approval: 'disabled',
      reason:
        'Tool can delete or disable a high-impact object; destructive tools are disabled by default.',
    };
  }

  if (writeHintPattern.test(haystack)) {
    return {
      sideEffect: 'write',
      approval: 'confirm',
      reason:
        'Tool name, scope, or description indicates write-capable behavior; explicit confirmation is required.',
    };
  }

  if (readOnlyHintPattern.test(haystack)) {
    return {
      sideEffect: 'read',
      approval: 'auto',
      reason:
        'Tool name, scope, or description indicates explicit read-only behavior.',
    };
  }

  return {
    sideEffect: 'write',
    approval: 'confirm',
    reason:
      'Tool safety could not be proven read-only; defaulting to confirmation-required write policy.',
  };
}

export function isRefreshEligibleConnectorToolSafety(
  safety: ConnectorToolSafety,
): boolean {
  return safety.sideEffect === 'read' && safety.approval === 'auto';
}

export function defineConnectorTool(
  tool: Omit<ConnectorCatalogToolDefinition, 'safety' | 'refreshEligible'> & {
    safety?: ConnectorToolSafety;
    refreshEligible?: boolean;
  },
): ConnectorCatalogToolDefinition {
  const safety = tool.safety ?? classifyConnectorToolSafety(tool);
  return {
    ...tool,
    safety,
    refreshEligible:
      tool.refreshEligible ?? isRefreshEligibleConnectorToolSafety(safety),
  };
}

export function connectorDefinitionToDetail(
  definition: ConnectorCatalogDefinition,
): ConnectorDetail {
  return {
    id: definition.id,
    name: definition.name,
    provider: definition.provider,
    category: definition.category,
    ...(definition.description === undefined
      ? {}
      : { description: definition.description }),
    ...(definition.apiKeyUrl === undefined
      ? {}
      : { apiKeyUrl: definition.apiKeyUrl }),
    status: definition.disabled ? 'disabled' : 'available',
    tools: definition.tools.map((tool) => toolDefinitionToDetail(tool)),
    allowedToolNames: [...definition.allowedToolNames],
    curatedToolNames: [
      ...(definition.curatedToolNames ?? definition.allowedToolNames),
    ],
    ...(definition.toolCount === undefined
      ? {}
      : { toolCount: definition.toolCount }),
    ...(definition.toolsNextCursor === undefined
      ? {}
      : { toolsNextCursor: definition.toolsNextCursor }),
    ...(definition.toolsHasMore === undefined
      ? {}
      : { toolsHasMore: definition.toolsHasMore }),
    ...(definition.featuredToolNames === undefined
      ? {}
      : { featuredToolNames: [...definition.featuredToolNames] }),
    ...(definition.minimumApproval === undefined
      ? {}
      : { minimumApproval: definition.minimumApproval }),
    auth: {
      provider: definition.authentication ?? fallbackAuthProvider(definition),
      configured:
        definition.authentication === 'none' || definition.provider === 'local',
    },
  };
}

function connectorToolSafetyHaystack(
  input: ConnectorToolSafetyClassificationInput,
): string {
  return [
    input.name,
    input.title,
    input.description,
    ...(input.requiredScopes ?? []),
  ]
    .filter(
      (value): value is string => typeof value === 'string' && value.length > 0,
    )
    .join(' ');
}

function toolDefinitionToDetail(
  tool: ConnectorCatalogToolDefinition,
): ConnectorToolDetail {
  return {
    name: tool.name,
    title: tool.title,
    ...(tool.description === undefined
      ? {}
      : { description: tool.description }),
    ...(tool.inputSchemaJson === undefined
      ? {}
      : { inputSchemaJson: cloneBoundedJsonObject(tool.inputSchemaJson) }),
    ...(tool.outputSchemaJson === undefined
      ? {}
      : { outputSchemaJson: cloneBoundedJsonObject(tool.outputSchemaJson) }),
    safety: { ...tool.safety },
    refreshEligible: tool.refreshEligible,
    ...(tool.curation === undefined
      ? {}
      : {
          curation: {
            ...(tool.curation.useCases === undefined
              ? {}
              : { useCases: [...tool.curation.useCases] }),
            ...(tool.curation.reason === undefined
              ? {}
              : { reason: tool.curation.reason }),
          },
        }),
    requiredScopes: [...tool.requiredScopes],
    ...(tool.providerToolId === undefined
      ? {}
      : { providerToolId: tool.providerToolId }),
    ...(tool.version === undefined ? {} : { version: tool.version }),
  };
}

function fallbackAuthProvider(
  definition: ConnectorCatalogDefinition,
): ConnectorAuthProvider {
  if (definition.provider === 'composio') return 'composio';
  if (definition.provider === 'native') return 'oauth';
  return 'none';
}
