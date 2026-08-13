import type {
  VideoPlugin,
  VideoPluginAtom,
  VideoPluginCapability,
} from './types';
import {
  VIDEO_ATOM_CAPABILITY_REQUIREMENTS,
  VIDEO_PLUGIN_ATOMS,
} from './types';

export interface VideoAtomDefinition {
  id: VideoPluginAtom;
  requiredCapabilities: readonly VideoPluginCapability[];
}

const plugins = new Map<string, VideoPlugin>();
const atoms = new Map<VideoPluginAtom, VideoAtomDefinition>();

registerBuiltinAtoms();

export function registerVideoPlugin(plugin: VideoPlugin): void {
  plugins.set(plugin.id, plugin);
}

export function registerVideoPlugins(
  nextPlugins: readonly VideoPlugin[],
): void {
  for (const plugin of nextPlugins) {
    registerVideoPlugin(plugin);
  }
}

export function getVideoPlugin(pluginId: string): VideoPlugin | undefined {
  return plugins.get(pluginId);
}

export function listVideoPlugins(): VideoPlugin[] {
  return [...plugins.values()].sort((a, b) => a.title.localeCompare(b.title));
}

export function clearVideoPluginRegistryForTests(): void {
  plugins.clear();
  atoms.clear();
  registerBuiltinAtoms();
}

export function registerVideoAtom(definition: VideoAtomDefinition): void {
  atoms.set(definition.id, definition);
}

export function getVideoAtom(
  atomId: VideoPluginAtom,
): VideoAtomDefinition | undefined {
  return atoms.get(atomId);
}

export function listVideoAtoms(): VideoAtomDefinition[] {
  return [...atoms.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function registerBuiltinAtoms(): void {
  for (const atom of VIDEO_PLUGIN_ATOMS) {
    atoms.set(atom, {
      id: atom,
      requiredCapabilities: VIDEO_ATOM_CAPABILITY_REQUIREMENTS[atom],
    });
  }
}
