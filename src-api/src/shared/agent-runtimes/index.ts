// Public surface for the agent runtime registry.

export {
  AGENT_DEFS,
  getAgentDef,
  stripFns,
  fallbackModelsFor,
  clampCodexReasoning,
  parseCursorAgentModels,
  parseLineSeparatedModels,
  parsePiModels,
} from './registry.js';
export {
  detectAgents,
  detectAgent,
  invalidateDetectionCache,
  getCachedAgentRuntimeStatus,
  getCapabilities,
  deriveRuntimeCapabilities,
} from './detect.js';
export { getRuntimeModeSupport } from './capabilities.js';
export type { RuntimeMode } from './capabilities.js';
export {
  buildRuntimeConnectionTestResult,
  type RuntimeConnectionTestResult,
  type RuntimeConnectionTestStatus,
} from './connection-test.js';
export {
  isKnownModel,
  sanitizeCustomModel,
  getLiveModels,
  rememberLiveModels,
} from './validation.js';
export {
  catalog,
  describeOptions,
  commandHash,
  canonicalCommandString,
  renderShellPreview,
  findOption,
  platformOptions,
  getOptions,
} from './install.js';
export type { Intent } from './install.js';
export {
  startOperation,
  cancelOperation,
  getOperation,
  listOperations,
} from './operations.js';
export {
  AGENT_PROMPT_TOO_LARGE,
  POSIX_ARGV_PROMPT_LIMIT,
  WINDOWS_COMMAND_LINE_LIMIT,
  checkPromptArgvBudget,
  checkWindowsCmdShimCommandLineBudget,
  checkWindowsDirectExeCommandLineBudget,
  validatePromptDeliveryBudget,
} from './prompt-guards.js';
export type {
  OperationRecord,
  OperationStatus,
  StartParams,
  StartResult,
  StartFailure,
} from './operations.js';
export { resolveOnPath, getExtendedPath } from './resolve.js';
export { DEFAULT_MODEL_OPTION, withModelSource } from './models.js';
export { readQwenConfiguredModelIds } from './qwen-settings.js';
export type {
  AgentRuntimeDef,
  AgentRuntimeStatus,
  AuthInfo,
  AuthState,
  BuildArgsOptions,
  EventParser,
  ModelOption,
  ModelAvailability,
  ModelCapabilityTag,
  ModelSource,
  ModelTier,
  ModeSupport,
  PromptDelivery,
  ReasoningOption,
  ResolvedSource,
  RuntimeCapabilities,
  RuntimeContext,
  RuntimeDiagnostic,
  RuntimeInstallOption,
  RuntimeRequirement,
  RuntimeUpdateOption,
  StreamFormat,
} from './types.js';
