import type { ModeDefinition, ModeId } from './types';

const registry = new Map<ModeId, ModeDefinition>();

function pathMatches(pathname: string, pattern: RegExp | string): boolean {
  if (typeof pattern === 'string') return pathname === pattern;
  return pattern.test(pathname);
}

export const ModeRegistry = {
  register(definition: ModeDefinition): () => void {
    registry.set(definition.id, definition);
    return () => ModeRegistry.unregister(definition.id);
  },

  unregister(id: ModeId): void {
    registry.delete(id);
  },

  clear(): void {
    registry.clear();
  },

  list(options?: { includeDisabled?: boolean }): ModeDefinition[] {
    const modes = Array.from(registry.values());
    const visibleModes = options?.includeDisabled
      ? modes
      : modes.filter((mode) => mode.enabled);
    return visibleModes.sort((a, b) => a.order - b.order);
  },

  byId(id: ModeId): ModeDefinition | undefined {
    return registry.get(id);
  },

  byPath(pathname: string): ModeDefinition | undefined {
    return ModeRegistry.list().find((mode) =>
      mode.matches.some((pattern) => pathMatches(pathname, pattern)),
    );
  },
};
