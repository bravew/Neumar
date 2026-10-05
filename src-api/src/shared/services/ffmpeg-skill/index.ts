/**
 * Managed FFmpeg skill execution.
 *
 * Transport code should import from here rather than the individual modules.
 */

export {
  catalogEntries,
  clearFfmpegContractCache,
  loadFfmpegContract,
  resolveFfmpegSkillDir,
  structuredArgumentNames,
  type CatalogEntry,
  type ContractTool,
  type LoadedFfmpegContract,
} from './contract';
export { FfmpegSkillError, isFfmpegSkillError } from './errors';
export { buildArgv, prepareArgs, validateArgs, type SkillArgs } from './argv';
export {
  authorizeOperation,
  manifestReferences,
  pathArgumentsFor,
} from './policy';
export { resolveSkillPath, skillPathRoots } from './paths';
export {
  clearSkillRuntimeCache,
  resolvePython,
  resolveSkillRuntime,
} from './runtime';
export {
  executeSkillOperation,
  type ExecuteSkillInput,
  type SkillOperationResult,
  type SkillProgress,
} from './runner';
export { runSupervised, type SupervisedRunInput } from './supervisor';
