import type { TranslationKeys } from '@/config/locale';

import type { CloudStorageLicenseInfo } from './AttributionChip';

export function formatCloudStorageAttribution(
  licenseInfo: CloudStorageLicenseInfo | undefined,
  t: TranslationKeys,
  tt: (key: string, params?: Record<string, string | number>) => string,
): string | null {
  if (!licenseInfo) return null;
  if (licenseInfo.attributionText) return licenseInfo.attributionText;

  const creator =
    licenseInfo.attribution?.authorName ?? licenseInfo.creatorName;
  const source =
    licenseInfo.attribution?.sourceName ?? licenseInfo.provider ?? undefined;

  if (creator && source) {
    return tt('cloudStorage.attributionByOn', { creator, source });
  }
  if (source) {
    return tt('cloudStorage.attributionOn', { source });
  }
  if (creator) {
    return tt('cloudStorage.attributionBy', { creator });
  }
  if (licenseInfo.requiresAttribution) {
    return t.cloudStorage.attributionRequired;
  }
  return licenseInfo.license ? t.cloudStorage.licenseInfo : null;
}
