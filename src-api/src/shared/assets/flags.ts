import { getSetting, setSetting } from '@/shared/db/operations';

export type AssetFeatureFlag = 'assets.catalog_enabled';

// Asset feature flags are opt-out: an unset flag is treated as enabled, matching
// the codebase convention for default-on settings (e.g. `sessionBudgetEnabled`,
// `assets.vec_available`). Only an explicit `'false'` disables the feature.
export function getFeatureFlag(flag: AssetFeatureFlag): boolean {
  return getSetting(flag) !== 'false';
}

export function setFeatureFlag(flag: AssetFeatureFlag, enabled: boolean): void {
  setSetting(flag, enabled ? 'true' : 'false');
}

export function isAssetsCatalogEnabled(): boolean {
  return getFeatureFlag('assets.catalog_enabled');
}

export function setAssetsCatalogEnabled(enabled: boolean): void {
  setFeatureFlag('assets.catalog_enabled', enabled);
}
