import type { RunMode } from './runtime-state';

const DESIGN_SPECIFICITY_SIGNALS = [
  /\b(?:audience|users?|customers?|for\s+(?:teams?|people|creators?|businesses?))\b/i,
  /\b(?:minimal|bold|playful|editorial|corporate|luxury|color|palette|brand|tone|style)\b/i,
  /\b(?:section|screen|page|slide|deck|poster|flyer|dashboard|landing|hero|pricing|features?|cta)\b/i,
] as const;

export function designBriefNeedsClarification(prompt: string): boolean {
  const normalized = prompt.trim().replace(/\s+/g, ' ');
  const words = normalized.split(' ').filter(Boolean).length;
  const specificity = DESIGN_SPECIFICITY_SIGNALS.filter((signal) =>
    signal.test(normalized),
  ).length;
  return words < 12 || (words < 24 && specificity < 2);
}

export function buildModeClarificationInstruction(mode: RunMode): string {
  const modeGuidance = {
    task: 'When the intended action and target are clear, begin work immediately. Ask only if the request could affect the wrong workspace or resource, needs missing authority, or has materially different interpretations. Do not ask design-discovery questions for ordinary Task requests.',
    design:
      'For a complete design brief, begin work immediately. For an ambiguous brief, ask only the smallest set of choices whose answers materially change the artifact.',
    video:
      'When the brief, target format, source assets, and creative direction are sufficient, begin work immediately. Ask only when a missing choice materially changes the edit. Approval, cost, rights, upload, and destructive-edit decisions are mandatory manual gates.',
  } satisfies Record<RunMode, string>;
  return [
    '## Clarification policy',
    modeGuidance[mode],
    'Optional questions may name one safe default. Never auto-answer approval, cost, rights, upload, or destructive-edit questions.',
    'If question policy is missing or uncertain, require a manual answer.',
  ].join('\n');
}
