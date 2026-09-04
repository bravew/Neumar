import apiPackage from '../../../package.json' with { type: 'json' };

/**
 * Release version from src-api/package.json. npm_package_version is only
 * present when the process is started through a package-manager script, so
 * the packaged sidecar and `node dist/index.js` must not fall back to a
 * hardcoded string.
 */
export function getApiVersion(): string {
  const version = apiPackage.version;
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error('neumar-api package.json is missing a version');
  }
  return version;
}
