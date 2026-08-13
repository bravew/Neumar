import type { DesignProject, DesignSurface } from '@/shared/types/design-mode';

export function normalizeSurface(
  surface: DesignSurface | 'other',
): DesignSurface {
  return surface === 'other' ? 'prototype' : surface;
}

export function defaultMediaForSurface(
  surface: DesignSurface | 'other',
): DesignProject['media'] {
  if (surface === 'image') return { aspect: '1:1' };
  if (surface === 'video') return { aspect: '16:9', lengthSeconds: 5 };
  if (surface === 'audio') return { audioKind: 'speech', durationSeconds: 30 };
  if (surface === 'prototype') return { fidelity: 'wireframe' };
  if (surface === 'deck') return { speakerNotes: false };
  if (surface === 'template') return { animations: false };
  return undefined;
}
