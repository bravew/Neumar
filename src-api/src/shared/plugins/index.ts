/**
 * Plugin module — public surface.
 *
 * The desktop API and skills compat shim consume the plugin loader through
 * this barrel; never import the internal files directly outside this folder.
 */

export {
  parseManifest,
  formatZodIssues,
  readManifestFile,
  PluginManifestSchema,
  PLUGIN_NAME_RE,
  SEMVER_RE,
  MANIFEST_FILENAMES,
  type PluginManifest,
  type ManifestParseResult,
} from './manifest';

export {
  parsePluginIdentifier,
  formatIdentifier,
  isOfficialMarketplaceName,
  type ParsedIdentifier,
} from './identifier';

export {
  buildEffectivePluginConfig,
  buildPublicPluginConfig,
  getPluginConfigFields,
  pluginConfigSecretName,
  validatePluginConfigPatch,
  type EffectivePluginConfigValue,
  type PluginConfigPatchValue,
  type PluginConfigPrimitive,
  type PluginConfigValidationEntry,
  type PluginConfigValidationResult,
  type PublicPluginConfigValue,
  type StoredPluginConfigValue,
} from './config';

export {
  loadPlugins,
  loadAllSkills,
  loadPluginsFromRoot,
  loadSkillFromDir,
  getPluginLoaderGeneration,
  invalidatePluginLoaderCache,
  stopPluginHotReload,
  type LoadedPlugin,
  type LoadedSkill,
  type PluginScope,
  type PluginLoaderConfig,
  type SkillMetadata,
} from './loader';

export { resolveBuiltinPluginRoot, resetBuiltinPluginRootCache } from './paths';

export { bundledPluginId, reconcileBuiltinPlugins } from './builtins';

export {
  compileTmpl,
  createPlugin,
  type CreatePluginOptions,
  type CreatePluginResult,
  type PluginTemplate,
} from './scaffold';

export {
  fetchAllRegistries,
  fetchRegistryByUrl,
  getConfiguredRegistries,
  invalidateRegistryCache,
  DEFAULT_MARKETPLACE_URL,
  MarketplaceIndexSchema,
  type MarketplaceIndex,
  type MarketplacePlugin,
  type RegistryFetchResult,
} from './marketplace';

export {
  addMarketplaceSource,
  ensureDefaultMarketplaceSource,
  getMarketplaceSources,
  listAvailablePlugins,
  MarketplaceSourceError,
  refreshMarketplaceSource,
  removeMarketplaceSource,
  resolveCatalogEntry,
  type AvailablePluginEntry,
  type MarketplaceSource,
  type MarketplaceSourceStatus,
  type MarketplaceSourceTrust,
} from './sources';

export {
  copyAndHash,
  installPluginFromDir,
  INSTALL_MAX_FILE_BYTES,
  INSTALL_MAX_FILES,
  INSTALL_MAX_TOTAL_BYTES,
  PluginInstallError,
  type InstallProvenance,
} from './install';

export {
  extractZipToTemp,
  fetchCatalogPlugin,
  fetchGithubPlugin,
  fetchUrlPlugin,
  parseGithubRef,
  resolvePluginFetchTarget,
  fetchTargetRef,
  type CatalogSource,
  type CatalogSourceObject,
  type GithubRef,
  type PluginFetchTarget,
} from './remote-install';

export {
  inspectCatalogPlugin,
  type PluginInspection,
  type InspectedSkill,
  type InspectedEvals,
} from './inspect';

export {
  verifyManifestSignature,
  type VerifyResult,
  type VerifyVerdict,
} from './verify';

export * from './task';
export * from './design';
