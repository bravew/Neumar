import type { DesignJuryRole } from '../../types';
import { DESIGN_JURY_ROLE_ORDER } from '../protocol';
import { createDegradedCritiqueAdapter } from './degraded';
import { createScoreboardCritiqueAdapter } from './scoreboard-adapter';
import type {
  CritiquePanelistAdapter,
  CritiquePanelistCapability,
} from './types';

const adapters = new Map<string, CritiquePanelistAdapter>();
let builtInsRegistered = false;
let builtInsEnabled = true;

export function registerCritiqueAdapter(adapter: CritiquePanelistAdapter) {
  const existing = adapters.get(adapter.id);
  if (existing && existing.role !== adapter.role) {
    throw new Error(
      `Critique adapter ${adapter.id} is already registered for ${existing.role}`,
    );
  }
  adapters.set(adapter.id, adapter);
}

export function getCritiqueAdapter(
  role: DesignJuryRole,
  capability: CritiquePanelistCapability = 'primary',
) {
  ensureBuiltIns();
  return [...adapters.values()].find(
    (adapter) => adapter.role === role && adapter.capability === capability,
  );
}

export function getCritiqueAdapterById(adapterId: string) {
  ensureBuiltIns();
  return adapters.get(adapterId);
}

export function getDegradedFallback(
  role: DesignJuryRole,
  preferredId?: string,
) {
  ensureBuiltIns();
  const preferred = preferredId ? adapters.get(preferredId) : null;
  if (preferred) {
    if (preferred.role !== role || preferred.capability !== 'degraded') {
      throw new Error(
        `Fallback ${preferredId} must be a degraded adapter for ${role}`,
      );
    }
    return preferred;
  }
  return getCritiqueAdapter(role, 'degraded');
}

export function listCritiqueAdapters() {
  ensureBuiltIns();
  return [...adapters.values()].map((adapter) => ({
    id: adapter.id,
    role: adapter.role,
    capability: adapter.capability,
  }));
}

export function __resetCritiqueAdapterRegistry(registerBuiltIns = true) {
  adapters.clear();
  builtInsRegistered = false;
  builtInsEnabled = registerBuiltIns;
  if (registerBuiltIns) ensureBuiltIns();
}

function ensureBuiltIns() {
  if (!builtInsEnabled) return;
  if (builtInsRegistered) return;
  builtInsRegistered = true;
  for (const role of DESIGN_JURY_ROLE_ORDER) {
    registerCritiqueAdapter(createScoreboardCritiqueAdapter(role, 'primary'));
    registerCritiqueAdapter(createDegradedCritiqueAdapter(role));
  }
}
