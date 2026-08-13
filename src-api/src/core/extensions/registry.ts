import type { LoadedExtension, ExtensionManifest } from './types.js';

const registry = new Map<string, LoadedExtension>();

export function registerExtension(
  manifest: ExtensionManifest,
  basePath: string,
): void {
  if (registry.has(manifest.id)) {
    throw new Error(`Extension '${manifest.id}' is already registered`);
  }
  registry.set(manifest.id, { manifest, basePath });
}

export function getExtension(id: string): LoadedExtension | undefined {
  return registry.get(id);
}

export function getAllExtensions(): LoadedExtension[] {
  return Array.from(registry.values());
}

export function getContributions(type: 'skills' | 'commands' | 'settingsTabs') {
  const result = [];
  for (const ext of registry.values()) {
    const contributions = ext.manifest.contributes[type];
    if (contributions) {
      result.push(
        ...contributions.map((c) => ({ ...c, extensionId: ext.manifest.id })),
      );
    }
  }
  return result;
}

export function unregisterExtension(id: string): void {
  registry.delete(id);
}
