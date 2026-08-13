// Types for the agent runtime registry. See doc-dev/plan/2026-05-02-agent-runtime-detection-install-update.md.

export type StreamFormat =
  | 'claude-stream-json'
  | 'json-event-stream'
  | 'acp-json-rpc'
  | 'pi-rpc'
  | 'copilot-stream-json'
  | 'plain';

export type ResolvedSource =
  | 'path'
  | 'known-path'
  | 'bundled'
  | 'wsl'
  | 'configured';

export type EventParser = 'codex' | 'gemini' | 'opencode' | 'cursor-agent';
export type PromptDelivery = 'argv' | 'stdin' | 'file';

export type ModelSource = 'fallback' | 'discovered' | 'configured';
export type ModelAvailability = 'available' | 'unavailable' | 'unknown';
export type ModelCapabilityTag =
  | 'chat'
  | 'vision'
  | 'reasoning'
  | 'code'
  | 'image'
  | 'video'
  | 'audio';
export type ModelTier = 'low' | 'medium' | 'high';

export interface ModelOption {
  id: string;
  label: string;
  source?: ModelSource;
  availability?: ModelAvailability;
  unavailableReason?: string;
  contextWindowTokens?: number;
  capabilityTags?: ModelCapabilityTag[];
  costTier?: ModelTier;
  speedTier?: ModelTier;
  compatibleReasoningTiers?: string[];
  compatibleServiceTiers?: string[];
}

export interface ReasoningOption {
  id: string;
  label: string;
}

export interface BuildArgsOptions {
  model?: string;
  reasoning?: string;
}

export interface RuntimeContext {
  cwd?: string;
  promptFilePath?: string;
}

export type BuildArgsFn = (
  prompt: string,
  imagePaths: string[],
  extraAllowedDirs: string[],
  options: BuildArgsOptions,
  runtimeContext: RuntimeContext,
) => string[];

export interface ListModelsSpec {
  args: string[];
  parse: (stdout: string) => ModelOption[] | null;
  timeoutMs?: number;
}

export type FetchModelsFn = (
  resolvedBin: string,
) => Promise<ModelOption[] | null>;

export type AuthState = 'authenticated' | 'unauthenticated' | 'unknown';

export interface AuthInfo {
  state: AuthState;
  detail?: string;
}

export type AuthProbeFn = (resolvedBin: string) => Promise<AuthInfo>;

export type Platform = NodeJS.Platform;

export interface RuntimeRequirement {
  bin: string;
  versionRange?: string; // e.g. ">=22"
  reason?: string;
}

export interface RuntimeInstallOption {
  id: string; // 'npm-latest', 'brew-stable', 'install-script', …
  label: string;
  command: string; // 'npm', 'brew', 'curl', 'powershell'
  args: string[]; // structured argv; never shell-string
  platforms: Platform[];
  requires?: RuntimeRequirement[];
  network: boolean; // true → must show "this downloads from <host>" warning
  inAppRunnable: boolean; // false → copy-to-terminal only
  notes?: string;
  commandHash?: string;
  rendered?: string;
}

export interface RuntimeUpdateOption extends RuntimeInstallOption {
  // Same shape; separated so install vs update intent is explicit in UI.
  kind?: 'native' | 'reinstall';
}

export interface AgentRuntimeDef {
  id: string;
  name: string;
  bin: string;
  versionArgs: string[];
  helpArgs?: string[];
  capabilityFlags?: Record<string, string>; // flag substring → capability key
  listModels?: ListModelsSpec;
  fetchModels?: FetchModelsFn;
  fallbackModels: ModelOption[];
  reasoningOptions?: ReasoningOption[];
  promptDelivery: PromptDelivery;
  /** Deprecated compatibility mirror for existing clients. */
  promptViaStdin?: boolean;
  /** Windows UTF-8 byte budget for runtimes that pass the prompt as an argv argument. */
  windowsMaxPromptArgBytes?: number;
  /** Deprecated compatibility alias for windowsMaxPromptArgBytes. */
  maxPromptArgBytes?: number;
  streamFormat: StreamFormat;
  eventParser?: EventParser;
  buildArgs?: BuildArgsFn; // optional in v1; execution adapter is Phase 5.
  install?: RuntimeInstallOption[];
  update?: RuntimeUpdateOption[];
  authProbe?: AuthProbeFn;
  /** Optional declarations merged into probed transport capabilities. */
  capabilities?: Partial<RuntimeCapabilities>;
}

export interface RuntimeCapabilities {
  execution: boolean;
  structuredStream: boolean;
  acp: boolean;
  rpc: boolean;
  imageInput?: boolean;
  flags?: Record<string, boolean>; // probed from --help
  /** Absent means support has not been evaluated, not that it is supported. */
  modes?: Record<'task' | 'design' | 'video', ModeSupport>;
  toolApproval?: 'host-mediated' | 'runtime-native' | 'none';
  mcpInjection?: 'native' | 'workspace-config' | 'none';
  sessionContinuation?: 'by-id' | 'continue-latest' | 'acp-load' | 'none';
}

export type ModeSupport = 'supported' | 'experimental' | 'unsupported';

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
  source?: ResolvedSource;
  install?: RuntimeInstallOption[];
  update?: RuntimeUpdateOption[];
  auth?: AuthInfo;
  models: ModelOption[];
  reasoningOptions?: ReasoningOption[];
  streamFormat: StreamFormat;
  eventParser?: EventParser;
  capabilities: RuntimeCapabilities;
  diagnostics?: RuntimeDiagnostic[];
}
