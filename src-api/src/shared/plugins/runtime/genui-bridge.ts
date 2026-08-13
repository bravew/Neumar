import type { Capability } from './capability-registry';

export type GenuiSurfaceKind = 'form' | 'choice' | 'confirmation';
export type GenuiPersistScope = 'run' | 'conversation' | 'project';

export interface GenuiSurfaceDeclaration {
  id: string;
  kind: GenuiSurfaceKind;
  persist: GenuiPersistScope;
  title?: string;
  prompt?: string;
  trigger?: Record<string, unknown>;
  schema?: Record<string, unknown>;
  options?: Array<{
    id: string;
    label: string;
    description?: string;
    preview?: string;
  }>;
  capabilitiesRequired?: Capability[];
}

export type GenuiBridgeSurface =
  | {
      type: 'ask-user-question';
      id: string;
      persist: GenuiPersistScope;
      question: string;
      options: Array<{
        id: string;
        label: string;
        description?: string;
        preview?: string;
      }>;
      capabilitiesRequired: Capability[];
    }
  | {
      type: 'custom-mcp-form';
      id: string;
      persist: GenuiPersistScope;
      title: string;
      schema: Record<string, unknown>;
      capabilitiesRequired: Capability[];
    };

type AskUserQuestionOptions = Extract<
  GenuiBridgeSurface,
  { type: 'ask-user-question' }
>['options'];

export function compileGenuiSurface(
  surface: GenuiSurfaceDeclaration,
): GenuiBridgeSurface {
  const capabilitiesRequired = surface.capabilitiesRequired ?? [];
  if (surface.kind === 'form') {
    return {
      type: 'custom-mcp-form',
      id: surface.id,
      persist: surface.persist,
      title: surface.title ?? surface.id,
      schema: surface.schema ?? { type: 'object', properties: {} },
      capabilitiesRequired,
    };
  }

  return {
    type: 'ask-user-question',
    id: surface.id,
    persist: surface.persist,
    question: surface.prompt ?? surface.title ?? surface.id,
    options: normalizeOptions(surface),
    capabilitiesRequired,
  };
}

function normalizeOptions(
  surface: GenuiSurfaceDeclaration,
): AskUserQuestionOptions {
  if (surface.kind === 'confirmation') {
    return [
      { id: 'confirm', label: 'Confirm' },
      { id: 'cancel', label: 'Cancel' },
    ];
  }
  const options = surface.options ?? [];
  return options.slice(0, 4);
}
