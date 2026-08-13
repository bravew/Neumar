import type { DesignJuryRole } from '../types';

export const DESIGN_JURY_PROTOCOL_VERSION = 'design-jury.v1' as const;
export const DESIGN_JURY_MAX_REVIEW_CHARS = 120_000;

export const DESIGN_JURY_ROLE_ORDER: DesignJuryRole[] = [
  'designer',
  'critic',
  'brand',
  'accessibility',
  'copy',
];

const ROLE_LABELS: Record<DesignJuryRole, string> = {
  designer: 'Designer',
  critic: 'Critic',
  brand: 'Brand',
  accessibility: 'Accessibility',
  copy: 'Copy',
};

export function roleLabel(role: DesignJuryRole) {
  return ROLE_LABELS[role];
}

export function isReviewablePath(filePath: string) {
  return /\.(html?|md|markdown|txt)$/i.test(filePath);
}
