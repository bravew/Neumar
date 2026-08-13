function readBooleanEnvFlag(
  value: string | undefined,
  fallback: boolean,
): boolean {
  const normalized = value?.trim().toLowerCase();
  if (normalized === '1' || normalized === 'true') return true;
  if (normalized === '0' || normalized === 'false') return false;
  return fallback;
}

export function isConnectorPlatformV2Enabled(): boolean {
  return readBooleanEnvFlag(process.env.NEUMA_CONNECTORS_PLATFORM_V2, true);
}
