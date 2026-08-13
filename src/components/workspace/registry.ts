import type { Artifact } from '../artifacts/types';
import type { WorkspaceContext, WorkspaceRegistration } from './types';

/**
 * Workspace Registry — class-based singleton pattern matching backend AgentRegistry.
 * Uses Map for O(1) lookups by id, sorted array for priority-based resolution.
 */
class WorkspaceRegistryImpl {
  private registrations = new Map<string, WorkspaceRegistration>();
  private sorted: WorkspaceRegistration[] = [];

  register(registration: WorkspaceRegistration): void {
    if (this.registrations.has(registration.id) && import.meta.env.DEV) {
      console.warn(
        `[WorkspaceRegistry] Overwriting existing workspace: ${registration.id}`,
      );
    }
    this.registrations.set(registration.id, registration);
    this.sorted = Array.from(this.registrations.values()).sort(
      (a, b) => b.priority - a.priority,
    );
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.log(
        `[WorkspaceRegistry] Registered: ${registration.id} (${registration.name})`,
      );
    }
  }

  resolve(
    artifact: Artifact,
    context: WorkspaceContext,
  ): WorkspaceRegistration | null {
    for (const ws of this.sorted) {
      if (!ws.types.includes(artifact.type)) continue;
      if (ws.canHandle && !ws.canHandle(artifact, context)) continue;
      return ws;
    }
    return null;
  }

  get(id: string): WorkspaceRegistration | undefined {
    return this.registrations.get(id);
  }

  getAll(): readonly WorkspaceRegistration[] {
    return this.sorted;
  }

  has(id: string): boolean {
    return this.registrations.has(id);
  }
}

// Singleton instance (consistent with backend pattern in AgentRegistry)
let globalRegistry: WorkspaceRegistryImpl | null = null;

export function getWorkspaceRegistry(): WorkspaceRegistryImpl {
  if (!globalRegistry) {
    globalRegistry = new WorkspaceRegistryImpl();
  }
  return globalRegistry;
}

// Convenience functions for common operations
export function registerWorkspace(registration: WorkspaceRegistration): void {
  getWorkspaceRegistry().register(registration);
}

export function resolveWorkspace(
  artifact: Artifact,
  context: WorkspaceContext,
): WorkspaceRegistration | null {
  return getWorkspaceRegistry().resolve(artifact, context);
}
