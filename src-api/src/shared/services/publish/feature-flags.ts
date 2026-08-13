import { getSetting } from '@/shared/db/operations';

export const PUBLISH_PIPELINE_FLAG = 'PUBLISH_PIPELINE_ENABLED';
export const PUBLISH_RCLONE_BRIDGE_FLAG = 'PUBLISH_RCLONE_BRIDGE_ENABLED';

export function isPublishPipelineEnabled(): boolean {
  return readBooleanFlag(PUBLISH_PIPELINE_FLAG, readPublishSettingsEnabled());
}

export function isPublishDestinationEnabled(kind: string): boolean {
  if (!isPublishPipelineEnabled()) return false;
  const socialFlag = socialFlagName(kind);
  if (!socialFlag) return true;
  return readBooleanFlag(socialFlag, false);
}

export function socialFlagName(kind: string): string | null {
  const normalized = kind.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  const socialKinds = new Set([
    'YOUTUBE',
    'TIKTOK',
    'INSTAGRAM',
    'LINKEDIN',
    'X',
    'THREADS',
    'BLUESKY',
    'MASTODON',
    'PINTEREST',
    'SNAPCHAT',
    'REDDIT',
    'FACEBOOK_PAGE',
  ]);
  return socialKinds.has(normalized)
    ? `PUBLISH_SOCIAL_${normalized}_ENABLED`
    : null;
}

export function readBooleanFlag(name: string, fallback: boolean): boolean {
  const raw = getSetting(name) ?? process.env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on', 'enabled'].includes(
    String(raw).toLowerCase(),
  );
}

function readPublishSettingsEnabled(): boolean {
  const raw = getSetting('publish');
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as { enabled?: unknown };
    return parsed.enabled === true;
  } catch {
    return false;
  }
}
