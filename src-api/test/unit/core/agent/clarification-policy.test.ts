import { describe, expect, it } from 'vitest';

import {
  buildModeClarificationInstruction,
  designBriefNeedsClarification,
} from '@/core/agent/clarification-policy';

describe('designBriefNeedsClarification', () => {
  it.each([
    'Make a landing page',
    'Create a poster',
    'A dashboard for my product',
  ])('asks for clarification for ambiguous brief: %s', (prompt) => {
    expect(designBriefNeedsClarification(prompt)).toBe(true);
  });

  it.each([
    'Create a bold landing page for freelance designers with hero, feature, pricing, and call-to-action sections.',
    'Build a minimal analytics dashboard for support teams with overview cards, a ticket table, and a blue palette.',
  ])('starts immediately for complete brief: %s', (prompt) => {
    expect(designBriefNeedsClarification(prompt)).toBe(false);
  });
});

describe('buildModeClarificationInstruction', () => {
  it('keeps ordinary Task guidance free of Design discovery language', () => {
    const instruction = buildModeClarificationInstruction('task');
    expect(instruction).toContain('ordinary Task requests');
    expect(instruction).not.toContain('complete design brief');
  });

  it('uses mode-specific Design and Video rules', () => {
    expect(buildModeClarificationInstruction('design')).toContain(
      'begin work immediately',
    );
    expect(buildModeClarificationInstruction('video')).toContain(
      'destructive-edit decisions are mandatory manual gates',
    );
  });

  it.each([
    ['task', 'intended action and target are clear', 'wrong workspace'],
    ['design', 'complete design brief', 'ambiguous brief'],
    ['video', 'source assets', 'cost'],
  ] as const)(
    'defines immediate-work and clarification conditions for %s',
    (mode, completeSignal, blockerSignal) => {
      const instruction = buildModeClarificationInstruction(mode);
      expect(instruction).toContain(completeSignal);
      expect(instruction).toContain(blockerSignal);
    },
  );
});
