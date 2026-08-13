/**
 * Agent Runtimes API Client
 *
 * Talks to /agent-runtimes endpoints. See doc-dev/plan/2026-05-02-agent-runtime-detection-install-update.md.
 */

import { API_BASE_URL } from '@/config';

export type StreamFormat =
  | 'claude-stream-json'
  | 'json-event-stream'
  | 'acp-json-rpc'
  | 'pi-rpc'
  | 'copilot-stream-json'
  | 'plain';

export interface ModelOption {
  id: string;
  label: string;
  source?: 'fallback' | 'discovered' | 'configured';
  availability?: 'available' | 'unavailable' | 'unknown';
  unavailableReason?: string;
  contextWindowTokens?: number;
  capabilityTags?: (
    | 'chat'
    | 'vision'
    | 'reasoning'
    | 'code'
    | 'image'
    | 'video'
    | 'audio'
  )[];
  costTier?: 'low' | 'medium' | 'high';
  speedTier?: 'low' | 'medium' | 'high';
  compatibleReasoningTiers?: string[];
  compatibleServiceTiers?: string[];
}

export interface ReasoningOption {
  id: string;
  label: string;
}

export interface AuthInfo {
  state: 'authenticated' | 'unauthenticated' | 'unknown';
  detail?: string;
}

export interface RuntimeRequirement {
  bin: string;
  versionRange?: string;
  reason?: string;
}

export interface RuntimeInstallOption {
  id: string;
  label: string;
  command: string;
  args: string[];
  platforms: string[];
  requires?: RuntimeRequirement[];
  network: boolean;
  inAppRunnable: boolean;
  notes?: string;
  commandHash: string;
  rendered: string;
}

export interface RuntimeUpdateOption extends RuntimeInstallOption {
  kind?: 'native' | 'reinstall';
}

export interface RuntimeCapabilities {
  execution: boolean;
  structuredStream: boolean;
  acp: boolean;
  rpc: boolean;
  imageInput?: boolean;
  flags?: Record<string, boolean>;
  modes?: Record<
    'task' | 'design' | 'video',
    'supported' | 'experimental' | 'unsupported'
  >;
  toolApproval?: 'host-mediated' | 'runtime-native' | 'none';
  mcpInjection?: 'native' | 'workspace-config' | 'none';
  sessionContinuation?: 'by-id' | 'continue-latest' | 'acp-load' | 'none';
}

export interface RuntimeDiagnostic {
  level: 'info' | 'warn' | 'error';
  message: string;
}

export interface AgentRuntimeStatus {
  id: string;
  name: string;
  bin: string;
  available: boolean;
  version?: string;
  path?: string;
  source?: 'path' | 'known-path' | 'bundled' | 'wsl' | 'configured';
  install?: RuntimeInstallOption[];
  update?: RuntimeUpdateOption[];
  auth?: AuthInfo;
  models: ModelOption[];
  reasoningOptions?: ReasoningOption[];
  streamFormat: StreamFormat;
  eventParser?: 'codex' | 'gemini' | 'opencode' | 'cursor-agent';
  capabilities: RuntimeCapabilities;
  diagnostics?: RuntimeDiagnostic[];
}

export interface CatalogEntry {
  id: string;
  install: RuntimeInstallOption[];
  update: RuntimeUpdateOption[];
}

export interface RuntimeConnectionTestResult {
  ok: boolean;
  status:
    | 'ok'
    | 'not_installed'
    | 'auth_required'
    | 'incompatible_version'
    | 'unsupported_model'
    | 'protocol_failure'
    | 'permission_failure'
    | 'unknown';
  message: string;
  runtime: AgentRuntimeStatus;
  recoveryActions?: {
    intent: 'install' | 'update' | 'authenticate' | 'inspect_diagnostics';
    label: string;
    optionId?: string;
    commandHash?: string;
    rendered?: string;
    inAppRunnable?: boolean;
    detail?: string;
  }[];
}

export interface ListResponse {
  success: true;
  runtimes: AgentRuntimeStatus[];
  catalog: CatalogEntry[];
  platform: string;
}

export interface OperationRecord {
  id: string;
  agentId: string;
  intent: 'install' | 'update';
  optionId: string;
  command: string;
  args: string[];
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  exitCode: number | null;
  startedAt: number;
  endedAt: number | null;
  output: string;
  cancellable: boolean;
  refreshedStatus?: AgentRuntimeStatus;
  error?: string;
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
  }
  return (await res.json()) as T;
}

export async function listAgentRuntimes(
  signal?: AbortSignal,
): Promise<ListResponse> {
  const res = await fetch(`${API_BASE_URL}/agent-runtimes`, { signal });
  return jsonOrThrow<ListResponse>(res);
}

export async function rescanAgentRuntimes(
  signal?: AbortSignal,
): Promise<ListResponse> {
  const res = await fetch(`${API_BASE_URL}/agent-runtimes/rescan`, {
    method: 'POST',
    signal,
  });
  return jsonOrThrow<ListResponse>(res);
}

export async function startAgentRuntimeOperation(params: {
  agentId: string;
  intent: 'install' | 'update';
  optionId: string;
  confirmedCommandHash: string;
}): Promise<{ success: true; operation: OperationRecord }> {
  const { agentId, intent, optionId, confirmedCommandHash } = params;
  const res = await fetch(
    `${API_BASE_URL}/agent-runtimes/${encodeURIComponent(agentId)}/${intent}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: optionId, confirmedCommandHash }),
    },
  );
  return jsonOrThrow(res);
}

export async function getAgentRuntimeOperation(
  operationId: string,
  signal?: AbortSignal,
): Promise<{ success: true; operation: OperationRecord }> {
  const res = await fetch(
    `${API_BASE_URL}/agent-runtimes/operations/${encodeURIComponent(operationId)}`,
    { signal },
  );
  return jsonOrThrow(res);
}

export async function cancelAgentRuntimeOperation(
  operationId: string,
): Promise<{ success: boolean }> {
  const res = await fetch(
    `${API_BASE_URL}/agent-runtimes/operations/${encodeURIComponent(operationId)}`,
    { method: 'DELETE' },
  );
  return jsonOrThrow(res);
}

export async function testAgentRuntimeConnection(
  agentId: string,
): Promise<{ success: true; result: RuntimeConnectionTestResult }> {
  const res = await fetch(
    `${API_BASE_URL}/agent-runtimes/${encodeURIComponent(agentId)}/test-connection`,
    { method: 'POST' },
  );
  return jsonOrThrow(res);
}
