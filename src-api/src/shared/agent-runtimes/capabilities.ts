import type { ModeSupport, RuntimeCapabilities } from './types.js';

export type RuntimeMode = 'task' | 'design' | 'video';

/** A missing declaration is deliberately distinct from supported. */
export function getRuntimeModeSupport(
  capabilities: RuntimeCapabilities,
  mode: RuntimeMode,
): ModeSupport | null {
  return capabilities.modes?.[mode] ?? null;
}
