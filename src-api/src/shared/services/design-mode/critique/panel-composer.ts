import { createHash } from 'node:crypto';

import type { DesignJuryRole } from '../types';
import { DESIGN_JURY_ROLE_ORDER, roleLabel } from './protocol';

export interface ComposeCritiquePanelInput {
  artifactPath: string;
  subject: string;
  maxRounds?: number;
  scoreScale?: number;
  scoreThreshold?: number;
  weights?: Partial<Record<DesignJuryRole, number>>;
}

export interface ComposedCritiquePanelPrompt {
  system: string;
  promptHash: string;
}

const DEFAULT_WEIGHTS: Record<DesignJuryRole, number> = {
  designer: 1,
  critic: 1,
  brand: 1,
  accessibility: 1.2,
  copy: 0.9,
};

const ROLE_RUBRICS: Record<DesignJuryRole, string[]> = {
  designer: [
    'Evaluate hierarchy, layout rhythm, visual clarity, and component density.',
    'P0 findings include incoherent hierarchy, overlapping UI, or unusable primary flows.',
  ],
  critic: [
    'Challenge weak assumptions, generic composition, and unresolved craft issues.',
    'P0 findings include export-blocking lint defects or severe interaction ambiguity.',
  ],
  brand: [
    'Evaluate whether the artifact expresses a specific, consistent brand voice.',
    'P0 findings include placeholder copy, unrelated accents, or diluted design-system use.',
  ],
  accessibility: [
    'Evaluate semantic structure, keyboard focus, contrast, labels, and reduced-motion support.',
    'P0 findings include missing alt text, unlabeled controls, or keyboard traps.',
  ],
  copy: [
    'Evaluate information scent, action labels, error language, and tone.',
    'P0 findings include vague recovery text, filler copy, or misleading calls to action.',
  ],
};

export function composeCritiquePanelPrompt({
  artifactPath,
  subject,
  maxRounds = 3,
  scoreScale = 10,
  scoreThreshold = 0.01,
  weights = {},
}: ComposeCritiquePanelInput): ComposedCritiquePanelPrompt {
  const roleSections = DESIGN_JURY_ROLE_ORDER.map((role) => {
    const weight = weights[role] ?? DEFAULT_WEIGHTS[role];
    const rubric = ROLE_RUBRICS[role].map((line) => `- ${line}`).join('\n');
    return [
      `### ${roleLabel(role)} (${role})`,
      `Weight: ${weight}`,
      rubric,
    ].join('\n');
  }).join('\n\n');

  const system = [
    '# DesignMode Critique Panel',
    '',
    'You are a five-role review panel. Reviewers score and describe findings; they never edit source, call tools, or emit patches.',
    '',
    '## Panel Charter',
    '- Keep findings tied to observable artifact evidence.',
    '- Preserve data-neuma-id and data-neuma-source-path references when citing elements.',
    '- Surface must-fix items separately from guidance.',
    '',
    '## Role Rubrics',
    roleSections,
    '',
    '## Round Protocol',
    '- Round 1 is independent: each role scores without seeing other roles.',
    `- Rounds 2..${maxRounds} may revise scores after reading prior role findings.`,
    `- Stop early when score variance is <= ${scoreThreshold}; otherwise stop at maxRounds.`,
    `- Scores use a 1-${scoreScale} scale.`,
    '',
    '## Output Schema',
    '- Emit JSON events only: panelist_open, panelist_dim, panelist_must_fix, panelist_close, round_end, ship, degraded, interrupted, failed, parser_warning.',
    '- If parsing fails, emit parser_warning with the raw text excerpt.',
    '',
    '## Subject',
    `Path: ${artifactPath}`,
    '```html',
    subject,
    '```',
  ].join('\n');

  return {
    system,
    promptHash: createHash('sha256').update(system).digest('hex'),
  };
}
