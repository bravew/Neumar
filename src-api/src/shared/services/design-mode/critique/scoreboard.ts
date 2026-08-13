import type {
  DesignJuryRole,
  DesignJuryRoleScore,
  DesignLintFinding,
} from '../types';
import { DESIGN_JURY_ROLE_ORDER, roleLabel } from './protocol';

export interface DesignJuryScoreboard {
  roles: DesignJuryRoleScore[];
  overallScore: number;
  mustFix: string[];
  quickWins: string[];
}

export function scoreDesignJuryArtifact(
  content: string,
  lint: DesignLintFinding[],
): DesignJuryScoreboard {
  const lintIds = lint.map((finding) => finding.id);
  const roles = DESIGN_JURY_ROLE_ORDER.map((role) =>
    scoreRole(role, content, lintIds),
  );
  return {
    roles,
    overallScore: Math.round(
      roles.reduce((sum, role) => sum + role.score, 0) / roles.length,
    ),
    mustFix: unique(roles.flatMap((role) => role.mustFix)).slice(0, 8),
    quickWins: unique(roles.flatMap((role) => role.quickWins)).slice(0, 8),
  };
}

function scoreRole(
  role: DesignJuryRole,
  content: string,
  lintIds: string[],
): DesignJuryRoleScore {
  const text = content.toLowerCase();
  const p0Count = lintIds.filter((id) => id.startsWith('ai-slop.')).length;
  const p1Count = lintIds.length - p0Count;
  const base = role === 'critic' ? 7 : 8;
  const penalties = rolePenalties(role, text, lintIds, p0Count, p1Count);
  const score = clampScore(base - penalties.length);
  return {
    role,
    score,
    evidence: evidenceFor(role, penalties, score),
    mustFix: penalties.slice(0, 3),
    quickWins: quickWinsFor(role, text).slice(0, 3),
  };
}

function rolePenalties(
  role: DesignJuryRole,
  text: string,
  lintIds: string[],
  p0Count: number,
  p1Count: number,
): string[] {
  const penalties: string[] = [];
  if (role === 'designer') {
    if (!/<(main|section|article|aside|header|nav)\b/i.test(text)) {
      penalties.push('Add semantic regions so the hierarchy is reviewable.');
    }
    if ((text.match(/rounded/g) ?? []).length > 24) {
      penalties.push('Reduce repeated rounded-card treatment across the page.');
    }
  }
  if (role === 'critic') {
    if (p0Count > 0) penalties.push(`${p0Count} P0 lint issue(s) remain.`);
    if (p1Count > 2) penalties.push(`${p1Count} P1 craft issue(s) remain.`);
    if (
      !/prefers-reduced-motion/i.test(text) &&
      /animation|transition/.test(text)
    ) {
      penalties.push('Motion lacks a reduced-motion fallback.');
    }
  }
  if (role === 'brand') {
    const hexCount = new Set(text.match(/#[0-9a-f]{6}\b/g) ?? []).size;
    if (hexCount > 10)
      penalties.push('Too many one-off hex values dilute the design system.');
    if (/lorem ipsum|feature one|feature two|placeholder/i.test(text)) {
      penalties.push('Placeholder copy weakens the brand voice.');
    }
  }
  if (role === 'accessibility') {
    if (lintIds.includes('a11y.missing-alt')) {
      penalties.push(
        'Images need meaningful alt text or explicit decorative alt attributes.',
      );
    }
    if (!/aria-|role=/.test(text)) {
      penalties.push(
        'Interactive states need ARIA or role annotations where relevant.',
      );
    }
    if (/button/.test(text) && !/focus-visible|:focus/.test(text)) {
      penalties.push('Keyboard focus styling is not visible in the artifact.');
    }
  }
  if (role === 'copy') {
    if (
      /something went wrong|click here|submit|go<\/button>|ok<\/button>/i.test(
        text,
      )
    ) {
      penalties.push(
        'Replace vague action and error copy with specific recovery language.',
      );
    }
    if ((text.match(/\b(the|and|for|with)\b/g) ?? []).length < 8) {
      penalties.push(
        'The artifact has too little real copy to judge tone and clarity.',
      );
    }
  }
  return penalties;
}

function evidenceFor(role: DesignJuryRole, penalties: string[], score: number) {
  if (penalties.length === 0) {
    return `${roleLabel(role)} found a coherent baseline with no gated defects in this bounded pass. Score ${score}/10.`;
  }
  return `${roleLabel(role)} found ${penalties.length} issue(s): ${penalties.join(' ')} Score ${score}/10.`;
}

function quickWinsFor(role: DesignJuryRole, text: string) {
  const wins: Record<DesignJuryRole, string[]> = {
    designer: [
      'Name the primary section with a clear heading and one secondary action.',
      'Align repeated cards to a single grid rhythm.',
      'Use one accent moment per viewport.',
    ],
    critic: [
      'Run the DesignMode linter after edits and resolve P0 findings first.',
      'Promote the weakest section to a concrete before/after edit task.',
      'Keep the generated preview visible while iterating.',
    ],
    brand: [
      'Replace one-off colors with named design-system tokens.',
      'Make the strongest brand phrase appear above the fold.',
      'Remove placeholder or generic marketing phrases.',
    ],
    accessibility: [
      'Add alt text, focus-visible states, and labelled controls.',
      'Use role="status" for non-urgent loading updates.',
      'Confirm contrast on muted text against the active surface.',
    ],
    copy: [
      'Rewrite button labels as verb plus object.',
      'Give every error a cause and recovery action.',
      'Replace filler copy with brief-specific nouns.',
    ],
  };
  return text.includes('error') ? wins[role] : wins[role].slice(0, 2);
}

function clampScore(value: number) {
  return Math.max(1, Math.min(10, value));
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}
